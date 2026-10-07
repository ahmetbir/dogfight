"""Eurofighter Typhoon: long slightly drooped nose, bubble canopy, canards
well forward under the cockpit, the wide "smiling" chin intake split in two
(lower lip forward) feeding a broad flat belly, a 53-degree cropped delta
with two elevons a side and tip pods, a big single fin, two nozzles close
together, four Meteors semi-recessed on the belly corners. True metres
(16.0 m long, 11.0 m span), nose toward -z.
"""
import atlas as A
from mesh import Part
from parts import bubble, duct, firing_order, fuselage, plate, store, tube
from kinds._jet import (IRIST, METEOR, Jet, engines, fin, gear, glass_uv, insignia, missile_uv, nozzles,
                        paint_common, paint_fuselage, paint_surface, stabilator, wing)

NAME = "typhoon"

J = Jet(length=(-8.15, 7.90), wing=(-2.0, 6.7, 0.4, 5.7), fin=(2.4, 7.0, 3.50, 0.40), stab=(-5.0, -1.9, 0.4, 2.4))

FUSE = [  # z, cy, w, ht, hb, wb, eu, el
    (-8.15, -0.15, 0.02, 0.02, 0.02, 0.02, 2.0, 2.0),
    (-7.60, -0.13, 0.20, 0.20, 0.19, 0.19, 2.0, 2.0),
    (-6.70, -0.08, 0.36, 0.36, 0.35, 0.35, 2.0, 2.0),
    (-5.60, -0.03, 0.47, 0.48, 0.47, 0.47, 2.1, 2.1),
    (-4.40, 0.00, 0.53, 0.56, 0.54, 0.53, 2.3, 2.3),
    (-3.00, 0.00, 0.57, 0.60, 0.50, 0.57, 2.5, 2.5),
    (-1.00, 0.00, 0.70, 0.60, 0.48, 0.70, 2.8, 2.8),
    (1.50, 0.00, 0.88, 0.56, 0.56, 0.88, 3.0, 3.0),
    (4.00, 0.00, 0.92, 0.52, 0.56, 0.92, 3.0, 3.0),
    (6.20, 0.00, 0.86, 0.46, 0.52, 0.86, 2.8, 2.8),
    (7.20, 0.00, 0.40, 0.30, 0.30, 0.40, 2.2, 2.2),
    (7.40, 0.00, 0.12, 0.10, 0.10, 0.12, 2.0, 2.0),
]
# Chin intake: wide, the top edge rising to the corners, the lower lip forward;
# the trunk becomes the flat belly. z, cx, cy, hw, hh, et, eb, rake, sweep, smile
INTAKE = [
    (-2.90, 0.0, -0.80, 0.78, 0.32, 3.0, 4.0, 0.30, 0.0, 0.10),
    (-2.10, 0.0, -0.76, 0.80, 0.36, 3.0, 3.5),
    (0.50, 0.0, -0.62, 0.82, 0.40, 2.8, 3.0),
    (3.00, 0.0, -0.50, 0.80, 0.36, 2.6, 2.8),
    (5.40, 0.0, -0.34, 0.74, 0.30, 2.4, 2.4),
]
CANOPY = [
    (-6.10, 0.40, 0.05, 0.06), (-5.75, 0.38, 0.30, 0.34), (-5.20, 0.38, 0.42, 0.62), (-4.50, 0.40, 0.46, 0.74),
    (-3.80, 0.44, 0.42, 0.66), (-3.20, 0.48, 0.32, 0.44), (-2.70, 0.52, 0.18, 0.20), (-2.40, 0.54, 0.05, 0.06),
]
SPINE = [(-2.80, 0.50, 0.30, 0.28), (-0.80, 0.50, 0.44, 0.24), (2.50, 0.48, 0.40, 0.16), (5.20, 0.44, 0.28, 0.10),
         (6.80, 0.40, 0.12, 0.04)]
WING_Y = -0.20


def wing_surface():
    le = lambda s: -1.00 + (s - 0.85) * 1.33  # 53 degrees
    return wing(0.70, 5.47, (le(0.70), le(5.47)), (6.60, 6.45), (0.26, 0.06), WING_Y, J.wing_uv, hinge=(0.88, 0.72))


def canard_surface():
    return wing(0.45, 2.25, (-4.90, -2.50), (-3.40, -2.00), (0.12, 0.04), -0.05, J.stab_uv)


def fin_surface():
    return fin(0.0, 2.95, (2.70, 5.45), (6.90, 6.60), (0.22, 0.07), J.fin_uv, x0=0.0, y0=0.50, hinge=(0.76, 0.66))


def build():
    root = Part(NAME)
    air = Part("airframe")
    half = Part("half")

    fuselage(air, FUSE, J.FUSE, nu=6, nl=6, role=lambda i: "secondary" if i < 2 else "body")
    tube(air, (0, -0.15, -8.55), (0, -0.15, -8.10), [0.01, 0.025], 4, "metal", lambda a, l: missile_uv(0.5, 0.5))
    bubble(air, SPINE, lambda c, z: J.fuse(z, 0.02 + 0.2 * c), seg=6, role="body")
    duct(air, INTAKE, J.duct_uv, seg=20, lip=0.05, depth=0.9, wall="dark")
    plate(air, [(0.0, -0.50, -2.75), (0.0, -0.50, -1.80), (0.0, -1.06, -1.80), (0.0, -1.06, -3.10)], "secondary", thick=0.05)  # splitter

    w = wing_surface()
    cuts = [("flap_r", 1.10, 3.10, {"role": "stab"}), ("aileron_r", 3.10, 5.20, {"role": "aileron"})]
    surfaces = w.build(half, [2.1, 4.2], cuts)
    w.decal(half, 3.90, 0.55, 0.36, 1, insignia)
    w.decal(half, 3.90, 0.55, 0.36, -1, insignia)
    tube(half, (5.50, WING_Y, 4.40), (5.50, WING_Y, 7.10), [0.0, 0.10, 0.12, 0.12, 0.08], 6, "secondary",
         at=[0.0, 0.2, 0.4, 0.85, 1.0])  # tip pod
    plate(half, [(4.30, WING_Y - 0.06, 3.20), (4.30, WING_Y - 0.06, 5.00), (4.30, WING_Y - 0.30, 4.80), (4.30, WING_Y - 0.30, 3.40)],
          "secondary", J.wing_uv, thick=0.08)

    canard = stabilator(canard_surface(), (0.45, -0.05, -3.50), (1.0, 0.0, 0.0), name="canard_r", role="canard")

    air.add(half).add(half.mirrored("half_l"))
    f = fin_surface()
    rudder = f.build(air, [2.60], [("rudder", 0.30, 2.30, {"role": "rudder"})],
                     role=lambda s: "stripe" if s > 2.60 else "body")[0]
    for side in (1, -1):
        f.patch(air, 1.10, 1.60, 4.60, 5.60, side, A.NUMBER)
    nozzles(air, (-0.47, 0.47), 6.70, 7.90, 0.44, 0.40, -0.02, seg=14)

    iris = store((4.30, WING_Y - 0.40, 2.80), **IRIST)
    front = store((0.80, -0.92, -1.20), **METEOR)
    rear = store((0.80, -0.86, 2.20), **METEOR)
    stores = firing_order([iris.mirrored(), iris, front.mirrored(), front, rear.mirrored(), rear])

    cano = Part("canopy", (0.0, 0.60, -2.4), {"role": "canopy"})
    bubble(cano, CANOPY, glass_uv, seg=8, frame_at=-5.50)

    root.children = [air, cano]
    for p in surfaces:
        root.children += [p, p.mirrored()]
    root.children += [canard, canard.mirrored(), rudder]
    root.children.append(gear(
        dict(z=-4.40, top=-0.55, r=0.26, fold=-1),
        dict(x=1.30, z=1.70, top=-0.55, r=0.40, xw=1.42, fold=1, brace=(1.00, -0.62, 1.10)),
        nose_door=dict(x=0.22, y=-0.56, z0=-5.0, z1=-3.8, depth=0.34),
        main_door=dict(x=1.70, y=-0.40, z0=0.9, z1=2.4, depth=0.50)))
    root.children += stores
    engines(root, [(-0.47, -0.02, 7.90, 0.38), (0.47, -0.02, 7.90, 0.38)])
    return root


def texture():
    cv = A.Canvas()
    paint_fuselage(cv, J,
                   frames=[(-6.7, 0, 1), (-5.8, 0, 0.5), (-2.6, 0, 1), (-0.4, 0, 0.5), (1.8, 0, 1), (4.0, 0, 1), (6.0, 0, 1)],
                   longerons=[(0.5, -6.4, 7.2), (0.30, -2.4, 6.2), (0.78, -4.4, 6.8)],
                   panels=[(-1.8, -0.6, 0.04, 0.16), (0.6, 1.8, 0.04, 0.16), (2.4, 3.6, 0.30, 0.42), (-5.0, -4.0, 0.60, 0.72)],
                   soot_from=6.6)
    w = wing_surface()
    paint_surface(cv, J.WING, w, chords=[(0.15, 1.0, 5.4), (0.45, 1.0, 5.3)], spans=[1.1, 2.1, 3.1, 4.2, 5.2], hinge_spans=(1.1, 5.2))
    paint_surface(cv, J.FIN, fin_surface(), chords=[(0.40, 0.2, 2.7)], spans=[0.3, 1.3, 2.3], hinge_spans=(0.3, 2.3),
                  height=lambda s: 0.50 + s)
    paint_surface(cv, J.STAB, canard_surface(), chords=[(0.4, 0.6, 2.2)], spans=[1.3])
    paint_common(cv, ("", "3101"))
    return cv
