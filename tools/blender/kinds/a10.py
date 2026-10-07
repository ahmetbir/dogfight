"""A-10: blunt nose with the GAU-8 barrel under it, high bubble canopy, a
long thick straight low wing (flat centre section, outer panels with
dihedral), main gear pods ahead of the wing, two TF34 pods on pylons above
the rear fuselage, a straight tailplane with twin fins at its tips. True
metres (16.3 m long, 17.5 m span), nose toward -z.
"""
import math

import atlas as A
from mesh import Part
from parts import bubble, duct, firing_order, fuselage, plate, store, tube
from kinds._jet import (AGM65, AIM9, Jet, engines, fin, gear, glass_uv, insignia, mirrored_rudder, missile_uv,
                        nozzles, paint_common, paint_fuselage, paint_surface, plain, wing)

NAME = "a10"
MISSILES = 4  # provisional (Phase 4 sets sim.Spec.Missiles)

J = Jet(length=(-8.15, 8.10), wing=(-2.0, 1.8, 0.4, 8.9), fin=(5.2, 7.8, 2.30, -0.40), stab=(5.8, 7.8, 0.2, 3.0))

FUSE = [  # z, cy, w, ht, hb, wb, eu, el
    (-8.15, -0.30, 0.10, 0.10, 0.10, 0.10, 2.0, 2.0),
    (-8.00, -0.30, 0.32, 0.30, 0.30, 0.32, 2.0, 2.0),
    (-7.40, -0.20, 0.55, 0.55, 0.55, 0.55, 2.2, 2.2),
    (-6.40, -0.10, 0.72, 0.72, 0.70, 0.70, 2.5, 2.5),
    (-5.00, -0.05, 0.80, 0.78, 0.78, 0.78, 2.8, 2.8),
    (-3.00, -0.05, 0.82, 0.78, 0.80, 0.80, 3.0, 3.0),
    (-1.00, -0.05, 0.80, 0.74, 0.80, 0.78, 3.0, 3.0),
    (1.50, 0.00, 0.72, 0.68, 0.70, 0.70, 2.8, 2.8),
    (4.00, 0.10, 0.55, 0.55, 0.50, 0.50, 2.4, 2.4),
    (6.50, 0.28, 0.34, 0.36, 0.28, 0.30, 2.2, 2.2),
    (7.90, 0.38, 0.16, 0.16, 0.14, 0.14, 2.0, 2.0),
    (8.10, 0.38, 0.04, 0.04, 0.04, 0.04, 2.0, 2.0),
]
CANOPY = [
    (-6.20, 0.56, 0.06, 0.08), (-5.85, 0.56, 0.40, 0.40), (-5.30, 0.58, 0.56, 0.74), (-4.60, 0.62, 0.58, 0.82),
    (-3.90, 0.68, 0.52, 0.70), (-3.40, 0.72, 0.36, 0.42), (-3.00, 0.74, 0.10, 0.12),
]
SPINE = [(-3.20, 0.70, 0.30, 0.20), (-1.20, 0.68, 0.40, 0.10), (2.00, 0.66, 0.30, 0.04)]
ENGINE_X, ENGINE_Y = 1.32, 1.18
POD = [  # TF34 pod: a round intake, the pod running aft into the nozzle
    (1.00, ENGINE_X, ENGINE_Y, 0.62, 0.62, 2.0, 2.0),
    (1.60, ENGINE_X, ENGINE_Y, 0.65, 0.65, 2.0, 2.0),
    (3.20, ENGINE_X, ENGINE_Y, 0.62, 0.62, 2.0, 2.0),
    (4.30, ENGINE_X, ENGINE_Y, 0.50, 0.50, 2.0, 2.0),
]
WING_Y = -0.55
DIHEDRAL = math.radians(7)
FIN_X, FIN_Y = 2.90, -0.30


def centre_wing():
    return wing(0.50, 3.00, (-1.65, -1.65), (1.40, 1.40), (0.42, 0.40), WING_Y, J.wing_uv)


def outer_wing():
    return wing(3.00, 8.76, (-1.65, -1.30), (1.40, 0.25), (0.40, 0.18), WING_Y, J.wing_uv, hinge=(0.74, 0.70),
                dihedral=DIHEDRAL, ridge=0.30)


def wing_y(s):
    return WING_Y + max(0.0, s - 3.0) * math.tan(DIHEDRAL)


def fin_surface(mirror=False):
    return fin(0.0, 2.50, (5.45, 5.65), (7.45, 7.25), (0.16, 0.12), J.fin_uv, x0=FIN_X, y0=FIN_Y, hinge=(0.70, 0.66),
               mirror=mirror)


def tail_surface():
    return wing(0.20, 2.90, (5.95, 6.10), (7.60, 7.45), (0.18, 0.12), 0.45, J.stab_uv, hinge=(0.68, 0.66))


def build():
    root = Part(NAME)
    air = Part("airframe")
    half = Part("half")

    fuselage(air, FUSE, J.FUSE, nu=6, nl=6, role=lambda i: "secondary" if i < 1 else "body")
    tube(air, (-0.10, -0.52, -8.85), (-0.10, -0.52, -7.70), [0.09, 0.09], 6, "metal", lambda a, l: missile_uv(0.5, 0.5),
         cap0="dark")  # GAU-8 barrels
    bubble(air, SPINE, lambda c, z: J.fuse(z, 0.02 + 0.2 * c), seg=6, role="body")

    c = centre_wing()
    c.build(half, [1.8])
    o = outer_wing()
    cuts = [("flap_r", 3.10, 5.70, {"role": "flap"}), ("aileron_r", 5.70, 8.40, {"role": "aileron"})]
    surfaces = o.build(half, [4.4, 7.0], cuts)
    o.decal(half, 7.40, 0.40, 0.44, 1, insignia)
    o.decal(half, 7.40, 0.40, 0.44, -1, insignia)
    # Main gear pods ahead of the wing.
    tube(half, (2.45, -0.78, -3.20), (2.45, -0.78, 0.80), [0.0, 0.30, 0.42, 0.42, 0.30], 8, "body",
         lambda a, l: J.fuse(-3.2 + 4.0 * l, 0.6), at=[0.0, 0.18, 0.40, 0.80, 1.0])
    # Pylons: AGM-65 inboard, the AIM-9 rail outboard.
    for s, lo in ((5.80, 0.36), (7.40, 0.30)):
        y = wing_y(s)
        plate(half, [(s, y - 0.12, -1.60), (s, y - 0.12, 0.40), (s, y - lo, 0.20), (s, y - lo, -1.40)], "secondary",
              J.wing_uv, thick=0.10)

    # Engine pods on pylons above the rear fuselage.
    pod = Part("pod")
    duct(pod, POD, lambda p, a: J.fuse(p[2], 0.1 + a), seg=14, lip=0.07, depth=0.5, wall="metal")
    tube(pod, (ENGINE_X, ENGINE_Y, 1.30), (ENGINE_X, ENGINE_Y, 1.10), [0.20, 0.0], 8, "metal")  # fan spinner
    plate(pod, [(0.30, 0.66, 1.80), (0.30, 0.66, 4.00), (ENGINE_X - 0.20, ENGINE_Y - 0.50, 3.70),
                (ENGINE_X - 0.20, ENGINE_Y - 0.50, 2.00)], "body", plain, thick=0.14)
    half.add(pod)

    f = fin_surface()
    rudder = f.build(half, [2.15], [("rudder_r", 0.30, 2.10, {"role": "rudder"})],
                     role=lambda s: "stripe" if s > 2.15 else "body")[0]
    t = tail_surface()
    elevator = t.build(half, [1.4], [("stab_r", 0.35, 2.80, {"role": "elevator"})])[0]

    air.add(half).add(half.mirrored("half_l"))
    nozzles(air, (-ENGINE_X, ENGINE_X), 4.10, 4.95, 0.50, 0.44, ENGINE_Y, seg=14)
    fin_surface().patch(air, 0.90, 1.50, 5.80, 6.90, 1, A.NUMBER)
    fin_surface(mirror=True).patch(air, 0.90, 1.50, 5.80, 6.90, 1, A.NUMBER, flip=True)

    a9 = store((7.40, wing_y(7.40) - 0.42, -1.70), **AIM9)
    agm = store((5.80, wing_y(5.80) - 0.52, -1.75), **AGM65)
    stores = firing_order([a9.mirrored(), a9, agm.mirrored(), agm])

    cano = Part("canopy", (0.0, 0.80, -3.0), {"role": "canopy"})
    bubble(cano, CANOPY, glass_uv, seg=8, frame_at=-5.80)

    root.children = [air, cano]
    for p in surfaces:
        root.children += [p, p.mirrored()]
    root.children += [elevator, elevator.mirrored(), rudder, mirrored_rudder(rudder)]
    root.children.append(gear(
        dict(z=-5.60, top=-0.70, r=0.30, fold=-1),
        dict(x=2.45, z=-1.90, top=-0.80, r=0.44, xw=2.40, fold=1, w=0.26),
        nose_door=dict(x=0.24, y=-0.76, z0=-6.3, z1=-4.9, depth=0.36)))
    root.children += stores
    engines(root, [(-ENGINE_X, ENGINE_Y, 4.95, 0.40), (ENGINE_X, ENGINE_Y, 4.95, 0.40)])
    return root


def texture():
    cv = A.Canvas()
    paint_fuselage(cv, J,
                   frames=[(-7.4, 0, 1), (-6.4, 0, 0.5), (-2.8, 0, 1), (-0.6, 0, 0.5), (1.6, 0, 1), (4.0, 0, 1), (6.4, 0, 1)],
                   longerons=[(0.5, -7.2, 7.8), (0.30, -2.8, 6.4), (0.78, -6.0, 7.0)],
                   panels=[(-2.4, -1.0, 0.04, 0.16), (0.4, 1.8, 0.04, 0.16), (2.4, 3.6, 0.30, 0.42), (-6.0, -4.8, 0.60, 0.72)],
                   soot_from=4.4)
    o = outer_wing()
    paint_surface(cv, J.WING, o, chords=[(0.15, 3.1, 8.7), (0.45, 3.1, 8.6)], spans=[3.1, 4.4, 5.7, 7.0, 8.4], hinge_spans=(3.1, 8.4))
    paint_surface(cv, J.WING, centre_wing(), chords=[(0.15, 0.6, 3.0), (0.45, 0.6, 3.0)], spans=[1.8])
    paint_surface(cv, J.FIN, fin_surface(), chords=[(0.40, 0.2, 2.3)], spans=[0.3, 1.2, 2.1], hinge_spans=(0.3, 2.1),
                  height=lambda s: FIN_Y + s)
    paint_surface(cv, J.STAB, tail_surface(), chords=[(0.4, 0.4, 2.8)], spans=[1.4], hinge_spans=(0.35, 2.8))
    paint_common(cv, ("AF", "0281"))
    return cv
