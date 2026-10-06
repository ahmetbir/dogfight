package geom

import "math"

type Quat struct{ W, X, Y, Z float64 }

func Identity() Quat { return Quat{W: 1} }

func AxisAngle(axis Vec3, angle float64) Quat {
	a := axis.Norm()
	s := math.Sin(angle / 2)
	return Quat{math.Cos(angle / 2), a.X * s, a.Y * s, a.Z * s}
}

func (q Quat) Mul(r Quat) Quat {
	return Quat{
		q.W*r.W - q.X*r.X - q.Y*r.Y - q.Z*r.Z,
		q.W*r.X + q.X*r.W + q.Y*r.Z - q.Z*r.Y,
		q.W*r.Y - q.X*r.Z + q.Y*r.W + q.Z*r.X,
		q.W*r.Z + q.X*r.Y - q.Y*r.X + q.Z*r.W,
	}
}

func (q Quat) Conj() Quat { return Quat{q.W, -q.X, -q.Y, -q.Z} }

func (q Quat) Norm() Quat {
	l := math.Sqrt(q.W*q.W + q.X*q.X + q.Y*q.Y + q.Z*q.Z)
	if l == 0 {
		return Identity()
	}
	return Quat{q.W / l, q.X / l, q.Y / l, q.Z / l}
}

// Rotate applies q to v (v' = q v q*), using the optimized cross-product form.
func (q Quat) Rotate(v Vec3) Vec3 {
	u := Vec3{q.X, q.Y, q.Z}
	t := u.Cross(v).Scale(2)
	return v.Add(t.Scale(q.W)).Add(u.Cross(t))
}

func (q Quat) Forward() Vec3 { return q.Rotate(Vec3{0, 0, -1}) }
func (q Quat) Up() Vec3      { return q.Rotate(Vec3{0, 1, 0}) }
func (q Quat) Right() Vec3   { return q.Rotate(Vec3{1, 0, 0}) }

// LookRotation returns the orientation whose forward is fwd and whose up is as
// close to up as possible. A zero fwd yields the identity; when fwd is
// parallel to up, another world axis stands in for up.
func LookRotation(fwd, up Vec3) Quat {
	f := fwd.Norm()
	if f == (Vec3{}) {
		return Identity()
	}
	r := f.Cross(up).Norm()
	if r == (Vec3{}) {
		alt := V(0, 0, 1)
		if math.Abs(f.Z) > 0.9 {
			alt = V(1, 0, 0)
		}
		r = f.Cross(alt).Norm()
	}
	u := r.Cross(f)
	// Columns of the rotation matrix: right, up, back(-f).
	m00, m01, m02 := r.X, u.X, -f.X
	m10, m11, m12 := r.Y, u.Y, -f.Y
	m20, m21, m22 := r.Z, u.Z, -f.Z
	tr := m00 + m11 + m22
	var q Quat
	switch {
	case tr > 0:
		s := math.Sqrt(tr+1) * 2
		q = Quat{0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s}
	case m00 > m11 && m00 > m22:
		s := math.Sqrt(1+m00-m11-m22) * 2
		q = Quat{(m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s}
	case m11 > m22:
		s := math.Sqrt(1+m11-m00-m22) * 2
		q = Quat{(m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s}
	default:
		s := math.Sqrt(1+m22-m00-m11) * 2
		q = Quat{(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s}
	}
	return q.Norm()
}
