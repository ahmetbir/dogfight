package game

import "testing"

// "Berabere" is the draw sentinel in Round.Winner, so no player may carry it.
func TestDrawNameIsReserved(t *testing.T) {
	for _, n := range []string{"Berabere", " berabere ", "BERABERE"} {
		if got := cleanName(n); got != defaultName {
			t.Fatalf("cleanName(%q) = %q, want %q", n, got, defaultName)
		}
	}
	if got := cleanName("Berabereci"); got != "Berabereci" {
		t.Fatalf("cleanName(Berabereci) = %q", got)
	}
}
