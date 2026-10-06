package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"playground/core/pilot"
	"playground/internal/stats"
)

const (
	roomsTTL  = time.Second      // how long one /api/rooms body is served before it is rebuilt
	boardTTL  = 10 * time.Second // same for each /api/leaderboard period
	boardSize = 20
)

// User-facing API error texts.
const (
	msgStatsOff  = "istatistik kapalı"
	msgBadPeriod = "geçersiz dönem"
	msgNoAPI     = "bulunamadı"
	msgRequests  = "çok fazla istek"
)

// apiCache holds one JSON body for ttl; a nil body from build is not kept.
type apiCache struct {
	mu   sync.Mutex
	at   time.Time
	body []byte
}

func (c *apiCache) get(now time.Time, ttl time.Duration, build func() []byte) []byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.body == nil || now.Sub(c.at) >= ttl {
		c.body, c.at = build(), now
	}
	return c.body
}

func writeJSON(w http.ResponseWriter, status int, body []byte) {
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	w.Write(body)
}

// errorJSON is an API error body: the Turkish text and its stable code.
func errorJSON(msg string) []byte {
	b, _ := json.Marshal(map[string]string{"error": msg, "code": errCode(msg)})
	return b
}

// apiAllow spends one API token of the caller's address; when none is left
// it answers 429 (503 while draining) and reports false.
func (s *Server) apiAllow(w http.ResponseWriter, r *http.Request) bool {
	if s.o.Metrics != nil {
		s.o.Metrics.API.Inc(strings.TrimPrefix(r.URL.Path, "/api/")) // fixed set; anything else is "other"
	}
	if s.apiDraining(w) {
		return false
	}
	ip := clientIP(r, s.o.TrustProxy)
	key := limitKey(ip)
	if s.apis.Allow(key, s.o.Now()) {
		return true
	}
	s.rejects.note(s.keyedReason(s.apis, key, "api-rate"), ip.String())
	writeJSON(w, http.StatusTooManyRequests, errorJSON(msgRequests))
	return false
}

type roomJSON struct {
	Code   string  `json:"code"`
	Mode   string  `json:"mode"`
	Map    string  `json:"map"`
	Wx     string  `json:"wx"`
	Humans int     `json:"humans"`
	Seats  int     `json:"seats"`
	Phase  string  `json:"phase"`
	Left   int     `json:"left"`            // seconds left in the round
	Teams  *[2]int `json:"teams,omitempty"` // humans on NATO, Soviet (team and base modes)
}

// apiRooms is GET /api/rooms: the listed rooms, rebuilt at most once per roomsTTL.
func (s *Server) apiRooms(w http.ResponseWriter, r *http.Request) {
	if !s.apiAllow(w, r) {
		return
	}
	writeJSON(w, http.StatusOK, s.rooms.get(s.o.Now(), roomsTTL, func() []byte {
		list := s.lobby.List()
		out := struct {
			Rooms []roomJSON `json:"rooms"`
		}{Rooms: make([]roomJSON, 0, len(list))}
		for _, x := range list {
			row := roomJSON{x.Code, x.Mode, x.Map, x.Weather, x.Humans, x.Seats, x.Phase, x.LeftS, nil}
			if x.Mode != "ffa" {
				row.Teams = &[2]int{x.NATO, x.Soviet}
			}
			out.Rooms = append(out.Rooms, row)
		}
		b, _ := json.Marshal(out)
		return b
	}))
}

// apiLeaderboard is GET /api/leaderboard?period=week|all: the top pilots,
// rebuilt at most once per boardTTL per period.
func (s *Server) apiLeaderboard(w http.ResponseWriter, r *http.Request) {
	if !s.apiAllow(w, r) {
		return
	}
	if s.o.Stats == nil || !s.o.Stats.Ready() {
		writeJSON(w, http.StatusServiceUnavailable, errorJSON(msgStatsOff))
		return
	}
	name := r.URL.Query().Get("period")
	period, ok := stats.ParsePeriod(name) // whitelisted before it is echoed
	if !ok {
		writeJSON(w, http.StatusBadRequest, errorJSON(msgBadPeriod))
		return
	}
	body := s.boards[period].get(s.o.Now(), boardTTL, func() []byte {
		top, week := s.o.Stats.Top(period, boardSize)
		if week == "" { // the store closed after Ready: no board, nothing cached
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
	})
	if body == nil {
		writeJSON(w, http.StatusServiceUnavailable, errorJSON(msgStatsOff))
		return
	}
	writeJSON(w, http.StatusOK, body)
}

// noPilot is /api/me's answer for a missing, malformed, oversize or unknown
// token: one body for all, so it never tells which.
var noPilot = []byte(`{"pilot":null}`)

// dummyToken is hashed in place of a malformed token, so every answer
// costs one hash and one lookup (no timing tell between bad and unknown).
const dummyToken = "AAAAAAAAAAAAAAAAAAAAAA"

// apiMe is GET /api/me with the X-Pilot-Token header: {"pilot":{...}} with
// the caller's own card, or {"pilot":null}. Stats off: 503.
func (s *Server) apiMe(w http.ResponseWriter, r *http.Request) {
	if !s.apiAllow(w, r) {
		return
	}
	if s.o.Stats == nil || !s.o.Stats.Ready() {
		writeJSON(w, http.StatusServiceUnavailable, errorJSON(msgStatsOff))
		return
	}
	tok := r.Header.Get(pilot.Header)
	valid := pilot.Valid(tok) // checked before hashing: any length is refused in O(1)
	if !valid {
		tok = dummyToken
	}
	p, ok := s.o.Stats.Me(pilot.Hash(tok))
	if !valid || !ok {
		writeJSON(w, http.StatusOK, noPilot)
		return
	}
	b, _ := json.Marshal(struct {
		Pilot any `json:"pilot"`
	}{struct {
		stats.Pilot
		Favorite string `json:"favorite"`
	}{p, p.Favorite()}})
	writeJSON(w, http.StatusOK, b)
}

// apiNotFound answers any other /api/ path in JSON.
func (s *Server) apiNotFound(w http.ResponseWriter, r *http.Request) {
	if !s.apiAllow(w, r) {
		return
	}
	writeJSON(w, http.StatusNotFound, errorJSON(msgNoAPI))
}
