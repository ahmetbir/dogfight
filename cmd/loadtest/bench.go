package main

import (
	"encoding/json"
	"fmt"
	"io"
	"time"

	"playground/internal/game"
	"playground/internal/protocol"
)

// benchResult is one room's CPU cost on this machine, single-threaded.
type benchResult struct {
	ticks     int
	step      time.Duration // total game.Step time
	snaps     int
	snapBuild time.Duration // total NewSnap time
	marshals  int
	marshal   time.Duration // total per-client JSON encode time
	snapBytes int           // bytes of the last encoded snapshot
	maxStep   time.Duration
}

// roomCPU is the fraction of one core a room needs at 60 Hz ticks and
// 30 Hz snapshots to `clients` players: sim, snapshot build and one JSON
// encode per player per snapshot (the server encodes per connection).
func (r benchResult) roomCPU() float64 {
	if r.ticks == 0 || r.snaps == 0 || r.marshals == 0 {
		return 0
	}
	perTick := float64(r.step) / float64(r.ticks)
	perSnap := float64(r.snapBuild) / float64(r.snaps)
	perMarshal := float64(r.marshal) / float64(r.marshals)
	clientsPerSnap := float64(r.marshals) / float64(r.snaps)
	perSec := 60*perTick + 30*(perSnap+clientsPerSnap*perMarshal)
	return perSec / float64(time.Second)
}

// runBench steps an all-bot room for ticks (after a 10 s warm-up) and
// encodes every 2nd tick's snapshot once per client, like a room actor
// plus its connections' writers. It needs no network: run the same binary
// on two machines and divide the per-tick times to get their speed ratio.
func runBench(st game.Settings, ticks, clients int) benchResult {
	g := game.New(st)
	for range 600 {
		g.Step(nil)
	}
	var r benchResult
	var events []protocol.EventJSON
	for range ticks {
		t0 := time.Now()
		evs := g.Step(nil)
		d := time.Since(t0)
		r.step += d
		r.maxStep = max(r.maxStep, d)
		r.ticks++
		tick := g.Tick()
		events = append(events, protocol.NewEvents(evs, tick)...)
		if tick%2 != 0 {
			continue
		}
		t1 := time.Now()
		snap := protocol.NewSnap(g.Snapshot(), events, tick)
		r.snapBuild += time.Since(t1)
		r.snaps++
		events = nil
		for c := range clients {
			snap.Ack = uint32(c)
			t2 := time.Now()
			b, err := json.Marshal(snap)
			r.marshal += time.Since(t2)
			if err != nil {
				panic(err) // plain numbers and strings always marshal
			}
			r.snapBytes = len(b)
			r.marshals++
		}
	}
	return r
}

func (r benchResult) print(w io.Writer) {
	avg := func(d time.Duration, n int) float64 {
		if n == 0 {
			return 0
		}
		return float64(d) / float64(n) / 1e3
	}
	cpu := r.roomCPU()
	fmt.Fprintf(w, "bench: ticks=%d step_avg=%.1fus step_max=%.1fus snap_build_avg=%.1fus marshal_avg=%.1fus snap_bytes=%d\n",
		r.ticks, avg(r.step, r.ticks), float64(r.maxStep)/1e3, avg(r.snapBuild, r.snaps), avg(r.marshal, r.marshals), r.snapBytes)
	fmt.Fprintf(w, "bench: room_cpu=%.2f%% of one core (60 Hz sim + 30 Hz snapshot to %d clients); rooms_per_core=%.1f\n",
		cpu*100, r.marshals/max(r.snaps, 1), 1/max(cpu, 1e-9))
}
