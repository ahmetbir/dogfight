package protocol

import (
	"reflect"
	"testing"

	"github.com/ahmetbir/roomkit/netproto"
)

// Dogfight's welcome carries the core envelope (netproto.Welcome) under the
// same JSON names: the client core rejoins with its code after a drain.
func TestWelcomeCarriesCoreEnvelope(t *testing.T) {
	tags := map[string]bool{}
	for f := range reflect.TypeFor[Welcome]().Fields() {
		tags[f.Tag.Get("json")] = true
	}
	for f := range reflect.TypeFor[netproto.Welcome]().Fields() {
		if !tags[f.Tag.Get("json")] {
			t.Errorf("Welcome lacks the core field %q", f.Tag.Get("json"))
		}
	}
}
