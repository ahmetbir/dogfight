package moderation

import (
	"errors"
	"strings"
	"unicode/utf8"
)

const (
	minPattern = 3  // normalised runes: a shorter pattern would block half the names
	maxPattern = 64 // bytes of the pattern as typed
	minSquash  = 5  // squashed runes a pattern needs before its squashed form is matched too
)

// ErrPattern is a pattern that normalises to fewer than minPattern runes or is too long.
var ErrPattern = errors.New("moderation: pattern must normalise to at least 3 letters or digits and be at most 64 bytes")

// rule is one compiled pattern.
type rule struct {
	norm, squashed string // squashed "" = not matched squashed
}

func compile(pattern string) (rule, error) {
	n := Normalize(pattern)
	if len(pattern) > maxPattern || utf8.RuneCountInString(n) < minPattern {
		return rule{}, ErrPattern
	}
	r := rule{norm: n}
	if q := squash(n); utf8.RuneCountInString(q) >= minSquash {
		r.squashed = q
	}
	return r, nil
}

// match: the normalised pattern is a substring of the normalised name, or
// (for long enough patterns) the squashed one of the squashed name, so
// doubled letters do not slip past ("aallaattiinn").
func (r rule) match(norm, squashed string) bool {
	return strings.Contains(norm, r.norm) || r.squashed != "" && strings.Contains(squashed, r.squashed)
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
	n := Normalize(name)
	q := squash(n)
	for _, r := range l.rules {
		if r.match(n, q) {
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

// Matcher is the single-pattern match of Blocked, for finding ledger rows
// by a name (lookup, purge-name) with the same rule the block uses.
func Matcher(pattern string) (func(name string) bool, error) {
	r, err := compile(pattern)
	if err != nil {
		return nil, err
	}
	return func(name string) bool {
		n := Normalize(name)
		return r.match(n, squash(n))
	}, nil
}

// same reports whether two patterns block the same names.
func same(a, b string) bool { return a == b || Normalize(a) == Normalize(b) }
