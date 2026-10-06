package protocol

import (
	"encoding/json"
	"testing"

	"playground/core/netproto"
	"playground/internal/sim"
)

func TestDecodeTeamWhitelist(t *testing.T) {
	for in, want := range map[string]sim.Team{"nato": sim.TeamNATO, "soviet": sim.TeamSoviet, "auto": sim.TeamNone} {
		m, err := DecodeClient([]byte(`{"t":"team","team":"` + in + `"}`))
		if err != nil || m.T != TTeam {
			t.Fatalf("%s: %v", in, err)
		}
		if got, ok := ParseTeam(m.Team); !ok || got != want {
			t.Fatalf("%s → %v %v", in, got, ok)
		}
	}
	for _, bad := range []string{`{"t":"team"}`, `{"t":"team","team":""}`, `{"t":"team","team":"none"}`, `{"t":"team","team":"NATO"}`, `{"t":"team","team":1}`} {
		if _, err := DecodeClient([]byte(bad)); err == nil {
			t.Fatalf("%s accepted", bad)
		}
	}
	// Other messages may not smuggle a bad team, but need none.
	if _, err := DecodeClient([]byte(`{"t":"ping","ts":1}`)); err != nil {
		t.Fatal(err)
	}
}

func TestNoticeWire(t *testing.T) {
	b, _ := json.Marshal(netproto.NewNotice(CodeTeamFull, "x"))
	if string(b) != `{"t":"notice","msg":"x","code":"team_full"}` {
		t.Fatal(string(b))
	}
}
