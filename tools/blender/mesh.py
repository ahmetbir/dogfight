"""Faces collected in game space, turned into Blender objects.

Game space is the client's model space: x right wing, y up, z toward the tail
(nose toward -z), metres. Blender is z-up, so a game point (x, y, z) becomes
(x, -z, y); the glTF exporter's +Y-up conversion turns that back into game
space in the .glb.
"""
import math

import bpy

ROLES = ("body", "secondary", "stripe", "canopy", "dark", "metal")


def to_blender(p):
    x, y, z = p
    return (x, -z, y)


class Part:
    """One glTF node: faces (game-space corners, a material role, one UV per corner).

    origin is the node's pivot in game space (hinges, gear legs); props become
    the node's glTF extras (three.js userData).
    """

    def __init__(self, name, origin=(0.0, 0.0, 0.0), props=None):
        self.name = name
        self.origin = tuple(origin)
        self.props = dict(props or {})
        self.faces = []
        self.children = []

    def face(self, pts, role, uvs):
        assert role in ROLES, role
        assert len(pts) == len(uvs) >= 3
        self.faces.append((tuple(tuple(p) for p in pts), role, tuple(tuple(u) for u in uvs)))

    def quad_strip(self, a, b, role, ua, ub):
        """Quads between two point rows a and b (same length) with matching UV rows."""
        for i in range(len(a) - 1):
            self.face((a[i], a[i + 1], b[i + 1], b[i]), role, (ua[i], ua[i + 1], ub[i + 1], ub[i]))

    def add(self, other):
        """Takes over other's faces (same pivot space)."""
        self.faces.extend(other.faces)
        return self

    def mirrored(self, name=None, props=None):
        """A copy reflected across x = 0 (winding reversed so faces still point out)."""
        m = Part(name or mirror_name(self.name), (-self.origin[0], self.origin[1], self.origin[2]), mirror_props(props if props is not None else self.props))
        for pts, role, uvs in self.faces:
            m.faces.append((tuple((-x, y, z) for x, y, z in reversed(pts)), role, tuple(reversed(uvs))))
        m.children = [c.mirrored(mirror_name(c.name)) for c in self.children]
        return m

    def mirror_into(self):
        """Adds the mirror image of every face to this part (symmetric parts)."""
        self.faces.extend(Part.mirrored(self).faces)
        return self

    def triangles(self):
        return sum(len(_clean(f[0])) - 2 for f in self.faces if len(_clean(f[0])) >= 3) + sum(c.triangles() for c in self.children)


def mirror_name(name):
    """aileron_r -> aileron_l and back; other names unchanged."""
    if name.endswith("_r"):
        return name[:-2] + "_l"
    if name.endswith("_l"):
        return name[:-2] + "_r"
    return name


def mirror_props(props):
    """A rotation axis reflected across x = 0 is (x, -y, -z) with the same angle."""
    out = dict(props)
    for k in ("axis", "retract"):
        if k in out:
            v = list(out[k])
            v[1], v[2] = -v[1], -v[2]
            out[k] = [round(c, 4) + 0.0 for c in v]
    return out


def _key(p):
    return tuple(round(c, 5) for c in p)


def _clean(pts):
    """Drops repeated corners (collapsed ring points) so degenerate quads become triangles."""
    out = []
    for p in pts:
        k = _key(p)
        if not out or _key(out[-1]) != k:
            out.append(p)
    while len(out) > 1 and _key(out[0]) == _key(out[-1]):
        out.pop()
    return out


def _clean_uv(pts, uvs):
    out_p, out_u = [], []
    for p, u in zip(pts, uvs):
        if not out_p or _key(out_p[-1]) != _key(p):
            out_p.append(p)
            out_u.append(u)
    while len(out_p) > 1 and _key(out_p[0]) == _key(out_p[-1]):
        out_p.pop()
        out_u.pop()
    return out_p, out_u


def build_object(part, materials, parent=None, flat=True, parent_origin=(0.0, 0.0, 0.0)):
    """Creates the Blender object for part (and its children) and returns it."""
    verts, index, faces, face_roles, loop_uvs = [], {}, [], [], []
    ox, oy, oz = part.origin
    for pts, role, uvs in part.faces:
        pts, uvs = _clean_uv(pts, uvs)
        if len(pts) < 3:
            continue
        ids = []
        for p in pts:
            k = _key(p)
            if k not in index:
                index[k] = len(verts)
                verts.append(to_blender((p[0] - ox, p[1] - oy, p[2] - oz)))
            ids.append(index[k])
        if len(set(ids)) < 3:
            continue
        faces.append(ids)
        face_roles.append(role)
        loop_uvs.extend(uvs)
    roles = [r for r in ROLES if r in face_roles]
    if faces:
        me = bpy.data.meshes.new(part.name)
        me.from_pydata(verts, [], faces)
        uv = me.uv_layers.new(name="UVMap")
        for i, u in enumerate(loop_uvs):
            uv.data[i].uv = u
        for r in roles:
            me.materials.append(materials[r])
        for poly, r in zip(me.polygons, face_roles):
            poly.material_index = roles.index(r)
            poly.use_smooth = not flat
        me.validate()
        ob = bpy.data.objects.new(part.name, me)
    else:
        ob = bpy.data.objects.new(part.name, None)
        ob.empty_display_size = 0.3
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    px, py, pz = parent_origin
    ob.location = to_blender((ox - px, oy - py, oz - pz))
    for k, v in part.props.items():
        ob[k] = v
    for c in part.children:
        build_object(c, materials, ob, flat, part.origin)
    return ob


def unit(v):
    n = math.sqrt(sum(c * c for c in v))
    return tuple(c / n for c in v)
