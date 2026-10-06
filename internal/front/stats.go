package front

import (
	"encoding/json"

	"playground/core/server"
	"playground/internal/stats"
)

const boardSize = 20

type statsAPI struct{ slot *stats.Slot }

// NewStats is the pilot API over slot; nil slot (stats off) is a nil
// server.Stats, never a typed nil.
func NewStats(slot *stats.Slot) server.Stats {
	if slot == nil {
		return nil
	}
	return statsAPI{slot}
}

func (a statsAPI) Ready() bool     { return a.slot.Ready() }
func (statsAPI) Periods() []string { return []string{"week", "all"} }

// Board is GET /api/leaderboard's body: {"period","week","top"}. nil when
// the store closed after Ready (nothing to cache), as the server did before.
func (a statsAPI) Board(name string) []byte {
	period, _ := stats.ParsePeriod(name) // the server only passes allowed names
	top, week := a.slot.Top(period, boardSize)
	if week == "" {
		return nil
	}
	if top == nil {
		top = []stats.Entry{}
	}
	b, _ := json.Marshal(struct {
		Period string        `json:"period"`
		Week   string        `json:"week"`
		Top    []stats.Entry `json:"top"`
	}{name, week, top})
	return b
}

// Me is GET /api/me's body for a known pilot: {"pilot":{card…,"favorite"}}.
func (a statsAPI) Me(hash string) ([]byte, bool) {
	p, ok := a.slot.Me(hash)
	if !ok {
		return nil, false
	}
	b, _ := json.Marshal(struct {
		Pilot any `json:"pilot"`
	}{struct {
		stats.Pilot
		Favorite string `json:"favorite"`
	}{p, p.Favorite()}})
	return b, true
}
