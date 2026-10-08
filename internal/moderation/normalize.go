// Package moderation holds the server-side list of blocked pilot names. The
// list lives in <data>/moderation.json on the server, never in the repo; the
// repo only has the mechanism.
package moderation

import (
	"strings"
	"unicode"
)

// Normalize folds a name for matching: Turkish letters and common accents to
// their ASCII base, look-alike Cyrillic and Greek letters to Latin, leetspeak
// digits and signs to letters, lower case, and everything but letters and
// digits dropped ("Z 0 r l u K@r7al" → "zorlukartal"). A cheap NFKD-ish fold:
// combining marks are dropped, so a decomposed "c" + U+0327 folds like "ç".
func Normalize(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r = fold(r); r != 0 {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// fold is one rune of Normalize; 0 drops it.
func fold(r rune) rune {
	if r >= 0xFF01 && r <= 0xFF5E { // fullwidth ASCII
		r -= 0xFEE0
	}
	switch r {
	case 'İ', 'I', 'ı': // Turkish dotted/dotless i: never "ı" via ToLower
		return 'i'
	}
	r = unicode.ToLower(r)
	if m, ok := folds[r]; ok {
		return m
	}
	if unicode.IsLetter(r) || unicode.IsDigit(r) {
		return r
	}
	return 0
}

// folds maps a lower-case rune to the letter it stands for.
var folds = func() map[rune]rune {
	m := map[rune]rune{
		'0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', // leetspeak
		'ß': 's', 'æ': 'a', 'œ': 'o',
	}
	for _, group := range []string{
		// Latin accents (Turkish ç ş ğ ö ü ı among them).
		"aàáâãäåāăąǎ", "cçćĉċč", "dďđ", "eèéêëēĕėęě", "gĝğġģ", "hĥħ", "iìíîïĩīĭįı", "jĵ", "kķ",
		"lĺļľŀł", "nñńņňŉ", "oòóôõöøōŏőǒ", "rŕŗř", "sśŝşšș", "tţťŧț", "uùúûüũūŭůűųǔ", "wŵ", "yýÿŷ", "zźżž",
		// Cyrillic and Greek look-alikes.
		"aаα", "bвβ", "cс", "eеёε", "hн", "iіїι", "jј", "kкκ", "mм", "oоο", "pрρ", "sѕ", "tтτ", "uυ", "vν", "xхχ", "yу",
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

// squash collapses runs of one rune ("aallaattiinn" → "alatin").
func squash(s string) string {
	var b strings.Builder
	var last rune = -1
	for _, r := range s {
		if r != last {
			b.WriteRune(r)
		}
		last = r
	}
	return b.String()
}
