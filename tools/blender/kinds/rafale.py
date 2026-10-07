"""Rafale: slim nose with the fixed refuelling probe on the right, bubble
canopy, kidney intakes low on the sides under the canard roots, close-
coupled canards, a cropped delta wing with two elevons a side, wingtip
missile rails, a big single fin, two nozzles close together. True metres
(15.3 m long, 10.8 m span), nose toward -z.
"""
import atlas as A
from mesh import Part
from parts import block, bubble, duct, firing_order, fuselage, store, tube
from kinds._jet import (METEOR, MICA, Jet, engines, fin, gear, glass_uv, insignia, missile_uv, nozzles, paint_common,
                        paint_fuselage, paint_surface, stabilator, wing)

NAME = "rafale"

J = Jet(length=(-7.75, 7.45), wing=(-2.6, 5.8, 0.4, 5.6), fin=(2.3, 6.8, 3.40, 0.50), stab=(-2.7, -0.3, 0.6, 2.4))

FUSE = [  # z, cy, w, ht, hb, wb, eu, el
    (-7.75, -0.05, 0.02, 0.02, 0.02, 0.02, 2.0, 2.0),
    (-7.20, -0.04, 0.20, 0.20, 0.19, 0.19, 2.0, 2.0),
    (-6.30, 0.00, 0.35, 0.36, 0.34, 0.34, 2.0, 2.0),
    (-5.20, 0.02, 0.45, 0.48, 0.44, 0.44, 2.2, 2.2),
    (-4.00, 0.04, 0.51, 0.56, 0.52, 0.50, 2.4, 2.4),
    (-2.60, 0.05, 0.56, 0.60, 0.58, 0.54, 2.6, 2.4),
    (-1.00, 0.05, 0.74, 0.58, 0.62, 0.78, 2.8, 2.6),
    (1.00, 0.05, 1.02, 0.56, 0.58, 0.98, 3.4, 3.0),
    (3.50, 0.05, 1.04, 0.52, 0.54, 1.00, 3.4, 3.0),
    (5.50, 0.05, 0.96, 0.46, 0.50, 0.94, 3.0, 2.8),
    (6.80, 0.05, 0.80, 0.40, 0.44, 0.80, 2.6, 2.6),
    (7.10, 0.05, 0.40, 0.30, 0.30, 0.40, 2.2, 2.2),
    (7.30, 0.05, 0.12, 0.10, 0.10, 0.12, 2.0, 2.0),
]
# Kidney intakes low on the sides, the outboard edge swept back, the top leaning in.
INTAKE = [
    (-2.30, 0.68, -0.40, 0.34, 0.36, 3.0, 2.0, 0.0, 0.30, 0.0, 1.0, -0.15),
    (-1.60, 0.70, -0.40, 0.34, 0.38, 3.0, 2.2),
    (0.50, 0.60, -0.32, 0.30, 0.38, 2.4, 2.4),
]
CANOPY = [
    (-5.65, 0.42, 0.05, 0.06), (-5.30, 0.40, 0.30, 0.34), (-4.80, 0.40, 0.42, 0.62), (-4.10, 0.42, 0.46, 0.72),
    (-3.40, 0.46, 0.42, 0.62), (-2.80, 0.50, 0.32, 0.40), (-2.30, 0.54, 0.18, 0.18), (-2.00, 0.56, 0.05, 0.06),
]
SPINE = [(-2.40, 0.52, 0.30, 0.26), (-0.50, 0.52, 0.44, 0.22), (2.50, 0.50, 0.40, 0.16), (5.00, 0.46, 0.28, 0.10),
         (6.60, 0.42, 0.14, 0.04)]
WING_Y = -0.15


def wing_surface():
    le = lambda s: -0.60 + (s - 0.95) * 1.11  # 48 degrees
    return wing(0.75, 5.40, (le(0.75), le(5.40)), (5.70, 5.55), (0.28, 0.06), WING_Y, J.wing_uv, hinge=(0.86, 0.70))


def canard_surface():
    return wing(0.70, 2.25, (-2.60, -1.05), (-1.05, -0.45), (0.12, 0.04), 0.12, J.stab_uv)


def fin_surface():
    return fin(0.0, 2.80, (2.60, 5.30), (6.55, 6.35), (0.22, 0.07), J.fin_uv, x0=0.0, y0=0.55, hinge=(0.76, 0.66))


def build():
    root = Part(NAME)
    air = Part("airframe")
    half = Part("half")

    fuselage(air, FUSE, J.FUSE, nu=6, nl=6, role=lambda i: "secondary" if i < 2 else "body")
    tube(air, (0, -0.05, -8.10), (0, -0.05, -7.70), [0.01, 0.025], 4, "metal", lambda a, l: missile_uv(0.5, 0.5))
    tube(air, (0.40, 0.36, -6.90), (0.40, 0.36, -4.60), [0.0, 0.05, 0.06, 0.07], 6, "secondary", at=[0.0, 0.05, 0.6, 1.0])  # probe
    bubble(air, SPINE, lambda c, z: J.fuse(z, 0.02 + 0.2 * c), seg=6, role="body")
    duct(half, INTAKE, J.duct_uv, seg=14, lip=0.05, depth=0.9, wall="dark")

    w = wing_surface()
    cuts = [("flap_r", 1.00, 3.00, {"role": "stab"}), ("aileron_r", 3.00, 5.10, {"role": "aileron"})]
    surfaces = w.build(half, [2.0, 4.0], cuts)
    w.decal(half, 3.80, 0.52, 0.36, 1, insignia)
    w.decal(half, 3.80, 0.52, 0.36, -1, insignia)
    block(half, (5.46, WING_Y, 3.60), (0.10, 0.12, 2.6), "secondary", J.wing_uv)  # tip rail
    from parts import plate
    plate(half, [(3.30, WING_Y - 0.06, 0.70), (3.30, WING_Y - 0.06, 3.20), (3.30, WING_Y - 0.30, 3.00), (3.30, WING_Y - 0.30, 0.90)],
          "secondary", J.wing_uv, thick=0.08)

    canard = stabilator(canard_surface(), (0.70, 0.12, -1.60), (1.0, 0.0, 0.0), name="canard_r", role="canard")

    air.add(half).add(half.mirrored("half_l"))
    f = fin_surface()
    rudder = f.build(air, [2.50], [("rudder", 0.30, 2.20, {"role": "rudder"})],
                     role=lambda s: "stripe" if s > 2.50 else "body")[0]
    for side in (1, -1):
        f.patch(air, 1.10, 1.60, 4.40, 5.40, side, A.NUMBER)
    nozzles(air, (-0.48, 0.48), 6.30, 7.45, 0.44, 0.40, 0.02, seg=14)

    tip = store((5.48, WING_Y, 2.00), **MICA)
    under = store((3.30, WING_Y - 0.40, 0.90), **MICA)
    meteor = store((0.60, -0.78, -0.70), **METEOR)
    stores = firing_order([tip.mirrored(), tip, under.mirrored(), under, meteor.mirrored(), meteor])

    cano = Part("canopy", (0.0, 0.60, -2.0), {"role": "canopy"})
    bubble(cano, CANOPY, glass_uv, seg=8, frame_at=-5.10)

    root.children = [air, cano]
    for p in surfaces:
        root.children += [p, p.mirrored()]
    root.children += [canard, canard.mirrored(), rudder]
    root.children.append(gear(
        dict(z=-4.60, top=-0.55, r=0.26, fold=-1),
        dict(x=1.40, z=1.40, top=-0.30, r=0.40, xw=1.52, fold=1, brace=(1.10, -0.40, 0.80)),
        nose_door=dict(x=0.22, y=-0.56, z0=-5.2, z1=-3.9, depth=0.34),
        main_door=dict(x=1.80, y=-0.25, z0=0.6, z1=2.1, depth=0.50)))
    root.children += stores
    engines(root, [(-0.48, 0.02, 7.45, 0.38), (0.48, 0.02, 7.45, 0.38)])
    return root


def texture():
    cv = A.Canvas()
    paint_fuselage(cv, J,
                   frames=[(-6.3, 0, 1), (-5.4, 0, 0.5), (-2.4, 0, 1), (-0.4, 0, 0.5), (1.6, 0, 1), (3.8, 0, 1), (5.8, 0, 1)],
                   longerons=[(0.5, -6.0, 7.0), (0.30, -2.2, 6.0), (0.78, -4.0, 6.6)],
                   panels=[(-1.8, -0.6, 0.04, 0.16), (0.6, 1.8, 0.04, 0.16), (2.4, 3.6, 0.30, 0.42), (-4.6, -3.6, 0.60, 0.72)],
                   soot_from=6.2)
    w = wing_surface()
    paint_surface(cv, J.WING, w, chords=[(0.15, 1.0, 5.3), (0.45, 1.0, 5.2)], spans=[1.0, 2.0, 3.0, 4.0, 5.1], hinge_spans=(1.0, 5.1))
    paint_surface(cv, J.FIN, fin_surface(), chords=[(0.40, 0.2, 2.6)], spans=[0.3, 1.3, 2.2], hinge_spans=(0.3, 2.2),
                  height=lambda s: 0.55 + s)
    paint_surface(cv, J.STAB, canard_surface(), chords=[(0.4, 0.8, 2.2)], spans=[1.4])
    paint_common(cv, ("", "113"))
    return cv
