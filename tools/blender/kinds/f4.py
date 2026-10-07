"""F-4E Phantom II: long drooping nose with the gun fairing under it, long
framed tandem canopy, rectangular intakes standing off the fuselage behind
big splitter plates, a low 45-degree wing (flat inner panels, outer panels
with 12 degrees of dihedral and the dogtooth), stabilators with 23 degrees
of anhedral high on the upswept tail, one big fin, two nozzles under the
tail, four AIM-7s semi-recessed under the belly. True metres (19.2 m long,
11.7 m span), nose toward -z.
"""
import math

import atlas as A
from mesh import Part
from parts import bubble, duct, firing_order, fuselage, plate, store, tube
from kinds._jet import (AIM7, AIM9, Jet, engines, fin, gear, glass_uv, insignia, missile_uv, nozzles, paint_common,
                        paint_fuselage, paint_surface, plain, stabilator, wing)

NAME = "f4"

J = Jet(length=(-9.60, 9.60), wing=(-1.6, 4.7, 0.4, 6.0), fin=(4.4, 8.8, 3.05, 0.40), stab=(6.9, 9.8, 0.3, 2.9))

FUSE = [  # z, cy, w, ht, hb, wb, eu, el
    (-9.60, -0.20, 0.02, 0.02, 0.02, 0.02, 2.0, 2.0),
    (-9.00, -0.18, 0.22, 0.22, 0.22, 0.22, 2.0, 2.0),
    (-7.90, -0.12, 0.40, 0.42, 0.40, 0.40, 2.0, 2.0),
    (-6.70, -0.06, 0.52, 0.54, 0.52, 0.52, 2.2, 2.2),
    (-5.30, 0.00, 0.60, 0.62, 0.62, 0.60, 2.4, 2.4),
    (-3.60, 0.00, 0.62, 0.66, 0.66, 0.62, 2.6, 2.6),
    (-1.50, 0.00, 0.82, 0.62, 0.66, 0.82, 3.0, 2.8),
    (1.50, 0.00, 1.10, 0.58, 0.64, 1.05, 3.2, 3.0),
    (4.00, 0.00, 1.05, 0.54, 0.62, 1.00, 3.0, 3.0),
    (6.20, 0.05, 0.80, 0.50, 0.55, 0.80, 2.8, 2.6),
    (7.40, 0.15, 0.55, 0.42, 0.40, 0.55, 2.4, 2.2),
    (8.60, 0.30, 0.32, 0.30, 0.18, 0.30, 2.2, 2.0),
    (9.60, 0.40, 0.08, 0.08, 0.06, 0.08, 2.0, 2.0),
]
# Tall rectangular intakes, the top a little forward, standing off the fuselage.
INTAKE = [
    (-3.50, 1.02, -0.15, 0.34, 0.60, 10.0, 10.0, -0.30),
    (-2.60, 1.02, -0.15, 0.36, 0.60, 7.0, 7.0),
    (-0.50, 0.96, -0.15, 0.38, 0.58, 4.0, 4.0),
    (2.00, 0.88, -0.15, 0.38, 0.52, 3.0, 3.0),
]
CANOPY = [
    (-6.10, 0.48, 0.05, 0.06), (-5.75, 0.46, 0.34, 0.36), (-5.20, 0.46, 0.44, 0.56), (-4.40, 0.48, 0.46, 0.64),
    (-3.50, 0.52, 0.46, 0.66), (-2.60, 0.56, 0.44, 0.62), (-1.80, 0.58, 0.38, 0.50), (-1.20, 0.60, 0.24, 0.28),
    (-0.80, 0.60, 0.06, 0.08),
]
SPINE = [(-1.30, 0.58, 0.36, 0.34), (1.00, 0.56, 0.40, 0.20), (3.50, 0.52, 0.30, 0.10), (5.50, 0.50, 0.16, 0.04)]
WING_Y = -0.30
FOLD = 3.65
DIHEDRAL = math.radians(12)


def inner_wing():
    le = lambda s: -1.30 + (s - 1.20) * 1.0  # 45 degrees
    return wing(1.00, FOLD, (le(1.00), le(FOLD)), (3.45, 3.95), (0.34, 0.20), WING_Y, J.wing_uv, hinge=(0.80, 0.74))


def outer_wing():
    return wing(FOLD, 5.85, (1.00, 3.20), (3.95, 4.50), (0.20, 0.08), WING_Y, J.wing_uv, dihedral=DIHEDRAL)


def fin_surface():
    return fin(0.0, 2.50, (4.70, 7.40), (8.30, 8.55), (0.20, 0.07), J.fin_uv, x0=0.0, y0=0.48, hinge=(0.80, 0.64))


def stab_surface():
    return wing(0.45, 2.75, (7.10, 8.90), (9.15, 9.55), (0.16, 0.05), 0.35, J.stab_uv, dihedral=-math.radians(23))


def build():
    root = Part(NAME)
    air = Part("airframe")
    half = Part("half")

    fuselage(air, FUSE, J.FUSE, nu=6, nl=6, role=lambda i: "secondary" if i < 2 else "body")
    tube(air, (0, -0.20, -9.85), (0, -0.20, -9.55), [0.01, 0.025], 4, "metal", lambda a, l: missile_uv(0.5, 0.5))
    tube(air, (0, -0.48, -9.05), (0, -0.48, -6.40), [0.06, 0.14, 0.18, 0.16], 8, "secondary", at=[0.0, 0.2, 0.7, 1.0],
         cap0="dark")  # M61 fairing
    bubble(air, SPINE, lambda c, z: J.fuse(z, 0.02 + 0.2 * c), seg=6, role="body")
    duct(half, INTAKE, J.duct_uv, seg=16, lip=0.05, depth=1.0, wall="dark")
    # Splitter plate ahead of the intake, standing off the fuselage.
    plate(half, [(0.66, 0.42, -3.70), (0.66, 0.46, -2.80), (0.66, -0.74, -2.80), (0.66, -0.74, -3.70),
                 (0.66, -0.30, -4.30), (0.66, 0.10, -4.25)], "secondary", J.wing_uv, thick=0.04)

    iw = inner_wing()
    cuts = [("flap_r", 1.35, 2.35, {"role": "flap"}), ("aileron_r", 2.35, FOLD - 0.05, {"role": "aileron"})]
    surfaces = iw.build(half, [2.35], cuts, tip_cap=True)
    iw.decal(half, 2.60, 0.45, 0.42, 1, insignia)
    iw.decal(half, 2.60, 0.45, 0.42, -1, insignia)
    outer_wing().build(half, [4.8], root_cap=True)
    # Inner pylon with AIM-9 rails on both sides.
    plate(half, [(2.20, WING_Y - 0.10, 0.00), (2.20, WING_Y - 0.10, 2.40), (2.20, WING_Y - 0.48, 2.20), (2.20, WING_Y - 0.48, 0.20)],
          "secondary", J.wing_uv, thick=0.12)

    st = stabilator(stab_surface(), (0.45, 0.35, 8.3), (1.0, 0.0, 0.0), stations=[1.6])
    st.props["axis"] = [round(math.cos(math.radians(23)), 4), round(-math.sin(math.radians(23)), 4), 0.0]

    air.add(half).add(half.mirrored("half_l"))
    f = fin_surface()
    rudder = f.build(air, [2.20], [("rudder", 0.30, 2.05, {"role": "rudder"})],
                     role=lambda s: "stripe" if s > 2.20 else "body")[0]
    for side in (1, -1):
        f.patch(air, 0.80, 1.30, 6.20, 7.30, side, A.NUMBER)
    nozzles(air, (-0.55, 0.55), 6.20, 7.50, 0.46, 0.42, -0.25, seg=14)

    a9 = store((2.40, WING_Y - 0.62, -0.40), **AIM9)
    front = store((0.64, -0.70, -1.80), **AIM7)
    rear = store((0.58, -0.68, 2.30), **AIM7)
    stores = firing_order([a9.mirrored(), a9, front.mirrored(), front, rear.mirrored(), rear])

    cano = Part("canopy", (0.0, 0.70, -0.8), {"role": "canopy"})
    bubble(cano, CANOPY, glass_uv, seg=8, frame_at=[-5.65, -4.50, -3.10, -1.90])

    root.children = [air, cano]
    for p in surfaces:
        root.children += [p, p.mirrored()]
    root.children += [st, st.mirrored(), rudder]
    root.children.append(gear(
        dict(z=-5.40, top=-0.62, r=0.26, twin=True, fold=-1),
        dict(x=2.70, z=1.50, top=-0.40, r=0.40, xw=2.62, fold=1, brace=(2.40, -0.45, 0.90)),
        nose_door=dict(x=0.22, y=-0.62, z0=-6.0, z1=-4.7, depth=0.36),
        main_door=dict(x=3.10, y=WING_Y - 0.10, z0=0.8, z1=2.3, depth=0.50)))
    root.children += stores
    engines(root, [(-0.55, -0.25, 7.50, 0.40), (0.55, -0.25, 7.50, 0.40)])
    return root


def texture():
    cv = A.Canvas()
    paint_fuselage(cv, J,
                   frames=[(-7.9, 0, 1), (-6.6, 0, 0.5), (-0.8, 0, 1), (1.4, 0, 0.5), (3.6, 0, 1), (5.6, 0, 1), (7.4, 0, 1)],
                   longerons=[(0.5, -7.6, 9.0), (0.30, -0.8, 7.0), (0.78, -3.6, 7.6)],
                   panels=[(0.0, 1.2, 0.04, 0.16), (2.0, 3.2, 0.04, 0.16), (3.6, 4.8, 0.30, 0.42), (-5.4, -4.4, 0.60, 0.72)],
                   soot_from=6.4)
    paint_surface(cv, J.WING, inner_wing(), chords=[(0.15, 1.3, 3.6), (0.45, 1.3, 3.6)], spans=[1.35, 2.35, 3.6],
                  hinge_spans=(1.35, 3.6))
    paint_surface(cv, J.WING, outer_wing(), chords=[(0.15, 3.7, 5.8), (0.45, 3.7, 5.7)], spans=[4.8])
    paint_surface(cv, J.FIN, fin_surface(), chords=[(0.40, 0.2, 2.3)], spans=[0.3, 1.2, 2.05], hinge_spans=(0.3, 2.05),
                  height=lambda s: 0.48 + s)
    paint_surface(cv, J.STAB, stab_surface(), chords=[(0.4, 0.6, 2.6)], spans=[1.6])
    paint_common(cv, ("AF", "0315"))
    return cv
