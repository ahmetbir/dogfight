package protocol

import (
	"encoding/json"
	"os"
	"regexp"
	"slices"
	"testing"

	"playground/core/netproto"
)

// The client lists the same notice codes (client/src/net/codes.ts) and
// translates each; the lists must not drift. (The core error codes are
// pinned in core/netproto.)
func TestNoticeCodesMatchClient(t *testing.T) {
	const file = "../../client/src/net/codes.ts"
	b, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`(?s)export const NOTICE_CODES = \[(.*?)\] as const`).FindSubmatch(b)
	if m == nil {
		t.Fatalf("%s lacks NOTICE_CODES", file)
	}
	var got []string
	for _, q := range regexp.MustCompile(`"([a-z_]+)"`).FindAllSubmatch(m[1], -1) {
		got = append(got, string(q[1]))
	}
	if !slices.Equal(got, NoticeCodes()) {
		t.Fatalf("NOTICE_CODES: client %v, server %v", got, NoticeCodes())
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
