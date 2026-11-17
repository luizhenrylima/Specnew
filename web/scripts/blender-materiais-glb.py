# Levanta os materiais de cada GLB (nome, nº de faces, caixa, cor, textura) e gera uma folha de imagens por produto:
# um quadro por material, com o material destacado em vermelho e o resto em cinza. Serve para ligar material -> parte.
#
# blender.exe -b -P blender-materiais-glb.py -- lista.txt <pasta de saída>
# lista.txt: uma linha "arquivo.glb|slug" por produto
import json
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
lista, saida = args[0], args[1]
os.makedirs(saida, exist_ok=True)
QUADRO = 260


def preparar_render():
    cena = bpy.context.scene
    cena.render.engine = "BLENDER_WORKBENCH"
    cena.display.shading.light = "STUDIO"
    cena.display.shading.color_type = "OBJECT"
    cena.display.shading.show_shadows = False
    cena.render.resolution_x = cena.render.resolution_y = QUADRO
    cena.render.film_transparent = False
    cena.view_settings.view_transform = "Standard"
    cena.render.image_settings.file_format = "PNG"


def resumo(ob_mats):
    out = []
    for nome, info in ob_mats.items():
        lo, hi = info["lo"], info["hi"]
        out.append({"material": nome, "faces": info["faces"], "cor": info["cor"], "textura": info["textura"],
                    "min_cm": [round(v * 100, 1) for v in lo], "max_cm": [round(v * 100, 1) for v in hi]})
    return sorted(out, key=lambda x: -x["faces"])


with open(lista, encoding="utf-8") as f:
    itens = [l.strip().split("|") for l in f if l.strip()]

todos = {}
for glb, slug in itens:
    bpy.ops.wm.read_homefile(use_empty=True)
    preparar_render()
    bpy.ops.import_scene.gltf(filepath=glb)
    malhas = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    # separa cada material num objeto próprio para poder colorir
    for ob in malhas:
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        if len(ob.material_slots) > 1:
            bpy.ops.mesh.separate(type="MATERIAL")
    partes = {}
    for ob in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
        mat = ob.material_slots[0].material if ob.material_slots else None
        nome = mat.name if mat else "_sem_material"
        cor, tex = None, False
        if mat and mat.use_nodes:
            b = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if b:
                cor = "#%02x%02x%02x" % tuple(int(255 * min(1, c ** (1 / 2.2))) for c in b.inputs["Base Color"].default_value[:3])
                tex = bool(b.inputs["Base Color"].links)
        pts = [ob.matrix_world @ v.co for v in ob.data.vertices]
        lo = [min(p[i] for p in pts) for i in range(3)]
        hi = [max(p[i] for p in pts) for i in range(3)]
        d = partes.setdefault(nome, {"faces": 0, "lo": lo, "hi": hi, "cor": cor, "textura": tex, "obs": []})
        d["faces"] += len(ob.data.polygons)
        d["lo"] = [min(a, b) for a, b in zip(d["lo"], lo)]
        d["hi"] = [max(a, b) for a, b in zip(d["hi"], hi)]
        d["obs"].append(ob)
    todos[slug] = resumo(partes)

    # câmera em perspectiva 3/4 enquadrando tudo
    obs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    lo = Vector([min(min((o.matrix_world @ v.co)[i] for v in o.data.vertices) for o in obs) for i in range(3)])
    hi = Vector([max(max((o.matrix_world @ v.co)[i] for v in o.data.vertices) for o in obs) for i in range(3)])
    centro, tam = (lo + hi) / 2, (hi - lo).length
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam.location = centro + Vector((1.2, -1.6, 0.9)).normalized() * tam * 1.05
    cam.rotation_euler = (centro - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 40

    nomes = [p["material"] for p in todos[slug]]
    quadros = []
    for alvo in nomes:
        for nome, d in partes.items():
            for o in d["obs"]:
                o.color = (0.9, 0.1, 0.1, 1) if nome == alvo else (0.82, 0.82, 0.82, 1)
        arq = os.path.join(saida, f"_q.png")
        bpy.context.scene.render.filepath = arq
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(arq)
        quadros.append(np.array(img.pixels[:], dtype=np.float32).reshape(QUADRO, QUADRO, 4))
        bpy.data.images.remove(img)
    # folha: quadros lado a lado (até 5 por linha)
    cols = min(5, len(quadros))
    linhas = (len(quadros) + cols - 1) // cols
    folha = np.ones((linhas * QUADRO, cols * QUADRO, 4), dtype=np.float32)
    for i, q in enumerate(quadros):
        r, c = divmod(i, cols)
        y0 = (linhas - 1 - r) * QUADRO  # imagem do Blender começa embaixo
        folha[y0:y0 + QUADRO, c * QUADRO:(c + 1) * QUADRO] = q
    im = bpy.data.images.new(slug, cols * QUADRO, linhas * QUADRO, alpha=True)
    im.pixels = folha.ravel()
    im.filepath_raw = os.path.join(saida, f"{slug}.png")
    im.file_format = "PNG"
    im.save()
    print(f"OK {slug} {len(nomes)} materiais: {', '.join(nomes)}", flush=True)

with open(os.path.join(saida, "materiais.json"), "w", encoding="utf-8") as f:
    json.dump(todos, f, ensure_ascii=False, indent=1)
