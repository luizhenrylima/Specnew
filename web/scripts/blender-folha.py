# Junta imagens do mesmo tamanho numa folha (grade de N colunas), para conferência visual.
# blender.exe -b -P blender-folha.py -- <saida.png> <colunas> <img1.png> <img2.png> ...
import sys
import bpy
import numpy as np
a = sys.argv[sys.argv.index("--") + 1:]
saida, cols, imgs = a[0], int(a[1]), a[2:]
qs = []
for f in imgs:
    im = bpy.data.images.load(f)
    w, h = im.size
    qs.append(np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4))
    bpy.data.images.remove(im)
h, w = qs[0].shape[:2]
lin = (len(qs) + cols - 1) // cols
folha = np.ones((lin * h, cols * w, 4), dtype=np.float32)
for k, q in enumerate(qs):
    r, c = divmod(k, cols)
    y0 = (lin - 1 - r) * h
    folha[y0:y0 + h, c * w:(c + 1) * w] = q[:h, :w]
    folha[y0:y0 + h, c * w:c * w + 2] = 0  # divisória
out = bpy.data.images.new("folha", cols * w, lin * h, alpha=True)
out.pixels = folha.ravel()
out.filepath_raw = saida
out.file_format = "PNG"
out.save()
