// Package moderation holds the server-side list of blocked pilot names. The
// list lives in <data>/moderation.json on the server, never in the repo; the
// repo only has the mechanism.
package moderation

import (
	_ "embed"
	"strconv"
	"strings"
	"unicode"
)

// Normalize is the matching skeleton of a name: every rune folded to the
// Latin letters it looks like (Unicode confusables: Cyrillic, Greek,
// Cherokee, math alphanumerics, letterlike symbols, Roman numerals,
// fullwidth forms; small capitals; Turkish and other accented letters to
// their base; leetspeak), lower case, then the look-alike classes merged
// (i, l, I, 1, |, ! are one letter), and everything that is not a letter or
// a digit dropped. Both a name and a pattern go through it, so "AIaattin",
// "A1aattin" and "Alaattin" share one skeleton. The skeleton is for
// matching only, never shown.
func Normalize(s string) string { return string(skeleton(s).r) }

// text is a skeleton with its word boundaries: b[i] is true when a word
// starts at r[i] (spacing or punctuation in the original came before it).
// The start and the end of the text are boundaries too.
type text struct {
	r []rune
	b []bool
}

func skeleton(s string) text {
	var t text
	gap := true
	for _, r := range s {
		out := foldRune(r)
		if out == "" {
			if separates(r) {
				gap = true
			}
			continue
		}
		for _, c := range out {
			if n := len(t.r); n > 0 && isDigit(t.r[n-1]) != isDigit(c) {
				gap = true // "kartal99": letters and digits are separate words
			}
			t.r = append(t.r, c)
			t.b = append(t.b, gap)
			gap = false
		}
	}
	return t
}

func isDigit(r rune) bool { return r >= '0' && r <= '9' }

// boundary reports whether a word starts or ends at i (0..len).
func (t text) boundary(i int) bool { return i == 0 || i == len(t.r) || t.b[i] }

// separates: runes that drop out but split words (spaces, punctuation,
// symbols). Invisible format characters and combining marks drop out
// without splitting, so "Ala​attin" stays one word.
func separates(r rune) bool {
	return unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r)
}

// foldRune is one rune of the skeleton: "" drops it.
func foldRune(r rune) string {
	switch r {
	case 'İ', 'I', 'ı', 'i': // Turkish dotted/dotless i, before the table maps I to l
		return "i"
	}
	if r >= 0xFF01 && r <= 0xFF5E { // fullwidth ASCII
		r -= 0xFEE0
	}
	if t, ok := confusables[r]; ok {
		var b strings.Builder
		for _, c := range t {
			b.WriteString(foldASCII(c))
		}
		return b.String()
	}
	if r < 0x80 {
		return foldASCII(r)
	}
	r = unicode.ToLower(r)
	if m, ok := accents[r]; ok {
		return string(m)
	}
	if unicode.IsLetter(r) || unicode.IsDigit(r) {
		return string(r)
	}
	return ""
}

// foldASCII: lower case, leetspeak and the i/l class; "" for the rest.
func foldASCII(r rune) string {
	if r >= 'A' && r <= 'Z' {
		r += 'a' - 'A'
	}
	if m, ok := leet[r]; ok {
		r = m
	}
	switch {
	case r == 'l':
		return "i"
	case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
		return string(r)
	}
	return ""
}

var leet = map[rune]rune{
	'0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '+': 't', '|': 'i', '!': 'i',
}

// accents maps lower-case accented Latin letters (Turkish ç ş ğ ö ü among
// them) to their base; combining marks have no entry and drop out.
var accents = func() map[rune]rune {
	m := map[rune]rune{'€': 'e', 'ß': 's'}
	for _, group := range []string{
		"aàáâãäåāăąǎ", "cçćĉċč", "dď", "eèéêëēĕėęě", "gĝğġģ", "hĥ", "iìíîïĩīĭį", "jĵ", "kķ",
		"lĺļľŀ", "nñńņňŉ", "oòóôõöōŏőǒ", "rŕŗř", "sśŝşšș", "tţťț", "uùúûüũūŭůűųǔ", "wŵ", "yýÿŷ", "zźżž",
	} {
		base := []rune(group)[0]
		for _, r := range group {
			if r != base {
				m[r] = base
			}
		}
	}
	return m
}()

//go:generate go run confusables_gen.go -in /tmp/confusables.txt
//go:embed latin_confusables.txt
var confusablesData string

// confusables: source rune → the ASCII letters/digits it looks like.
var confusables = func() map[rune]string {
	m := map[rune]string{}
	for _, line := range strings.Split(confusablesData, "\n") {
		src, target, ok := strings.Cut(line, "\t")
		if !ok || strings.HasPrefix(line, "#") {
			continue
		}
		v, err := strconv.ParseUint(src, 16, 32)
		if err != nil {
			panic("moderation: bad confusables line " + line)
		}
		m[rune(v)] = target
	}
	return m
}()

// squash collapses runs of one rune, keeping word boundaries
// ("aallaattiinn" → "alatin").
func (t text) squash() text {
	var out text
	for i, r := range t.r {
		if n := len(out.r); n > 0 && out.r[n-1] == r {
			continue
		}
		out.r = append(out.r, r)
		out.b = append(out.b, t.boundary(i))
	}
	return out
}
