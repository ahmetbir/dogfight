"""Renders every built jet side by side at true size (orthographic camera):
NATO on the top row, Soviet below, the matching pairs in one column.

    blender -b --factory-startup -P tools/blender/lineup.py -- OUT_DIR [--suffix -v1]

Writes OUT_DIR/lineup_top<suffix>.png and OUT_DIR/lineup_front34<suffix>.png.
"""
import math
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import render  # noqa: E402

MODELS = os.path.join(os.path.dirname(os.path.dirname(HERE)), "client", "static", "models")
ROWS = [  # (NATO, Soviet) pairs by role, one column each
    ("f16", "mig29"), ("f15", "su27"), ("f22", "su57"), ("f14", "mig31"), ("a10", "su25"),
    ("rafale", "mig21"), ("typhoon", None), ("f18", "su30"), ("f4", "mig23"),
]
GAP_X, GAP_Z = 22.0, 27.0


def args():
    a = sys.argv[sys.argv.index("--") + 1:]
    suffix = a[a.index("--suffix") + 1] if "--suffix" in a else ""
    return a[0], suffix


def place(kind, x, z):
    path = os.path.join(MODELS, f"{kind}.glb")
    if not os.path.exists(path):
        return
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        if o.parent is None:
            o.location = (x, -z, 0.0)  # game (x, z) -> Blender (x, -z)
        if o.name.startswith("gear"):
            o.hide_render = True
    label = bpy.data.curves.new(f"label_{kind}", "FONT")
    label.body = kind.upper()
    label.size = 2.2
    label.align_x = "CENTER"
    ob = bpy.data.objects.new(f"label_{kind}", label)
    ob["y_top"] = -(z + 12.5)  # under the jet in the top view
    ob["y_front"] = -(z - 12.5)  # ahead of the nose, seen from the front
    ob.location = (x, ob["y_top"], 0.0)
    bpy.context.scene.collection.objects.link(ob)


def main():
    out, suffix = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    cam = render.setup(scene)
    scene.render.resolution_x, scene.render.resolution_y = 2400, 900
    x0 = -(len(ROWS) - 1) / 2 * GAP_X
    for i, (nato, soviet) in enumerate(ROWS):
        x = x0 + i * GAP_X
        place(nato, x, -GAP_Z / 2)
        if soviet:
            place(soviet, x, GAP_Z / 2)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = len(ROWS) * GAP_X + 6
    labels = [o for o in bpy.data.objects if o.name.startswith("label_")]
    # top: nose up the image; front34: from ahead and above, the labels turned to face the camera.
    for name, d, turn in (("top", (0.0, 0.0, 1.0), 0.0), ("front34", (0.30, 1.0, 0.75), math.pi)):
        dv = Vector(d).normalized()
        cam.location = Vector((0.0, -1.0, 0.0)) + dv * 200
        cam.rotation_euler = (0.0, 0.0, 0.0) if name == "top" else (-dv).to_track_quat("-Z", "Y").to_euler()
        for o in labels:
            o.rotation_euler = (0.0, 0.0, turn)
            o.location.y = o["y_top"] if name == "top" else o["y_front"]
        scene.render.filepath = os.path.join(out, f"lineup_{name}{suffix}.png")
        bpy.ops.render.render(write_still=True)


main()
