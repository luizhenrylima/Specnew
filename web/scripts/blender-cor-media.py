# Cor média do centro de cada foto (sem a etiqueta na lateral nem o reflexo nas bordas), em hex sRGB.
# blender.exe -b -P blender-cor-media.py -- <saida.json> <foto> [<foto> ...]
import json
import os
import sys

import bpy
import numpy as np

args = sys.argv[sys.argv.index("--") + 1:]
saida, fotos = args[0], args[1:]
res = {}
for f in fotos:
    img = bpy.data.images.load(f)
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[:, :, :3]
    bpy.data.images.remove(img)
    c = a[int(h * .3):int(h * .7), int(w * .35):int(w * .75)].reshape(-1, 3)
    m = np.median(c, axis=0)
    res[os.path.basename(f)] = "#%02x%02x%02x" % tuple(int(round(max(0, min(1, v)) * 255)) for v in m)
json.dump(res, open(saida, "w"), indent=1)
print("CORES", len(res))
