package protocol

import (
	"encoding/json"
	"os"
	"regexp"
	"slices"
	"strconv"
	"testing"

	"github.com/ahmetbir/roomkit/netproto"
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

// The client says the same protocol version in its hello
// (client/src/net/protocol.ts VERSION); both move together.
func TestVersionMatchesClient(t *testing.T) {
	const file = "../../client/src/net/protocol.ts"
	b, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`export const VERSION = (\d+);`).FindSubmatch(b)
	if m == nil || string(m[1]) != strconv.Itoa(Version) {
		t.Fatalf("%s VERSION %q, server %d", file, m, Version)
	}
}

func TestErrorWire(t *testing.T) {
	b, err := json.Marshal(netproto.NewError(netproto.CodeFull, "oda dolu"))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `{"t":"error","msg":"oda dolu","code":"full"}` {
		t.Fatal(string(b))
	}
}

// Notice codes are non-empty, distinct and never a core error or API code:
// the client looks a code up in one table per message kind.
func TestNoticeCodesDistinct(t *testing.T) {
	seen := map[string]bool{}
	for _, c := range append(netproto.ErrorCodes(), netproto.APICodes()...) {
		seen[c] = true
	}
	for _, c := range NoticeCodes() {
		if c == "" || seen[c] {
			t.Errorf("notice code %q is empty or taken", c)
		}
		seen[c] = true
	}
}
