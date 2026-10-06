package netproto

import (
	"encoding/json"
	"math"
	"testing"
)

func TestCoreMessagesWire(t *testing.T) {
	for _, c := range []struct {
		v    any
		want string
	}{
		{NewPong(5), `{"t":"pong","ts":5}`},
		{NewError(CodeFull, "oda dolu"), `{"t":"error","msg":"oda dolu","code":"full"}`},
		{NewError("", "x"), `{"t":"error","msg":"x"}`},
		{NewNotice("team_full", "Takım dolu"), `{"t":"notice","msg":"Takım dolu","code":"team_full"}`},
		{NewChat(3, 2), `{"t":"chat","from":3,"id":2}`},
	} {
		b, err := json.Marshal(c.v)
		if err != nil || string(b) != c.want {
			t.Errorf("%T: %s %v, want %s", c.v, b, err, c.want)
		}
	}
}

func TestCheckHeader(t *testing.T) {
	ok := []Header{{T: TPing, TS: 1}, {T: TChat, Chat: 1}, {T: TChat, Chat: 6}, {T: TIn, Seq: 1}}
	for _, h := range ok {
		if err := CheckHeader(h, 6); err != nil {
			t.Errorf("%+v: %v", h, err)
		}
	}
	if err := CheckHeader(Header{T: TChat, Chat: 7}, 6); err != ErrBadChat {
		t.Errorf("chat 7: %v", err)
	}
	if err := CheckHeader(Header{T: TChat}, 6); err != ErrBadChat {
		t.Errorf("chat 0: %v", err)
	}
	if err := CheckHeader(Header{T: TPing, TS: math.Inf(1)}, 6); err != ErrNotFinite {
		t.Errorf("inf ts: %v", err)
	}
}

func TestNewCodesRefusesCollisions(t *testing.T) {
	c, err := NewCodes("team_full", "team_late")
	if err != nil || len(c.Notices) != 2 || len(c.Errors) != len(ErrorCodes()) || len(c.API) != 4 {
		t.Fatalf("%+v %v", c, err)
	}
	for _, bad := range [][]string{{"full"}, {"rate"}, {"x", "x"}, {""}} {
		if _, err := NewCodes(bad...); err == nil {
			t.Errorf("%v accepted", bad)
		}
	}
}

func TestCleanName(t *testing.T) {
	for in, want := range map[string]string{
		"  Ace  ":                    "Ace",
		"":                           "Pilot",
		"‮​\t":                       "Pilot",
		"​​":                         "Pilot",
		"a‮b⁦c‏d\x00e":               "abcde",
		"abcdefghijklmnopqrstuvwxyz": "abcdefghijklmnop",
		"ÇğüşİöÇğüşİöÇğüşİöXYZ": "ÇğüşİöÇğüşİöÇğüş",
		"\xff\xfeok": "ok",
		"ㅤᅟᅠﾠ⠀":      "Pilot", // blank-looking fillers
		"aㅤb":        "ab",
		"á́́́́b̀":   "á́b̀", // at most 2 marks per letter
	} {
		if got := CleanName(in); got != want {
			t.Errorf("CleanName(%q) = %q, want %q", in, got, want)
		}
	}
}
