"""Su-27: long drooped nose, big bubble canopy and dorsal hump, large ogival
LERX, widely spaced nacelles with boxy intakes (upper lip forward) under the
LERX, the long tail "stinger" between the nozzles, twin upright fins on booms
outboard of the nacelles with ventral fins below, tip launchers. True metres
(21.9 m long, 14.7 m span), nose toward -z.
"""
import math

import atlas as A
from mesh import Part
from parts import block, bubble, duct, firing_order, fuselage, loft, plate, store, strake, tube
from kinds._jet import (R27, R73, Jet, engines, fin, gear, glass_uv, insignia, mirrored_rudder, missile_uv, nozzles,
                        paint_common, paint_fuselage, paint_surface, plain, stabilator, wing)

NAME = "su27"
MISSILES = 5  # sim.Spec.Missiles

J = Jet(length=(-10.95, 10.95), wing=(-7.0, 5.5, 0.5, 7.3), fin=(5.2, 9.5, 3.55, -0.10), stab=(7.4, 10.6, 2.1, 5.5))

FUSE = [  # z, cy, w, ht, hb, wb, eu, el
    (-10.40, -0.30, 0.03, 0.03, 0.03, 0.03, 2.0, 2.0),
    (-9.80, -0.25, 0.30, 0.30, 0.28, 0.28, 2.0, 2.0),
    (-8.90, -0.17, 0.50, 0.50, 0.46, 0.46, 2.0, 2.0),
    (-7.90, -0.08, 0.62, 0.62, 0.56, 0.56, 2.0, 2.2),
    (-6.70, 0.00, 0.70, 0.66, 0.62, 0.62, 2.2, 2.3),
    (-5.20, 0.00, 0.76, 0.70, 0.66, 0.64, 2.4, 2.4),
    (-3.50, 0.00, 0.80, 0.74, 0.66, 0.62, 2.6, 2.4),
    (-1.20, 0.00, 0.80, 0.76, 0.58, 0.56, 2.8, 2.4),
    (1.80, 0.00, 0.76, 0.72, 0.50, 0.50, 2.8, 2.4),
    (4.50, 0.00, 0.66, 0.60, 0.44, 0.44, 2.6, 2.4),
    (7.00, 0.00, 0.50, 0.46, 0.38, 0.38, 2.4, 2.2),
    (9.20, 0.00, 0.40, 0.36, 0.32, 0.32, 2.2, 2.0),
    (10.70, 0.02, 0.24, 0.22, 0.20, 0.20, 2.0, 2.0),
    (10.95, 0.02, 0.06, 0.06, 0.05, 0.05, 2.0, 2.0),
]
NACELLE = [
    (-3.00, 1.30, -0.76, 0.46, 0.56, 9.0, 8.0, -0.46),
    (-1.80, 1.30, -0.77, 0.49, 0.59, 5.0, 4.5),
    (1.50, 1.28, -0.70, 0.56, 0.60, 3.0, 3.0),
    (5.00, 1.22, -0.55, 0.58, 0.58, 2.5, 2.5),
    (7.80, 1.18, -0.42, 0.58, 0.55, 2.2, 2.2),
    (8.60, 1.18, -0.40, 0.56, 0.53, 2.0, 2.0),
]
CANOPY = [
    (-7.05, 0.42, 0.07, 0.10), (-6.60, 0.38, 0.38, 0.50), (-6.00, 0.36, 0.52, 0.96), (-5.20, 0.38, 0.56, 1.14),
    (-4.40, 0.44, 0.52, 1.05), (-3.70, 0.52, 0.42, 0.76), (-3.10, 0.60, 0.28, 0.42), (-2.60, 0.66, 0.10, 0.20),
]
SPINE = [(-3.40, 0.55, 0.30, 0.36), (-1.80, 0.55, 0.55, 0.54), (0.50, 0.50, 0.60, 0.50), (3.50, 0.45, 0.50, 0.34),
         (6.50, 0.40, 0.35, 0.20), (9.00, 0.32, 0.20, 0.10)]
LERX_OUT = [(0.62, -6.60), (0.90, -5.60), (1.25, -4.50), (1.65, -3.40), (2.10, -2.40), (2.60, -1.50), (3.10, -0.80), (3.45, -0.30)]
WING_Y = 0.05
FIN_X, FIN_Y = 2.20, -0.05


def wing_surface():
    le = lambda s: -0.30 + (s - 3.45) * 0.90
    return wing(0.60, 7.00, (le(0.60), le(7.00)), (5.30, 4.30), (0.30, 0.07), WING_Y, J.wing_uv, hinge=(0.86, 0.72))


def fin_surface(mirror=False):
    return fin(0.0, 3.50, (5.40, 7.80), (9.20, 9.15), (0.20, 0.07), J.fin_uv, x0=FIN_X, y0=FIN_Y, hinge=(0.80, 0.50), mirror=mirror)


def stab_surface():
    return wing(2.30, 5.30, (7.60, 9.60), (10.40, 10.20), (0.16, 0.05), -0.25, J.stab_uv)


def build():
    root = Part(NAME)
    air = Part("airframe")
    half = Part("half")

    fuselage(air, FUSE, J.FUSE, nu=6, nl=6, role=lambda i: "secondary" if i < 3 else "body")
    tube(air, (0, -0.30, -10.95), (0, -0.30, -10.38), [0.02, 0.03], 4, "metal", lambda a, l: missile_uv(0.5, 0.5))
    bubble(air, SPINE, lambda c, z: J.fuse(z, 0.02 + 0.2 * c), seg=6, role="body")
    duct(half, NACELLE, J.duct_uv, seg=16, lip=0.05, depth=1.3)
    strake(half, [(0.45, z) for _, z in LERX_OUT], LERX_OUT, WING_Y, 0.22, 0.12, J.wing_uv)

    w = wing_surface()
    cuts = [("flap_r", 1.90, 4.60, {"role": "flap"}), ("aileron_r", 4.60, 6.40, {"role": "aileron"})]
    surfaces = w.build(half, [3.45, 5.5], cuts)
    w.decal(half, 5.40, 0.40, 0.44, 1, insignia)
    w.decal(half, 5.40, 0.40, 0.44, -1, insignia)
    block(half, (7.08, WING_Y, 3.60), (0.12, 0.14, 2.0), "secondary", J.wing_uv)  # tip launcher
    plate(half, [(5.00, WING_Y - 0.08, 1.8), (5.00, WING_Y - 0.08, 3.6), (5.00, -0.36, 3.4), (5.00, -0.36, 1.9)], "secondary", J.wing_uv, thick=0.08)
    plate(air, [(0.0, -0.62, 0.4), (0.0, -0.62, 2.6), (0.0, -0.80, 2.4), (0.0, -0.80, 0.6)], "secondary", plain, thick=0.10)

    rings = []
    for z, k in ((3.4, 0.1), (4.6, 1.0), (9.6, 1.0), (10.3, 0.7)):
        rings.append([(2.20 + 0.22 * k * math.cos(t), -0.22 + 0.16 * k * math.sin(t), z) for t in [i / 6 * 2 * math.pi for i in range(6)]])
    loft(half, rings, [[J.fuse(p[2], 0.5) for p in r] for r in rings], "body", closed=True, cap_end="secondary")

    f = fin_surface()
    rudder = f.build(half, [3.1], [("rudder_r", 0.40, 2.60, {"role": "rudder"})],
                     role=lambda s: "stripe" if s > 3.1 else "body")[0]
    f.decal(half, 2.20, 0.36, 0.34, 1, insignia)
    f.decal(half, 2.20, 0.36, 0.34, -1, insignia)
    # Ventral fins under the booms.
    c, sn = math.cos(math.radians(10)), math.sin(math.radians(10))
    from parts import Surface
    Surface(0.0, 0.85, (5.80, 6.40), (7.20, 7.00), (0.06, 0.03),
            lambda s, n, z: (2.20 + s * sn + n * c, -0.30 - s * c + n * sn, z), J.fin_uv).build(half, [], root_cap=False)

    st = stabilator(stab_surface(), (2.30, -0.25, 8.8), (1.0, 0.0, 0.0), stations=[3.8])

    air.add(half).add(half.mirrored("half_l"))
    nozzles(air, (-1.18, 1.18), 8.30, 9.50, 0.56, 0.50, -0.40)
    fin_surface().patch(air, 0.80, 1.35, 7.25, 8.15, 1, A.NUMBER)
    fin_surface(mirror=True).patch(air, 0.80, 1.35, 7.25, 8.15, 1, A.NUMBER, flip=True)

    r73 = store((7.12, WING_Y - 0.14, 1.70), **R73)
    r27 = store((5.00, -0.50, 0.30), **R27)
    centre = store((0.0, -0.95, -0.40), **R27)
    stores = firing_order([r73.mirrored(), r73, centre, r27.mirrored(), r27])

    cano = Part("canopy", (0.0, 0.70, -2.6), {"role": "canopy"})
    bubble(cano, CANOPY, glass_uv, seg=8, frame_at=-6.45)

    root.children = [air, cano]
    for p in surfaces:
        root.children += [p, p.mirrored()]
    root.children += [st, st.mirrored(), rudder, mirrored_rudder(rudder)]
    root.children.append(gear(
        dict(z=-5.60, top=-0.60, r=0.32, fold=-1),
        dict(x=2.05, z=2.10, top=-0.35, r=0.48, xw=2.18, fold=1, brace=(1.75, -0.50, 1.40)),
        nose_door=dict(x=0.26, y=-0.62, z0=-6.3, z1=-4.9, depth=0.42),
        main_door=dict(x=2.60, y=-0.30, z0=1.2, z1=2.9, depth=0.60)))
    root.children += stores
    engines(root, [(-1.18, -0.40, 9.50, 0.47), (1.18, -0.40, 9.50, 0.47)])
    return root


def texture():
    cv = A.Canvas()
    paint_fuselage(cv, J,
                   frames=[(-7.90, 0, 1), (-6.8, 0, 0.5), (-3.0, 0.5, 1), (-2.4, 0, 1), (-0.2, 0, 0.5), (2.0, 0, 1),
                           (4.2, 0, 0.5), (6.2, 0, 1), (8.4, 0, 1)],
                   longerons=[(0.5, -7.6, 10.4), (0.22, -2.8, 8.8), (0.8, -4.0, 9.0)],
                   panels=[(-2.0, -0.8, 0.06, 0.18), (0.8, 2.2, 0.06, 0.18), (3.0, 4.4, 0.30, 0.44), (-5.6, -4.6, 0.56, 0.70),
                           (5.0, 6.2, 0.58, 0.74)],
                   soot_from=8.8)
    w = wing_surface()
    paint_surface(cv, J.WING, w, chords=[(0.15, 3.5, 6.9), (0.42, 3.5, 6.8)], spans=[1.9, 3.0, 4.6, 5.5, 6.4], hinge_spans=(1.9, 6.4))
    paint_surface(cv, J.FIN, fin_surface(), chords=[(0.42, 0.3, 3.0)], spans=[0.4, 1.5, 2.6], hinge_spans=(0.4, 2.6),
                  height=lambda s: FIN_Y + s)
    paint_surface(cv, J.STAB, stab_surface(), chords=[(0.4, 2.4, 5.1)], spans=[3.2, 4.2])
    paint_common(cv, ("", "36"))
    return cv
