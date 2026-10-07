"""Shared part builders: every jet is assembled from these with its own numbers.

All coordinates are game space (see mesh.py). Builders add faces to a Part and
return any hinged sub-parts (control surfaces) as new Parts.
"""
import math

import atlas as A
from mesh import Part, unit


def lerp(a, b, t):
    return a + (b - a) * t


def lerp3(a, b, t):
    return tuple(lerp(a[i], b[i], t) for i in range(3))


def centroid(pts):
    n = len(pts)
    return tuple(sum(p[i] for p in pts) / n for i in range(3))


def newell(pts):
    nx = ny = nz = 0.0
    for i in range(len(pts)):
        (x0, y0, z0), (x1, y1, z1) = pts[i], pts[(i + 1) % len(pts)]
        nx += (y0 - y1) * (z0 + z1)
        ny += (z0 - z1) * (x0 + x1)
        nz += (x0 - x1) * (y0 + y1)
    return (nx, ny, nz)


def outward(part, pts, role, uvs, inside):
    """Adds the face wound so its normal points away from the point inside."""
    n = newell(pts)
    c = centroid(pts)
    d = sum(n[i] * (c[i] - inside[i]) for i in range(3))
    if d < 0:
        pts, uvs = list(reversed(pts)), list(reversed(uvs))
    part.face(pts, role, uvs)


def loft(part, rings, uvs, role, closed=True, cap_start=False, cap_end=False, cap_uv=None, inside=None):
    """Quads between consecutive rings (same point count), facing outward.

    role is a string or role(i, j) for the band between ring i and i+1, edge j.
    inside(i) gives a point inside band i (default: the rings' centroid).
    """
    n = len(rings[0])
    edges = n if closed else n - 1
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        mid = inside(i) if inside else lerp3(centroid(a), centroid(b), 0.5)
        for j in range(edges):
            k = (j + 1) % n
            r = role(i, j) if callable(role) else role
            outward(part, [a[j], a[k], b[k], b[j]], r, [uvs[i][j], uvs[i][k], uvs[i + 1][k], uvs[i + 1][j]], mid)
    for flag, ring, other in ((cap_start, rings[0], rings[1]), (cap_end, rings[-1], rings[-2])):
        if flag:
            c = centroid(other)
            r = flag if isinstance(flag, str) else (role if isinstance(role, str) else role(0, 0))
            outward(part, list(ring), r, [cap_uv or uvs[0][0]] * len(ring), c)


# --- Fuselage ---------------------------------------------------------------

def profile(st, nu, nl):
    """Right half cross-section, top centre to bottom centre.

    st: z, cy (centre height), w (half width at the chine), ht (top above cy),
    hb (bottom below cy), wb (lower half width), eu/el (superellipse exponents).
    """
    z, cy, w, ht, hb, wb, eu, el = st
    pts = []
    for i in range(nu + 1):
        t = i / nu * math.pi / 2
        pts.append((w * math.sin(t) ** (2 / eu), cy + ht * math.cos(t) ** (2 / eu), z))
    for i in range(1, nl + 1):
        t = i / nl * math.pi / 2
        pts.append((wb * math.cos(t) ** (2 / el), cy - hb * math.sin(t) ** (2 / el), z))
    return pts


def fuselage(body, stations, reg, nu=5, nl=5, role="body"):
    """Lofted fuselage, nose to tail, from cross-sections (see profile).
    role is a string or role(i) for the band after station i. Intakes are
    separate ducts (see duct)."""
    n = nu + nl + 1
    s = [k / (n - 1) for k in range(n)]
    rings = [profile(st, nu, nl) for st in stations]
    uvs = [[reg.uv(p[2], s[k]) for k, p in enumerate(r)] for r in rings]
    half = Part("tmp")

    def inside(i):
        c = lerp3(centroid(rings[i]), centroid(rings[i + 1]), 0.5)
        return (c[0] * 0.5, c[1], c[2])

    loft(half, rings, uvs, (lambda i, j: role(i)) if callable(role) else role, closed=False, inside=inside)
    half.mirror_into()
    body.add(half)
    return rings


def duct_ring(st, seg):
    """Closed ring of a duct station: z, cx, cy, half width, half height,
    top and bottom superellipse exponents, mouth slant (dz per unit of y
    above the centre, dz per unit of x outboard of the centre, smile: how far
    the top edge's corners rise)."""
    z, cx, cy, hw, hh, et, eb = st[:7]
    sy, sx, smile = (list(st[7:10]) + [0.0, 0.0, 0.0])[:3]
    pts = []
    for j in range(seg):
        t = math.pi / 2 - j / seg * 2 * math.pi  # start on top, clockwise seen from the front
        c, sn = math.cos(t), math.sin(t)
        e = et if sn >= 0 else eb
        x = cx + hw * math.copysign(abs(c) ** (2 / e), c)
        y = cy + hh * math.copysign(abs(sn) ** (2 / e), sn)
        if sn > 0:  # smile: the top edge rises toward the corners
            y += smile * ((x - cx) / hw) ** 2
        side = 1 if cx >= 0 else -1
        pts.append((x, y, z + sy * (y - cy) / hh + sx * side * (x - cx) / hw))
    return pts


def duct(part, stations, uv, seg=16, lip=0.07, depth=0.8, role="body", wall="secondary"):
    """An intake: the first station is the mouth, the rest the duct running
    aft (into the airframe). The mouth gets a lip of thickness lip, a throat
    depth metres deep walled in wall, and a dark end (the engine face). uv(p, around) maps a point, around 0 top .. 0.5 bottom."""
    rings = [duct_ring(st, seg) for st in stations]
    around = [min(j, seg - j) / seg for j in range(seg)]
    uvs = [[uv(p, around[j]) for j, p in enumerate(r)] for r in rings]
    axis = lambda i: (stations[i][1], stations[i][2], stations[i][0])
    loft(part, rings, uvs, role, closed=True,
         inside=lambda i: lerp3(axis(i), axis(i + 1), 0.5))
    mouth = rings[0]
    cx, cy = stations[0][1], stations[0][2]
    hw, hh = stations[0][3], stations[0][4]
    k = lambda f: [(cx + (x - cx) * (1 - f * lip / hw), cy + (y - cy) * (1 - f * lip / hh), z + 0.02 * f) for x, y, z in mouth]
    inner = k(1.0)
    throat = [(cx + (x - cx) * 0.92, cy + (y - cy) * 0.92, z + depth) for x, y, z in inner]
    for j in range(seg):
        i2 = (j + 1) % seg
        q = [mouth[j], mouth[i2], inner[i2], inner[j]]
        outward(part, q, role, [uvs[0][j], uvs[0][i2], uvs[0][i2], uvs[0][j]], (cx, cy, mouth[j][2] + 1.0))
        q = [inner[j], inner[i2], throat[i2], throat[j]]
        c = centroid(q)
        outward(part, q, wall, [A.PLAIN_UV] * 4, (cx + (c[0] - cx) * 3, cy + (c[1] - cy) * 3, c[2]))
    outward(part, throat, "dark", [A.PLAIN_UV] * seg, (cx, cy, throat[0][2] + 1.0))
    return rings


def bubble(part, stations, reg_uv, seg=6, role="canopy", frame_at=None, frame_role="secondary"):
    """Canopy or dorsal hump: half-elliptic rings (z, base y, half width, height).
    reg_uv(c, z) with c = |cos| of the ring angle (0 on top, 1 at the base)."""
    rings, uvs = [], []
    for z, yb, w, h in stations:
        r, u = [], []
        for i in range(seg + 1):
            t = i / seg * math.pi
            r.append((w * math.cos(t), yb + h * math.sin(t), z))
            u.append(reg_uv(abs(math.cos(t)), z))
        rings.append(r)
        uvs.append(u)
    loft(part, rings, uvs, role, closed=False,
         inside=lambda i: (0.0, stations[i][1], (stations[i][0] + stations[i + 1][0]) / 2))
    if frame_at is not None:
        # A bow just outside the glass at z frame_at.
        for k in range(len(stations) - 1):
            z0, z1 = stations[k][0], stations[k + 1][0]
            if z0 <= frame_at <= z1:
                t = (frame_at - z0) / (z1 - z0)
                st = [lerp(stations[k][i], stations[k + 1][i], t) for i in range(4)]
                bow = []
                for dz, grow in ((-0.05, 1.05), (0.05, 1.05)):
                    bow.append([(st[2] * grow * math.cos(i / seg * math.pi), st[1] + st[3] * grow * math.sin(i / seg * math.pi), frame_at + dz) for i in range(seg + 1)])
                inner = [[(x / 1.05 * 0.98, st[1] + (y - st[1]) / 1.05 * 0.98, z) for x, y, z in ring] for ring in bow]
                rows = [inner[0], bow[0], bow[1], inner[1]]
                loft(part, rows, [[A.PLAIN_UV] * (seg + 1)] * 4, frame_role, closed=False,
                     inside=lambda i: (0.0, st[1], frame_at))
                break


# --- Lifting surfaces ---------------------------------------------------------

class Surface:
    """A tapered surface in local coordinates: s span, z chord, n thickness.

    to_world(s, n, z) places local points; uv(p) maps a world point into the
    atlas. le/te/thick are (root, tip) pairs at s0/s1. hinge is the chord
    fraction of a hinge line (None: plain diamond section).
    """

    def __init__(self, s0, s1, le, te, thick, to_world, uv, hinge=None, ridge=0.35):
        self.s0, self.s1, self.le, self.te, self.thick = s0, s1, le, te, thick
        self.to_world, self.uv, self.hinge, self.ridge = to_world, uv, hinge, ridge

    def at(self, s):
        t = (s - self.s0) / (self.s1 - self.s0)
        return lerp(self.le[0], self.le[1], t), lerp(self.te[0], self.te[1], t), lerp(self.thick[0], self.thick[1], t)

    def hinge_frac(self, s):
        h = self.hinge
        if isinstance(h, tuple):
            return lerp(h[0], h[1], (s - self.s0) / (self.s1 - self.s0))
        return h

    def n_at(self, s, z):
        """Half thickness of the section at span s, chord position z (the outer surface)."""
        le, te, t = self.at(s)
        f = (z - le) / (te - le)
        r = self.ridge
        if f <= r:
            return t / 2 * f / r
        if self.hinge is None:
            return t / 2 * (1 - f) / (1 - r)
        h = self.hinge_frac(s)
        if f <= h:
            return lerp(t / 2, t * 0.22, (f - r) / (h - r))
        return t * 0.22 * (1 - f) / (1 - h)

    def decal(self, part, s, f, radius, side, uv_at, role="stripe", seg=12, lift=0.012):
        """A round decal on the surface (side +1 or -1) centred at span s, chord fraction f.
        uv_at(angle, rad) gives the insignia slot's UV."""
        le, te, _ = self.at(s)
        zc = lerp(le, te, f)
        ring, uvs = [], []
        for i in range(seg):
            a = i / seg * 2 * math.pi
            ss, zz = s + radius * math.cos(a), zc + radius * math.sin(a)
            ring.append(self.to_world(ss, side * (self.n_at(ss, zz) + lift), zz))
            uvs.append(uv_at(a, 1.0))
        c = self.to_world(s, side * (self.n_at(s, zc) + lift), zc)
        inner = self.to_world(s, 0.0, zc)
        for i in range(seg):
            j = (i + 1) % seg
            outward(part, [c, ring[i], ring[j]], role, [uv_at(0, 0.0), uvs[i], uvs[j]], inner)

    def patch(self, part, s0, s1, z0, z1, side, rect, role="body", cols=4, rows=2, lift=0.01):
        """A rectangular decal (span s0..s1, chord z0..z1) on one side, following the
        facets; rect (x, y, w, h) is its atlas slot, read upright from that side."""
        x, y, w, h = rect
        grid = []
        for i in range(rows + 1):
            ss = lerp(s1, s0, i / rows)
            row = []
            for j in range(cols + 1):
                t = j / cols
                zz = lerp(z1, z0, t) if side > 0 else lerp(z0, z1, t)
                row.append((self.to_world(ss, side * (self.n_at(ss, zz) + lift), zz), A.uv_px(x + t * w, y + i / rows * h)))
            grid.append(row)
        for i in range(rows):
            for j in range(cols):
                q = [grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]]
                inner = self.to_world((s0 + s1) / 2, 0.0, (z0 + z1) / 2)
                outward(part, [p for p, _ in q], role, [u for _, u in q], inner)

    def hinge_point(self, s):
        le, te, _ = self.at(s)
        return self.to_world(s, 0.0, lerp(le, te, self.hinge_frac(s)))

    def main_ring(self, s):
        le, te, t = self.at(s)
        c = te - le
        w = self.to_world
        if self.hinge is None:
            zr = le + self.ridge * c
            return [w(s, 0, le), w(s, t / 2, zr), w(s, 0, te), w(s, -t / 2, zr)]
        zr, zh = le + self.ridge * c, le + self.hinge_frac(s) * c
        th = t * 0.22
        return [w(s, 0, le), w(s, t / 2, zr), w(s, th, zh), w(s, -th, zh), w(s, -t / 2, zr)]

    def aft_ring(self, s):
        le, te, t = self.at(s)
        zh = lerp(le, te, self.hinge_frac(s))
        w = self.to_world
        return [w(s, t * 0.22, zh), w(s, 0, te), w(s, -t * 0.22, zh)]

    def _band(self, part, ring, sa, sb, role, cap_a=False, cap_b=False, closed=None):
        ra, rb = ring(sa), ring(sb)
        mid = lerp3(centroid(ra), centroid(rb), 0.5)
        n = len(ra)
        closed = n > 3 if closed is None else closed
        edges = n if closed else n - 1
        for j in range(edges):
            k = (j + 1) % n
            pts = [ra[j], ra[k], rb[k], rb[j]]
            outward(part, pts, role, [self.uv(p) for p in pts], mid)
        for flag, r, other in ((cap_a, ra, rb), (cap_b, rb, ra)):
            if flag:
                outward(part, list(r), role if flag is True else flag, [self.uv(p) for p in r], centroid(other))

    def build(self, body, stations, cuts=(), role=lambda s: "body", tip_cap=True, root_cap=False):
        """Adds the fixed structure to body; returns one Part per cut (name, sa, sb, props).

        A cut's Part pivots on the hinge line at its inboard end; props gain
        "axis" (unit hinge direction, game space) for the client.
        """
        st = sorted(set([self.s0, self.s1] + list(stations) + [c[1] for c in cuts] + [c[2] for c in cuts]))
        out = []
        for i in range(len(st) - 1):
            sa, sb = st[i], st[i + 1]
            r = role((sa + sb) / 2)
            first, last = i == 0, i == len(st) - 2
            self._band(body, self.main_ring, sa, sb, r, cap_a=root_cap and first, cap_b=tip_cap and last)
            if self.hinge is None:
                continue
            cut = next((c for c in cuts if c[1] <= sa and sb <= c[2]), None)
            if cut is None:
                self._band(body, self.aft_ring, sa, sb, r, cap_a=root_cap and first, cap_b=tip_cap and last)
        for name, sa, sb, props in cuts:
            pa, pb = self.hinge_point(sa), self.hinge_point(sb)
            p = Part(name, pa, props)
            for j, (x0, x1) in enumerate(_pairs([s for s in st if sa <= s <= sb])):
                self._band(p, self.aft_ring, x0, x1, role((x0 + x1) / 2), cap_a=j == 0, cap_b=x1 == sb, closed=True)
            p.props["axis"] = [round(c, 4) for c in unit(tuple(pb[k] - pa[k] for k in range(3)))]
            out.append(p)
        return out


def _pairs(xs):
    return list(zip(xs[:-1], xs[1:]))


def strake(part, inner, outer, y, up, down, uv, role="body"):
    """A fairing from the fuselage side (inner line, points (x, z)) out to a sharp
    edge (outer, same count, at height y): its top meets the fuselage up metres
    above y, its bottom down metres below."""
    top_i = [(x, y + up, z) for x, z in inner]
    bot_i = [(x, y - down, z) for x, z in inner]
    edge = [(x, y, z) for x, z in outer]
    for j in range(len(inner) - 1):
        for row, sign in ((top_i, 1), (bot_i, -1)):
            pts = [row[j], row[j + 1], edge[j + 1], edge[j]]
            c = centroid(pts)
            outward(part, pts, role, [uv(p) for p in pts], (c[0], c[1] - sign, c[2]))


# --- Round things -------------------------------------------------------------

def basis(d):
    d = unit(d)
    up = (0.0, 1.0, 0.0) if abs(d[1]) < 0.9 else (1.0, 0.0, 0.0)
    a = unit((up[1] * d[2] - up[2] * d[1], up[2] * d[0] - up[0] * d[2], up[0] * d[1] - up[1] * d[0]))
    b = (d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0])
    return d, a, b


def tube(part, p0, p1, radii, seg, role, uv=lambda a, l: A.PLAIN_UV, cap0=False, cap1=False, phase=0.0, at=None):
    """Rings along p0→p1: radii[i] at fraction at[i] (default evenly spaced).
    uv(around 0..1, along 0..1). A zero radius closes to a point."""
    d, a, b = basis(tuple(p1[i] - p0[i] for i in range(3)))
    L = math.dist(p0, p1)
    at = at or [i / (len(radii) - 1) for i in range(len(radii))]
    rings, uvs = [], []
    for r, f in zip(radii, at):
        c = tuple(p0[i] + d[i] * L * f for i in range(3))
        ring, u = [], []
        for j in range(seg):
            t = phase + j / seg * 2 * math.pi
            ring.append(tuple(c[i] + r * (math.cos(t) * a[i] + math.sin(t) * b[i]) for i in range(3)))
            u.append(uv(j / seg, f))
        rings.append(ring)
        uvs.append(u)
    loft(part, rings, uvs, role, closed=True, cap_start=cap0, cap_end=cap1, cap_uv=uv(0, 0),
         inside=lambda i: tuple(p0[k] + d[k] * L * (at[i] + at[i + 1]) / 2 for k in range(3)))
    return rings


def block(part, c, size, role, uv=lambda p: A.PLAIN_UV):
    """Axis-aligned box centred at c, size (sx, sy, sz)."""
    hx, hy, hz = (s / 2 for s in size)
    v = [(c[0] + sx * hx, c[1] + sy * hy, c[2] + sz * hz) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    for q in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        pts = [v[i] for i in q]
        outward(part, pts, role, [uv(p) for p in pts], c)


def plate(part, pts, role, uv=lambda p: A.PLAIN_UV, thick=0.0):
    """A flat plate: both sides (thick 0) or a thin slab offset along its normal."""
    n = unit(newell(pts))
    if thick <= 0:
        part.face(pts, role, [uv(p) for p in pts])
        part.face(list(reversed(pts)), role, [uv(p) for p in reversed(pts)])
        return
    h = thick / 2
    top = [tuple(p[i] + n[i] * h for i in range(3)) for p in pts]
    bot = [tuple(p[i] - n[i] * h for i in range(3)) for p in pts]
    c = centroid(pts)
    outward(part, top, role, [uv(p) for p in top], tuple(c[i] - n[i] for i in range(3)))
    outward(part, bot, role, [uv(p) for p in bot], tuple(c[i] + n[i] for i in range(3)))
    for j in range(len(pts)):
        k = (j + 1) % len(pts)
        q = [top[j], top[k], bot[k], bot[j]]
        outward(part, q, role, [uv(p) for p in q], c)


def missile(part, nose, length, r, uv, fins=((0.86, 0.12, 0.14),), seg=8):
    """Missile along +z from nose (tip): body tube, seeker cone, cruciform fins
    (fraction along, span, chord)."""
    x, y, z = nose
    tip = (x, y, z)
    body0 = (x, y, z + r * 2.4)
    tail = (x, y, z + length)
    tube(part, tip, body0, [0.0, r * 0.75, r], seg, "metal", lambda a, l: uv(a, l * 0.06), at=[0.0, 0.55, 1.0], phase=math.pi / seg)
    tube(part, body0, tail, [r, r], seg, "metal", lambda a, l: uv(a, 0.06 + l * 0.94), cap1=True, phase=math.pi / seg)
    for f, span, chord in fins:
        zf = z + length * f
        for ang in (0.25, 0.75, 1.25, 1.75):
            dx, dy = math.cos(ang * math.pi), math.sin(ang * math.pi)
            root0 = (x + dx * r, y + dy * r, zf)
            root1 = (x + dx * r, y + dy * r, zf + chord)
            tip1 = (x + dx * (r + span), y + dy * (r + span), zf + chord)
            tip0 = (x + dx * (r + span), y + dy * (r + span), zf + chord * 0.55)
            plate(part, [root0, root1, tip1, tip0], "metal", lambda p: uv(0.02, 0.98))


def store(nose, length, r, uv, fins, seg=8):
    """A missile as its own node (pivot at its middle) so the client can hide it
    once fired; named later in firing order (msl_0, msl_1, ...)."""
    x, y, z = nose
    p = Part("msl", (x, y, z + length / 2), {"role": "missile"})
    missile(p, nose, length, r, uv, fins=fins, seg=seg)
    return p


def firing_order(parts):
    """Names the store parts msl_0.. in the order given (first fired first)."""
    for i, p in enumerate(parts):
        p.name = f"msl_{i}"
    return parts


def nozzle(part, z0, z1, r0, r1, cy, seg, petals, uv, depth=0.5):
    """Engine nozzle from z0 (inside the fuselage) to the exit z1: a tapered
    tube whose exit edge alternates (petals), a lip and a dark recess."""
    rings, uvs = [], []
    for k, (z, r) in enumerate(((z0, r0), (lerp(z0, z1, 0.55), lerp(r0, r1, 0.6)), (z1, r1))):
        ring, u = [], []
        for j in range(seg):
            t = j / seg * 2 * math.pi
            rr, zz = r, z
            if k == 2 and petals and j % 2:
                rr, zz = r * 0.95, z - 0.06
            ring.append((rr * math.cos(t), cy + rr * math.sin(t), zz))
            u.append(uv(j / seg, k / 2))
        rings.append(ring)
        uvs.append(u)
    inner = [(x * 0.86, cy + (y - cy) * 0.86, z1 - 0.04) for x, y, _ in rings[-1]]
    deep = [(x * 0.7, cy + (y - cy) * 0.7, z1 - depth) for x, y, _ in rings[-1]]
    loft(part, rings, uvs, "metal", closed=True, inside=lambda i: (0.0, cy, z0))
    for j in range(seg):
        k = (j + 1) % seg
        pts = [rings[-1][j], rings[-1][k], inner[k], inner[j]]
        outward(part, pts, "metal", [uv(0.5, 1.0)] * 4, (0.0, cy, z1 - 1.0))
        pts = [inner[j], inner[k], deep[k], deep[j]]
        c = centroid(pts)
        outward(part, pts, "dark", [A.PLAIN_UV] * 4, (c[0] * 3, cy + (c[1] - cy) * 3, c[2]))  # faces the axis
    outward(part, deep, "dark", [A.PLAIN_UV] * seg, (0.0, cy, z1 - depth - 1.0))
