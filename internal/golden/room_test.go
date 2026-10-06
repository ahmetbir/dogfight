package golden

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"slices"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"playground/core/room"
	"playground/internal/game"
	"playground/internal/match"
	"playground/internal/protocol"
	"playground/internal/sim"
	"playground/internal/stats"
)

// newRoom builds a Dogfight room the way the lobby does. It is the only
// code in this file later refactor tasks may change (the constructor
// moves); scenarios and golden files never change.
func newRoom(code string, s game.Settings, sink *sink) *match.Room {
	return room.New(code, match.New(s, sink), room.Options{Seq: 1})
}

// sink records pilot tallies into the transcript ("sink" session) and sums
// them per pilot for the scenario's own checks.
type sink struct {
	tr  *transcript
	mu  sync.Mutex
	sum map[string]stats.Delta
}

func (s *sink) Record(d stats.Delta) bool {
	b, err := json.Marshal(d)
	if err != nil {
		panic(err)
	}
	s.tr.addRaw("sink", "delta", b)
	s.mu.Lock()
	t := s.sum[d.Pilot]
	t.Kills, t.BotKills, t.Deaths, t.Crashes = t.Kills+d.Kills, t.BotKills+d.BotKills, t.Deaths+d.Deaths, t.Crashes+d.Crashes
	t.Wins, t.Matches, t.Fired, t.Hits, t.Flight = t.Wins+d.Wins, t.Matches+d.Matches, t.Fired+d.Fired, t.Hits+d.Hits, t.Flight+d.Flight
	s.sum[d.Pilot] = t
	s.mu.Unlock()
	return true
}

func (s *sink) total(pilot string) stats.Delta {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sum[pilot]
}

// rec is a room.Sender that records into a transcript. Snapshots, and
// round messages in which only the clock moved, go into runs (one line per
// run); every other message is a line of its own. The events of each snapshot that involve the
// seat's own plane (except cannon "fire") are kept readable in "<name>.ev".
type rec struct {
	tr    *transcript
	name  string
	mu    sync.Mutex
	me    sim.ID
	last  protocol.Snap
	has   bool
	team  map[sim.ID]string // from the latest roster
	phase string            // of the latest round message
	round []byte            // the latest round message without its clock
}

// repeat reports whether rd equals the previous round message but for the
// seconds left, and remembers it.
func (r *rec) repeat(rd protocol.RoundMsg) bool {
	rd.TicksLeft = 0
	b, _ := json.Marshal(rd)
	same := bytes.Equal(b, r.round)
	r.round = b
	return same
}

func (r *rec) Send(v any) bool {
	snap, ok := v.(protocol.Snap)
	if !ok {
		if rd, ok := v.(protocol.RoundMsg); ok {
			r.mu.Lock()
			r.phase = rd.Phase
			r.mu.Unlock()
			if r.repeat(rd) { // only the clock moved: part of the run
				b, _ := json.Marshal(rd)
				r.tr.addRun(r.name, b)
				return true
			}
		}
		if pl, ok := v.(protocol.PlayersMsg); ok {
			r.mu.Lock()
			r.team = map[sim.ID]string{}
			for _, p := range pl.List {
				r.team[p.ID] = p.Team
			}
			r.mu.Unlock()
		}
		r.tr.add(r.name, v)
		return true
	}
	b, err := json.Marshal(snap)
	if err != nil {
		panic(err)
	}
	r.tr.addRun(r.name, b)
	r.mu.Lock()
	r.last, r.has = snap, true
	me := r.me
	r.mu.Unlock()
	for _, e := range snap.Events {
		if e.K == "fire" || me == 0 || (e.A != me && e.B != me && e.O != me) {
			continue
		}
		e.Pos, e.Vel = nil, nil
		j, _ := json.Marshal(e)
		r.tr.addRaw(r.name+".ev", e.K, j)
	}
	return true
}

func (r *rec) Close() { r.tr.addRaw(r.name, "close", []byte(`{"t":"close"}`)) }

func (r *rec) snap() (protocol.Snap, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.last, r.has
}

const tick = time.Second / 60

// h drives one room inside a synctest bubble. Every action happens half a
// tick after a tick boundary, so no action races the ticker.
type h struct {
	t      *testing.T
	s      game.Settings
	r      *match.Room
	tr     *transcript
	sink   *sink
	cancel context.CancelFunc
	seats  map[string]*match.Seat
	recs   map[string]*rec
	pilots map[string]*autoPilot
	seqs   map[string]uint32
}

func start(t *testing.T, s game.Settings) *h {
	tr := newTranscript()
	sk := &sink{tr: tr, sum: map[string]stats.Delta{}}
	r := newRoom("GOLD", s, sk)
	ctx, cancel := context.WithCancel(t.Context())
	go r.Run(ctx)
	time.Sleep(tick / 2)
	synctest.Wait()
	return &h{t: t, s: s, r: r, tr: tr, sink: sk, cancel: cancel, seats: map[string]*match.Seat{},
		recs: map[string]*rec{}, pilots: map[string]*autoPilot{}, seqs: map[string]uint32{}}
}

func (x *h) join(name, pilotHash, tok string) {
	rc := &rec{tr: x.tr, name: name}
	seat, err := x.r.Join(x.t.Context(), room.Who{Name: name, Pilot: pilotHash, NewToken: tok}, rc)
	if err != nil {
		x.t.Fatalf("join %s: %v", name, err)
	}
	rc.mu.Lock()
	rc.me = sim.ID(seat.ID())
	rc.mu.Unlock()
	x.seats[name], x.recs[name] = seat, rc
	synctest.Wait()
}

// autopilot hands a seat's stick to a brain (see autoPilot); seed varies it.
func (x *h) autopilot(name string, seed int64) {
	x.pilots[name] = newPilot(sim.ID(x.seats[name].ID()), x.s, seed)
}

func (x *h) send(name string, m protocol.ClientMsg) { x.seats[name].Input(m); synctest.Wait() }

// pick sends the kind of the seat's current team: nato (or none) or soviet.
func (x *h) pick(name, nato, soviet, lo string) {
	rc := x.recs[name]
	rc.mu.Lock()
	tm := rc.team[rc.me]
	rc.mu.Unlock()
	kind := nato
	if tm == "soviet" {
		kind = soviet
	}
	x.send(name, protocol.ClientMsg{T: protocol.TPick, Kind: kind, Lo: lo})
}

func (x *h) run(n int) {
	for range n {
		time.Sleep(tick)
		synctest.Wait()
	}
}

func (x *h) leave(name string) {
	x.seats[name].Leave()
	delete(x.seats, name)
	delete(x.pilots, name)
	synctest.Wait()
}

func (x *h) flush() {
	if !x.r.FlushStats(x.t.Context()) {
		x.t.Fatal("flush not acknowledged")
	}
	synctest.Wait()
}

func (x *h) stop() []byte {
	x.cancel()
	<-x.r.Done()
	synctest.Wait()
	return x.tr.bytes()
}

// next is the seat's next input: its autopilot's on the latest snapshot,
// else the scripted stick.
func (x *h) next(name string) protocol.ClientMsg {
	x.seqs[name]++
	seq := x.seqs[name]
	if p, ok := x.pilots[name]; ok {
		if s, ok := x.recs[name].snap(); ok {
			return p.input(s, seq)
		}
	}
	return stick(seq, float64(len(name)))
}

// phase is the round phase the seat last heard.
func (x *h) phase(name string) string {
	rc := x.recs[name]
	rc.mu.Lock()
	defer rc.mu.Unlock()
	return rc.phase
}

// fly sends one input per tick for every named seat for n ticks.
func (x *h) fly(n int, names ...string) {
	slices.Sort(names)
	for range n {
		for _, name := range names {
			x.seats[name].Input(x.next(name))
		}
		x.run(1)
	}
}

// flyUntil flies the named seats in 60-tick steps until names[0] hears
// phase; past limit ticks it fails (with the transcript diff), never spins.
func (x *h) flyUntil(phase string, limit int, names ...string) {
	n := 0
	for ; x.phase(names[0]) != phase && n < limit; n += 60 {
		x.fly(60, names...)
	}
	if x.phase(names[0]) != phase {
		x.t.Errorf("phase %q not reached in %d ticks", phase, limit)
	}
}

// burst queues k inputs of one seat inside one tick, the first ones
// carrying the one-shot presses press sets: more than the room keeps
// (backlog trim) or holds (queue overflow), so presses must merge forward.
func (x *h) burst(name string, k int, press func(i int, m *protocol.ClientMsg)) {
	for i := range k {
		m := x.next(name)
		m.M, m.FL, m.BO = false, false, false
		press(i, &m)
		x.seats[name].Input(m)
	}
	synctest.Wait()
}

// stick is a deterministic input for seq: smooth sinusoids, a missile every
// 120, a flare every 200 and a bomb every 300.
func stick(seq uint32, phase float64) protocol.ClientMsg {
	f := float64(seq) / 60
	r3 := func(v float64) float64 { return math.Round(v*1000) / 1000 }
	return protocol.ClientMsg{
		T: protocol.TIn, Seq: seq,
		P: r3(0.2 + 0.3*math.Sin(0.7*f+phase)), R: r3(0.6 * math.Sin(0.5*f+2*phase)), Y: r3(0.1 * math.Sin(f)),
		Th: r3(0.8 + 0.2*math.Sin(0.3*f)), AB: seq%240 < 60, F: seq%90 < 20,
		M: seq%120 == 0, FL: seq%200 == 0, BO: seq%300 == 0,
	}
}

// played fails unless every named pilot hash has a non-empty tally.
func (x *h) played(pilots ...string) {
	for _, p := range pilots {
		if x.sink.total(p).Empty() {
			x.t.Errorf("pilot %s has no tally in the sink", p)
		}
	}
}
