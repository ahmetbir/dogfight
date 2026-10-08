package moderation

import (
	"errors"
	"slices"
	"strings"
)

const (
	minPattern = 3  // skeleton runes: a shorter pattern would block half the names
	maxPattern = 64 // bytes of the pattern as typed
	minSquash  = 5  // squashed runes a pattern needs before its squashed form is matched too
)

// ErrPattern is a pattern that normalises to fewer than minPattern runes or is too long.
var ErrPattern = errors.New("moderation: a pattern needs at least 3 letters or digits and at most 64 bytes (modes: words, *part*, =exact)")

// Mode is how a pattern matches a name, both as skeletons (Normalize).
type Mode uint8

const (
	// Words (the default, "zorlu kartal"): the pattern occurs in the name
	// starting and ending on word boundaries of the name as typed (spaces,
	// punctuation). "ali" blocks "Ali" and "Ali Veli", not "Halil" or "Salih".
	// Spacing inside it does not matter: "z o r l u" is still caught.
	Words Mode = iota
	// Part ("*kartal*"): anywhere in the name, also inside words.
	Part
	// Exact ("=zorlu kartal"): the whole name, nothing more.
	Exact
)

// rule is one compiled pattern.
type rule struct {
	mode     Mode
	pat      []rune // skeleton
	squashed []rune // nil = not matched squashed
}

// parse splits a typed pattern into its mode and text.
func parse(pattern string) (Mode, string) {
	p := strings.TrimSpace(pattern)
	switch {
	case strings.HasPrefix(p, "="):
		return Exact, p[1:]
	case len(p) > 2 && strings.HasPrefix(p, "*") && strings.HasSuffix(p, "*"):
		return Part, p[1 : len(p)-1]
	}
	return Words, p
}

func compile(pattern string) (rule, error) {
	if len(pattern) > maxPattern {
		return rule{}, ErrPattern
	}
	mode, body := parse(pattern)
	t := skeleton(body)
	if len(t.r) < minPattern {
		return rule{}, ErrPattern
	}
	r := rule{mode: mode, pat: t.r}
	if q := t.squash(); len(q.r) >= minSquash {
		r.squashed = q.r
	}
	return r, nil
}

// match: the rule against a name's skeleton, and (for long enough patterns)
// the squashed pattern against the squashed name, so doubled letters do
// not slip past ("aallaattiinn").
func (r rule) match(name text) bool {
	if r.matchText(r.pat, name) {
		return true
	}
	return r.squashed != nil && r.matchText(r.squashed, name.squash())
}

func (r rule) matchText(pat []rune, t text) bool {
	switch r.mode {
	case Exact:
		return slices.Equal(pat, t.r)
	case Part:
		return strings.Contains(string(t.r), string(pat))
	}
	for i := 0; i+len(pat) <= len(t.r); i++ {
		if t.boundary(i) && t.boundary(i+len(pat)) && slices.Equal(t.r[i:i+len(pat)], pat) {
			return true
		}
	}
	return false
}

// List is an immutable set of blocked-name patterns.
type List struct {
	patterns []string // as the admin typed them
	rules    []rule
}

// NewList compiles patterns; it fails on the first bad one.
func NewList(patterns []string) (*List, error) {
	l := &List{}
	for _, p := range patterns {
		r, err := compile(p)
		if err != nil {
			return nil, err
		}
		l.patterns = append(l.patterns, p)
		l.rules = append(l.rules, r)
	}
	return l, nil
}

// Blocked reports whether any pattern matches name. A nil List blocks nothing.
func (l *List) Blocked(name string) bool {
	if l == nil || len(l.rules) == 0 {
		return false
	}
	t := skeleton(name)
	for _, r := range l.rules {
		if r.match(t) {
			return true
		}
	}
	return false
}

// Patterns returns a copy of the patterns as typed.
func (l *List) Patterns() []string {
	if l == nil {
		return nil
	}
	return append([]string(nil), l.patterns...)
}

// Matcher is the single-pattern match of Blocked (same modes), for finding
// ledger rows by a pattern (lookup, purge-name).
func Matcher(pattern string) (func(name string) bool, error) {
	r, err := compile(pattern)
	if err != nil {
		return nil, err
	}
	return func(name string) bool { return r.match(skeleton(name)) }, nil
}

// same reports whether two patterns block the same names.
func same(a, b string) bool {
	if a == b {
		return true
	}
	ma, ta := parse(a)
	mb, tb := parse(b)
	return ma == mb && Normalize(ta) == Normalize(tb)
}
