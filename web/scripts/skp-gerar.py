# Etapa 2 do SKP, no Python que vem com o Blender (processo separado, sem bpy):
# para cada linha "entrada.glb|pasta_saida|nome" da lista, lê <pasta>/_skp/cena.json e grava <pasta>/skp/<nome>.skp,
# depois reabre o arquivo e confere medidas, faces e texturas.
#
# python.exe -I skp-gerar.py lista.txt <pasta do sketchup-sdk>
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from skp_exportar import conferir_skp, gerar_skp  # noqa: E402

lista, sdk = sys.argv[1], sys.argv[2]
with open(lista, encoding="utf-8") as f:
    itens = [l.strip().split("|") for l in f if l.strip()]

for _, pasta, nome in itens:
    try:
        saida = os.path.join(pasta, "skp", f"{nome}.skp")
        faces = gerar_skp(os.path.join(pasta, "_skp", "cena.json"), saida, nome, sdk)
        c = conferir_skp(saida)
        print(f"OK {nome} faces {faces}->{c['faces']} cm {c['cm']} materiais {c['materiais']} texturas {c['texturas']}", flush=True)
    except Exception:
        print(f"ERRO {nome}\n{traceback.format_exc()}", flush=True)
