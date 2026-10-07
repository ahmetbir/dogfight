"""Su-25: pointed nose ending in the laser window, small framed canopy with
a dorsal spine, long engine nacelles alongside the fuselage under the wing
roots with oval intakes behind the cockpit, a shoulder wing with mild sweep
and slight anhedral, wingtip airbrake pods, a tall single fin, a tailplane
with dihedral and elevators. True metres (15.5 m long, 14.4 m span), nose
toward -z.
"""
import math

import atlas as A
from mesh import Part
from parts import bubble, duct, firing_order, fuselage, plate, store, strake, tube
from kinds._jet import (KH25, R60, Jet, engines, fin, gear, glass_uv, insignia, missile_uv, nozzles, paint_common,
                        paint_fuselage, paint_surface, wing)

NAME = "su25"
MISSILES = 4  # provisional (Phase 4 sets sim.Spec.Missiles)

J = Jet(length=(-7.95, 7.85), wing=(-3.2, 2.4, 0.4, 7.4), fin=(4.0, 7.8, 3.30, 0.40), stab=(5.4, 7.4, 0.2, 3.0))

FUSE = [  # z, cy, w, ht, hb, wb, eu, el
    (-7.72, -0.08, 0.15, 0.15, 0.15, 0.15, 2.0, 2.0),
    (-7.40, -0.06, 0.26, 0.28, 0.24, 0.26, 2.0, 2.0),
    (-6.80, 0.00, 0.42, 0.46, 0.42, 0.42, 2.0, 2.0),
    (-5.80, 0.05, 0.55, 0.62, 0.58, 0.55, 2.2, 2.2),
    (-4.60, 0.05, 0.60, 0.68, 0.66, 0.60, 2.4, 2.4),
    (-3.20, 0.05, 0.62, 0.70, 0.70, 0.62, 2.5, 2.5),
    (-1.00, 0.05, 0.60, 0.68, 0.70, 0.60, 2.5, 2.5),
    (2.00, 0.10, 0.54, 0.60, 0.62, 0.52, 2.4, 2.4),
    (4.50, 0.15, 0.44, 0.50, 0.50, 0.42, 2.2, 2.2),
    (6.50, 0.20, 0.32, 0.36, 0.34, 0.30, 2.0, 2.0),
    (7.65, 0.22, 0.15, 0.16, 0.14, 0.14, 2.0, 2.0),
    (7.85, 0.22, 0.04, 0.04, 0.04, 0.04, 2.0, 2.0),
]
# Oval intakes (taller than wide, the top raked back) into nacelles that run to the tail.
NACELLE = [
    (-3.30, 0.88, -0.10, 0.33, 0.48, 2.2, 2.2, 0.18),
    (-2.50, 0.92, -0.12, 0.37, 0.50, 2.2, 2.2),
    (0.50, 0.98, -0.15, 0.45, 0.52, 2.4, 2.4),
    (3.50, 0.95, -0.12, 0.44, 0.48, 2.2, 2.2),
    (5.10, 0.90, -0.06, 0.38, 0.40, 2.0, 2.0),
]
CANOPY = [
    (-5.75, 0.56, 0.05, 0.06), (-5.45, 0.56, 0.34, 0.34), (-5.05, 0.58, 0.44, 0.52), (-4.50, 0.62, 0.44, 0.54),
    (-4.00, 0.66, 0.38, 0.44), (-3.60, 0.70, 0.26, 0.28),
]
SPINE = [(-3.90, 0.66, 0.34, 0.36), (-2.00, 0.66, 0.36, 0.26), (1.50, 0.64, 0.30, 0.18), (4.50, 0.60, 0.22, 0.10),
         (6.00, 0.56, 0.12, 0.04)]
LERX_OUT = [(0.70, -3.40), (1.05, -2.40), (1.45, -1.70)]
WING_Y = 0.45
ANHEDRAL = math.radians(2.5)


def wing_surface():
    le = lambda s: -1.75 + (s - 0.70) * 0.364  # 20 degrees
    return wing(0.70, 7.18, (le(0.70), le(7.18)), (2.05, 2.00), (0.36, 0.12), WING_Y, J.wing_uv, hinge=(0.76, 0.72),
                dihedral=-ANHEDRAL, ridge=0.30)


def wing_y(s):
    return WING_Y - (s - 0.70) * math.tan(ANHEDRAL)


def fin_surface():
    return fin(0.0, 2.75, (4.20, 6.20), (7.30, 7.60), (0.20, 0.08), J.fin_uv, x0=0.0, y0=0.55, hinge=(0.74, 0.66))


def tail_surface():
    return wing(0.25, 2.85, (5.65, 6.35), (7.15, 7.05), (0.16, 0.08), 0.42, J.stab_uv, hinge=(0.66, 0.62),
                dihedral=math.radians(5))


def build():
    root = Part(NAME)
    air = Part("airframe")
    half = Part("half")

    fuselage(air, FUSE, J.FUSE, nu=6, nl=6, role=lambda i: "secondary" if i < 1 else "body")
    tube(air, (0, -0.12, -7.95), (0, -0.08, -7.70), [0.09, 0.15], 8, "dark", cap0="dark")  # laser window
    tube(air, (-0.30, 0.20, -8.80), (-0.30, 0.20, -7.20), [0.02, 0.03], 4, "metal", lambda a, l: missile_uv(0.5, 0.5))
    bubble(air, SPINE, lambda c, z: J.fuse(z, 0.02 + 0.2 * c), seg=6, role="body")
    duct(half, NACELLE, J.duct_uv, seg=14, lip=0.05, depth=0.9, wall="dark")
    strake(half, [(0.55, z) for _, z in LERX_OUT], LERX_OUT, WING_Y, 0.12, 0.10, J.wing_uv)

    w = wing_surface()
    cuts = [("flap_r", 1.10, 4.20, {"role": "flap"}), ("aileron_r", 4.60, 6.80, {"role": "aileron"})]
    surfaces = w.build(half, [2.5, 4.6, 6.0], cuts)
    w.decal(half, 5.60, 0.42, 0.38, 1, insignia)
    w.decal(half, 5.60, 0.42, 0.38, -1, insignia)
    # Wingtip airbrake pods.
    yt = wing_y(7.18)
    tube(half, (7.20, yt, -0.70), (7.20, yt, 2.50), [0.0, 0.12, 0.16, 0.16, 0.10], 8, "secondary",
         lambda a, l: J.wing_uv((7.2, 0, -0.7 + 3.2 * l)), at=[0.0, 0.15, 0.35, 0.85, 1.0])
    for s in (2.6, 3.6, 4.8, 6.1):
        y = wing_y(s)
        plate(half, [(s, y - 0.14, -1.60), (s, y - 0.14, 0.60), (s, y - 0.42, 0.40), (s, y - 0.42, -1.40)], "secondary",
              J.wing_uv, thick=0.10)

    t = tail_surface()
    elevator = t.build(half, [1.4], [("stab_r", 0.40, 2.70, {"role": "elevator"})])[0]

    air.add(half).add(half.mirrored("half_l"))
    f = fin_surface()
    rudder = f.build(air, [2.45], [("rudder", 0.35, 2.30, {"role": "rudder"})],
                     role=lambda s: "stripe" if s > 2.45 else "body")[0]
    f.patch(air, 0.90, 1.40, 5.50, 6.50, 1, A.NUMBER)
    f.patch(air, 0.90, 1.40, 5.50, 6.50, -1, A.NUMBER)
    nozzles(air, (-0.90, 0.90), 5.00, 5.90, 0.37, 0.33, -0.06, seg=14)

    r60 = store((6.10, wing_y(6.10) - 0.55, -1.30), **R60)
    kh = store((4.80, wing_y(4.80) - 0.58, -1.90), **KH25)
    stores = firing_order([r60.mirrored(), r60, kh.mirrored(), kh])

    cano = Part("canopy", (0.0, 0.80, -3.6), {"role": "canopy"})
    bubble(cano, CANOPY, glass_uv, seg=6, frame_at=[-5.30, -4.55])

    root.children = [air, cano]
    for p in surfaces:
        root.children += [p, p.mirrored()]
    root.children += [elevator, elevator.mirrored(), rudder]
    root.children.append(gear(
        dict(z=-4.90, top=-0.62, r=0.30, fold=-1),
        dict(x=1.20, z=0.90, top=-0.60, r=0.42, xw=1.32, fold=1, w=0.28, brace=(0.95, -0.65, 0.30)),
        nose_door=dict(x=0.24, y=-0.64, z0=-5.5, z1=-4.2, depth=0.36),
        main_door=dict(x=1.48, y=-0.60, z0=0.2, z1=1.8, depth=0.50)))
    root.children += stores
    engines(root, [(-0.90, -0.06, 5.90, 0.30), (0.90, -0.06, 5.90, 0.30)])
    return root


def texture():
    cv = A.Canvas()
    paint_fuselage(cv, J,
                   frames=[(-6.8, 0, 1), (-5.8, 0, 0.5), (-3.2, 0, 1), (-1.0, 0, 0.5), (1.4, 0, 1), (3.6, 0, 1), (5.8, 0, 1)],
                   longerons=[(0.5, -6.6, 7.4), (0.30, -3.0, 6.0), (0.78, -5.0, 6.8)],
                   panels=[(-2.6, -1.4, 0.04, 0.16), (0.2, 1.4, 0.04, 0.16), (2.0, 3.2, 0.30, 0.42), (-5.4, -4.4, 0.60, 0.72)],
                   soot_from=5.6)
    w = wing_surface()
    paint_surface(cv, J.WING, w, chords=[(0.15, 1.0, 7.1), (0.45, 1.0, 7.0)], spans=[1.1, 2.5, 4.2, 4.6, 6.0, 6.8],
                  hinge_spans=(1.1, 6.8))
    paint_surface(cv, J.FIN, fin_surface(), chords=[(0.40, 0.2, 2.6)], spans=[0.35, 1.3, 2.3], hinge_spans=(0.35, 2.3),
                  height=lambda s: 0.55 + s)
    paint_surface(cv, J.STAB, tail_surface(), chords=[(0.4, 0.4, 2.8)], spans=[1.4], hinge_spans=(0.4, 2.7))
    paint_common(cv, ("", "07"))
    return cv
