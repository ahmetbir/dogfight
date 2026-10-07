"""F-22: chined diamond nose, long frameless bubble canopy, caret intakes
(raked, swept lips) under the chines, a wide flat body, 42-degree diamond
wing with a forward-swept trailing edge, twin fins canted 28 degrees out,
all-moving stabilators notched behind the wing, flat 2-D nozzles between the
tail booms, missiles in the side and main bays. True metres (18.9 m long,
13.6 m span), nose toward -z.
"""
import math

import atlas as A
from mesh import Part
from parts import bubble, duct, firing_order, fuselage, loft, plate, store, strake, tube
from kinds._jet import (AIM120, AIM9, Jet, engines, fin, gear, glass_uv, insignia, mirrored_rudder, missile_uv,
                        paint_common, paint_fuselage, paint_surface, shaped_nozzle, stabilator, wing)

NAME = "f22"

J = Jet(length=(-9.55, 9.60), wing=(-1.4, 6.8, 1.4, 6.8), fin=(4.2, 8.2, 3.05, 0.35), stab=(5.8, 9.7, 1.8, 4.5))

FUSE = [  # z, cy, w, ht, hb, wb, eu, el: a chine at cy, flat facets above and below
    (-9.55, -0.10, 0.02, 0.02, 0.02, 0.02, 1.4, 1.4),
    (-8.90, -0.08, 0.30, 0.22, 0.20, 0.26, 1.4, 1.5),
    (-7.80, -0.04, 0.56, 0.38, 0.36, 0.46, 1.4, 1.5),
    (-6.60, 0.00, 0.76, 0.46, 0.50, 0.58, 1.5, 1.6),
    (-5.20, 0.00, 0.92, 0.52, 0.60, 0.66, 1.6, 1.7),
    (-3.90, 0.00, 1.05, 0.54, 0.62, 0.66, 1.8, 1.8),
    (-2.20, 0.00, 1.45, 0.58, 0.62, 0.80, 2.2, 2.2),
    (0.50, 0.00, 1.90, 0.58, 0.58, 1.40, 3.0, 2.6),
    (3.00, 0.00, 1.88, 0.55, 0.52, 1.45, 3.2, 2.8),
    (5.50, 0.00, 1.62, 0.48, 0.46, 1.30, 3.0, 2.8),
    (7.40, 0.00, 1.30, 0.38, 0.40, 1.10, 2.8, 2.8),
    (8.30, 0.00, 1.10, 0.20, 0.30, 0.95, 2.6, 2.6),
]
# Caret intakes: the top wider than the bottom, the lower lip forward, the
# outboard edge swept back. z, cx, cy, hw, hh, et, eb, rake, sweep, smile, taper, lean
INTAKE = [
    (-3.90, 1.18, -0.28, 0.40, 0.50, 10.0, 10.0, 0.62, 0.35, 0.0, 1.40, 0.0),
    (-3.00, 1.12, -0.30, 0.36, 0.45, 6.0, 6.0, 0.0, 0.0, 0.0, 1.25),
    (-1.00, 1.02, -0.30, 0.34, 0.41, 4.0, 4.0, 0.0, 0.0, 0.0, 1.10),
    (1.50, 0.90, -0.28, 0.32, 0.36, 3.0, 3.0),
]
CANOPY = [  # z, base y, half width, height
    (-6.70, 0.40, 0.04, 0.06), (-6.20, 0.38, 0.30, 0.34), (-5.40, 0.36, 0.48, 0.74), (-4.50, 0.38, 0.54, 0.94),
    (-3.60, 0.42, 0.50, 0.86), (-2.90, 0.48, 0.40, 0.54), (-2.40, 0.52, 0.26, 0.30), (-2.05, 0.55, 0.06, 0.08),
]
SPINE = [(-2.60, 0.50, 0.40, 0.30), (-0.80, 0.50, 0.75, 0.30), (2.50, 0.48, 0.80, 0.26), (5.50, 0.42, 0.60, 0.16),
         (7.60, 0.34, 0.40, 0.06)]
CHINE_OUT = [(1.05, -3.90), (1.25, -3.20), (1.50, -2.40), (1.78, -1.60), (1.95, -1.15)]
WING_Y = 0.02
FIN_X, FIN_Y, FIN_CANT = 1.38, 0.40, math.radians(28)


def wing_surface():
    le = lambda s: -1.05 + (s - 1.95) * 0.90  # 42 degrees
    te = lambda s: 6.55 - (s - 1.95) * 0.31   # forward-swept trailing edge
    return wing(1.60, 6.78, (le(1.60), le(6.78)), (te(1.60), te(6.78)), (0.30, 0.07), WING_Y, J.wing_uv, hinge=(0.82, 0.68))


def fin_surface(mirror=False):
    return fin(0.0, 2.95, (4.40, 6.05), (7.95, 7.05), (0.16, 0.06), J.fin_uv, x0=FIN_X, y0=FIN_Y, cant=FIN_CANT,
               hinge=(0.78, 0.62), mirror=mirror)


def stab_surface():
    return wing(1.85, 4.45, (6.10, 8.40), (9.55, 8.85), (0.15, 0.04), -0.05, J.stab_uv)


def build():
    root = Part(NAME)
    air = Part("airframe")
    half = Part("half")

    fuselage(air, FUSE, J.FUSE, nu=6, nl=6, role=lambda i: "secondary" if i < 2 else "body")
    tube(air, (0, -0.10, -9.62), (0, -0.10, -9.50), [0.01, 0.02], 4, "metal", lambda a, l: missile_uv(0.5, 0.5))
    bubble(air, SPINE, lambda c, z: J.fuse(z, 0.02 + 0.2 * c), seg=6, role="body")
    duct(half, INTAKE, J.duct_uv, seg=16, lip=0.05, depth=0.9, wall="dark")
    strake(half, [(0.95, z) for _, z in CHINE_OUT], CHINE_OUT, WING_Y, 0.20, 0.30, J.wing_uv)

    w = wing_surface()
    cuts = [("flap_r", 2.05, 4.20, {"role": "flap"}), ("aileron_r", 4.20, 6.10, {"role": "aileron"})]
    surfaces = w.build(half, [3.2, 5.3], cuts)
    w.decal(half, 5.00, 0.42, 0.36, 1, insignia)
    w.decal(half, 5.00, 0.42, 0.36, -1, insignia)

    # Tail booms outboard of the nozzles carry the stabilators.
    rings = []
    for z, k in ((4.6, 0.1), (5.6, 1.0), (9.1, 1.0), (9.60, 0.6)):
        rings.append([(1.80 + 0.26 * k * math.cos(t), -0.02 + 0.14 * k * math.sin(t), z) for t in [i / 6 * 2 * math.pi for i in range(6)]])
    loft(half, rings, [[J.fuse(p[2], 0.5) for p in r] for r in rings], "body", closed=True, cap_end="secondary")

    f = fin_surface()
    rudder = f.build(half, [2.55], [("rudder_r", 0.25, 2.35, {"role": "rudder"})],
                     role=lambda s: "stripe" if s > 2.55 else "body")[0]

    st = stabilator(stab_surface(), (1.85, -0.05, 7.6), (1.0, 0.0, 0.0), stations=[3.0])

    air.add(half).add(half.mirrored("half_l"))
    for x in (-0.66, 0.66):  # flat thrust-vectoring nozzles
        shaped_nozzle(air, [(7.30, x, 0.0, 0.58, 0.40, 4.0, 4.0), (8.40, x, 0.0, 0.56, 0.34, 6.0, 6.0),
                            (9.20, x, 0.0, 0.54, 0.26, 9.0, 9.0)], seg=12, depth=0.5)
    fin_surface().patch(air, 0.75, 1.30, 5.60, 6.60, 1, A.NUMBER)
    fin_surface(mirror=True).patch(air, 0.75, 1.30, 5.60, 6.60, 1, A.NUMBER, flip=True)
    # Weapon bay outlines on the belly (dark) with the missiles on their trapezes.
    for x0, x1, z0, z1 in ((-0.80, 0.80, -1.80, 2.40),):
        plate(air, [(x0, -0.585, z0), (x1, -0.585, z0), (x1, -0.585, z1), (x0, -0.585, z1)], "dark")

    a9 = store((1.42, -0.42, -2.30), **AIM9)
    a120 = store((0.42, -0.70, -1.40), **AIM120)
    stores = firing_order([a9.mirrored(), a9, a120.mirrored(), a120])

    cano = Part("canopy", (0.0, 0.60, -2.0), {"role": "canopy"})
    bubble(cano, CANOPY, glass_uv, seg=8)

    root.children = [air, cano]
    for p in surfaces:
        root.children += [p, p.mirrored()]
    root.children += [st, st.mirrored(), rudder, mirrored_rudder(rudder)]
    root.children.append(gear(
        dict(z=-5.80, top=-0.58, r=0.28, fold=-1),
        dict(x=1.45, z=1.60, top=-0.45, r=0.42, xw=1.58, fold=1, brace=(1.15, -0.55, 0.90)),
        nose_door=dict(x=0.24, y=-0.60, z0=-6.5, z1=-5.1, depth=0.38),
        main_door=dict(x=1.95, y=-0.30, z0=0.8, z1=2.5, depth=0.55)))
    root.children += stores
    engines(root, [(-0.66, 0.0, 9.20, 0.36), (0.66, 0.0, 9.20, 0.36)])
    return root


def texture():
    cv = A.Canvas()
    paint_fuselage(cv, J,
                   frames=[(-7.8, 0, 1), (-6.7, 0, 0.5), (-2.0, 0, 1), (0.4, 0, 0.5), (2.6, 0, 1), (5.0, 0, 1), (7.2, 0, 1)],
                   longerons=[(0.5, -7.6, 8.2), (0.30, -2.0, 7.2), (0.75, -3.8, 8.0)],
                   panels=[(-1.6, -0.2, 0.04, 0.16), (0.6, 2.0, 0.04, 0.16), (3.0, 4.6, 0.30, 0.42), (-5.6, -4.4, 0.60, 0.72)],
                   soot_from=8.0)
    w = wing_surface()
    paint_surface(cv, J.WING, w, chords=[(0.12, 2.2, 6.6), (0.45, 2.2, 6.4)], spans=[2.05, 3.2, 4.2, 5.3, 6.1], hinge_spans=(2.05, 6.1))
    paint_surface(cv, J.FIN, fin_surface(), chords=[(0.40, 0.2, 2.7)], spans=[0.25, 1.3, 2.35], hinge_spans=(0.25, 2.35),
                  height=lambda s: FIN_Y + s * math.cos(FIN_CANT))
    paint_surface(cv, J.STAB, stab_surface(), chords=[(0.4, 2.0, 4.2)], spans=[3.0])
    paint_common(cv, ("AF", "4065"))
    return cv
