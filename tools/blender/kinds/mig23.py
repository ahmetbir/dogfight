"""MiG-23MLD: long pointed nose, small canopy faired into the spine,
rectangular side intakes behind big splitter plates, a shoulder glove,
swing wings (modelled at mid sweep, 45 degrees; wing_l/wing_r pivots), a
tall fin with a long dorsal fillet, a big ventral fin, swept all-moving
stabilators, one big nozzle, R-24s under the gloves and R-60s under the
belly. True metres (16.7 m long, 12.6 m span at mid sweep), nose toward -z.
"""
import math

import atlas as A
from mesh import Part
from parts import Surface, bubble, duct, firing_order, fuselage, plate, store, strake, tube
from kinds._jet import (R24, R60, Jet, engines, fin, gear, glass_uv, insignia, missile_uv, nozzles, paint_common,
                        paint_fuselage, paint_surface, plain, stabilator, swing, wing)

NAME = "mig23"
MISSILES = 4  # provisional (Phase 4 sets sim.Spec.Missiles)

J = Jet(length=(-8.40, 8.30), wing=(-3.0, 5.2, 0.6, 6.4), fin=(2.8, 8.0, 3.20, 0.50), stab=(5.4, 8.4, 0.5, 3.0))

FUSE = [  # z, cy, w, ht, hb, wb, eu, el
    (-8.40, -0.10, 0.02, 0.02, 0.02, 0.02, 2.0, 2.0),
    (-7.80, -0.09, 0.22, 0.22, 0.22, 0.22, 2.0, 2.0),
    (-6.80, -0.05, 0.38, 0.40, 0.38, 0.38, 2.0, 2.0),
    (-5.60, 0.00, 0.50, 0.54, 0.50, 0.50, 2.2, 2.2),
    (-4.20, 0.00, 0.56, 0.62, 0.58, 0.56, 2.4, 2.4),
    (-2.60, 0.00, 0.62, 0.64, 0.62, 0.62, 2.6, 2.6),
    (0.00, 0.00, 0.96, 0.62, 0.64, 0.94, 3.0, 2.8),
    (2.50, 0.00, 0.92, 0.58, 0.62, 0.90, 3.0, 2.8),
    (5.00, 0.00, 0.78, 0.54, 0.56, 0.76, 2.6, 2.6),
    (6.80, 0.00, 0.62, 0.50, 0.50, 0.62, 2.2, 2.2),
    (7.60, 0.00, 0.58, 0.48, 0.48, 0.58, 2.0, 2.0),
]
INTAKE = [
    (-3.30, 1.00, -0.10, 0.32, 0.50, 10.0, 10.0, -0.15),
    (-2.40, 1.00, -0.10, 0.34, 0.50, 7.0, 7.0),
    (0.00, 0.85, -0.05, 0.36, 0.52, 4.0, 4.0),
    (2.50, 0.75, -0.05, 0.34, 0.46, 3.0, 3.0),
]
CANOPY = [(-5.30, 0.50, 0.05, 0.06), (-5.00, 0.48, 0.32, 0.34), (-4.50, 0.48, 0.40, 0.50), (-3.90, 0.50, 0.40, 0.52),
          (-3.40, 0.52, 0.34, 0.44), (-3.00, 0.54, 0.22, 0.28)]
SPINE = [(-3.30, 0.54, 0.32, 0.44), (-1.50, 0.54, 0.40, 0.36), (1.50, 0.52, 0.36, 0.26), (4.00, 0.50, 0.26, 0.14),
         (6.00, 0.48, 0.12, 0.04)]
GLOVE_OUT = [(1.20, -2.60), (1.32, -2.10), (1.55, -1.40), (1.80, -0.60), (1.95, 0.30), (1.95, 1.60), (1.40, 3.00)]
WING_Y = 0.42
PIVOT = (1.65, WING_Y, 0.0)
SWEEP = [-math.radians(27), math.radians(29)]  # 72 .. 16 degrees


def wing_surface():
    le = lambda s: -0.90 + (s - 1.65) * 1.0  # 45 degrees
    return wing(1.40, 6.30, (le(1.40), le(6.30)), (2.20, 4.95), (0.24, 0.07), WING_Y, J.wing_uv, hinge=(0.78, 0.74))


def fin_surface():
    return fin(0.0, 2.60, (3.40, 6.60), (7.60, 7.90), (0.20, 0.07), J.fin_uv, x0=0.0, y0=0.55, hinge=(0.78, 0.62))


def stab_surface():
    return wing(0.55, 2.85, (5.60, 7.40), (7.90, 8.20), (0.15, 0.05), 0.0, J.stab_uv)


def build():
    root = Part(NAME)
    air = Part("airframe")
    half = Part("half")

    fuselage(air, FUSE, J.FUSE, nu=6, nl=6, role=lambda i: "secondary" if i < 2 else "body")
    tube(air, (0, -0.10, -9.10), (0, -0.10, -8.35), [0.012, 0.03], 4, "metal", lambda a, l: missile_uv(0.5, 0.5))
    bubble(air, SPINE, lambda c, z: J.fuse(z, 0.02 + 0.2 * c), seg=6, role="body")
    plate(air, [(0.0, 0.60, 0.20), (0.0, 0.60, 3.60), (0.0, 1.25, 3.90)], "body", plain, thick=0.08)  # dorsal fillet
    Surface(0.0, 1.00, (5.30, 6.30), (7.30, 7.30), (0.08, 0.04),
            lambda s, n, z: (n, -0.50 - s, z), lambda p: J.fin_uv((p[0], 0.6, p[2]))).build(air, [], root_cap=False)  # ventral
    duct(half, INTAKE, J.duct_uv, seg=16, lip=0.05, depth=1.0, wall="dark")
    plate(half, [(0.62, 0.40, -3.50), (0.62, 0.44, -2.60), (0.62, -0.58, -2.60), (0.62, -0.58, -3.50),
                 (0.62, -0.20, -4.00), (0.62, 0.15, -3.95)], "secondary", J.wing_uv, thick=0.04)  # splitter
    strake(half, [(0.80, z) for _, z in GLOVE_OUT], GLOVE_OUT, WING_Y, 0.16, 0.04, J.wing_uv)
    plate(half, [(1.50, WING_Y - 0.12, -3.00), (1.50, WING_Y - 0.12, -0.80), (1.50, -0.05, -1.00), (1.50, -0.05, -2.80)],
          "secondary", J.wing_uv, thick=0.10)  # glove pylon

    wr = swing(PIVOT, SWEEP)
    w = wing_surface()
    cuts = [("flap_r", 2.10, 4.30, {"role": "flap"}), ("aileron_r", 4.30, 5.90, {"role": "aileron"})]
    wr.children = w.build(wr, [3.0, 5.0], cuts)
    w.decal(wr, 4.80, 0.42, 0.34, 1, insignia)
    w.decal(wr, 4.80, 0.42, 0.34, -1, insignia)

    st = stabilator(stab_surface(), (0.55, 0.0, 7.0), (1.0, 0.0, 0.0), stations=[1.6])

    air.add(half).add(half.mirrored("half_l"))
    f = fin_surface()
    rudder = f.build(air, [2.30], [("rudder", 0.35, 2.15, {"role": "rudder"})],
                     role=lambda s: "stripe" if s > 2.30 else "body")[0]
    f.decal(air, 1.20, 0.50, 0.32, 1, insignia)
    f.decal(air, 1.20, 0.50, 0.32, -1, insignia)
    for side in (1, -1):
        f.patch(air, 1.75, 2.15, 5.60, 6.60, side, A.NUMBER)
    nozzles(air, (0.0,), 7.40, 8.30, 0.60, 0.55, 0.0, seg=16)

    r24 = store((1.50, -0.24, -3.20), **R24)
    r60 = store((0.38, -0.84, 0.20), **R60)
    stores = firing_order([r60.mirrored(), r60, r24.mirrored(), r24])

    cano = Part("canopy", (0.0, 0.80, -3.0), {"role": "canopy"})
    bubble(cano, CANOPY, glass_uv, seg=8, frame_at=-4.95)

    root.children = [air, cano, wr, wr.mirrored()]
    root.children += [st, st.mirrored(), rudder]
    root.children.append(gear(
        dict(z=-5.00, top=-0.55, r=0.26, twin=True, fold=-1),
        dict(x=1.40, z=0.90, top=-0.50, r=0.42, xw=1.62, fold=1, brace=(1.10, -0.55, 0.40)),
        nose_door=dict(x=0.22, y=-0.56, z0=-5.6, z1=-4.3, depth=0.34),
        main_door=dict(x=1.80, y=-0.45, z0=0.2, z1=1.7, depth=0.50)))
    root.children += stores
    engines(root, [(0.0, 0.0, 8.30, 0.52)])
    return root


def texture():
    cv = A.Canvas()
    paint_fuselage(cv, J,
                   frames=[(-6.8, 0, 1), (-5.6, 0, 0.5), (-2.8, 0, 1), (-0.4, 0, 0.5), (2.0, 0, 1), (4.2, 0, 1), (6.4, 0, 1)],
                   longerons=[(0.5, -6.6, 7.4), (0.30, -2.8, 6.4), (0.78, -4.4, 7.0)],
                   panels=[(-2.0, -0.8, 0.04, 0.16), (0.4, 1.6, 0.04, 0.16), (2.4, 3.6, 0.30, 0.42), (-5.2, -4.2, 0.60, 0.72)],
                   soot_from=6.8)
    w = wing_surface()
    paint_surface(cv, J.WING, w, chords=[(0.15, 2.0, 6.2), (0.45, 2.0, 6.1)], spans=[2.1, 3.0, 4.3, 5.0, 5.9], hinge_spans=(2.1, 5.9))
    paint_surface(cv, J.FIN, fin_surface(), chords=[(0.40, 0.2, 2.4)], spans=[0.35, 1.2, 2.15], hinge_spans=(0.35, 2.15),
                  height=lambda s: 0.55 + s)
    paint_surface(cv, J.STAB, stab_surface(), chords=[(0.4, 0.7, 2.7)], spans=[1.6])
    paint_common(cv, ("", "55"))
    return cv
