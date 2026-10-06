package protocol

import (
	"encoding/json"
	"os"
	"regexp"
	"slices"
	"testing"

	"playground/core/netproto"
)

// The client lists the same error and notice codes (client/src/net/codes.ts)
// and translates each; the two lists must not drift.
func TestCodesMatchClient(t *testing.T) {
	b, err := os.ReadFile("../../client/src/net/codes.ts")
	if err != nil {
		t.Fatal(err)
	}
	for name, want := range map[string][]string{"ERROR_CODES": ErrorCodes(), "NOTICE_CODES": NoticeCodes()} {
		m := regexp.MustCompile(`(?s)export const ` + name + ` = \[(.*?)\] as const`).FindSubmatch(b)
		if m == nil {
			t.Fatalf("codes.ts lacks %s", name)
		}
		var got []string
		for _, q := range regexp.MustCompile(`"([a-z_]+)"`).FindAllSubmatch(m[1], -1) {
			got = append(got, string(q[1]))
		}
		if !slices.Equal(got, want) {
			t.Fatalf("%s: client %v, server %v", name, got, want)
		}
	}
}

func TestErrorWire(t *testing.T) {
	b, err := json.Marshal(netproto.NewError(CodeFull, "oda dolu"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `{"t":"error","msg":"oda dolu","code":"full"}` {
		t.Fatal(string(b))
	}
}

func TestNoticeCodesRegister(t *testing.T) {
	if _, err := netproto.NewCodes(NoticeCodes()...); err != nil {
		t.Fatal(err)
	}
}
