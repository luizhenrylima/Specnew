# Etapa 1 do SKP, dentro do Blender (sem janela). Para cada linha "entrada.glb|pasta_saida|nome" da lista,
# importa o GLB e grava <pasta_saida>/_skp/cena.json (+ texturas). A etapa 2 é skp-gerar.py.
#
# blender.exe -b -P blender-skp.py -- lista.txt
import os
import sys
import traceback

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from skp_exportar import extrair_cena  # noqa: E402

lista = sys.argv[sys.argv.index("--") + 1]
with open(lista, encoding="utf-8") as f:
    itens = [l.strip().split("|") for l in f if l.strip()]

for glb, pasta, nome in itens:
    try:
        bpy.ops.wm.read_homefile(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=glb)
        n = extrair_cena(os.path.join(pasta, "_skp"))
        print(f"OK {nome} {n} triangulos", flush=True)
    except Exception:
        print(f"ERRO {nome}\n{traceback.format_exc()}", flush=True)
