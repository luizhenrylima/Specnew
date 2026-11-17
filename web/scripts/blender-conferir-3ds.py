# Confere em lote os .3ds gerados: reimporta cada um e compara a contagem de faces com o FBX do mesmo produto.
# blender.exe -b -P blender-conferir-3ds.py -- <pasta conversao>
import bpy
import os
import sys

bpy.ops.preferences.addon_enable(module="bl_ext.user_default.autodesk_3ds_format")
base = sys.argv[sys.argv.index("--") + 1]


def faces(importar, caminho):
    bpy.ops.wm.read_homefile(use_empty=True)
    importar(filepath=caminho)
    return sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type == "MESH")


ruins = 0
for slug in sorted(os.listdir(base)):
    tds = os.path.join(base, slug, "3ds", f"{slug}.3ds")
    fbx = os.path.join(base, slug, "fbx", f"{slug}.fbx")
    if not os.path.exists(tds):
        continue
    a, b = faces(bpy.ops.import_scene.max3ds, tds), faces(bpy.ops.import_scene.fbx, fbx)
    if a == 0 or abs(a - b) > b * 0.02:
        ruins += 1
        print(f"3DS-RUIM {slug}: 3ds {a} faces x fbx {b}", flush=True)
print(f"3DS-RESUMO problemas: {ruins}", flush=True)
