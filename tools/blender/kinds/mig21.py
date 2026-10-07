"""MiG-21bis: round nose intake with the shock cone, the pitot boom over
the nose, a small canopy faired into the big dorsal spine, a mid-mounted
57-degree delta with fences, a tall 60-degree fin with a dorsal fillet, a
ventral fin, low swept stabilators, one nozzle. True metres (14.5 m long,
7.15 m span), nose toward -z.
"""
import math

import atlas as A
from mesh import Part
from parts import Surface, bubble, firing_order, fuselage, plate, store, tube
from kinds._jet import (R3S, Jet, engines, fin, gear, glass_uv, insignia, missile_uv, nose_intake, nozzles,
                        paint_common, paint_fuselage, paint_surface, plain, stabilator, wing)

NAME = "mig21"
MISSILES = 2  # provisional (Phase 4 sets sim.Spec.Missiles)

J = Jet(length=(-8.10, 7.30), wing=(-1.6, 4.1, 0.3, 3.7), fin=(2.4, 6.6, 2.60, 0.40), stab=(4.4, 6.7, 0.3, 2.0))

FUSE = [  # z, cy, w, ht, hb, wb, eu, el
    (-7.25, 0.00, 0.47, 0.47, 0.47, 0.47, 2.0, 2.0),
    (-6.40, 0.00, 0.55, 0.55, 0.55, 0.55, 2.0, 2.0),
    (-5.00, 0.02, 0.62, 0.64, 0.60, 0.62, 2.0, 2.0),
    (-3.80, 0.02, 0.64, 0.66, 0.62, 0.64, 2.0, 2.0),
    (-2.00, 0.00, 0.65, 0.65, 0.63, 0.65, 2.0, 2.0),
    (1.00, 0.00, 0.62, 0.62, 0.60, 0.62, 2.0, 2.0),
    (3.50, 0.00, 0.58, 0.58, 0.56, 0.58, 2.0, 2.0),
    (5.50, 0.00, 0.52, 0.52, 0.50, 0.52, 2.0, 2.0),
    (6.90, 0.00, 0.47, 0.47, 0.46, 0.47, 2.0, 2.0),
]
CANOPY = [(-4.95, 0.50, 0.05, 0.05), (-4.65, 0.48, 0.32, 0.36), (-4.10, 0.48, 0.40, 0.54), (-3.50, 0.50, 0.40, 0.58),
          (-3.00, 0.52, 0.36, 0.54)]
SPINE = [(-3.20, 0.50, 0.36, 0.58), (-1.50, 0.50, 0.40, 0.52), (1.00, 0.50, 0.34, 0.38), (3.00, 0.50, 0.24, 0.22),
         (4.50, 0.50, 0.10, 0.05)]
WING_Y = 0.0


def wing_surface():
    le = lambda s: -1.20 + (s - 0.60) * 1.54  # 57 degrees
    return wing(0.55, 3.57, (le(0.55), le(3.57)), (3.95, 3.95), (0.22, 0.05), WING_Y, J.wing_uv, hinge=(0.86, 0.80))


def fin_surface():
    return fin(0.0, 1.95, (2.60, 5.80), (6.40, 6.40), (0.18, 0.06), J.fin_uv, x0=0.0, y0=0.55, hinge=(0.74, 0.62))


def stab_surface():
    return wing(0.40, 1.87, (4.55, 5.85), (6.30, 6.55), (0.12, 0.04), -0.12, J.stab_uv)


def build():
    root = Part(NAME)
    air = Part("airframe")
    half = Part("half")

    fuselage(air, FUSE, J.FUSE, nu=6, nl=6)
    nose_intake(air, -7.25, 0.0, 0.47, lip=0.05, depth=1.0, cone=(0.80, 0.62))
    tube(air, (0.0, 0.62, -8.10), (0.0, 0.50, -6.40), [0.025, 0.04], 4, "metal", lambda a, l: missile_uv(0.5, 0.5))  # pitot
    bubble(air, SPINE, lambda c, z: J.fuse(z, 0.02 + 0.2 * c), seg=6, role="body")
    plate(air, [(0.0, 0.62, 1.40), (0.0, 0.62, 2.80), (0.0, 1.05, 3.05)], "body", plain, thick=0.08)  # dorsal fillet
    Surface(0.0, 0.62, (4.80, 5.50), (6.30, 6.30), (0.08, 0.04),
            lambda s, n, z: (n, -0.45 - s, z), lambda p: J.fin_uv((p[0], 0.5, p[2]))).build(air, [], root_cap=False)  # ventral

    w = wing_surface()
    cuts = [("flap_r", 0.80, 1.80, {"role": "flap"}), ("aileron_r", 2.10, 3.30, {"role": "aileron"})]
    surfaces = w.build(half, [1.8, 2.1], cuts)
    w.decal(half, 2.55, 0.62, 0.30, 1, insignia)
    w.decal(half, 2.55, 0.62, 0.30, -1, insignia)
    for s in (1.95, 2.85):  # wing fences
        le, te, _ = w.at(s)
        plate(half, [(s, WING_Y + 0.02, le + 0.3), (s, WING_Y + 0.02, te - 0.3), (s, WING_Y + 0.13, te - 0.5), (s, WING_Y + 0.13, le + 0.6)],
              "body", J.wing_uv, thick=0.02)
    plate(half, [(1.65, WING_Y - 0.08, -0.60), (1.65, WING_Y - 0.08, 1.40), (1.65, WING_Y - 0.30, 1.20), (1.65, WING_Y - 0.30, -0.40)],
          "secondary", J.wing_uv, thick=0.08)

    st = stabilator(stab_surface(), (0.40, -0.12, 5.6), (1.0, 0.0, 0.0), stations=[1.1])

    air.add(half).add(half.mirrored("half_l"))
    f = fin_surface()
    rudder = f.build(air, [1.70], [("rudder", 0.25, 1.60, {"role": "rudder"})],
                     role=lambda s: "stripe" if s > 1.70 else "body")[0]
    f.decal(air, 0.80, 0.52, 0.28, 1, insignia)
    f.decal(air, 0.80, 0.52, 0.28, -1, insignia)
    for side in (1, -1):
        f.patch(air, 1.15, 1.50, 4.60, 5.40, side, A.NUMBER)
    nozzles(air, (0.0,), 6.60, 7.30, 0.48, 0.44, 0.0, seg=16)

    r3 = store((1.65, -0.42, -1.30), **R3S)
    stores = firing_order([r3.mirrored(), r3])

    cano = Part("canopy", (0.0, 0.70, -3.0), {"role": "canopy"})
    bubble(cano, CANOPY, glass_uv, seg=8, frame_at=-4.55)

    root.children = [air, cano]
    for p in surfaces:
        root.children += [p, p.mirrored()]
    root.children += [st, st.mirrored(), rudder]
    root.children.append(gear(
        dict(z=-5.10, top=-0.45, r=0.24, fold=1),
        dict(x=1.35, z=0.70, top=-0.15, r=0.38, xw=1.42, fold=1, brace=(1.05, -0.22, 0.10)),
        nose_door=dict(x=0.20, y=-0.50, z0=-5.7, z1=-4.5, depth=0.32),
        main_door=dict(x=1.70, y=-0.10, z0=0.1, z1=1.4, depth=0.45)))
    root.children += stores
    engines(root, [(0.0, 0.0, 7.30, 0.40)])
    return root


def texture():
    cv = A.Canvas()
    paint_fuselage(cv, J,
                   frames=[(-6.4, 0, 1), (-5.2, 0, 0.5), (-2.8, 0, 1), (-0.6, 0, 0.5), (1.6, 0, 1), (3.6, 0, 1), (5.6, 0, 1)],
                   longerons=[(0.5, -6.6, 6.8), (0.30, -2.8, 5.6), (0.78, -4.6, 6.4)],
                   panels=[(-2.2, -1.2, 0.04, 0.16), (0.2, 1.2, 0.04, 0.16), (2.0, 3.0, 0.30, 0.42), (-6.0, -5.2, 0.60, 0.72)],
                   soot_from=6.0)
    w = wing_surface()
    paint_surface(cv, J.WING, w, chords=[(0.18, 0.8, 3.5), (0.50, 0.8, 3.4)], spans=[0.8, 1.8, 2.1, 3.3], hinge_spans=(0.8, 3.3))
    paint_surface(cv, J.FIN, fin_surface(), chords=[(0.40, 0.2, 1.8)], spans=[0.25, 1.0, 1.6], hinge_spans=(0.25, 1.6),
                  height=lambda s: 0.55 + s)
    paint_surface(cv, J.STAB, stab_surface(), chords=[(0.4, 0.5, 1.8)], spans=[1.1])
    paint_common(cv, ("", "41"))
    return cv
