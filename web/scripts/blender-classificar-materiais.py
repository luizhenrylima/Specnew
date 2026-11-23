# Classifica cada material dos modelos convertidos (madeira, laca, pedra, tecido, couro, vidro, espelho, metal, tela)
# pela aparência da textura/cor e pelo nome, e faz uma imagem de conferência com cada classe pintada de uma cor.
# blender.exe -b -P blender-classificar-materiais.py -- <pasta conversao> <saida classes.json> [slug ...]
import json
import math
import os
import re
import sys

import bpy
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
base, saida, so = args[0], args[1], set(args[2:])

CORES = {  # cor de conferência por classe
    "madeira": (0.55, 0.32, 0.12, 1), "laca": (0.95, 0.85, 0.2, 1), "pedra": (0.6, 0.6, 0.95, 1), "tecido": (0.2, 0.75, 0.3, 1),
    "couro": (0.75, 0.2, 0.2, 1), "vidro": (0.4, 0.9, 0.95, 1), "espelho": (0.9, 0.9, 0.95, 1), "metal": (0.25, 0.25, 0.25, 1),
    "tela": (0.95, 0.5, 0.0, 1), "outro": (1, 0, 1, 1),
}
NOMES = [
    ("espelho", r"espelho|mirror"), ("vidro", r"vidro|glass|cristal"),
    ("metal", r"metal|alum|inox|a[cç]o\b|lat[aã]o|ouro|gold|bronze|cromo|chrome|steel|brass|cobre|copper"),
    ("tela", r"palha|cane|rattan|vime|tela\b|vitral|wicker"),
    ("couro", r"couro|leather|recouro|couri|nobuck"), ("tecido", r"tecido|fabric|linho|linen|veludo|velvet|boucl|cotton|algod"),
    ("pedra", r"m[aá]rmore|marble|pedra|stone|granit|nero|calac|travert|quartz|onix|[oô]nix|terrazz"),
    ("madeira", r"madeira|wood|veneer|nogueira|walnut|carvalho|oak|freij|louro|mdf|imbuia|jacarand|teca|teak|ebano|freijo|cumaru|tauari"),
]


def stats_textura(arq):
    img = bpy.data.images.load(arq)
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(img)
    passo = max(1, max(w, h) // 192)
    a = a[::passo, ::passo, :3]
    mx, mn = a.max(axis=2), a.min(axis=2)
    sat = np.where(mx > 1e-3, (mx - mn) / np.maximum(mx, 1e-3), 0).mean()
    r, g, b = a[..., 0].mean(), a[..., 1].mean(), a[..., 2].mean()
    lum = a.mean(axis=2)
    dx = np.abs(np.diff(lum, axis=1)).mean()
    dy = np.abs(np.diff(lum, axis=0)).mean()
    aniso = max(dx, dy) / max(min(dx, dy), 1e-5)
    fino = (dx + dy) / 2                      # detalhe pixel a pixel (trama)
    largo = lum.std()                         # contraste geral (veios)
    return {"sat": float(sat), "rgb": [float(r), float(g), float(b)], "aniso": float(aniso), "fino": float(fino), "largo": float(largo)}


def classificar(m, pasta, area_frac=1.0, categoria=""):
    nome = m["nome"].lower()
    if m.get("alfa", 1) < 0.95:
        return "vidro", "transparente"
    for classe, re_ in NOMES:
        if re.search(re_, nome):
            return classe, f"nome ({nome})"
    r, g, b = [c / 255 for c in m["cor"]]
    if m.get("textura") and os.path.exists(os.path.join(pasta, m["textura"])):
        s = stats_textura(os.path.join(pasta, m["textura"]))
        rr, gg, bb = s["rgb"]
        marrom = rr > gg > bb and (rr - bb) > 0.08
        if marrom and s["sat"] > 0.25:  # madeira primeiro: veio fino parece trama, mas tecido raramente é marrom saturado
            return "madeira", f"marrom saturado {s['sat']:.2f}"
        if s["aniso"] > 1.35 and marrom:
            return "madeira", f"veio direcional {s['aniso']:.2f}, marrom"
        if s["sat"] < 0.18 and s["largo"] > 0.06 and s["fino"] < 0.06:
            return "pedra", f"veios {s['largo']:.2f}, pouca cor"
        if s["fino"] > 0.035 and s["aniso"] < 1.35:
            return "tecido", f"trama fina {s['fino']:.3f}"
        if marrom:
            return "madeira", "marrom"
        if s["sat"] < 0.2:
            return "pedra", "pouca cor"
        return "laca", "textura sem padrão claro"
    # sem textura: cor lisa
    mx, mn = max(r, g, b), min(r, g, b)
    sat = (mx - mn) / mx if mx > 0 else 0
    if r > g > b and sat > 0.45 and 0.25 < mx < 0.85 and (r - b) > 0.25 and area_frac > 0.15:
        return "madeira", "cor de madeira"
    # peça pequena de cor lisa (pés, puxadores, frisos, ferragens): metal, fica com o acabamento original
    if area_frac < 0.12:
        return "metal", f"cor lisa em {area_frac:.0%} da área"
    return "laca", "cor lisa"


def previa(pasta, classes):
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(pasta, "modelo.glb"))
    for mat in bpy.data.materials:
        c = classes.get(mat.name, {}).get("classe", "outro")
        mat.diffuse_color = CORES[c]
    cena = bpy.context.scene
    cena.render.engine = "BLENDER_WORKBENCH"
    cena.display.shading.light = "STUDIO"
    cena.display.shading.color_type = "MATERIAL"
    cena.render.resolution_x, cena.render.resolution_y = 300, 240
    cena.view_settings.view_transform = "Standard"
    obs = [o for o in cena.objects if o.type == "MESH"]
    pts = [o.matrix_world @ Vector(c) for o in obs for c in o.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    centro, tam = (lo + hi) / 2, (hi - lo).length
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cena.collection.objects.link(cam)
    cena.camera = cam
    cam.location = centro + Vector((1.1, -1.7, 0.8)).normalized() * tam * 1.25
    cam.rotation_euler = (centro - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 45
    cena.render.filepath = os.path.join(pasta, "classes.png")
    bpy.ops.render.render(write_still=True)


resultado = json.load(open(saida, encoding="utf-8")) if os.path.exists(saida) and so else {}
for slug in sorted(os.listdir(base)):
    pasta = os.path.join(base, slug)
    if so and slug not in so or not os.path.exists(os.path.join(pasta, "cena.json")):
        continue
    cena_j = json.load(open(os.path.join(pasta, "cena.json"), encoding="utf-8"))
    # quantos triângulos de cada material (peso de cada um no produto)
    n_tri = [0] * len(cena_j["materiais"])
    area = [0.0] * (len(cena_j["materiais"]) + 1)  # último = faces sem material ("padrao")
    V = cena_j["vertices"]
    for t in cena_j["triangulos"]:
        a, b, c = (Vector(V[k]) for k in t[:3])
        ar = (b - a).cross(c - a).length / 2
        area[t[6]] += ar  # t[6] = -1 cai no último
        if t[6] >= 0:
            n_tri[t[6]] += 1
    total = sum(area) or 1
    classes = {}
    for i, m in enumerate(cena_j["materiais"]):
        c, motivo = classificar(m, pasta, area[i] / total, slug)
        classes[m["nome"][:60]] = {"classe": c, "motivo": motivo, "triangulos": n_tri[i], "area": round(area[i] / total, 3)}
    if area[-1] > 0:
        classes["padrao"] = {"classe": "laca" if area[-1] / total >= 0.12 else "metal", "motivo": "faces sem material",
                             "triangulos": 0, "area": round(area[-1] / total, 3)}
    # espelho: na categoria Espelhos, a maior superfície lisa e clara é o espelho
    if slug.startswith("espelho"):
        lisos = [(k, v) for k, v in classes.items() if v["classe"] in ("laca", "metal", "pedra")]
        if lisos:
            k, v = max(lisos, key=lambda kv: kv[1]["area"])
            v["classe"], v["motivo"] = "espelho", "maior superfície lisa de um espelho"
    resultado[slug] = classes
    try:
        previa(pasta, classes)
    except Exception as e:  # noqa: BLE001
        print(f"ERRO previa {slug}: {e}", flush=True)
    print(f"OK {slug} " + ", ".join(f"{k[:18]}={v['classe']}" for k, v in classes.items()), flush=True)

json.dump(resultado, open(saida, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
