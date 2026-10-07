"""F/A-18C Hornet: rounded nose, high bubble canopy, big slender LERX
running forward to the windscreen, D-shaped intakes under the LERX, a
trapezoid wing (26 degrees) with tip rails, twin fins canted 20 degrees
standing forward over the wing trailing edge, all-moving stabilators, two
nozzles. True metres (17.1 m long, 11.4 m span without the tip missiles),
nose toward -z.
"""
import math

import atlas as A
from mesh import Part
from parts import block, bubble, duct, firing_order, fuselage, plate, store, strake, tube
from kinds._jet import (AIM120, AIM9, Jet, engines, fin, gear, glass_uv, insignia, mirrored_rudder, missile_uv,
                        nozzles, paint_common, paint_fuselage, paint_surface, plain, stabilator, wing)

NAME = "f18"

J = Jet(length=(-8.60, 8.50), wing=(-5.8, 3.6, 0.4, 5.9), fin=(2.2, 6.0, 3.30, 0.40), stab=(5.4, 8.4, 1.3, 3.4))

FUSE = [  # z, cy, w, ht, hb, wb, eu, el
    (-8.60, -0.10, 0.02, 0.02, 0.02, 0.02, 2.0, 2.0),
    (-8.10, -0.09, 0.24, 0.24, 0.23, 0.23, 2.0, 2.0),
    (-7.20, -0.06, 0.42, 0.42, 0.40, 0.40, 2.0, 2.0),
    (-6.20, -0.02, 0.52, 0.54, 0.50, 0.50, 2.1, 2.1),
    (-5.00, 0.00, 0.56, 0.60, 0.56, 0.54, 2.3, 2.3),
    (-3.60, 0.00, 0.58, 0.62, 0.58, 0.56, 2.5, 2.4),
    (-1.80, 0.00, 0.70, 0.62, 0.58, 0.62, 2.8, 2.6),
    (0.50, 0.00, 1.05, 0.58, 0.56, 0.95, 3.2, 3.0),
    (3.00, 0.00, 1.10, 0.54, 0.54, 1.00, 3.2, 3.0),
    (5.50, 0.00, 1.00, 0.48, 0.50, 0.95, 3.0, 2.8),
    (7.40, 0.00, 0.95, 0.40, 0.42, 0.90, 2.8, 2.6),
    (7.70, 0.00, 0.30, 0.25, 0.25, 0.30, 2.2, 2.2),
    (7.90, 0.00, 0.10, 0.08, 0.08, 0.10, 2.0, 2.0),
]
# D-shaped intakes under the LERX: flat-ish top, round bottom, the top lip forward.
INTAKE = [
    (-2.70, 1.00, -0.42, 0.34, 0.42, 3.4, 2.2, -0.25, 0.10),
    (-1.90, 1.00, -0.42, 0.36, 0.44, 3.0, 2.4),
    (0.50, 0.92, -0.38, 0.38, 0.42, 2.8, 2.6),
    (3.50, 0.80, -0.30, 0.38, 0.38, 2.4, 2.4),
]
CANOPY = [
    (-6.40, 0.48, 0.05, 0.06), (-6.05, 0.46, 0.32, 0.36), (-5.50, 0.46, 0.44, 0.64), (-4.80, 0.48, 0.48, 0.76),
    (-4.10, 0.52, 0.44, 0.68), (-3.50, 0.56, 0.34, 0.46), (-3.00, 0.60, 0.20, 0.22), (-2.70, 0.62, 0.05, 0.06),
]
SPINE = [(-3.10, 0.58, 0.32, 0.30), (-1.00, 0.56, 0.48, 0.24), (2.00, 0.52, 0.48, 0.18), (5.00, 0.46, 0.34, 0.10),
         (7.00, 0.40, 0.16, 0.04)]
LERX_OUT = [(0.56, -5.70), (0.76, -4.70), (1.00, -3.70), (1.30, -2.70), (1.62, -1.70), (1.95, -0.95), (2.25, -0.40)]
WING_Y = 0.15
FIN_X, FIN_Y, FIN_CANT = 0.95, 0.45, math.radians(20)


def wing_surface():
    le = lambda s: -0.40 + (s - 2.25) * 0.50  # 26.7 degrees
    return wing(1.10, 5.71, (le(1.10), le(5.71)), (3.40, 3.05), (0.28, 0.08), WING_Y, J.wing_uv, hinge=(0.78, 0.72))


def fin_surface(mirror=False):
    return fin(0.0, 3.00, (2.40, 4.55), (5.20, 5.55), (0.18, 0.07), J.fin_uv, x0=FIN_X, y0=FIN_Y, cant=FIN_CANT,
               hinge=(0.76, 0.62), mirror=mirror)


def stab_surface():
    return wing(1.40, 3.30, (5.60, 7.25), (8.25, 8.05), (0.15, 0.05), -0.05, J.stab_uv)


def build():
    root = Part(NAME)
    air = Part("airframe")
    half = Part("half")

    fuselage(air, FUSE, J.FUSE, nu=6, nl=6, role=lambda i: "secondary" if i < 2 else "body")
    tube(air, (0, -0.10, -8.85), (0, -0.10, -8.55), [0.01, 0.025], 4, "metal", lambda a, l: missile_uv(0.5, 0.5))
    bubble(air, SPINE, lambda c, z: J.fuse(z, 0.02 + 0.2 * c), seg=6, role="body")
    duct(half, INTAKE, J.duct_uv, seg=14, lip=0.05, depth=0.9, wall="dark")
    strake(half, [(0.45, z) for _, z in LERX_OUT], LERX_OUT, WING_Y, 0.22, 0.10, J.wing_uv)

    w = wing_surface()
    cuts = [("flap_r", 1.40, 3.60, {"role": "flap"}), ("aileron_r", 3.60, 5.40, {"role": "aileron"})]
    surfaces = w.build(half, [2.25, 4.4], cuts)
    w.decal(half, 4.40, 0.40, 0.34, 1, insignia)
    w.decal(half, 4.40, 0.40, 0.34, -1, insignia)
    block(half, (5.76, WING_Y, 1.80), (0.10, 0.12, 2.2), "secondary", J.wing_uv)  # tip rail
    plate(half, [(3.90, WING_Y - 0.08, 0.20), (3.90, WING_Y - 0.08, 2.40), (3.90, WING_Y - 0.36, 2.20), (3.90, WING_Y - 0.36, 0.40)],
          "secondary", J.wing_uv, thick=0.10)

    f = fin_surface()
    rudder = f.build(half, [2.65], [("rudder_r", 0.30, 2.35, {"role": "rudder"})],
                     role=lambda s: "stripe" if s > 2.65 else "body")[0]
    f.decal(half, 1.80, 0.42, 0.30, 1, insignia)
    f.decal(half, 1.80, 0.42, 0.30, -1, insignia)

    st = stabilator(stab_surface(), (1.40, -0.05, 7.0), (1.0, 0.0, 0.0), stations=[2.3])

    air.add(half).add(half.mirrored("half_l"))
    nozzles(air, (-0.56, 0.56), 7.30, 8.50, 0.46, 0.41, -0.02, seg=14)
    fin_surface().patch(air, 0.80, 1.35, 3.60, 4.60, 1, A.NUMBER)
    fin_surface(mirror=True).patch(air, 0.80, 1.35, 3.60, 4.60, 1, A.NUMBER, flip=True)

    tip = store((5.78, WING_Y, 0.55), **AIM9)
    wing120 = store((3.90, WING_Y - 0.52, -0.80), **AIM120)
    body120 = store((0.90, -0.92, -1.40), **AIM120)
    stores = firing_order([tip.mirrored(), tip, wing120.mirrored(), wing120, body120.mirrored(), body120])

    cano = Part("canopy", (0.0, 0.70, -2.7), {"role": "canopy"})
    bubble(cano, CANOPY, glass_uv, seg=8, frame_at=-5.95)

    root.children = [air, cano]
    for p in surfaces:
        root.children += [p, p.mirrored()]
    root.children += [st, st.mirrored(), rudder, mirrored_rudder(rudder)]
    root.children.append(gear(
        dict(z=-5.40, top=-0.58, r=0.26, twin=True, fold=-1),
        dict(x=1.55, z=1.10, top=-0.45, r=0.40, xw=1.66, fold=1, brace=(1.25, -0.55, 0.50)),
        nose_door=dict(x=0.22, y=-0.58, z0=-6.0, z1=-4.7, depth=0.34),
        main_door=dict(x=1.95, y=-0.40, z0=0.4, z1=1.9, depth=0.50)))
    root.children += stores
    engines(root, [(-0.56, -0.02, 8.50, 0.40), (0.56, -0.02, 8.50, 0.40)])
    return root


def texture():
    cv = A.Canvas()
    paint_fuselage(cv, J,
                   frames=[(-7.2, 0, 1), (-6.2, 0, 0.5), (-2.8, 0, 1), (-0.4, 0, 0.5), (2.0, 0, 1), (4.4, 0, 1), (6.6, 0, 1)],
                   longerons=[(0.5, -7.0, 7.6), (0.30, -2.6, 6.6), (0.78, -4.6, 7.2)],
                   panels=[(-1.8, -0.6, 0.04, 0.16), (0.6, 1.8, 0.04, 0.16), (2.4, 3.6, 0.30, 0.42), (-5.4, -4.4, 0.60, 0.72)],
                   soot_from=7.0)
    w = wing_surface()
    paint_surface(cv, J.WING, w, chords=[(0.15, 1.4, 5.6), (0.45, 1.4, 5.5)], spans=[1.4, 2.25, 3.6, 4.4, 5.4], hinge_spans=(1.4, 5.4))
    paint_surface(cv, J.FIN, fin_surface(), chords=[(0.40, 0.2, 2.8)], spans=[0.3, 1.3, 2.35], hinge_spans=(0.3, 2.35),
                  height=lambda s: FIN_Y + s * math.cos(FIN_CANT))
    paint_surface(cv, J.STAB, stab_surface(), chords=[(0.4, 1.5, 3.2)], spans=[2.3])
    paint_common(cv, ("", "300"))
    return cv
