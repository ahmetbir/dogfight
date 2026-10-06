package geom

import (
	"math"
	"testing"
)

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }
func nearV(a, b Vec3) bool   { return near(a.X, b.X) && near(a.Y, b.Y) && near(a.Z, b.Z) }

func TestVecOps(t *testing.T) {
	a, b := V(1, 2, 3), V(4, 5, 6)
	if got := a.Add(b); got != V(5, 7, 9) {
		t.Fatalf("Add = %v", got)
	}
	if got := a.Dot(b); got != 32 {
		t.Fatalf("Dot = %v", got)
	}
	if got := V(1, 0, 0).Cross(V(0, 1, 0)); got != V(0, 0, 1) {
		t.Fatalf("Cross = %v", got)
	}
	if got := (Vec3{}).Norm(); got != (Vec3{}) {
		t.Fatalf("zero Norm = %v", got)
	}
}

func TestPitchUpRaisesNose(t *testing.T) {
	q := AxisAngle(V(1, 0, 0), 0.3) // +pitch about local right
	if f := q.Forward(); f.Y <= 0 {
		t.Fatalf("forward after +pitch = %v, want Y>0", f)
	}
}

func TestRollRightLowersRightWing(t *testing.T) {
	q := AxisAngle(V(0, 0, -1), 0.3) // +roll about forward axis
	if r := q.Right(); r.Y >= 0 {
		t.Fatalf("right after +roll = %v, want Y<0", r)
	}
}

func TestMulOrderLocal(t *testing.T) {
	yaw := AxisAngle(V(0, 1, 0), math.Pi/2) // nose -Z -> -X
	pitch := AxisAngle(V(1, 0, 0), math.Pi/2)
	f := yaw.Mul(pitch).Forward() // local pitch after yaw: nose straight up
	if !nearV(f, V(0, 1, 0)) {
		t.Fatalf("forward = %v, want up", f)
	}
}

func TestLookRotation(t *testing.T) {
	dir := V(1, 0.2, -0.5).Norm()
	q := LookRotation(dir, V(0, 1, 0))
	if !nearV(q.Forward(), dir) {
		t.Fatalf("Forward = %v, want %v", q.Forward(), dir)
	}
}

func TestVecMoreOps(t *testing.T) {
	a, b := V(1, 2, 3), V(4, 6, 3)
	if got := b.Sub(a); got != V(3, 4, 0) {
		t.Fatalf("Sub = %v", got)
	}
	if got := a.Scale(2); got != V(2, 4, 6) {
		t.Fatalf("Scale = %v", got)
	}
	if got := V(3, 4, 0).Len(); got != 5 {
		t.Fatalf("Len = %v", got)
	}
	if got := a.Dist(b); got != 5 {
		t.Fatalf("Dist = %v", got)
	}
	if got := a.Lerp(b, 0.5); !nearV(got, V(2.5, 4, 3)) {
		t.Fatalf("Lerp = %v", got)
	}
	if got := a.Lerp(b, 0); got != a {
		t.Fatalf("Lerp(0) = %v", got)
	}
}

func TestQuatIdentityConjNorm(t *testing.T) {
	v := V(1, 2, 3)
	if got := Identity().Rotate(v); !nearV(got, v) {
		t.Fatalf("Identity.Rotate = %v", got)
	}
	q := AxisAngle(V(0.3, 1, -0.2), 1.1)
	if got := q.Conj().Rotate(q.Rotate(v)); !nearV(got, v) {
		t.Fatalf("Conj does not undo q: %v", got)
	}
	n := Quat{2, 0, 0, 0}.Norm()
	if n != Identity() {
		t.Fatalf("Norm = %v", n)
	}
	if got := (Quat{}).Norm(); got != Identity() {
		t.Fatalf("zero Norm = %v, want identity", got)
	}
	s := Quat{1, 2, 3, 4}.Norm()
	if l := s.W*s.W + s.X*s.X + s.Y*s.Y + s.Z*s.Z; !near(l, 1) {
		t.Fatalf("Norm length² = %v", l)
	}
}

func finiteQ(q Quat) bool {
	for _, c := range []float64{q.W, q.X, q.Y, q.Z} {
		if math.IsNaN(c) || math.IsInf(c, 0) {
			return false
		}
	}
	return true
}

func TestLookRotationDegenerate(t *testing.T) {
	up := V(0, 1, 0)
	for _, fwd := range []Vec3{V(0, 1, 0), V(0, -3, 0)} {
		q := LookRotation(fwd, up)
		if !finiteQ(q) || !nearV(q.Forward(), fwd.Norm()) {
			t.Fatalf("LookRotation(%v ∥ up) = %v, forward %v", fwd, q, q.Forward())
		}
	}
	if q := LookRotation(Vec3{}, up); q != Identity() {
		t.Fatalf("LookRotation(zero) = %v, want identity", q)
	}
}
