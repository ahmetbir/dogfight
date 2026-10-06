package sim

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

// v1CheckpointsSHA256 pins the checkpoints of the first ten (v1) scenarios
// in flight.json. They were frozen at v1 (41d562d, f1378842…); the
// controller ruling for feedback #1 (FB-A flight model: control inertia,
// pitch asymmetry, induced drag, afterburner heat) lifted that freeze once
// and this is the re-frozen value: a change means the air path drifted.
const v1CheckpointsSHA256 = "d1f9a054f6c534ef6fe4510f84e1a838a326f6ffae3b8177ed5bb90f9fdfab30"

// v1CheckpointsHash hashes name + compacted checkpoints JSON of the first
// ten scenarios, so formatting of the rest of the file does not matter.
func v1CheckpointsHash(data []byte) (string, error) {
	var f struct {
		Scenarios []struct {
			Name        string          `json:"name"`
			Checkpoints json.RawMessage `json:"checkpoints"`
		} `json:"scenarios"`
	}
	if err := json.Unmarshal(data, &f); err != nil {
		return "", err
	}
	h := sha256.New()
	for _, sc := range f.Scenarios[:min(10, len(f.Scenarios))] {
		var buf bytes.Buffer
		if err := json.Compact(&buf, sc.Checkpoints); err != nil {
			return "", err
		}
		h.Write([]byte(sc.Name + "\n"))
		h.Write(buf.Bytes())
		h.Write([]byte("\n"))
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func TestV1VectorCheckpointsFrozen(t *testing.T) {
	data, err := os.ReadFile(vectorsPath)
	if err != nil {
		t.Fatal(err)
	}
	got, err := v1CheckpointsHash(data)
	if err != nil {
		t.Fatal(err)
	}
	if got != v1CheckpointsSHA256 {
		t.Fatalf("v1 flight-vector checkpoints changed (sha256 %s): the airborne path drifted from v1", got)
	}
}
