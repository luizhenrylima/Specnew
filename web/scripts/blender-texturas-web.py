# Gera versões para a web das texturas de acabamento: <nome>.jpg (máx. 2048 px) e <nome>-mini.jpg (256 px).
# blender.exe -b -P blender-texturas-web.py -- lista.txt
# lista.txt: uma linha "entrada|saida_base" por textura (saida_base sem extensão).
import os
import sys

import bpy

lista = sys.argv[sys.argv.index("--") + 1]
cena = bpy.context.scene
cena.render.image_settings.file_format = "JPEG"
cena.render.image_settings.quality = 85
cena.render.image_settings.color_mode = "RGB"
cena.view_settings.view_transform = "Standard"  # sem isso o save_render aplica AgX e muda as cores
cena.view_settings.look = "None"

with open(lista, encoding="utf-8") as f:
    itens = [l.strip().split("|") for l in f if l.strip()]

for entrada, saida in itens:
    try:
        os.makedirs(os.path.dirname(saida), exist_ok=True)
        for sufixo, maximo in (("", 2048), ("-mini", 256)):
            img = bpy.data.images.load(entrada)
            w, h = img.size
            fator = min(1.0, maximo / max(w, h))
            if fator < 1:
                img.scale(max(1, round(w * fator)), max(1, round(h * fator)))
            img.save_render(saida + sufixo + ".jpg", scene=cena)
            bpy.data.images.remove(img)
        print(f"OK {saida}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"ERRO {entrada}: {e}", flush=True)
