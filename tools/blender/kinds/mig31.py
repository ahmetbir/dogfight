"""MiG-31: very long nose, tandem cockpit (a bubble in front, a framed
hood behind), huge rectangular side intakes with the top ramp lip forward
that become the slab-sided boxy fuselage, a shoulder wing with a small
LERX and anhedral, twin fins canted out with ventral fins below, big
all-moving stabilators, two large nozzles side by side, four R-33s
semi-recessed under the belly. True metres (22.7 m long, 13.5 m span), nose
toward -z.
"""
import math

import atlas as A
from mesh import Part
from parts import Surface, bubble, duct, firing_order, fuselage, plate, store, strake, tube
from kinds._jet import (R33, R40, Jet, engines, fin, gear, glass_uv, insignia, mirrored_rudder, missile_uv, nozzles,
                        paint_common, paint_fuselage, paint_surface, stabilator, wing)

NAME = "mig31"

J = Jet(length=(-11.40, 11.00), wing=(-3.6, 5.6, 1.4, 6.8), fin=(4.4, 9.8, 3.90, 0.50), stab=(6.2, 10.2, 1.4, 5.0))

FUSE = [  # z, cy, w, ht, hb, wb, eu, el
    (-11.40, -0.20, 0.02, 0.02, 0.02, 0.02, 2.0, 2.0),
    (-10.60, -0.17, 0.36, 0.34, 0.34, 0.36, 2.0, 2.0),
    (-9.40, -0.10, 0.62, 0.58, 0.58, 0.62, 2.0, 2.0),
    (-8.10, -0.05, 0.78, 0.70, 0.70, 0.76, 2.1, 2.2),
    (-6.80, 0.00, 0.84, 0.74, 0.74, 0.80, 2.3, 2.5),
    (-5.20, 0.00, 0.86, 0.74, 0.78, 0.82, 2.6, 2.8),
    (-3.60, 0.00, 0.86, 0.72, 0.84, 0.86, 2.8, 3.0),
    (-1.00, 0.00, 1.75, 0.66, 0.92, 1.70, 5.0, 5.0),
    (3.00, 0.00, 1.80, 0.62, 0.88, 1.75, 5.0, 5.0),
    (6.50, 0.00, 1.70, 0.58, 0.80, 1.65, 4.5, 4.5),
    (8.80, 0.00, 1.50, 0.52, 0.72, 1.45, 4.0, 4.0),
    (9.80, 0.00, 1.40, 0.48, 0.68, 1.35, 3.5, 3.5),
    (10.60, 0.05, 0.36, 0.30, 0.30, 0.36, 2.0, 2.0),
    (11.00, 0.05, 0.10, 0.08, 0.08, 0.10, 2.0, 2.0),
]
# Rectangular intakes, the top ramp lip forward, flowing into the slab sides.
INTAKE = [
    (-4.80, 1.30, -0.12, 0.47, 0.78, 12.0, 12.0, -0.70),
    (-3.80, 1.30, -0.12, 0.47, 0.78, 10.0, 10.0),
    (-1.50, 1.25, -0.12, 0.48, 0.76, 6.0, 6.0),
    (1.00, 1.15, -0.10, 0.45, 0.70, 4.0, 4.0),
]
CANOPY = [  # front bubble
    (-7.70, 0.58, 0.06, 0.08), (-7.30, 0.56, 0.34, 0.36), (-6.80, 0.54, 0.46, 0.58), (-6.20, 0.56, 0.48, 0.64),
    (-5.60, 0.60, 0.44, 0.56), (-5.20, 0.64, 0.36, 0.42),
]
HOOD = [  # rear cockpit hood, lower, mostly framed
    (-5.25, 0.64, 0.38, 0.42), (-4.60, 0.66, 0.42, 0.48), (-3.90, 0.66, 0.42, 0.44), (-3.30, 0.66, 0.36, 0.30),
    (-2.80, 0.66, 0.20, 0.14),
]
SPINE = [(-3.20, 0.58, 0.40, 0.34), (-1.00, 0.60, 0.55, 0.20), (3.00, 0.58, 0.55, 0.16), (7.00, 0.52, 0.40, 0.10),
         (9.60, 0.48, 0.25, 0.04)]
LERX_OUT = [(1.78, -3.40), (1.86, -2.40), (2.02, -1.40), (2.20, -0.75)]
WING_Y = 0.60
FIN_X, FIN_Y, FIN_CANT = 1.25, 0.55, math.radians(8)


def wing_surface():
    le = lambda s: -0.75 + (s - 2.20) * 0.87  # 41 degrees
    return wing(1.60, 6.73, (le(1.60), le(6.73)), (5.40, 5.30), (0.32, 0.08), WING_Y, J.wing_uv, hinge=(0.80, 0.72),
                dihedral=-math.radians(5))


def fin_surface(mirror=False):
    return fin(0.0, 3.35, (4.60, 7.70), (8.80, 9.50), (0.20, 0.07), J.fin_uv, x0=FIN_X, y0=FIN_Y, cant=FIN_CANT,
               hinge=(0.80, 0.62), mirror=mirror)


def stab_surface():
    return wing(1.45, 4.95, (6.40, 8.90), (9.90, 10.10), (0.18, 0.05), 0.0, J.stab_uv)


def build():
    root = Part(NAME)
    air = Part("airframe")
    half = Part("half")

    fuselage(air, FUSE, J.FUSE, nu=6, nl=6, role=lambda i: "secondary" if i < 3 else "body")
    tube(air, (0, -0.20, -11.80), (0, -0.20, -11.35), [0.015, 0.03], 4, "metal", lambda a, l: missile_uv(0.5, 0.5))
    bubble(air, SPINE, lambda c, z: J.fuse(z, 0.02 + 0.2 * c), seg=6, role="body")
    duct(half, INTAKE, J.duct_uv, seg=16, lip=0.06, depth=1.2, wall="dark")
    strake(half, [(1.55, z) for _, z in LERX_OUT], LERX_OUT, WING_Y, 0.10, 0.10, J.wing_uv)

    w = wing_surface()
    cuts = [("flap_r", 2.00, 4.40, {"role": "flap"}), ("aileron_r", 4.40, 6.30, {"role": "aileron"})]
    surfaces = w.build(half, [2.2, 3.4, 5.4], cuts)
    w.decal(half, 5.20, 0.42, 0.40, 1, insignia)
    w.decal(half, 5.20, 0.42, 0.40, -1, insignia)
    yw = WING_Y - (3.40 - 1.60) * math.tan(math.radians(5))
    plate(half, [(3.40, yw - 0.10, -0.6), (3.40, yw - 0.10, 2.2), (3.40, yw - 0.40, 2.0), (3.40, yw - 0.40, -0.4)],
          "secondary", J.wing_uv, thick=0.10)

    f = fin_surface()
    rudder = f.build(half, [2.95], [("rudder_r", 0.40, 2.75, {"role": "rudder"})],
                     role=lambda s: "stripe" if s > 2.95 else "body")[0]
    f.decal(half, 2.05, 0.40, 0.36, 1, insignia)
    f.decal(half, 2.05, 0.40, 0.36, -1, insignia)
    c, sn = math.cos(math.radians(12)), math.sin(math.radians(12))
    Surface(0.0, 1.00, (6.40, 7.30), (8.80, 8.70), (0.07, 0.03),
            lambda s, n, z: (1.30 + s * sn + n * c, -0.85 - s * c + n * sn, z), lambda p: J.fin_uv((p[0], FIN_Y + 0.1, p[2]))).build(half, [], root_cap=False)

    st = stabilator(stab_surface(), (1.45, 0.0, 8.6), (1.0, 0.0, 0.0), stations=[3.2])

    air.add(half).add(half.mirrored("half_l"))
    nozzles(air, (-0.74, 0.74), 9.00, 10.90, 0.68, 0.62, -0.10)
    fin_surface().patch(air, 1.00, 1.60, 6.60, 7.70, 1, A.NUMBER)
    fin_surface(mirror=True).patch(air, 1.00, 1.60, 6.60, 7.70, 1, A.NUMBER, flip=True)
    for z0 in (-4.0, 0.2):  # R-33 recesses
        plate(air, [(-0.85, -0.925, z0), (0.85, -0.925, z0), (0.85, -0.925, z0 + 4.4), (-0.85, -0.925, z0 + 4.4)], "dark")

    front = store((0.56, -1.05, -3.80), **R33)
    rear = store((0.56, -1.05, 0.40), **R33)
    r40 = store((3.40, yw - 0.58, -1.60), **R40)
    stores = firing_order([r40.mirrored(), r40, front.mirrored(), front, rear.mirrored(), rear])

    cano = Part("canopy", (0.0, 0.80, -2.8), {"role": "canopy"})
    bubble(cano, CANOPY, glass_uv, seg=8, frame_at=-7.25)
    bubble(cano, HOOD, glass_uv, seg=8, frame_at=[-5.15, -4.20, -3.40])

    root.children = [air, cano]
    for p in surfaces:
        root.children += [p, p.mirrored()]
    root.children += [st, st.mirrored(), rudder, mirrored_rudder(rudder)]
    root.children.append(gear(
        dict(z=-7.40, top=-0.72, r=0.30, twin=True, fold=-1),
        dict(x=1.55, z=1.00, top=-0.85, r=0.46, xw=1.68, fold=1, w=0.34, brace=(1.25, -0.92, 0.30)),
        nose_door=dict(x=0.26, y=-0.74, z0=-8.1, z1=-6.6, depth=0.40),
        main_door=dict(x=1.95, y=-0.80, z0=0.2, z1=1.9, depth=0.50)))
    root.children += stores
    engines(root, [(-0.74, -0.10, 10.90, 0.58), (0.74, -0.10, 10.90, 0.58)])
    return root


def texture():
    cv = A.Canvas()
    paint_fuselage(cv, J,
                   frames=[(-9.4, 0, 1), (-8.0, 0, 0.5), (-2.8, 0, 1), (0.2, 0, 0.5), (2.8, 0, 1), (5.4, 0, 1), (8.2, 0, 1)],
                   longerons=[(0.5, -9.0, 10.0), (0.30, -2.6, 8.8), (0.78, -4.6, 9.4)],
                   panels=[(-2.2, -0.8, 0.04, 0.16), (0.8, 2.2, 0.04, 0.16), (3.2, 4.8, 0.30, 0.42), (-7.0, -5.6, 0.60, 0.72),
                           (5.6, 7.0, 0.60, 0.72)],
                   soot_from=9.4)
    w = wing_surface()
    paint_surface(cv, J.WING, w, chords=[(0.12, 2.2, 6.6), (0.45, 2.2, 6.4)], spans=[2.0, 3.4, 4.4, 5.4, 6.3], hinge_spans=(2.0, 6.3))
    paint_surface(cv, J.FIN, fin_surface(), chords=[(0.42, 0.2, 3.1)], spans=[0.4, 1.6, 2.75], hinge_spans=(0.4, 2.75),
                  height=lambda s: FIN_Y + s * math.cos(FIN_CANT))
    paint_surface(cv, J.STAB, stab_surface(), chords=[(0.4, 1.6, 4.8)], spans=[3.2])
    paint_common(cv, ("", "74"))
    return cv
