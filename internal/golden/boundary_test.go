package golden

import (
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
)

const module = "playground"

// coreAllow lists, per core package directory, the Dogfight packages it may
// still import while it is being made generic. It only ever shrinks; the
// extraction is done when it is empty.
var coreAllow = map[string][]string{}

// TestCoreImportsNothingFromDogfight: core/** (tests included) imports only
// the standard library, coder/websocket and core/**.
func TestCoreImportsNothingFromDogfight(t *testing.T) {
	root := filepath.Join("..", "..", "core")
	if _, err := os.Stat(root); os.IsNotExist(err) {
		t.Skip("no core/ yet")
	}
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") {
			return err
		}
		f, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(filepath.Join("..", ".."), filepath.Dir(path))
		for _, im := range f.Imports {
			p, _ := strconv.Unquote(im.Path.Value)
			switch {
			case !strings.Contains(strings.SplitN(p, "/", 2)[0], ".") && !strings.HasPrefix(p, module+"/"):
				// standard library
			case p == "github.com/coder/websocket":
			case strings.HasPrefix(p, module+"/core/"):
			case slices.Contains(coreAllow[filepath.ToSlash(rel)], p):
			default:
				t.Errorf("%s imports %s", path, p)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// TestDockerfileCopiesEveryGoDir: the reproducible build copies every
// top-level directory holding Go code the server is built from.
func TestDockerfileCopiesEveryGoDir(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "Dockerfile"))
	if err != nil {
		t.Fatal(err)
	}
	copied := map[string]bool{}
	for _, m := range regexp.MustCompile(`(?m)^COPY (\w+)/ `).FindAllStringSubmatch(string(b), -1) {
		copied[m[1]] = true
	}
	for _, dir := range []string{"cmd", "internal", "core"} {
		if _, err := os.Stat(filepath.Join("..", "..", dir)); err == nil && !copied[dir] {
			t.Errorf("Dockerfile does not COPY %s/", dir)
		}
	}
}
