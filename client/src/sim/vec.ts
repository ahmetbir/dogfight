// Plain-object vector/quaternion math; mirrors internal/geom operation order.
// No Three.js here: the sim must run under node tests.

export type V3 = { x: number; y: number; z: number };
export type Q = { w: number; x: number; y: number; z: number };

export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });

export function add(a: V3, b: V3): V3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
export function sub(a: V3, b: V3): V3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
export function scale(a: V3, s: number): V3 { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
export function dot(a: V3, b: V3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function len(a: V3): number { return Math.sqrt(dot(a, a)); }
export function dist(a: V3, b: V3): number { return len(sub(a, b)); }
export function lerp(a: V3, b: V3, t: number): V3 { return add(a, scale(sub(b, a), t)); }

export function cross(a: V3, b: V3): V3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function norm(a: V3): V3 {
  const l = len(a);
  if (l === 0) return { x: 0, y: 0, z: 0 };
  return scale(a, 1 / l);
}

export function qIdentity(): Q { return { w: 1, x: 0, y: 0, z: 0 }; }

export function qAxisAngle(axis: V3, angle: number): Q {
  const a = norm(axis);
  const s = Math.sin(angle / 2);
  return { w: Math.cos(angle / 2), x: a.x * s, y: a.y * s, z: a.z * s };
}

export function qMul(q: Q, r: Q): Q {
  return {
    w: q.w * r.w - q.x * r.x - q.y * r.y - q.z * r.z,
    x: q.w * r.x + q.x * r.w + q.y * r.z - q.z * r.y,
    y: q.w * r.y - q.x * r.z + q.y * r.w + q.z * r.x,
    z: q.w * r.z + q.x * r.y - q.y * r.x + q.z * r.w,
  };
}

export function qConj(q: Q): Q { return { w: q.w, x: -q.x, y: -q.y, z: -q.z }; }

export function qNorm(q: Q): Q {
  const l = Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z);
  if (l === 0) return qIdentity();
  return { w: q.w / l, x: q.x / l, y: q.y / l, z: q.z / l };
}

/** Applies q to v (v' = q v q*), optimized cross-product form. */
export function qRotate(q: Q, v: V3): V3 {
  const u = { x: q.x, y: q.y, z: q.z };
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q.w)), cross(u, t));
}

/** Nose direction: local −Z. */
export function qForward(q: Q): V3 { return qRotate(q, { x: 0, y: 0, z: -1 }); }

/** Spherical interpolation along the shortest arc (not in Go; for rendering). */
export function qSlerp(a: Q, b: Q, t: number): Q {
  let d = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
  let s = 1;
  if (d < 0) { d = -d; s = -1; }
  let ka: number, kb: number;
  if (d > 0.9995) {
    ka = 1 - t;
    kb = t;
  } else {
    const th = Math.acos(d);
    const sin = Math.sin(th);
    ka = Math.sin((1 - t) * th) / sin;
    kb = Math.sin(t * th) / sin;
  }
  kb *= s;
  return qNorm({ w: a.w * ka + b.w * kb, x: a.x * ka + b.x * kb, y: a.y * ka + b.y * kb, z: a.z * ka + b.z * kb });
}
