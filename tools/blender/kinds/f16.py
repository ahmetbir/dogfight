"""F-16: slim blended fuselage with a chin intake, bubble canopy, cropped delta
wing with LERX, all-moving stabilators, single fin with the drag chute fairing,
ventral fins, tip and pylon missiles. True metres, nose toward -z.
"""
import math

import atlas as A
from mesh import Part
from parts import Surface, block, bubble, duct, firing_order, fuselage, lerp, nozzle, plate, store, strake, tube

NAME = "f16"
LENGTH = (-7.62, 7.45)  # pitot tip .. nozzle exit
WING_Y = -0.02

# Fuselage cross-sections: z, cy, w, ht, hb, wb, eu, el (see parts.profile).
FORE = [
    (-7.25, 0.06, 0.03, 0.03, 0.03, 0.03, 2.0, 2.0),
    (-6.90, 0.05, 0.18, 0.18, 0.17, 0.17, 2.0, 2.0),
    (-6.35, 0.04, 0.32, 0.32, 0.31, 0.31, 2.0, 2.0),
    (-5.60, 0.03, 0.45, 0.44, 0.42, 0.42, 2.0, 2.0),
    (-4.75, 0.02, 0.55, 0.52, 0.50, 0.49, 2.2, 2.2),
    (-3.95, 0.00, 0.62, 0.53, 0.54, 0.52, 2.4, 2.4),
    (-3.25, 0.00, 0.66, 0.55, 0.55, 0.53, 2.5, 2.4),
]
AFT = [
    (-2.40, 0.00, 0.72, 0.58, 0.62, 0.60, 2.6, 2.4),
    (-1.30, 0.00, 0.80, 0.61, 0.68, 0.66, 2.8, 2.4),
    (0.00, 0.00, 0.86, 0.63, 0.72, 0.70, 3.0, 2.4),
    (1.50, 0.00, 0.88, 0.63, 0.74, 0.72, 3.0, 2.4),
    (3.00, 0.00, 0.84, 0.62, 0.72, 0.70, 2.8, 2.4),
    (4.50, 0.00, 0.74, 0.62, 0.66, 0.66, 2.4, 2.3),
    (5.80, 0.00, 0.64, 0.62, 0.62, 0.62, 2.1, 2.2),
    (6.60, 0.00, 0.60, 0.60, 0.60, 0.60, 2.0, 2.0),
]
# Chin intake: a wide, shallow "smile" under the radome; flat top, round
# bottom, lower lip forward. z, cx, cy, half width, half height, exponents, slant.
INTAKE = [
    (-3.40, 0.0, -0.845, 0.77, 0.275, 3.2, 2.0, 0.14, 0.0, 0.08),
    (-2.80, 0.0, -0.790, 0.72, 0.250, 3.0, 2.2),
    (-1.40, 0.0, -0.720, 0.68, 0.280, 3.0, 2.4),
    (0.30, 0.0, -0.640, 0.62, 0.300, 3.0, 2.4),
    (1.90, 0.0, -0.520, 0.50, 0.260, 2.5, 2.4),
]
CANOPY = [  # z, base y, half width, height
    (-4.85, 0.38, 0.06, 0.10),
    (-4.45, 0.34, 0.32, 0.42),
    (-3.85, 0.30, 0.42, 0.72),
    (-3.05, 0.30, 0.45, 0.90),
    (-2.20, 0.32, 0.44, 0.84),
    (-1.55, 0.38, 0.38, 0.62),
    (-1.00, 0.44, 0.30, 0.44),
    (-0.50, 0.50, 0.18, 0.28),
]
SPINE = [  # dorsal hump from the canopy to the fin: z, base y, half width, height
    (-1.40, 0.42, 0.22, 0.30),
    (-0.40, 0.40, 0.38, 0.50),
    (2.00, 0.40, 0.40, 0.48),
    (4.00, 0.40, 0.34, 0.38),
    (5.60, 0.42, 0.24, 0.30),
    (6.40, 0.45, 0.16, 0.26),
]
LERX_OUT = [(0.54, -4.70), (0.70, -4.00), (0.84, -3.20), (0.98, -2.30), (1.14, -1.50), (1.36, -0.80), (1.64, -0.22), (1.98, 0.27)]
WING_LE = (0.60, -0.88), (4.55, 2.43)  # (x, z) at root and tip
WING_TE = 3.20, 3.40
STAB = dict(s0=0.55, s1=2.85, le=(4.55, 6.10), te=(6.95, 6.95), y=-0.12, anhedral=math.radians(10), pivot_z=5.55)
FIN = dict(s0=0.55, s1=3.35, le=(2.75, 5.75), te=(6.55, 6.75))

FUSE_R = A.region(A.FUSE, LENGTH[0] - 0.05, LENGTH[1] + 0.05, 0.0, 1.0)
WING_R = A.region(A.WING, -4.85, 3.85, 0.50, 4.90)
FIN_R = A.region(A.FIN, 2.45, 7.65, 3.45, 0.45)
STAB_R = A.region(A.STAB, 4.35, 7.10, 0.40, 3.00)


def wing_uv(p):
    return WING_R.uv(p[2], abs(p[0]))


def fin_uv(p):
    return FIN_R.uv(p[2], p[1])


def stab_uv(p):
    return STAB_R.uv(p[2], abs(p[0]))


def metal_uv(a, l):
    x, y, w, h = A.METAL
    return A.uv_px(x + a * w, y + l * (h - 1))


def missile_uv(a, l):
    x, y, w, h = A.MISSILE
    return A.uv_px(x + 1 + a * (w - 2), y + l * (h - 1))


def glass_uv(c):
    x, y, w, h = A.GLASS
    return A.uv_px(x + w / 2, y + 1 + c * (h - 2))


def plain(_p=None):
    return A.PLAIN_UV


def insignia(a, r):
    return A.insignia_uv(a, r)


def half_width(z):
    """Fuselage half width at the chine at z (stations interpolated)."""
    st = FORE + AFT
    for a, b in zip(st, st[1:]):
        if a[0] <= z <= b[0]:
            return lerp(a[2], b[2], (z - a[0]) / (b[0] - a[0]) if b[0] > a[0] else 0)
    return st[-1][2] if z > 0 else st[0][2]


def wing():
    le0, le1 = WING_LE
    return Surface(le0[0], le1[0], (le0[1], le1[1]), WING_TE, (0.20, 0.06),
                   lambda s, n, z: (s, WING_Y + n, z), wing_uv, hinge=(0.86, 0.60))


def fin():
    f = FIN
    return Surface(f["s0"], f["s1"], f["le"], f["te"], (0.20, 0.07), lambda s, n, z: (n, s, z), fin_uv, hinge=(0.83, 0.45))


def stab_surface():
    st = STAB
    k = math.tan(st["anhedral"])
    return Surface(st["s0"], st["s1"], st["le"], st["te"], (0.14, 0.05),
                   lambda s, n, z: (s, st["y"] - (s - st["s0"]) * k + n, z), stab_uv)


def build():
    root = Part(NAME)
    air = Part("airframe")
    half = Part("half")  # right-hand parts, mirrored at the end

    fuselage(air, FORE + AFT, FUSE_R, nu=6, nl=6, role=lambda i: "secondary" if i < 3 else "body")
    duct(air, INTAKE, lambda p, a: FUSE_R.uv(p[2], 0.5 + a), seg=20, lip=0.05, depth=1.3)
    # Radome and the pitot ahead of it.
    tube(air, (0, 0.06, -7.62), (0, 0.06, -7.20), [0.018, 0.03], 4, "metal", lambda a, l: missile_uv(0.5, 0.5))
    # Drag chute fairing at the fin root, reaching past the nozzle.
    tube(air, (0, 0.78, 5.20), (0, 0.78, 7.60), [0.04, 0.17, 0.19, 0.17], 6, "body",
         lambda a, l: FUSE_R.uv(lerp(5.2, 7.6, l), 0.02), cap1=True, at=[0, 0.25, 0.8, 1.0])
    bubble(air, SPINE, lambda c, z: FUSE_R.uv(z, 0.02 + 0.2 * c), seg=6, role="body")
    nozzle(air, 6.30, 7.45, 0.60, 0.52, 0.0, 16, True, metal_uv)

    # Wing with flaperon (inboard "flap", outboard "aileron"), LERX, rail, pylon, missiles.
    w = wing()
    cuts = [("flap_r", 0.95, 2.45, {"role": "flap"}), ("aileron_r", 2.45, 3.90, {"role": "aileron"})]
    surfaces = w.build(half, [1.95, 3.20], cuts)
    w.decal(half, 3.05, 0.47, 0.34, 1, insignia)
    w.decal(half, 3.05, 0.47, 0.34, -1, insignia)
    strake(half, [(0.78 * half_width(z), z) for _, z in LERX_OUT], LERX_OUT, WING_Y, 0.24, 0.10, wing_uv)
    block(half, (4.60, WING_Y, 2.70), (0.10, 0.12, 1.70), "secondary", wing_uv)
    plate(half, [(3.20, WING_Y - 0.06, 1.25), (3.20, WING_Y - 0.06, 2.95), (3.20, -0.36, 2.75), (3.20, -0.36, 1.05)], "secondary", wing_uv, thick=0.07)
    # Stores (sim loadout: 5): AIM-120s on the tips, AIM-9s on the outer pylons, one on the left inner pylon.
    amraam = dict(length=3.65, r=0.085, uv=missile_uv, fins=((0.36, 0.11, 0.34), (0.88, 0.12, 0.30)))
    sidewinder = dict(length=2.90, r=0.064, uv=missile_uv, fins=((0.12, 0.09, 0.14), (0.86, 0.12, 0.26)))
    tip = store((4.73, WING_Y - 0.01, 0.55), **amraam)
    outer = store((3.20, -0.44, 0.35), **sidewinder)
    inner = store((-2.20, -0.48, -0.05), **sidewinder)
    plate(air, [(-2.20, WING_Y - 0.08, 0.85), (-2.20, WING_Y - 0.08, 2.55), (-2.20, -0.40, 2.35), (-2.20, -0.40, 0.65)], "secondary", wing_uv, thick=0.07)
    stores = firing_order([inner, outer, outer.mirrored(), tip, tip.mirrored()])

    # Tail boom fairings either side of the engine; speed brakes at their ends.
    boom = [(z, k) for z, k in ((2.55, 0.05), (3.40, 1.0), (6.25, 1.0), (7.15, 0.85))]
    rings = []
    for z, k in boom:
        rings.append([(0.82 + 0.20 * k * math.cos(t), -0.08 + 0.11 * k * math.sin(t), z) for t in [i / 6 * 2 * math.pi for i in range(6)]])
    from parts import loft
    loft(half, rings, [[FUSE_R.uv(p[2], 0.5) for p in r] for r in rings],
         lambda i, j: "secondary" if i == 2 else "body", closed=True, cap_end="secondary")

    # Ventral fins, canted out.
    c, s_ = math.cos(math.radians(15)), math.sin(math.radians(15))
    ventral = Surface(0.0, 0.55, (3.75, 4.30), (5.05, 4.95), (0.05, 0.03),
                      lambda s, n, z: (0.60 + s * s_ + n * c, -0.30 - s * c + n * s_, z), fin_uv)
    ventral.build(half, [], root_cap=False)

    # Stabilator (all-moving, pivots near its root).
    st = stab_surface()
    stab = Part("stab_r", (STAB["s0"], STAB["y"], STAB["pivot_z"]), {"role": "stab", "axis": [0.0, 0.0, 0.0]})
    st.build(stab, [1.7], root_cap=False)
    k = math.tan(STAB["anhedral"])
    n = math.hypot(1, k)
    stab.props["axis"] = [round(1 / n, 4), round(-k / n, 4), 0.0]

    half_l = half.mirrored("half_l")
    air.add(half).add(half_l)

    # Fin with rudder, tip stripe and insignia.
    f = fin()
    rudder = f.build(air, [2.95], [("rudder", 0.95, 2.70, {"role": "rudder"})],
                     role=lambda s: "stripe" if s > 2.95 else "body")[0]
    f.decal(air, 2.45, 0.42, 0.26, 1, insignia)
    f.decal(air, 2.45, 0.42, 0.26, -1, insignia)
    for side in (1, -1):
        f.patch(air, 1.30, 1.86, 4.45, 5.20, side, A.NUMBER)
    # IFF antennas ahead of the windscreen.
    for x in (-0.16, 0.16):
        plate(air, [(x, 0.56, -5.05), (x, 0.56, -4.90), (x * 1.3, 0.74, -4.95), (x * 1.3, 0.74, -5.05)], "dark", plain)

    cano = Part("canopy", (0.0, 0.70, -0.75), {"role": "canopy"})
    bubble(cano, CANOPY, lambda c, z: glass_uv(c), seg=8, frame_at=-2.45)

    root.children = [air, cano]
    for p in surfaces:
        root.children += [p, p.mirrored()]
    root.children += [stab, stab.mirrored(), rudder, gear()] + stores
    for name in ("ab_0", "idle_0"):
        root.children.append(Part(name, (0.0, 0.0, 7.45), {"radius": 0.46}))
    return root


def gear():
    """Gear in the down position; retract = [axis x, y, z, angle] to fold it up."""
    g = Part("gear")
    dark, metal = "dark", "metal"
    m = lambda a, l: missile_uv(0.5, 0.5)

    nose = Part("gear_nose", (0.0, -0.90, -2.70), {"retract": [1.0, 0.0, 0.0, -1.5708]})
    tube(nose, (0, -0.90, -2.70), (0, -1.98, -2.70), [0.07, 0.06], 6, metal, m)
    for x in (-0.12, 0.12):
        block(nose, (x, -2.06, -2.64), (0.04, 0.34, 0.10), metal)
    tube(nose, (-0.09, -2.22, -2.62), (0.09, -2.22, -2.62), [0.28, 0.28], 10, dark, cap0=True, cap1=True)
    block(nose, (0.0, -1.55, -2.62), (0.05, 0.40, 0.06), metal)  # torque link

    main = Part("gear_main_r", (1.02, -0.18, 0.90), {"retract": [1.0, 0.0, 0.0, 1.5708]})
    tube(main, (1.02, -0.18, 0.90), (1.15, -1.95, 0.90), [0.085, 0.07], 6, metal, m)
    tube(main, (0.72, -0.30, 0.25), (1.10, -1.25, 0.86), [0.045, 0.04], 5, metal, m)
    tube(main, (1.06, -2.14, 0.90), (1.30, -2.14, 0.90), [0.36, 0.36], 12, dark, cap0=True, cap1=True)

    door_n = Part("door_nose", (0.21, -1.04, -2.20), {"retract": [0.0, 0.0, 1.0, -1.5708]})
    plate(door_n, [(0.21, -1.04, -2.90), (0.21, -1.04, -1.50), (0.21, -1.43, -1.55), (0.21, -1.43, -2.85)], "body", plain, thick=0.03)
    door_m = Part("door_main_r", (1.46, -0.12, 0.95), {"retract": [0.0, 0.0, 1.0, -1.5708]})
    plate(door_m, [(1.46, -0.12, 0.25), (1.46, -0.12, 1.65), (1.46, -0.58, 1.55), (1.46, -0.58, 0.35)], "body", plain, thick=0.03)

    g.children = [nose, main, main.mirrored(), door_n, door_m, door_m.mirrored()]
    return g


def texture():
    cv = A.Canvas()
    fz = lambda z, s: FUSE_R.px(z, s)
    # Fuselage: radome shade, frames, longerons, access panels, intake warning, exhaust soot.
    for z, s0, s1 in ((-5.60, 0, 1), (-4.80, 0, 0.5), (-3.25, 0.5, 1), (-0.80, 0, 1), (0.70, 0, 0.5), (2.10, 0, 1),
                      (3.55, 0, 0.5), (4.90, 0, 1), (5.95, 0, 1)):
        x, y0 = fz(z, s0)
        _, y1 = fz(z, s1)
        cv.line(x, y0, x, y1 - 1, 0.7)
    for s, z0, z1 in ((0.5, -4.7, 6.3), (0.24, -0.8, 5.95), (0.78, -3.25, 4.9)):
        a, y = fz(z0, s)
        b, _ = fz(z1, s)
        cv.line(a, y, b, y, 0.74)
    for z0, z1, s0, s1 in ((-2.0, -1.0, 0.08, 0.20), (0.9, 1.9, 0.06, 0.18), (2.3, 3.3, 0.30, 0.44), (-0.6, 0.4, 0.56, 0.70),
                           (3.8, 4.7, 0.56, 0.72), (1.0, 2.0, 0.84, 0.96), (-4.6, -3.5, 0.30, 0.44)):
        a, b = fz(z0, s0), fz(z1, s1)
        cv.box(a[0], a[1], b[0], b[1], 0.72)
    for k in range(2):  # red intake warning chevrons, pointing forward
        zc = -2.95 + k * 0.32
        a = fz(zc, 0.70)
        b = fz(zc + 0.28, 0.60)
        c = fz(zc + 0.28, 0.80)
        cv.poly([a, b, (b[0] + 3, b[1]), (a[0] + 3, a[1]), (c[0] + 3, c[1]), c], (0.9, 0.16, 0.12), op="mul")
    sx, _ = fz(5.95, 0)
    ex, _ = fz(LENGTH[1], 0)
    for x in range(int(sx), int(ex) + 1):
        k = 1 - 0.35 * (x - sx) / max(1, ex - sx)
        cv.rect_mul(x, 0, x + 1, 96, k)
    # Wing and LERX from above: LE flap line, spars, ribs, flaperon hinge.
    w = wing()
    for f, k in ((0.16, 0.62), (0.40, 0.75), (None, 0.55)):
        pts = []
        for s in (1.95, 2.6, 3.3, 4.0, 4.55) if f is not None else (0.95, 2.45, 3.90):
            le, te, _ = w.at(s)
            ff = f if f is not None else w.hinge_frac(s)
            pts.append(WING_R.px(lerp(le, te, ff), s))
        for a, b in zip(pts, pts[1:]):
            cv.line(a[0], a[1], b[0], b[1], k)
    for s in (0.95, 1.60, 2.45, 3.20, 3.90):
        le, te, _ = w.at(s)
        a, b = WING_R.px(lerp(le, te, 0.16), s), WING_R.px(te, s)
        cv.line(a[0], a[1], b[0], b[1], 0.78)
    a, b = WING_R.px(-4.7, 0.95), WING_R.px(0.2, 0.95)
    cv.line(a[0], a[1], b[0], b[1], 0.7)
    # Fin: rudder hinge, panels, tail number.
    f = fin()
    pts = [FIN_R.px(lerp(*f.at(s)[:2], f.hinge_frac(s)), s) for s in (0.95, 2.70)]
    cv.line(pts[0][0], pts[0][1], pts[1][0], pts[1][1], 0.55)
    for s in (0.95, 1.80, 2.70):
        le, te, _ = f.at(s)
        a, b = FIN_R.px(le, s), FIN_R.px(te, s)
        cv.line(a[0], a[1], b[0], b[1], 0.72)
    x, y, _, _ = A.NUMBER
    cv.text("AF86", x + 4, y + 3, 0.3)
    cv.text("0401", x + 4, y + 13, 0.3)
    # Stabilator panel lines.
    st = stab_surface()
    for s in (1.2, 2.0):
        le, te, _ = st.at(s)
        a, b = STAB_R.px(le, s), STAB_R.px(te, s)
        cv.line(a[0], a[1], b[0], b[1], 0.7)
    # Nozzle: light casing, darker petals with seams, burnt rim.
    x, y, ww, hh = A.METAL
    cv.rect_mul(x, y + hh * 0.45, x + ww, y + hh, 0.62)
    cv.rect_mul(x, y + hh * 0.85, x + ww, y + hh, 0.7)
    for j in range(16):
        px = x + j / 16 * ww
        cv.line(px, y + hh * 0.45, px, y + hh - 1, 0.6)
    # Missile: dark seeker, yellow and brown bands, darker tail.
    x, y, ww, hh = A.MISSILE
    cv.rect(x, y, x + ww, y + 4, (0.25, 0.25, 0.28))
    cv.rect(x, y + 8, x + ww, y + 10, (0.95, 0.8, 0.25))
    cv.rect(x, y + 11, x + ww, y + 13, (0.6, 0.45, 0.3))
    cv.rect_mul(x, y + hh - 6, x + ww, y + hh, 0.8)
    # Canopy: a bright streak along the top, darker towards the sills.
    x, y, ww, hh = A.GLASS
    for j in range(hh):
        c = j / (hh - 1)
        k = 1.0 if c < 0.12 else (0.55 if c < 0.2 else 0.72 - 0.25 * c)
        cv.rect(x, y + j, x + ww, y + j + 1, (k, k, k))
    A.draw_insignia(cv)
    return cv
