"""MiG-29: drooped nose, bubble canopy and dorsal hump, big sharp LERX,
two engine nacelles slung apart under the wing roots with boxy wedge intakes
(upper lip forward) under the LERX, twin fins canted out on the booms,
all-moving tailerons. True metres (17.3 m long, 11.4 m span), nose toward -z.
"""
import math

import atlas as A
from mesh import Part
from parts import bubble, duct, firing_order, fuselage, loft, plate, store, strake, tube
from kinds._jet import (R27, R73, Jet, engines, fin, gear, glass_uv, insignia, mirrored_rudder, missile_uv, nozzles,
                        paint_common, paint_fuselage, paint_surface, plain, stabilator, wing)

NAME = "mig29"
MISSILES = 4  # sim.Spec.Missiles

J = Jet(length=(-8.66, 8.40), wing=(-5.5, 4.3, 0.4, 5.8), fin=(2.4, 7.3, 2.75, 0.05), stab=(5.9, 8.8, 1.6, 4.0))

FUSE = [  # z, cy, w, ht, hb, wb, eu, el
    (-8.20, -0.24, 0.03, 0.03, 0.03, 0.03, 2.0, 2.0),
    (-7.70, -0.20, 0.24, 0.24, 0.23, 0.23, 2.0, 2.0),
    (-6.90, -0.12, 0.40, 0.40, 0.38, 0.38, 2.0, 2.0),
    (-6.10, -0.05, 0.50, 0.50, 0.46, 0.46, 2.0, 2.2),
    (-5.10, 0.00, 0.56, 0.56, 0.52, 0.52, 2.2, 2.3),
    (-4.00, 0.00, 0.60, 0.58, 0.55, 0.55, 2.4, 2.4),
    (-2.80, 0.00, 0.62, 0.60, 0.56, 0.56, 2.6, 2.4),
    (-1.00, 0.00, 0.62, 0.60, 0.50, 0.50, 2.8, 2.4),
    (1.50, 0.00, 0.60, 0.55, 0.45, 0.45, 2.8, 2.4),
    (4.00, 0.00, 0.55, 0.48, 0.40, 0.42, 2.6, 2.4),
    (6.00, 0.00, 0.45, 0.40, 0.35, 0.35, 2.4, 2.2),
    (7.40, 0.00, 0.28, 0.28, 0.25, 0.25, 2.0, 2.0),
]
# Wedge intakes under the LERX, upper lip forward, flowing into the nacelles.
NACELLE = [
    (-2.70, 1.06, -0.52, 0.43, 0.46, 9.0, 8.0, -0.40),
    (-1.60, 1.06, -0.52, 0.43, 0.45, 5.0, 4.5),
    (1.00, 1.05, -0.50, 0.49, 0.50, 3.0, 3.0),
    (4.00, 1.02, -0.40, 0.50, 0.50, 2.5, 2.5),
    (6.50, 0.98, -0.24, 0.50, 0.48, 2.2, 2.2),
    (7.40, 0.98, -0.20, 0.48, 0.46, 2.0, 2.0),
]
CANOPY = [
    (-5.55, 0.36, 0.06, 0.10), (-5.15, 0.34, 0.32, 0.44), (-4.60, 0.32, 0.44, 0.72), (-3.90, 0.34, 0.46, 0.80),
    (-3.20, 0.40, 0.42, 0.68), (-2.60, 0.48, 0.32, 0.44), (-2.10, 0.54, 0.18, 0.24), (-1.70, 0.56, 0.06, 0.10),
]
SPINE = [(-2.60, 0.45, 0.25, 0.25), (-1.00, 0.42, 0.42, 0.36), (2.00, 0.40, 0.40, 0.30), (4.50, 0.38, 0.30, 0.20), (6.40, 0.34, 0.16, 0.12)]
LERX_OUT = [(0.50, -5.20), (0.75, -4.40), (1.05, -3.40), (1.40, -2.40), (1.80, -1.50), (2.20, -0.80), (2.55, -0.25), (2.80, 0.10)]
WING_Y = 0.02
FIN_X, FIN_Y, FIN_CANT = 1.58, 0.10, math.radians(6)


def wing_surface():
    le = lambda s: 0.10 + (s - 2.80) * 0.90
    return wing(0.50, 5.68, (le(0.50), le(5.68)), (3.95, 3.85), (0.22, 0.06), WING_Y, J.wing_uv, hinge=(0.85, 0.72))


def fin_surface(mirror=False):
    return fin(0.0, 2.45, (3.60, 6.00), (7.00, 6.95), (0.16, 0.06), J.fin_uv, x0=FIN_X, y0=FIN_Y, cant=FIN_CANT,
               hinge=(0.80, 0.55), mirror=mirror)


def stab_surface():
    return wing(1.72, 3.95, (6.10, 7.85), (8.55, 8.45), (0.14, 0.05), -0.12, J.stab_uv)


def build():
    root = Part(NAME)
    air = Part("airframe")
    half = Part("half")

    fuselage(air, FUSE, J.FUSE, nu=6, nl=6, role=lambda i: "secondary" if i < 3 else "body")
    tube(air, (0, -0.24, -8.66), (0, -0.24, -8.18), [0.02, 0.03], 4, "metal", lambda a, l: missile_uv(0.5, 0.5))
    bubble(air, SPINE, lambda c, z: J.fuse(z, 0.02 + 0.2 * c), seg=6, role="body")
    duct(half, NACELLE, J.duct_uv, seg=16, lip=0.05, depth=1.2)
    strake(half, [(0.40, z) for _, z in LERX_OUT], LERX_OUT, WING_Y, 0.20, 0.10, J.wing_uv)

    w = wing_surface()
    cuts = [("flap_r", 1.60, 3.40, {"role": "flap"}), ("aileron_r", 3.40, 5.20, {"role": "aileron"})]
    surfaces = w.build(half, [2.8, 4.4], cuts)
    w.decal(half, 4.30, 0.40, 0.36, 1, insignia)
    w.decal(half, 4.30, 0.40, 0.36, -1, insignia)
    # Pylons: R-27 inboard, R-73 outboard.
    for x, z0, z1, lo in ((3.20, 0.3, 2.6, -0.34), (4.30, 1.4, 2.9, -0.28)):
        plate(half, [(x, WING_Y - 0.06, z0), (x, WING_Y - 0.06, z1), (x, lo, z1 - 0.2), (x, lo, z0 + 0.1)], "secondary", J.wing_uv, thick=0.08)

    # Booms outboard of the nacelles carry the fins and tailerons.
    rings = []
    for z, k in ((2.4, 0.1), (3.4, 1.0), (7.9, 1.0), (8.4, 0.7)):
        rings.append([(1.62 + 0.20 * k * math.cos(t), -0.10 + 0.14 * k * math.sin(t), z) for t in [i / 6 * 2 * math.pi for i in range(6)]])
    loft(half, rings, [[J.fuse(p[2], 0.5) for p in r] for r in rings], "body", closed=True, cap_end="secondary")

    f = fin_surface()
    rudder = f.build(half, [2.1], [("rudder_r", 0.25, 1.90, {"role": "rudder"})],
                     role=lambda s: "stripe" if s > 2.1 else "body")[0]
    f.decal(half, 1.45, 0.38, 0.28, 1, insignia)
    f.decal(half, 1.45, 0.38, 0.28, -1, insignia)
    # Fin root extension running forward onto the LERX.
    x0 = FIN_X
    plate(half, [(x0, FIN_Y, 2.40), (x0, FIN_Y, 3.70), (x0 + 0.05, FIN_Y + 0.45, 3.95)], "body", J.fin_uv, thick=0.06)

    st = stabilator(stab_surface(), (1.72, -0.12, 7.2), (1.0, 0.0, 0.0), stations=[2.8])

    air.add(half).add(half.mirrored("half_l"))
    nozzles(air, (-0.98, 0.98), 7.10, 8.30, 0.50, 0.44, -0.20)
    fin_surface().patch(air, 0.55, 1.05, 5.55, 6.35, 1, A.NUMBER)
    fin_surface(mirror=True).patch(air, 0.55, 1.05, 5.55, 6.35, 1, A.NUMBER, flip=True)

    r73 = store((4.30, -0.40, 0.50), **R73)
    r27 = store((3.20, -0.48, -0.60), **R27)
    stores = firing_order([r73.mirrored(), r73, r27.mirrored(), r27])

    cano = Part("canopy", (0.0, 0.62, -1.7), {"role": "canopy"})
    bubble(cano, CANOPY, glass_uv, seg=8, frame_at=-5.05)

    root.children = [air, cano]
    for p in surfaces:
        root.children += [p, p.mirrored()]
    root.children += [st, st.mirrored(), rudder, mirrored_rudder(rudder)]
    root.children.append(gear(
        dict(z=-3.70, top=-0.52, r=0.26, twin=True, fold=-1),
        dict(x=1.55, z=1.30, top=-0.30, r=0.38, xw=1.68, fold=1, brace=(1.25, -0.42, 0.70)),
        nose_door=dict(x=0.24, y=-0.54, z0=-4.3, z1=-3.0, depth=0.36),
        main_door=dict(x=2.00, y=-0.10, z0=0.55, z1=2.05, depth=0.50)))
    root.children += stores
    engines(root, [(-0.98, -0.20, 8.30, 0.42), (0.98, -0.20, 8.30, 0.42)])
    return root


def texture():
    cv = A.Canvas()
    paint_fuselage(cv, J,
                   frames=[(-6.10, 0, 1), (-5.2, 0, 0.5), (-3.6, 0.5, 1), (-2.4, 0, 1), (-0.5, 0, 0.5), (1.4, 0, 1),
                           (3.2, 0, 0.5), (4.8, 0, 1), (6.2, 0, 1)],
                   longerons=[(0.5, -5.8, 7.2), (0.22, -2.2, 6.4), (0.8, -3.6, 6.8)],
                   panels=[(-1.8, -0.8, 0.06, 0.18), (0.6, 1.8, 0.06, 0.18), (2.4, 3.6, 0.30, 0.44), (-4.6, -3.7, 0.56, 0.70)],
                   soot_from=6.2)
    w = wing_surface()
    paint_surface(cv, J.WING, w, chords=[(0.15, 2.9, 5.6), (0.42, 2.9, 5.5)], spans=[1.6, 2.5, 3.4, 4.4, 5.2], hinge_spans=(1.6, 5.2))
    for z in (-3.0, -2.6, -2.2, -1.8):  # LERX auxiliary intake louvres
        a, b = J.WING.px(z, 0.75), J.WING.px(z + 0.25, 1.25)
        cv.box(a[0], a[1], b[0], b[1], 0.6)
    paint_surface(cv, J.FIN, fin_surface(), chords=[(0.42, 0.2, 2.1)], spans=[0.25, 1.1, 1.9], hinge_spans=(0.25, 1.9),
                  height=lambda s: FIN_Y + s * math.cos(FIN_CANT))
    paint_surface(cv, J.STAB, stab_surface(), chords=[(0.4, 1.9, 3.8)], spans=[2.5, 3.2])
    paint_common(cv, ("", "23"))
    return cv
