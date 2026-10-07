"""Su-30: the Su-27 airframe (kinds/su27) with canards on the LERX, the
longer two-seat canopy, the IRST ball ahead of it, and a six-missile load.
True metres (21.9 m long, 14.7 m span), nose toward -z.
"""
import atlas as A
from mesh import Part
from parts import bubble, firing_order, store, tube
from kinds import su27
from kinds._jet import R27, R73, R77, glass_uv, stabilator, wing

NAME = "su30"

J = su27.J
CANOPY = [  # longer two-seat bubble
    (-7.05, 0.42, 0.07, 0.10), (-6.60, 0.38, 0.38, 0.50), (-6.00, 0.36, 0.52, 0.92), (-5.20, 0.38, 0.56, 1.08),
    (-4.30, 0.42, 0.56, 1.12), (-3.40, 0.50, 0.50, 0.96), (-2.70, 0.58, 0.38, 0.64), (-2.10, 0.64, 0.20, 0.30),
    (-1.70, 0.66, 0.06, 0.10),
]


def canard_surface():
    return wing(0.80, 3.20, (-5.70, -3.05), (-3.95, -2.40), (0.14, 0.04), su27.WING_Y + 0.20, J.stab_uv)


def build():
    root = su27.build()
    root.name = NAME
    root.children = [c for c in root.children if c.name != "canopy" and not c.name.startswith("msl_")]
    air = next(c for c in root.children if c.name == "airframe")
    tube(air, (0.26, 0.50, -7.70), (0.26, 0.50, -7.25), [0.0, 0.10, 0.12, 0.10, 0.04], 8, "dark",
         at=[0.0, 0.25, 0.5, 0.8, 1.0])  # IRST ball

    canard = stabilator(canard_surface(), (0.80, su27.WING_Y + 0.20, -4.40), (1.0, 0.0, 0.0), name="canard_r", role="canard")

    r73 = store((7.12, su27.WING_Y - 0.14, 1.70), **R73)
    r27 = store((5.00, -0.50, 0.30), **R27)
    r77 = store((1.30, -1.45, -1.80), **R77)
    stores = firing_order([r73.mirrored(), r73, r27.mirrored(), r27, r77.mirrored(), r77])

    cano = Part("canopy", (0.0, 0.70, -1.7), {"role": "canopy"})
    bubble(cano, CANOPY, glass_uv, seg=8, frame_at=[-6.45, -4.55])

    root.children += [cano, canard, canard.mirrored()] + stores
    return root


def texture():
    cv = su27.texture()
    x, y, w, h = A.NUMBER
    cv.rect(x, y, x + w, y + h, (1.0, 1.0, 1.0))  # repaint the number slot
    cv.text("02", x + 4, y + 13, 0.3)
    return cv

