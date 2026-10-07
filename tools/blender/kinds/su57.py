"""Su-57: long chined nose with an IRST ball ahead of a big bubble canopy,
a wide flat lifting body, widely spaced nacelles with raked intakes under the
LEVCONs, 48-degree wing, small all-moving fins canted out on the tail booms,
big all-moving stabilators, the long tail stinger between round nozzles,
missiles in the side and main bays. True metres (20.1 m long, 14.1 m span),
nose toward -z.
"""
import math

import atlas as A
from mesh import Part
from parts import bubble, duct, firing_order, fuselage, loft, plate, store, strake, tube
from kinds._jet import (R73, R77, Jet, engines, fin, gear, glass_uv, insignia, mirrored_rudder, missile_uv, nozzles,
                        paint_common, paint_fuselage, paint_surface, stabilator, wing)

NAME = "su57"

J = Jet(length=(-10.10, 10.30), wing=(-6.6, 5.8, 0.5, 7.2), fin=(5.0, 9.1, 2.75, 0.15), stab=(5.7, 9.9, 1.8, 4.8))

FUSE = [  # z, cy, w, ht, hb, wb, eu, el
    (-10.10, -0.15, 0.02, 0.02, 0.02, 0.02, 1.6, 1.8),
    (-9.40, -0.12, 0.30, 0.24, 0.22, 0.28, 1.6, 1.8),
    (-8.30, -0.06, 0.55, 0.42, 0.38, 0.48, 1.7, 1.9),
    (-7.00, 0.00, 0.72, 0.52, 0.50, 0.60, 1.8, 2.0),
    (-5.60, 0.00, 0.82, 0.58, 0.56, 0.64, 2.0, 2.2),
    (-4.00, 0.00, 0.92, 0.60, 0.56, 0.62, 2.2, 2.3),
    (-2.00, 0.00, 1.15, 0.60, 0.50, 0.70, 2.6, 2.4),
    (0.50, 0.00, 1.40, 0.56, 0.46, 0.80, 3.2, 2.6),
    (3.50, 0.00, 1.32, 0.50, 0.42, 0.75, 3.2, 2.6),
    (6.00, 0.00, 1.00, 0.42, 0.36, 0.60, 2.8, 2.4),
    (8.20, 0.00, 0.52, 0.32, 0.28, 0.40, 2.4, 2.2),
    (10.00, 0.00, 0.28, 0.20, 0.18, 0.24, 2.0, 2.0),
    (10.30, 0.00, 0.08, 0.06, 0.06, 0.06, 2.0, 2.0),
]
# Raked intakes: the top lip forward, the outboard edge swept back, wider on top.
NACELLE = [
    (-3.40, 1.10, -0.56, 0.48, 0.50, 9.0, 8.0, -0.45, 0.30, 0.0, 1.15),
    (-2.40, 1.10, -0.56, 0.50, 0.52, 6.0, 5.0),
    (1.00, 1.10, -0.53, 0.55, 0.56, 3.5, 3.0),
    (5.00, 1.10, -0.42, 0.56, 0.54, 2.6, 2.4),
    (7.80, 1.10, -0.30, 0.54, 0.52, 2.2, 2.2),
    (8.40, 1.10, -0.28, 0.52, 0.50, 2.0, 2.0),
]
CANOPY = [
    (-7.45, 0.44, 0.06, 0.08), (-7.00, 0.42, 0.34, 0.42), (-6.40, 0.40, 0.50, 0.78), (-5.60, 0.42, 0.54, 0.92),
    (-4.80, 0.46, 0.50, 0.84), (-4.10, 0.52, 0.40, 0.60), (-3.50, 0.56, 0.26, 0.34), (-3.00, 0.58, 0.08, 0.10),
]
SPINE = [(-3.70, 0.52, 0.34, 0.34), (-2.00, 0.52, 0.62, 0.34), (1.00, 0.48, 0.70, 0.30), (4.50, 0.42, 0.55, 0.20),
         (7.50, 0.34, 0.32, 0.08)]
LEVCON_OUT = [(0.92, -4.80), (1.30, -4.10), (1.75, -3.30), (2.25, -2.40), (2.75, -1.30)]
WING_Y = 0.05
FIN_X, FIN_Y, FIN_CANT = 1.85, 0.20, math.radians(26)


def wing_surface():
    le = lambda s: -1.30 + (s - 2.75) * 1.11  # 48 degrees
    te = lambda s: 5.00 + (7.05 - s) * 0.12
    return wing(1.60, 7.05, (le(1.60), le(7.05)), (te(1.60), te(7.05)), (0.30, 0.07), WING_Y, J.wing_uv, hinge=(0.84, 0.70))


def fin_surface(mirror=False):
    return fin(0.0, 2.75, (5.20, 7.75), (8.45, 8.95), (0.14, 0.05), J.fin_uv, x0=FIN_X, y0=FIN_Y, cant=FIN_CANT, mirror=mirror)


def stab_surface():
    return wing(1.90, 4.75, (5.90, 8.60), (9.70, 9.60), (0.16, 0.05), -0.12, J.stab_uv)


def build():
    root = Part(NAME)
    air = Part("airframe")
    half = Part("half")

    fuselage(air, FUSE, J.FUSE, nu=6, nl=6, role=lambda i: "secondary" if i < 2 else "body")
    tube(air, (0, -0.15, -10.30), (0, -0.15, -10.05), [0.01, 0.025], 4, "metal", lambda a, l: missile_uv(0.5, 0.5))
    bubble(air, SPINE, lambda c, z: J.fuse(z, 0.02 + 0.2 * c), seg=6, role="body")
    tube(air, (0.0, 0.50, -8.05), (0.0, 0.50, -7.55), [0.0, 0.11, 0.14, 0.12, 0.05], 8, "dark",
         at=[0.0, 0.25, 0.5, 0.8, 1.0])  # IRST ball
    duct(half, NACELLE, J.duct_uv, seg=16, lip=0.05, depth=1.1, wall="dark")
    strake(half, [(0.70, z) for _, z in LEVCON_OUT], LEVCON_OUT, WING_Y, 0.24, 0.20, J.wing_uv)

    w = wing_surface()
    cuts = [("flap_r", 2.10, 4.60, {"role": "flap"}), ("aileron_r", 4.60, 6.50, {"role": "aileron"})]
    surfaces = w.build(half, [2.75, 5.5], cuts)
    w.decal(half, 5.40, 0.40, 0.40, 1, insignia)
    w.decal(half, 5.40, 0.40, 0.40, -1, insignia)

    rings = []
    for z, k in ((4.2, 0.1), (5.2, 1.0), (9.5, 1.0), (10.0, 0.6)):
        rings.append([(1.85 + 0.24 * k * math.cos(t), -0.10 + 0.15 * k * math.sin(t), z) for t in [i / 6 * 2 * math.pi for i in range(6)]])
    loft(half, rings, [[J.fuse(p[2], 0.5) for p in r] for r in rings], "body", closed=True, cap_end="secondary")

    # All-moving fins on spindles: the whole fin is the rudder.
    c, sn = math.cos(FIN_CANT), math.sin(FIN_CANT)
    rudder = stabilator(fin_surface(), (FIN_X, FIN_Y, 7.0), (sn, c, 0.0), name="rudder_r", role="rudder")
    tip = Part("tip")
    f = fin_surface()
    f.decal(tip, 1.20, 0.42, 0.30, 1, insignia)
    f.decal(tip, 1.20, 0.42, 0.30, -1, insignia)
    for face in tip.faces:
        rudder.face(*face)

    st = stabilator(stab_surface(), (1.90, -0.12, 8.0), (1.0, 0.0, 0.0), stations=[3.3])

    air.add(half).add(half.mirrored("half_l"))
    nozzles(air, (-1.10, 1.10), 8.20, 9.40, 0.52, 0.46, -0.28)
    for x0, x1, z0, z1 in ((-0.50, 0.50, -2.20, 3.20),):  # main weapon bays
        plate(air, [(x0, -0.465, z0), (x1, -0.465, z0), (x1, -0.465, z1), (x0, -0.465, z1)], "dark")

    r73 = store((1.82, -0.40, -2.80), **R73)
    r77 = store((0.28, -0.60, -1.60), **R77)
    stores = firing_order([r73.mirrored(), r73, r77.mirrored(), r77])

    cano = Part("canopy", (0.0, 0.64, -3.0), {"role": "canopy"})
    bubble(cano, CANOPY, glass_uv, seg=8, frame_at=-4.40)

    root.children = [air, cano]
    for p in surfaces:
        root.children += [p, p.mirrored()]
    root.children += [st, st.mirrored(), rudder, mirrored_rudder(rudder)]
    root.children.append(gear(
        dict(z=-6.40, top=-0.55, r=0.28, twin=True, fold=-1),
        dict(x=1.70, z=1.90, top=-0.80, r=0.46, xw=1.84, fold=1, brace=(1.40, -0.90, 1.20)),
        nose_door=dict(x=0.26, y=-0.56, z0=-7.1, z1=-5.7, depth=0.40),
        main_door=dict(x=2.10, y=-0.50, z0=1.0, z1=2.8, depth=0.55)))
    root.children += stores
    engines(root, [(-1.10, -0.28, 9.40, 0.44), (1.10, -0.28, 9.40, 0.44)])
    return root


def texture():
    cv = A.Canvas()
    paint_fuselage(cv, J,
                   frames=[(-8.3, 0, 1), (-7.2, 0, 0.5), (-3.0, 0, 1), (-0.5, 0, 0.5), (2.2, 0, 1), (5.0, 0, 1), (7.6, 0, 1)],
                   longerons=[(0.5, -8.0, 10.0), (0.30, -3.0, 8.0), (0.78, -4.0, 9.0)],
                   panels=[(-2.4, -1.0, 0.04, 0.16), (0.5, 2.0, 0.04, 0.16), (3.0, 4.6, 0.30, 0.42), (-6.4, -5.2, 0.60, 0.72)],
                   soot_from=8.4)
    w = wing_surface()
    paint_surface(cv, J.WING, w, chords=[(0.12, 2.8, 6.9), (0.45, 2.8, 6.8)], spans=[2.1, 3.4, 4.6, 5.5, 6.5], hinge_spans=(2.1, 6.5))
    paint_surface(cv, J.FIN, fin_surface(), chords=[(0.45, 0.2, 2.5)], spans=[0.8, 1.8],
                  height=lambda s: FIN_Y + s * math.cos(FIN_CANT))
    paint_surface(cv, J.STAB, stab_surface(), chords=[(0.4, 2.0, 4.6)], spans=[3.3])
    paint_common(cv, ("", "51"))
    return cv
