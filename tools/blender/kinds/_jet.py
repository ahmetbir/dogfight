"""Shared pieces of the jet modules: atlas mapping, standard surfaces, gear,
engine markers and the texture painters. A kind module supplies numbers."""
import math

import atlas as A
from mesh import Part
from parts import Surface, block, lerp, plate, tube

GEAR_HEIGHT = 2.5  # m: wheel bottoms below the origin (sim GearHeight)


class Jet:
    """Atlas regions sized for one airframe.

    length (z0, z1); wing (z0, z1, x0, x1) from above; fin (z0, z1, y top,
    y bottom) from the side; stab (z0, z1, x0, x1) from above.
    """

    def __init__(self, length, wing, fin, stab):
        self.length = length
        self.FUSE = A.region(A.FUSE, length[0] - 0.05, length[1] + 0.05, 0.0, 1.0)
        self.WING = A.region(A.WING, *wing)
        self.FIN = A.region(A.FIN, *fin)
        self.STAB = A.region(A.STAB, *stab)

    def fuse(self, z, s):
        return self.FUSE.uv(z, s)

    def wing_uv(self, p):
        return self.WING.uv(p[2], abs(p[0]))

    def fin_uv(self, p):
        return self.FIN.uv(p[2], p[1])

    def stab_uv(self, p):
        return self.STAB.uv(p[2], abs(p[0]))

    def duct_uv(self, p, around):
        return self.FUSE.uv(p[2], 0.5 + around)


def metal_uv(a, l):
    x, y, w, h = A.METAL
    return A.uv_px(x + a * w, y + l * (h - 1))


def missile_uv(a, l):
    x, y, w, h = A.MISSILE
    return A.uv_px(x + 1 + a * (w - 2), y + l * (h - 1))


def glass_uv(c, _z=None):
    x, y, w, h = A.GLASS
    return A.uv_px(x + w / 2, y + 1 + c * (h - 2))


def plain(_p=None):
    return A.PLAIN_UV


def insignia(a, r):
    return A.insignia_uv(a, r)


def strut_uv(_a, _l):
    return missile_uv(0.5, 0.5)


# Missile shapes: length, radius, fins (fraction along, span, chord).
AIM9 = dict(length=2.90, r=0.064, uv=missile_uv, fins=((0.12, 0.09, 0.14), (0.86, 0.12, 0.26)))
AIM120 = dict(length=3.65, r=0.085, uv=missile_uv, fins=((0.36, 0.11, 0.34), (0.88, 0.12, 0.30)))
AIM7 = dict(length=3.66, r=0.10, uv=missile_uv, fins=((0.40, 0.20, 0.42), (0.88, 0.17, 0.32)))
R73 = dict(length=2.90, r=0.085, uv=missile_uv, fins=((0.07, 0.10, 0.12), (0.84, 0.15, 0.30)))
R27 = dict(length=4.00, r=0.115, uv=missile_uv, fins=((0.30, 0.24, 0.30), (0.86, 0.16, 0.36)))
AIM54 = dict(length=3.96, r=0.19, uv=missile_uv, fins=((0.42, 0.20, 0.62), (0.88, 0.24, 0.40)))
AGM65 = dict(length=2.49, r=0.15, uv=missile_uv, fins=((0.50, 0.20, 0.90),))
R60 = dict(length=2.09, r=0.06, uv=missile_uv, fins=((0.08, 0.07, 0.08), (0.85, 0.10, 0.22)))
R77 = dict(length=3.60, r=0.10, uv=missile_uv, fins=((0.40, 0.10, 0.30), (0.93, 0.15, 0.08)))
R33 = dict(length=4.15, r=0.19, uv=missile_uv, fins=((0.45, 0.24, 0.72), (0.88, 0.22, 0.40)))
R24 = dict(length=4.46, r=0.12, uv=missile_uv, fins=((0.30, 0.30, 0.46), (0.88, 0.18, 0.36)))
R3S = dict(length=2.84, r=0.064, uv=missile_uv, fins=((0.10, 0.09, 0.14), (0.86, 0.13, 0.26)))
KH25 = dict(length=3.70, r=0.14, uv=missile_uv, fins=((0.10, 0.10, 0.20), (0.80, 0.24, 0.46)))
MICA = dict(length=3.10, r=0.08, uv=missile_uv, fins=((0.22, 0.05, 1.50), (0.88, 0.13, 0.30)))
METEOR = dict(length=3.65, r=0.089, uv=missile_uv, fins=((0.86, 0.15, 0.36),))
IRIST = dict(length=2.94, r=0.064, uv=missile_uv, fins=((0.10, 0.05, 0.10), (0.87, 0.12, 0.28)))


def wing(s0, s1, le, te, thick, y, uv, hinge=None, dihedral=0.0, ridge=0.35):
    """Horizontal surface, span s = x (root s0 to tip s1)."""
    k = math.tan(dihedral)
    return Surface(s0, s1, le, te, thick, lambda s, n, z: (s, y + (s - s0) * k + n, z), uv, hinge=hinge, ridge=ridge)


def fin(s0, s1, le, te, thick, uv, x0=0.0, y0=0.0, cant=0.0, hinge=None, mirror=False):
    """Vertical surface: s = distance up the span from (x0, y0), leaning
    outboard by cant radians; mirror builds the left-hand one."""
    c, sn = math.cos(cant), math.sin(cant)
    m = -1 if mirror else 1

    def w(s, n, z):
        return (m * (x0 + s * sn + n * c), y0 + s * c - n * sn, z)

    return Surface(s0, s1, le, te, thick, w, uv, hinge=hinge)


def stabilator(surface, pivot, axis, name="stab_r", stations=(), role="stab"):
    """All-moving surface (tail, canard, fin): its own Part pivoting at pivot about axis."""
    p = Part(name, pivot, {"role": role})
    surface.build(p, list(stations), root_cap=False)
    n = math.sqrt(sum(a * a for a in axis))
    p.props["axis"] = [round(a / n, 4) for a in axis]
    return p


def engines(root, exits):
    """ab_i / idle_i markers at each nozzle exit (x, y, z, radius)."""
    for i, (x, y, z, r) in enumerate(exits):
        for kind in ("ab", "idle"):
            root.children.append(Part(f"{kind}_{i}", (x, y, z), {"radius": r}))


def gear(nose, main, nose_door=None, main_door=None):
    """Landing gear, down, wheels touching y = -GEAR_HEIGHT.

    nose: z, top (strut top y), r (wheel radius), twin (two wheels), fold
    (+1 forward, -1 aft). main: x, z, top, r, xw (wheel x), fold, brace
    (x, y, z) of a drag brace top or None. Doors: x (hinge), y, z0, z1, depth.
    retract = [axis, angle] folds a leg or shuts a door.
    """
    g = Part("gear")
    axle_n = -GEAR_HEIGHT + nose["r"]
    z = nose["z"]
    leg = Part("gear_nose", (0.0, nose["top"], z), {"retract": [1.0, 0.0, 0.0, 1.5708 * nose.get("fold", -1)]})
    tube(leg, (0, nose["top"], z), (0, axle_n + nose["r"] * 0.9, z), [0.075, 0.065], 6, "metal", strut_uv)
    block(leg, (0.0, (nose["top"] + axle_n) / 2, z + 0.08), (0.05, 0.4, 0.06), "metal")
    if nose.get("twin"):
        block(leg, (0.0, axle_n, z + 0.06), (0.42, 0.06, 0.06), "metal")
        for sx in (-1, 1):
            tube(leg, (sx * 0.08, axle_n, z + 0.06), (sx * 0.26, axle_n, z + 0.06), [nose["r"]] * 2, 10, "dark", cap0=True, cap1=True)
    else:
        for x in (-0.12, 0.12):
            block(leg, (x, axle_n + 0.12, z + 0.04), (0.04, 0.34, 0.10), "metal")
        tube(leg, (-0.09, axle_n, z + 0.08), (0.09, axle_n, z + 0.08), [nose["r"]] * 2, 10, "dark", cap0=True, cap1=True)
    legs = [leg]

    axle_m = -GEAR_HEIGHT + main["r"]
    x, zm, top, xw = main["x"], main["z"], main["top"], main.get("xw", main["x"] + 0.13)
    m = Part("gear_main_r", (x, top, zm), {"retract": [1.0, 0.0, 0.0, 1.5708 * main.get("fold", 1)]})
    tube(m, (x, top, zm), (xw, axle_m + 0.19, zm), [0.095, 0.075], 6, "metal", strut_uv)
    if main.get("brace"):
        tube(m, main["brace"], (xw - 0.04, axle_m + 0.9, zm - 0.04), [0.05, 0.045], 5, "metal", strut_uv)
    w = main.get("w", 0.24)
    tube(m, (xw - 0.06, axle_m, zm), (xw - 0.06 + w, axle_m, zm), [main["r"]] * 2, 12, "dark", cap0=True, cap1=True)
    legs += [m, m.mirrored()]

    doors = []
    if nose_door:
        d = nose_door
        p = Part("door_nose", (d["x"], d["y"], (d["z0"] + d["z1"]) / 2), {"retract": [0.0, 0.0, 1.0, -1.5708]})
        plate(p, [(d["x"], d["y"], d["z0"]), (d["x"], d["y"], d["z1"]), (d["x"], d["y"] - d["depth"], d["z1"] - 0.05),
                  (d["x"], d["y"] - d["depth"], d["z0"] + 0.05)], "body", plain, thick=0.03)
        doors.append(p)
    if main_door:
        d = main_door
        p = Part("door_main_r", (d["x"], d["y"], (d["z0"] + d["z1"]) / 2), {"retract": [0.0, 0.0, 1.0, -1.5708]})
        plate(p, [(d["x"], d["y"], d["z0"]), (d["x"], d["y"], d["z1"]), (d["x"], d["y"] - d["depth"], d["z1"] - 0.1),
                  (d["x"], d["y"] - d["depth"], d["z0"] + 0.1)], "body", plain, thick=0.03)
        doors += [p, p.mirrored()]
    g.children = legs + doors
    return g


# --- Texture -----------------------------------------------------------------

def paint_fuselage(cv, jet, frames, longerons, panels, soot_from, k=0.7):
    """frames (z, s0, s1), longerons (s, z0, z1), access panels (z0, z1, s0, s1);
    exhaust soot darkens from soot_from to the tail."""
    fz = jet.FUSE.px
    for z, s0, s1 in frames:
        x, y0 = fz(z, s0)
        _, y1 = fz(z, s1)
        cv.line(x, y0, x, y1 - 1, k)
    for s, z0, z1 in longerons:
        a, y = fz(z0, s)
        b, _ = fz(z1, s)
        cv.line(a, y, b, y, k + 0.04)
    for z0, z1, s0, s1 in panels:
        a, b = fz(z0, s0), fz(z1, s1)
        cv.box(a[0], a[1], b[0], b[1], k + 0.02)
    sx, _ = fz(soot_from, 0)
    ex, _ = fz(jet.length[1], 0)
    for x in range(int(sx), int(ex) + 1):
        cv.rect_mul(x, 0, x + 1, 96, 1 - 0.35 * (x - sx) / max(1, ex - sx))


def chevrons(cv, jet, z, s, color=(0.9, 0.16, 0.12), size=1.0):
    """Two red intake warning chevrons pointing forward at (z, s)."""
    fz = jet.FUSE.px
    for k in range(2):
        zc = z + k * 0.32 * size
        a, b, c = fz(zc, s), fz(zc + 0.28 * size, s - 0.1 * size), fz(zc + 0.28 * size, s + 0.1 * size)
        cv.poly([a, b, (b[0] + 3, b[1]), (a[0] + 3, a[1]), (c[0] + 3, c[1]), c], color, op="mul")


def paint_surface(cv, region, surface, chords=(), spans=(), hinge_spans=None, k=0.7, height=lambda s: s):
    """Panel lines of a surface seen in region(z, s): lines at chord fractions
    (frac, s from, s to), ribs at span stations, and the hinge line. height maps
    a span position to the region's second coordinate (a fin's height)."""
    for f, sa, sb in chords:
        pts = []
        for i in range(5):
            s = lerp(sa, sb, i / 4)
            le, te, _ = surface.at(s)
            pts.append(region.px(lerp(le, te, f), height(s)))
        for a, b in zip(pts, pts[1:]):
            cv.line(a[0], a[1], b[0], b[1], k)
    for s in spans:
        le, te, _ = surface.at(s)
        p, q = region.px(lerp(le, te, 0.12), height(s)), region.px(te, height(s))
        cv.line(p[0], p[1], q[0], q[1], k + 0.08)
    if hinge_spans and surface.hinge is not None:
        pts = []
        for i in range(5):
            s = lerp(hinge_spans[0], hinge_spans[1], i / 4)
            le, te, _ = surface.at(s)
            pts.append(region.px(lerp(le, te, surface.hinge_frac(s)), height(s)))
        for a, b in zip(pts, pts[1:]):
            cv.line(a[0], a[1], b[0], b[1], k - 0.15)


def paint_common(cv, number=("", "")):
    """Nozzle, missile, canopy glass, insignia and the tail number slot."""
    x, y, ww, hh = A.METAL
    cv.rect_mul(x, y + hh * 0.45, x + ww, y + hh, 0.62)
    cv.rect_mul(x, y + hh * 0.85, x + ww, y + hh, 0.7)
    for j in range(16):
        px = x + j / 16 * ww
        cv.line(px, y + hh * 0.45, px, y + hh - 1, 0.6)
    x, y, ww, hh = A.MISSILE
    cv.rect(x, y, x + ww, y + 4, (0.25, 0.25, 0.28))
    cv.rect(x, y + 8, x + ww, y + 10, (0.95, 0.8, 0.25))
    cv.rect(x, y + 11, x + ww, y + 13, (0.6, 0.45, 0.3))
    cv.rect_mul(x, y + hh - 6, x + ww, y + hh, 0.8)
    x, y, ww, hh = A.GLASS
    for j in range(hh):
        c = j / (hh - 1)
        g = 1.0 if c < 0.12 else (0.55 if c < 0.2 else 0.72 - 0.25 * c)
        cv.rect(x, y + j, x + ww, y + j + 1, (g, g, g))
    A.draw_insignia(cv)
    x, y, _, _ = A.NUMBER
    cv.text(number[0], x + 4, y + 3, 0.3)
    cv.text(number[1], x + 4, y + 13, 0.3)


def mirrored_rudder(p):
    """The left rudder of a pair: mirrored geometry, its axis kept pointing up
    so a positive angle still swings the trailing edge to the right."""
    m = p.mirrored()
    ax, ay, az = p.props["axis"]
    m.props["axis"] = [-ax + 0.0, ay, az]
    return m


def nozzles(part, xs, z0, z1, r0, r1, cy, seg=16):
    """One petalled nozzle per x (built in place, not mirrored)."""
    from parts import nozzle
    for x in xs:
        p = Part("n")
        nozzle(p, z0, z1, r0, r1, cy, seg, True, metal_uv)
        p.faces = [(tuple((px + x, py, pz) for px, py, pz in pts), r, u) for pts, r, u in p.faces]
        part.add(p)


def swing(pivot, sweep):
    """The pivot of a swing wing (wing_r; mirror it for wing_l). The panel is
    modelled at mid sweep; sweep = [lo, hi] is the turn range in radians about
    axis from that pose, positive swinging the tip forward (hi: fully
    spread, lo: fully swept). Its flap and aileron nodes are its children."""
    return Part("wing_r", pivot, {"role": "sweep", "axis": [0.0, 1.0, 0.0], "sweep": [round(a, 4) for a in sweep]})


def shaped_nozzle(part, stations, seg=12, depth=0.5, uv=metal_uv):
    """A nozzle of duct-ring stations (see parts.duct_ring), front to exit:
    metal walls, an inner lip and a dark recess."""
    from parts import centroid, duct_ring, loft, outward
    rings = [duct_ring(st, seg) for st in stations]
    uvs = [[uv(j / seg, i / max(1, len(rings) - 1)) for j in range(seg)] for i in range(len(rings))]
    axis = lambda i: (stations[i][1], stations[i][2], stations[i][0])
    loft(part, rings, uvs, "metal", closed=True, inside=lambda i: tuple((axis(i)[k] + axis(i + 1)[k]) / 2 for k in range(3)))
    cx, cy, z1 = stations[-1][1], stations[-1][2], stations[-1][0]
    exit_ = rings[-1]
    inner = [(cx + (x - cx) * 0.86, cy + (y - cy) * 0.86, z - 0.04) for x, y, z in exit_]
    deep = [(cx + (x - cx) * 0.7, cy + (y - cy) * 0.7, z - depth) for x, y, z in exit_]
    for j in range(seg):
        k = (j + 1) % seg
        outward(part, [exit_[j], exit_[k], inner[k], inner[j]], "metal", [uv(0.5, 1.0)] * 4, (cx, cy, z1 - 1.0))
        q = [inner[j], inner[k], deep[k], deep[j]]
        c = centroid(q)
        outward(part, q, "dark", [A.PLAIN_UV] * 4, (cx + (c[0] - cx) * 3, cy + (c[1] - cy) * 3, c[2]))
    outward(part, deep, "dark", [A.PLAIN_UV] * seg, (cx, cy, z1 - depth - 1.0))


def nose_intake(part, z, cy, r, lip=0.06, depth=1.2, cone=(0.9, 0.55), seg=16, uv=plain):
    """A pitot nose intake at z (the lip) with a shock cone: cone = (how far its
    tip stands ahead of the lip, base radius as a fraction of r)."""
    from parts import centroid, outward
    ring = lambda rr, zz: [(rr * math.cos(t), cy + rr * math.sin(t), zz) for t in [j / seg * 2 * math.pi for j in range(seg)]]
    outer, inner = ring(r, z), ring(r - lip, z + 0.04)
    throat = ring((r - lip) * 0.9, z + depth)
    for j in range(seg):
        k = (j + 1) % seg
        outward(part, [outer[j], outer[k], inner[k], inner[j]], "secondary", [uv(None)] * 4, (0.0, cy, z + 1.0))
        q = [inner[j], inner[k], throat[k], throat[j]]
        c = centroid(q)
        outward(part, q, "dark", [A.PLAIN_UV] * 4, (c[0] * 3, cy + (c[1] - cy) * 3, c[2]))
    outward(part, throat, "dark", [A.PLAIN_UV] * seg, (0.0, cy, z + depth + 1.0))
    ahead, base = cone
    rb = r * base
    tube(part, (0.0, cy, z - ahead), (0.0, cy, z + depth * 0.8), [0.0, rb * 0.55, rb, rb * 0.9], 12, "secondary",
         lambda a, l: A.PLAIN_UV, at=[0.0, 0.45, 0.75, 1.0])
