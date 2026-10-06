package match

import (
	"reflect"
	"testing"

	"github.com/ahmetbir/roomkit/room"
	"playground/internal/sim"
)

type nopBox struct{}

func (nopBox) To(room.PlayerID, any) {}
func (nopBox) All(any)               {}
func (nopBox) Snap(room.Acker)       {}
func (nopBox) Changed()              {}

// The room's input map is the game's input map: Step converts nothing.
func TestStepPassesTheRoomMapThrough(t *testing.T) {
	if reflect.TypeOf(map[room.PlayerID]sim.Input{}) != reflect.TypeOf(map[sim.ID]sim.Input{}) {
		t.Fatal("sim.ID and room.PlayerID differ: Step would copy the input map every tick")
	}
}

// Step's allocations do not grow with the number of inputs: no per-tick map copy.
func TestStepAllocsIndependentOfInputCount(t *testing.T) {
	big := ffa4
	big.Size = 16
	m := New(big, nil)
	ids := make([]room.PlayerID, 16)
	for i := range ids {
		ids[i], _ = m.Join(room.Who{Name: "p"})
	}
	var b nopBox
	for range 10 {
		m.Step(nil, b)
	}
	full := map[room.PlayerID]sim.Input{}
	for _, id := range ids {
		full[id] = sim.Input{Throttle: 1}
	}
	measure := func(in map[room.PlayerID]sim.Input) float64 {
		return testing.AllocsPerRun(200, func() { m.Step(in, b) })
	}
	with, without := measure(full), measure(nil)
	if with > without+1 {
		t.Fatalf("allocs/step with inputs %.1f vs none %.1f", with, without)
	}
}
