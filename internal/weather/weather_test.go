package weather

import (
	"math"
	"testing"
)

func TestTable(t *testing.T) {
	want := map[Kind]Spec{Clear: {1, 0, 0}, Cloudy: {1, 3, 1}, Fog: {0.6, 0, 0}, Rain: {0.8, 6, 2}, Storm: {0.7, 10, 6}, Night: {1, 2, 0}}
	for k, s := range want {
		if k.Spec() != s {
			t.Fatalf("%v: %+v", k, k.Spec())
		}
		if got, ok := ParseKind(k.String()); !ok || got != k {
			t.Fatalf("round trip %v", k)
		}
	}
	if _, ok := ParseKind("kar"); ok || Kind(0).Spec() != Clear.Spec() {
		t.Fatal("unknown kinds")
	}
}

func TestWind(t *testing.T) {
	a, b := Wind(Storm, 7), Wind(Storm, 7)
	if a != b || a.Y != 0 || math.Abs(a.Len()-10) > 1e-9 {
		t.Fatalf("storm wind %v", a)
	}
	if Wind(Storm, 8) == a {
		t.Fatal("direction must depend on the seed")
	}
	if Wind(Clear, 7).Len() != 0 || Wind(Fog, 7).Len() != 0 {
		t.Fatal("calm weathers have no wind")
	}
}
