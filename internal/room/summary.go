package room

import "playground/internal/game"

// Summary is what the lobby lists of a room: published by the actor,
// readable from any goroutine.
type Summary struct {
	Code, Mode, Map, Weather, Phase string // phase: playing|ended
	Humans, Seats, LeftS            int
	NATO, Soviet                    int // humans per team (team and base modes)
	Listed                          bool
	Seq                             int64 // lobby creation order
}

// publish stores a fresh summary; called by the actor only (and by New
// before the actor starts).
func (r *Room) publish() {
	st := r.game.Settings()
	rd := r.game.Round()
	phase := "playing"
	if rd.Phase == game.Ended {
		phase = "ended"
	}
	nato, soviet := r.game.HumanTeams()
	r.summary.Store(&Summary{NATO: nato, Soviet: soviet, Code: r.code, Mode: st.Mode.String(), Map: st.Map.String(), Weather: st.Weather.String(),
		Phase: phase, Humans: r.game.Humans(), Seats: r.seats, LeftS: rd.TicksLeft / TickRate, Listed: st.Listed, Seq: r.seq})
}

// Summary is the latest published summary; safe from any goroutine.
func (r *Room) Summary() Summary { return *r.summary.Load() }
