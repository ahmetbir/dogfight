"""Preview renders of the built scene (EEVEE, soft flat light) from four angles."""
import math
import os

import bpy
from mathutils import Vector

from mesh import to_blender

# name: (direction from the jet to the camera in game space, gear down, surfaces deflected)
VIEWS = {
    "front34": ((-1.0, 0.55, -1.25), True, False),
    "side": ((1.0, 0.06, 0.0), True, False),
    "top": ((0.0, 1.0, 0.02), False, False),
    "front": ((0.0, 0.12, -1.0), True, False),
    "rear34": ((0.95, 0.45, 1.3), False, True),
}
DEFLECT = {"aileron_r": -0.35, "aileron_l": 0.35, "flap_r": 0.3, "flap_l": 0.3, "stab_r": -0.25, "stab_l": -0.12, "rudder": 0.3}


def setup(scene):
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1280, 800
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Standard"
    scene.eevee.taa_render_samples = 16
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    nt = world.node_tree
    light = nt.nodes["Background"]  # what the jet is lit by
    light.inputs[0].default_value = (0.42, 0.50, 0.60, 1.0)
    backdrop = nt.nodes.new("ShaderNodeBackground")  # what the camera sees behind it
    backdrop.inputs[0].default_value = (0.07, 0.08, 0.10, 1.0)
    mix = nt.nodes.new("ShaderNodeMixShader")
    path = nt.nodes.new("ShaderNodeLightPath")
    nt.links.new(path.outputs["Is Camera Ray"], mix.inputs[0])
    nt.links.new(light.outputs[0], mix.inputs[1])
    nt.links.new(backdrop.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], nt.nodes["World Output"].inputs[0])
    scene.world = world
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.0
    sun.angle = math.radians(8)
    ob = bpy.data.objects.new("sun", sun)
    ob.rotation_euler = (math.radians(40), math.radians(-25), math.radians(30))
    scene.collection.objects.link(ob)
    cam = bpy.data.cameras.new("cam")
    cam.lens = 85
    cam.clip_end = 500
    co = bpy.data.objects.new("cam", cam)
    scene.collection.objects.link(co)
    scene.camera = co
    return co


def pose(gear_down, deflect):
    gear = bpy.data.objects.get("gear")
    for ob in [gear] + list(gear.children_recursive):
        ob.hide_render = not gear_down
    for name, a in DEFLECT.items():
        ob = bpy.data.objects.get(name)
        if ob is None or "axis" not in ob:
            continue
        ax = to_blender(tuple(ob["axis"]))
        ob.rotation_mode = "AXIS_ANGLE"
        ob.rotation_axis_angle = (a if deflect else 0.0, *ax)


def shots(kind, out_dir):
    scene = bpy.context.scene
    cam = setup(scene)
    target = Vector((0.0, 0.0, -0.3))
    for name, (d, gear_down, deflect) in VIEWS.items():
        pose(gear_down, deflect)
        dv = Vector(to_blender(d)).normalized()
        cam.location = target + dv * (60.0 if name == "top" else 46.0)
        cam.rotation_euler = (-dv).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(out_dir, f"{kind}_{name}.png")
        bpy.ops.render.render(write_still=True)
    pose(True, False)
    for ob in (cam, bpy.data.objects["sun"]):
        bpy.data.objects.remove(ob)
