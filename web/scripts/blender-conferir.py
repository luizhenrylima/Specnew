# Confere arquivos exportados: reimporta no Blender e imprime medidas (cm) e texturas encontradas.
# blender.exe -b -P blender-conferir.py -- arquivo1 arquivo2 ...
import bpy
import sys
from mathutils import Vector

try:
    bpy.ops.preferences.addon_enable(module="bl_ext.user_default.autodesk_3ds_format")
except Exception:
    pass

for caminho in sys.argv[sys.argv.index("--") + 1:]:
    bpy.ops.wm.read_homefile(use_empty=True)
    ext = caminho.lower().rsplit(".", 1)[-1]
    if ext == "fbx":
        bpy.ops.import_scene.fbx(filepath=caminho)
    elif ext == "dae":
        bpy.ops.wm.collada_import(filepath=caminho)
    elif ext == "3ds":
        bpy.ops.import_scene.max3ds(filepath=caminho)
    pts = [ob.matrix_world @ Vector(c) for ob in bpy.context.scene.objects if ob.type == "MESH" for c in ob.bound_box]
    if not pts:
        print(f"CONFERIR {ext}: sem malha"); continue
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    d = (mx - mn) * 100
    imgs = [i.name for i in bpy.data.images if i.has_data]
    tris = sum(len(ob.data.polygons) for ob in bpy.context.scene.objects if ob.type == "MESH")
    print(f"CONFERIR {ext}: {d.x:.1f} x {d.y:.1f} x {d.z:.1f} cm (X,Y,Z) | faces {tris} | texturas carregadas {len(imgs)}")
