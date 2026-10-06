package protocol

import (
	"encoding/json"
	"os"
	"regexp"
	"slices"
	"testing"

	"playground/core/netproto"
)

// The client lists the same error and notice codes (client/src/core/net/codes.ts, client/src/net/codes.ts)
// and translates each; the two lists must not drift.
func TestCodesMatchClient(t *testing.T) {
	for _, c := range []struct {
		file, name string
		want       []string
	}{
		{"../../client/src/core/net/codes.ts", "ERROR_CODES", netproto.ErrorCodes()},
		{"../../client/src/net/codes.ts", "NOTICE_CODES", NoticeCodes()},
	} {
		b, err := os.ReadFile(c.file)
		if err != nil {
			t.Fatal(err)
		}
		m := regexp.MustCompile(`(?s)export const ` + c.name + ` = \[(.*?)\] as const`).FindSubmatch(b)
		if m == nil {
			t.Fatalf("%s lacks %s", c.file, c.name)
		}
		var got []string
		for _, q := range regexp.MustCompile(`"([a-z_]+)"`).FindAllSubmatch(m[1], -1) {
			got = append(got, string(q[1]))
		}
		if !slices.Equal(got, c.want) {
			t.Fatalf("%s: client %v, server %v", c.name, got, c.want)
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
