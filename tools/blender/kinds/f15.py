"""F-15: long nose, high bubble canopy, big boxy side intakes with the upper
ramp lip forward, a wide flat "pancake" body, broad 45-degree wing with
cropped tips, twin vertical fins on tail booms, twin nozzles. True metres
(19.4 m long, 13.05 m span), nose toward -z.
"""
import math

import atlas as A
from mesh import Part
from parts import bubble, duct, firing_order, fuselage, loft, plate, store, tube
from kinds._jet import (AIM120, AIM9, Jet, engines, fin, gear, glass_uv, insignia, mirrored_rudder, nozzles,
                        missile_uv, paint_common, paint_fuselage, paint_surface, plain, stabilator, wing)

NAME = "f15"

J = Jet(length=(-9.72, 9.75), wing=(-2.2, 5.0, 1.5, 6.7), fin=(4.9, 9.4, 3.55, 0.25), stab=(6.4, 9.8, 1.7, 4.5))

FUSE = [  # z, cy, w, ht, hb, wb, eu, el
    (-9.30, 0.05, 0.03, 0.03, 0.03, 0.03, 2.0, 2.0),
    (-8.80, 0.04, 0.26, 0.26, 0.25, 0.25, 2.0, 2.0),
    (-7.90, 0.03, 0.48, 0.48, 0.45, 0.45, 2.0, 2.0),
    (-6.95, 0.02, 0.62, 0.60, 0.58, 0.58, 2.0, 2.2),
    (-5.80, 0.00, 0.72, 0.64, 0.66, 0.66, 2.3, 2.4),
    (-4.60, 0.00, 0.80, 0.66, 0.70, 0.72, 2.6, 2.6),
    (-3.20, 0.00, 0.88, 0.68, 0.72, 0.78, 2.8, 2.8),
    (-1.50, -0.04, 1.25, 0.70, 0.70, 1.10, 3.2, 3.0),
    (0.50, -0.05, 1.85, 0.72, 0.66, 1.65, 3.8, 3.4),
    (3.00, -0.05, 1.90, 0.70, 0.62, 1.72, 4.0, 3.4),
    (5.50, -0.05, 1.72, 0.64, 0.60, 1.55, 3.6, 3.2),
    (7.50, -0.05, 1.45, 0.62, 0.60, 1.35, 3.2, 3.0),
    (8.70, -0.05, 1.30, 0.62, 0.62, 1.25, 3.0, 3.0),
]
# Side intakes: tall boxes, the upper ramp lip forward. z, cx, cy, hw, hh, et, eb, slant.
INTAKE = [
    (-4.90, 1.42, -0.12, 0.55, 0.68, 9.0, 7.0, -0.42),
    (-3.80, 1.42, -0.10, 0.56, 0.66, 7.0, 6.0),
    (-1.80, 1.36, -0.08, 0.56, 0.62, 5.0, 4.0),
    (0.80, 1.28, -0.08, 0.50, 0.55, 4.0, 4.0),
]
CANOPY = [  # z, base y, half width, height
    (-6.15, 0.42, 0.08, 0.10),
    (-5.70, 0.38, 0.40, 0.45),
    (-5.00, 0.34, 0.55, 0.90),
    (-4.20, 0.34, 0.58, 1.08),
    (-3.40, 0.38, 0.55, 1.00),
    (-2.70, 0.46, 0.45, 0.68),
    (-2.10, 0.54, 0.30, 0.35),
    (-1.55, 0.60, 0.10, 0.20),
]
SPINE = [(-2.60, 0.50, 0.30, 0.28), (-1.00, 0.50, 0.55, 0.36), (1.50, 0.50, 0.62, 0.34), (4.00, 0.50, 0.52, 0.26), (6.20, 0.50, 0.30, 0.16)]
WING_Y = 0.20
FIN_X, FIN_Y = 1.62, 0.30


def wing_surface():
    return wing(1.60, 6.52, (-1.80, 3.12), (4.70, 4.25), (0.32, 0.08), WING_Y, J.wing_uv, hinge=(0.84, 0.72))


def fin_surface(mirror=False):
    return fin(0.0, 3.15, (5.20, 7.75), (9.00, 8.85), (0.20, 0.07), J.fin_uv, x0=FIN_X, y0=FIN_Y, hinge=(0.82, 0.55), mirror=mirror)


def stab_surface():
    return wing(1.85, 4.40, (6.60, 8.70), (9.62, 9.50), (0.16, 0.05), -0.12, J.stab_uv)


def build():
    root = Part(NAME)
    air = Part("airframe")
    half = Part("half")

    fuselage(air, FUSE, J.FUSE, nu=6, nl=6, role=lambda i: "secondary" if i < 3 else "body")
    duct(half, INTAKE, J.duct_uv, seg=16, lip=0.06, depth=1.4)
    tube(air, (0, 0.05, -9.72), (0, 0.05, -9.28), [0.02, 0.03], 4, "metal", lambda a, l: missile_uv(0.5, 0.5))
    bubble(air, SPINE, lambda c, z: J.fuse(z, 0.02 + 0.2 * c), seg=6, role="body")

    # Wing: flaps inboard, ailerons outboard.
    w = wing_surface()
    cuts = [("flap_r", 2.10, 3.90, {"role": "flap"}), ("aileron_r", 3.90, 5.70, {"role": "aileron"})]
    surfaces = w.build(half, [3.0, 4.8], cuts)
    w.decal(half, 4.55, 0.42, 0.42, 1, insignia)
    w.decal(half, 4.55, 0.42, 0.42, -1, insignia)
    # Wing pylon with a pair of AIM-9 rails.
    plate(half, [(3.60, WING_Y - 0.10, 0.90), (3.60, WING_Y - 0.10, 3.20), (3.60, -0.30, 3.00), (3.60, -0.30, 0.70)], "secondary", J.wing_uv, thick=0.10)
    for dx in (-0.16, 0.16):
        plate(half, [(3.60 + dx, -0.30, 0.6), (3.60 + dx, -0.30, 2.6), (3.60 + dx, -0.36, 2.6), (3.60 + dx, -0.36, 0.6)], "secondary", plain, thick=0.05)

    # Tail booms beside the engines carry the fins and stabilators.
    rings = []
    for z, k in ((3.6, 0.1), (4.6, 1.0), (8.9, 1.0), (9.75, 0.8)):
        rings.append([(1.75 + 0.24 * k * math.cos(t), -0.02 + 0.20 * k * math.sin(t), z) for t in [i / 6 * 2 * math.pi for i in range(6)]])
    loft(half, rings, [[J.fuse(p[2], 0.5) for p in r] for r in rings], "body", closed=True, cap_end="secondary")

    # Twin fins with rudders and tip bands.
    f = fin_surface()
    rudder = f.build(half, [2.75], [("rudder_r", 0.30, 1.95, {"role": "rudder"})],
                     role=lambda s: "stripe" if s > 2.75 else "body")[0]
    f.decal(half, 2.30, 0.40, 0.30, 1, insignia)
    f.decal(half, 2.30, 0.40, 0.30, -1, insignia)

    st = stabilator(stab_surface(), (1.85, -0.12, 7.9), (1.0, 0.0, 0.0), stations=[3.2])

    half_l = half.mirrored("half_l")
    air.add(half).add(half_l)
    # Twin nozzles (built per side: the petals are not mirror images).
    nozzles(air, (-0.64, 0.64), 8.40, 9.65, 0.64, 0.56, -0.05)
    # Tail numbers on both fins' outer faces.
    fin_surface().patch(air, 1.10, 1.70, 6.70, 7.55, 1, A.NUMBER)
    fin_surface(mirror=True).patch(air, 1.10, 1.70, 6.70, 7.55, 1, A.NUMBER, flip=True)

    # Stores: AIM-9 pairs on the wing pylons, AIM-120s on the fuselage corners.
    s9 = [store((3.60 + dx, -0.46, 0.25), **AIM9) for dx in (0.24, -0.24)]
    s120 = store((1.02, -0.86, -1.70), **AIM120)
    stores = firing_order([s9[0].mirrored(), s9[0], s9[1].mirrored(), s9[1], s120.mirrored(), s120])

    cano = Part("canopy", (0.0, 0.70, -1.5), {"role": "canopy"})
    bubble(cano, CANOPY, glass_uv, seg=8, frame_at=-5.55)

    root.children = [air, cano]
    for p in surfaces:
        root.children += [p, p.mirrored()]
    root.children += [st, st.mirrored(), rudder, mirrored_rudder(rudder)]
    root.children.append(gear(
        dict(z=-6.0, top=-0.60, r=0.30, fold=-1),
        dict(x=1.22, z=1.40, top=-0.55, r=0.42, xw=1.36, fold=1, brace=(0.95, -0.62, 0.55)),
        nose_door=dict(x=0.22, y=-0.64, z0=-6.7, z1=-5.2, depth=0.40),
        main_door=dict(x=1.90, y=-0.62, z0=0.6, z1=2.3, depth=0.55)))
    root.children += stores
    engines(root, [(-0.64, -0.05, 9.65, 0.50), (0.64, -0.05, 9.65, 0.50)])
    return root


def texture():
    cv = A.Canvas()
    paint_fuselage(cv, J,
                   frames=[(-6.95, 0, 1), (-5.9, 0, 0.5), (-4.9, 0.5, 1), (-3.0, 0, 1), (-1.0, 0, 0.5), (1.0, 0, 1),
                           (3.0, 0, 0.5), (5.0, 0, 1), (7.0, 0, 1)],
                   longerons=[(0.5, -6.8, 8.6), (0.22, -2.5, 7.0), (0.8, -4.0, 8.0)],
                   panels=[(-0.5, 2.5, 0.04, 0.16), (-4.4, -3.4, 0.3, 0.44), (2.0, 3.4, 0.30, 0.44), (4.0, 5.2, 0.58, 0.72),
                           (0.0, 1.2, 0.84, 0.96)],
                   soot_from=7.4)
    w = wing_surface()
    paint_surface(cv, J.WING, w, chords=[(0.14, 1.9, 6.4), (0.42, 1.9, 6.2)], spans=[2.1, 3.0, 3.9, 4.8, 5.7], hinge_spans=(2.1, 5.7))
    paint_surface(cv, J.FIN, fin_surface(), chords=[(0.45, 0.2, 2.7)], spans=[0.3, 1.2, 1.95], hinge_spans=(0.3, 1.95), height=lambda s: s + FIN_Y)
    paint_surface(cv, J.STAB, stab_surface(), chords=[(0.4, 2.0, 4.2)], spans=[2.6, 3.4])
    paint_common(cv, ("AF78", "0521"))
    return cv
