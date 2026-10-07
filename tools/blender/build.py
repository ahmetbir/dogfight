"""Builds the jets as .glb files. Run headless from the repo root:

    blender -b --factory-startup -P tools/blender/build.py -- f16 [--render DIR]
    blender -b --factory-startup -P tools/blender/build.py -- all

Each kind is tools/blender/kinds/<kind>.py: build() returns the node tree,
texture() the atlas. Output: client/static/models/<kind>.glb; run the client
build (or scripts/models-manifest.mjs) afterwards so the client lists it.
The same input always writes the same file.
"""
import importlib
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402

import atlas  # noqa: E402
from mesh import ROLES, build_object  # noqa: E402

REPO = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(REPO, "client", "static", "models")
MAX_TRIS, MAX_BYTES = 4000, 150 * 1024
REQUIRED = ("airframe", "canopy", "aileron_l", "aileron_r", "flap_l", "flap_r", "gear", "ab_0", "idle_0")

# Colour factors per role. The client recolours body/secondary/stripe per team
# and skin; canopy, dark and metal keep these.
COLORS = {
    "body": (0.33, 0.37, 0.42),
    "secondary": (0.21, 0.24, 0.28),
    "stripe": (0.05, 0.16, 0.69),
    "canopy": (0.16, 0.11, 0.035),
    "dark": (0.025, 0.028, 0.032),
    "metal": (0.45, 0.47, 0.50),
}


def kinds_from_args(argv):
    args = argv[argv.index("--") + 1:] if "--" in argv else []
    render = None
    if "--render" in args:
        i = args.index("--render")
        render = args[i + 1]
        args = args[:i] + args[i + 2:]
    kinds = args or ["all"]
    if kinds == ["all"]:
        kinds = sorted(f[:-3] for f in os.listdir(os.path.join(HERE, "kinds")) if f.endswith(".py") and not f.startswith("_"))
    return kinds, render


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_materials(kind, canvas):
    img = bpy.data.images.new(f"{kind}_atlas", atlas.SIZE, atlas.SIZE, alpha=False)
    img.pixels.foreach_set(canvas.floats())
    img.file_format = "PNG"
    img.pack()
    mats = {}
    for role in ROLES:
        m = bpy.data.materials.new(role)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.interpolation = "Closest"
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        nt.links.new(tex.outputs["Color"], mix.inputs[6])
        mix.inputs[7].default_value = (*COLORS[role], 1.0)
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.25 if role == "canopy" else 0.8
        bsdf.inputs["Metallic"].default_value = 0.0
        m.diffuse_color = (*COLORS[role], 1.0)
        m.use_backface_culling = True
        mats[role] = m
    return mats, img


def triangles(objs):
    n = 0
    for ob in objs:
        if ob.type == "MESH":
            ob.data.calc_loop_triangles()
            n += len(ob.data.loop_triangles)
    return n


def export(path):
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", export_yup=True, export_apply=False,
        export_normals=False, export_texcoords=True, export_tangents=False,
        export_materials="EXPORT", export_image_format="AUTO", export_extras=True,
        export_cameras=False, export_lights=False, export_animations=False,
        export_vertex_color="NONE", export_attributes=False, use_selection=False,
    )


def build(kind, render_dir):
    reset()
    mod = importlib.import_module(f"kinds.{kind}")
    tree = mod.build()
    canvas = mod.texture()
    mats, _ = make_materials(kind, canvas)
    build_object(tree, mats)
    objs = list(bpy.context.scene.objects)
    names = {o.name for o in objs}
    missing = [n for n in REQUIRED if n not in names]
    tris = triangles(objs)
    path = os.path.join(OUT, f"{kind}.glb")
    os.makedirs(OUT, exist_ok=True)
    export(path)
    size = os.path.getsize(path)
    if render_dir:  # after the export: renders pose the jet
        import render
        os.makedirs(render_dir, exist_ok=True)
        with open(os.path.join(render_dir, f"{kind}_atlas.png"), "wb") as f:
            f.write(canvas.png())
        render.shots(kind, render_dir)
    print(f"BUILD {kind}: {tris} triangles, {size} bytes -> {os.path.relpath(path, REPO)}")
    errors = []
    if missing:
        errors.append(f"missing nodes {missing}")
    if tris > MAX_TRIS:
        errors.append(f"{tris} triangles > {MAX_TRIS}")
    if size > MAX_BYTES:
        errors.append(f"{size} bytes > {MAX_BYTES}")
    return errors


def main():
    kinds, render_dir = kinds_from_args(sys.argv)
    failed = False
    for kind in kinds:
        for e in build(kind, render_dir):
            print(f"ERROR {kind}: {e}")
            failed = True
    sys.exit(1 if failed else 0)


main()
