"""F-14: long nose with a chin pod, tandem two-seat canopy, tall raked
rectangular intakes standing off the fuselage, the flat "pancake" deck
between widely spaced nacelles, sharply swept fixed gloves, swing wings
(modelled at mid sweep, 44 degrees; wing_l/wing_r pivots), big stabilators,
twin fins on the nacelles with ventral fins, the beaver tail between the
nozzles, Phoenixes in the tunnel. True metres (19.1 m long, 18.3 m span at
mid sweep), nose toward -z.
"""
import math

import atlas as A
from mesh import Part
from parts import bubble, duct, firing_order, fuselage, loft, plate, store, strake, tube
from kinds._jet import (AIM54, AIM7, AIM9, Jet, engines, fin, gear, glass_uv, insignia, mirrored_rudder, missile_uv,
                        nozzles, paint_common, paint_fuselage, paint_surface, plain, stabilator, swing, wing)

NAME = "f14"

J = Jet(length=(-9.55, 9.70), wing=(-6.0, 7.0, 0.5, 9.3), fin=(4.0, 8.6, 3.30, 0.30), stab=(5.2, 9.9, 1.9, 5.1))

FUSE = [  # z, cy, w, ht, hb, wb, eu, el
    (-9.55, -0.05, 0.02, 0.02, 0.02, 0.02, 2.0, 2.0),
    (-9.00, -0.04, 0.24, 0.24, 0.23, 0.23, 2.0, 2.0),
    (-8.10, -0.02, 0.44, 0.44, 0.42, 0.42, 2.0, 2.0),
    (-7.00, 0.00, 0.58, 0.56, 0.54, 0.54, 2.1, 2.2),
    (-5.80, 0.00, 0.66, 0.62, 0.60, 0.60, 2.3, 2.4),
    (-4.40, 0.00, 0.78, 0.64, 0.62, 0.62, 2.6, 2.6),
    (-2.60, 0.05, 1.40, 0.56, 0.42, 0.80, 3.4, 2.6),
    (0.00, 0.10, 2.20, 0.42, 0.32, 1.00, 5.0, 2.6),
    (3.00, 0.10, 2.30, 0.40, 0.30, 0.95, 5.0, 2.6),
    (5.50, 0.10, 2.05, 0.36, 0.28, 0.85, 4.5, 2.6),
    (7.60, 0.10, 1.60, 0.30, 0.24, 0.70, 4.0, 2.4),
    (8.60, 0.10, 1.10, 0.20, 0.18, 0.60, 3.0, 2.2),
]
# Tall raked intakes (top lip well forward), standing off the fuselage, into the nacelles.
NACELLE = [
    (-4.30, 1.58, -0.28, 0.46, 0.64, 10.0, 10.0, -0.85, 0.0, 0.0, 1.0, 0.08),
    (-3.30, 1.58, -0.30, 0.48, 0.62, 7.0, 7.0),
    (-0.50, 1.52, -0.32, 0.52, 0.58, 4.0, 3.5),
    (3.50, 1.42, -0.30, 0.56, 0.56, 3.0, 2.6),
    (7.00, 1.38, -0.22, 0.58, 0.55, 2.4, 2.2),
    (7.80, 1.36, -0.20, 0.57, 0.55, 2.0, 2.0),
]
CANOPY = [
    (-7.15, 0.46, 0.06, 0.08), (-6.75, 0.44, 0.36, 0.42), (-6.20, 0.42, 0.48, 0.70), (-5.40, 0.44, 0.52, 0.82),
    (-4.50, 0.48, 0.50, 0.80), (-3.70, 0.52, 0.42, 0.62), (-3.10, 0.54, 0.28, 0.36), (-2.60, 0.54, 0.08, 0.12),
]
SPINE = [(-3.00, 0.50, 0.40, 0.40), (-1.20, 0.48, 0.60, 0.30), (2.00, 0.48, 0.50, 0.12), (4.50, 0.46, 0.30, 0.04)]
GLOVE_OUT = [(1.00, -5.60), (1.35, -4.60), (1.85, -3.40), (2.40, -2.10), (2.95, -0.80), (3.15, 0.20), (3.15, 2.20),
             (2.80, 4.00), (2.45, 5.60)]
WING_Y = 0.26
PIVOT = (2.71, WING_Y, 0.0)
MID_SWEEP = math.radians(44)
SWEEP = [-math.radians(24), math.radians(24)]  # 68 .. 20 degrees
FIN_X, FIN_Y, FIN_CANT = 1.62, 0.40, math.radians(5)


def wing_surface():
    k = math.tan(MID_SWEEP)
    return wing(2.40, 9.15, (-1.10 + (2.40 - 2.71) * k, -1.10 + (9.15 - 2.71) * k), (2.60, 6.60), (0.26, 0.07), WING_Y,
                J.wing_uv, hinge=(0.80, 0.74))


def fin_surface(mirror=False):
    return fin(0.0, 2.85, (4.30, 7.00), (8.10, 8.45), (0.18, 0.07), J.fin_uv, x0=FIN_X, y0=FIN_Y, cant=FIN_CANT,
               hinge=(0.78, 0.60), mirror=mirror)


def stab_surface():
    return wing(2.10, 5.05, (5.40, 8.70), (9.30, 9.75), (0.17, 0.05), 0.02, J.stab_uv)


def build():
    root = Part(NAME)
    air = Part("airframe")
    half = Part("half")

    fuselage(air, FUSE, J.FUSE, nu=6, nl=6, role=lambda i: "secondary" if i < 2 else "body")
    tube(air, (0, -0.05, -9.80), (0, -0.05, -9.50), [0.01, 0.025], 4, "metal", lambda a, l: missile_uv(0.5, 0.5))
    tube(air, (0, -0.62, -7.90), (0, -0.62, -6.90), [0.0, 0.14, 0.16, 0.10], 8, "secondary", at=[0.0, 0.25, 0.7, 1.0])  # chin pod
    bubble(air, SPINE, lambda c, z: J.fuse(z, 0.02 + 0.2 * c), seg=6, role="body")
    duct(half, NACELLE, J.duct_uv, seg=16, lip=0.06, depth=1.0, wall="dark")
    strake(half, [(0.90, z) for _, z in GLOVE_OUT], GLOVE_OUT, WING_Y, 0.30, 0.16, J.wing_uv)

    # Swing wing: the pivot node carries the panel, its flaps and its ailerons.
    wr = swing(PIVOT, SWEEP)
    w = wing_surface()
    cuts = [("flap_r", 3.30, 6.40, {"role": "flap"}), ("aileron_r", 6.40, 8.60, {"role": "aileron"})]
    wr.children = w.build(wr, [4.8, 7.5], cuts)
    w.decal(wr, 7.40, 0.40, 0.36, 1, insignia)
    w.decal(wr, 7.40, 0.40, 0.36, -1, insignia)

    # Glove pylon: an AIM-7 below, an AIM-9 on the shoulder rail.
    plate(half, [(2.20, WING_Y - 0.14, -2.30), (2.20, WING_Y - 0.14, 0.60), (2.20, -0.62, 0.30), (2.20, -0.62, -1.90)],
          "secondary", J.wing_uv, thick=0.12)
    plate(half, [(2.26, -0.40, -2.0), (2.48, -0.40, -2.0), (2.48, -0.40, -0.4), (2.26, -0.40, -0.4)], "secondary", plain, thick=0.05)

    f = fin_surface()
    rudder = f.build(half, [2.45], [("rudder_r", 0.35, 2.25, {"role": "rudder"})],
                     role=lambda s: "stripe" if s > 2.45 else "body")[0]
    f.decal(half, 1.75, 0.42, 0.30, 1, insignia)
    f.decal(half, 1.75, 0.42, 0.30, -1, insignia)
    from parts import Surface
    c, sn = math.cos(math.radians(15)), math.sin(math.radians(15))
    Surface(0.0, 0.80, (5.80, 6.50), (7.40, 7.30), (0.06, 0.03),
            lambda s, n, z: (1.70 + s * sn + n * c, -0.62 - s * c + n * sn, z), lambda p: J.fin_uv((p[0], FIN_Y + 0.1, p[2]))).build(half, [], root_cap=False)

    st = stabilator(stab_surface(), (2.10, 0.02, 7.6), (1.0, 0.0, 0.0), stations=[3.4])

    air.add(half).add(half.mirrored("half_l"))
    nozzles(air, (-1.36, 1.36), 7.60, 8.95, 0.57, 0.50, -0.20)
    plate(air, [(-0.55, 0.12, 8.0), (0.55, 0.12, 8.0), (0.45, 0.12, 9.70), (-0.45, 0.12, 9.70)], "body", plain, thick=0.12)  # beaver tail
    fin_surface().patch(air, 0.80, 1.40, 6.00, 7.10, 1, A.NUMBER)
    fin_surface(mirror=True).patch(air, 0.80, 1.40, 6.00, 7.10, 1, A.NUMBER, flip=True)

    a54 = store((0.48, -0.62, -1.40), **AIM54)
    a7 = store((2.20, -0.86, -2.30), **AIM7)
    a9 = store((2.37, -0.52, -2.50), **AIM9)
    stores = firing_order([a9.mirrored(), a9, a7.mirrored(), a7, a54.mirrored(), a54])

    cano = Part("canopy", (0.0, 0.66, -2.6), {"role": "canopy"})
    bubble(cano, CANOPY, glass_uv, seg=8, frame_at=[-6.60, -4.70])

    root.children = [air, cano, wr, wr.mirrored()]
    root.children += [st, st.mirrored(), rudder, mirrored_rudder(rudder)]
    root.children.append(gear(
        dict(z=-5.70, top=-0.60, r=0.28, twin=True, fold=-1),
        dict(x=2.35, z=1.30, top=-0.20, r=0.46, xw=2.48, fold=1, brace=(2.05, -0.30, 0.60)),
        nose_door=dict(x=0.24, y=-0.62, z0=-6.4, z1=-5.0, depth=0.38),
        main_door=dict(x=2.85, y=-0.05, z0=0.5, z1=2.2, depth=0.60)))
    root.children += stores
    engines(root, [(-1.36, -0.20, 8.95, 0.48), (1.36, -0.20, 8.95, 0.48)])
    return root


def texture():
    cv = A.Canvas()
    paint_fuselage(cv, J,
                   frames=[(-8.1, 0, 1), (-7.0, 0, 0.5), (-2.6, 0, 1), (0.0, 0, 0.5), (2.5, 0, 1), (5.0, 0, 1), (7.4, 0, 1)],
                   longerons=[(0.5, -7.8, 8.5), (0.30, -2.4, 7.4), (0.78, -4.0, 8.0)],
                   panels=[(-1.8, -0.4, 0.04, 0.16), (0.6, 2.0, 0.04, 0.16), (3.0, 4.6, 0.30, 0.42), (-5.6, -4.6, 0.60, 0.72)],
                   soot_from=7.8)
    w = wing_surface()
    paint_surface(cv, J.WING, w, chords=[(0.12, 3.0, 9.0), (0.45, 3.0, 8.8)], spans=[3.3, 4.8, 6.4, 7.5, 8.6], hinge_spans=(3.3, 8.6))
    paint_surface(cv, J.FIN, fin_surface(), chords=[(0.42, 0.2, 2.6)], spans=[0.35, 1.3, 2.25], hinge_spans=(0.35, 2.25),
                  height=lambda s: FIN_Y + s * math.cos(FIN_CANT))
    paint_surface(cv, J.STAB, stab_surface(), chords=[(0.4, 2.2, 4.9)], spans=[3.4])
    paint_common(cv, ("", "100"))
    return cv
