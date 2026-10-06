// Command loadtest drives simulated dogfight players over WebSocket and
// reports per-second throughput, snapshot timing and disconnects.
//
// Each player does the real handshake (hello, then create / join / quick,
// then pick once the roster names its team), sends 60 Hz inputs with
// moving sticks, cannon bursts, missiles and flares, pings once a second
// and reads every server message.
//
// Per-address limits: the server allows 6 sockets, 3 room creations and
// 20 joins per address per minute. From one machine, run it only against
// a TEST instance started with raised limits, e.g.
//
//	dogfight -max-conns-ip 1000 -max-conns 1000 -create-per-min-ip 1000 \
//	         -join-per-min-ip 1000 -join-fail-per-min-ip 1000 -max-rooms 64
//
// on a private network next to the load test. Never point it at the
// production instance (or through Cloudflare): its limits refuse it, and
// its players would share the box with the test.
//
// -bench needs no server: it times one all-bot room's sim tick and
// snapshot encoding on this CPU, to compare two machines.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"playground/internal/bot"
	"playground/internal/game"
	"playground/internal/maps"
	"playground/internal/mode"
	"playground/internal/protocol"
	"playground/internal/sim"
	"playground/internal/weather"
)

type config struct {
	url                            string
	players, rooms, size           int
	mode, diff, mapName, wx, start string
	duration, ramp, settle, every  time.Duration
	bench                          bool
	benchTicks, benchClients       int
}

func parseFlags(args []string) (config, error) {
	var c config
	fl := flag.NewFlagSet("loadtest", flag.ContinueOnError)
	fl.StringVar(&c.url, "url", "ws://127.0.0.1:8080/ws", "game socket URL, ws:// or wss:// (empty path = /ws)")
	fl.IntVar(&c.players, "players", 6, "simulated players")
	fl.IntVar(&c.rooms, "rooms", 1, "rooms the players are spread over, round-robin; the first player of each creates it (0 = quick play)")
	fl.StringVar(&c.mode, "mode", "team", "room mode: team|ffa|base")
	fl.IntVar(&c.size, "size", 6, "room size: per team for team/base (max 6), seats for ffa (max 12); seats without a player are bots")
	fl.StringVar(&c.diff, "diff", "normal", "bot difficulty: easy|normal|hard")
	fl.StringVar(&c.mapName, "map", "ada", "map: ada|sehir|col|dag")
	fl.StringVar(&c.wx, "wx", "acik", "weather: acik|bulutlu|sisli|yagmurlu|firtina|gece")
	fl.StringVar(&c.start, "start", "hava", "start: hava|pist")
	fl.DurationVar(&c.duration, "duration", 60*time.Second, "run time after the ramp")
	fl.DurationVar(&c.ramp, "ramp", 10*time.Second, "players connect evenly over this time")
	fl.DurationVar(&c.settle, "settle", 5*time.Second, "after the ramp, time excluded from the steady-state summary")
	fl.DurationVar(&c.every, "every", time.Second, "report interval")
	fl.BoolVar(&c.bench, "bench", false, "no network: time one all-bot room's tick + snapshot encoding on this CPU (uses -mode -size -diff -map -wx -start)")
	fl.IntVar(&c.benchTicks, "bench-ticks", 3600, "ticks the bench measures")
	fl.IntVar(&c.benchClients, "bench-clients", 12, "snapshot encodes per snapshot in the bench (one per connected player)")
	if err := fl.Parse(args); err != nil {
		return c, err
	}
	if c.players < 1 || c.rooms < 0 || c.duration <= 0 || c.ramp < 0 || c.every <= 0 {
		return c, fmt.Errorf("need -players >= 1, -rooms >= 0, -duration > 0, -ramp >= 0, -every > 0")
	}
	if !c.bench {
		u, err := wsURL(c.url)
		if err != nil {
			return c, fmt.Errorf("-url: %v", err)
		}
		c.url = u
	}
	return c, nil
}

// settings validates the room flags and returns them as a create message
// and as game settings (for -bench).
func (c config) settings() (protocol.ClientMsg, game.Settings, error) {
	k, ok1 := mode.ParseKind(c.mode)
	d, ok2 := bot.ParseDifficulty(c.diff)
	mk, ok3 := maps.ParseKind(c.mapName)
	wk, ok4 := weather.ParseKind(c.wx)
	if !ok1 || !ok2 || !ok3 || !ok4 || (c.start != "hava" && c.start != "pist") {
		return protocol.ClientMsg{}, game.Settings{}, fmt.Errorf("bad room settings: mode=%q diff=%q map=%q wx=%q start=%q", c.mode, c.diff, c.mapName, c.wx, c.start)
	}
	if slots := mode.NewRules(k, c.size).Slots(); !c.bench && humansPerRoom(c.players, c.rooms) > slots {
		return protocol.ClientMsg{}, game.Settings{}, fmt.Errorf("%d players per room exceed the room's %d seats", humansPerRoom(c.players, c.rooms), slots)
	}
	start := sim.StartAir
	if c.start == "pist" {
		start = sim.StartRunway
	}
	m := protocol.ClientMsg{T: protocol.TCreate, Mode: c.mode, Size: c.size, Diff: c.diff, Map: c.mapName, Wx: c.wx, Start: c.start, Vis: "ozel"}
	return m, game.Settings{Mode: k, Size: c.size, Difficulty: d, Seed: 1, Map: mk, Weather: wk, Start: start}, nil
}

func main() {
	c, err := parseFlags(os.Args[1:])
	if errors.Is(err, flag.ErrHelp) {
		return
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "loadtest:", err)
		os.Exit(2)
	}
	create, gs, err := c.settings()
	if err != nil {
		fmt.Fprintln(os.Stderr, "loadtest:", err)
		os.Exit(2)
	}
	if c.bench {
		fmt.Printf("bench: mode=%s size=%d map=%s wx=%s\n", c.mode, c.size, c.mapName, c.wx)
		runBench(gs, c.benchTicks, c.benchClients).print(os.Stdout)
		return
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	run(ctx, c, create)
}

// run starts every player on its ramp slot and reports until the run ends.
func run(ctx context.Context, c config, create protocol.ClientMsg) {
	fmt.Printf("loadtest: url=%s players=%d rooms=%d mode=%s size=%d map=%s wx=%s start=%s ramp=%s duration=%s\n",
		c.url, c.players, c.rooms, c.mode, c.size, c.mapName, c.wx, c.start, c.ramp, c.duration)
	st := newStats()
	codes := make([]*roomCode, c.rooms)
	for i := range codes {
		codes[i] = newRoomCode()
	}
	begin := time.Now()
	rctx, cancel := context.WithDeadline(ctx, begin.Add(c.ramp+c.duration))
	defer cancel()
	var wg sync.WaitGroup
	for i, sl := range assign(c.players, c.rooms) {
		p := &player{i: i, slot: sl, url: c.url, entry: create, st: st, epoch: begin}
		if sl.room >= 0 {
			p.code = codes[sl.room]
		}
		wg.Go(func() {
			select {
			case <-time.After(time.Until(begin.Add(startAt(i, c.players, c.ramp)))):
				p.run(rctx)
			case <-rctx.Done():
			}
		})
	}
	from, end := report(rctx, c, st, begin)
	wg.Wait()
	fmt.Println(summary(from, end, st.handshake.Snapshot(), st.reasonCounts()))
}

// report prints a line every c.every until ctx ends; it returns the
// samples that bound the steady-state window (ramp + settle to the end).
func report(ctx context.Context, c config, st *stats, begin time.Time) (from, end sample) {
	t := time.NewTicker(c.every)
	defer t.Stop()
	prev := st.sample(0)
	steady := false
	for {
		select {
		case <-ctx.Done():
			// The last periodic sample ends the window: at the deadline
			// players are already closing, which would skew per-client rates.
			if !steady {
				from = sample{} // never steady: the whole run
			}
			end = prev
			if end.at <= from.at {
				end = st.sample(time.Since(begin))
			}
			return from, end
		case <-t.C:
			cur := st.sample(time.Since(begin))
			fmt.Println(line(prev, cur))
			if !steady && cur.at >= c.ramp+c.settle {
				from, steady = cur, true
			}
			prev = cur
		}
	}
}
