# Separa o modelo 3D de cada produto nas PEÇAS da ficha técnica (partes-def.json) e grava um GLB em que cada peça
# tem materiais próprios, com nome "<papel>|<material original>". Assim trocar o acabamento do tampo só muda o tampo,
# mesmo quando o projetista usou o mesmo material no tampo e nos pés; e o que não é peça configurável
# (colchão, ferragens) fica com o material original.
#
# Cada pedaço solto do modelo (ilha de faces conectadas) recebe um papel pela geometria:
#   tampo   = pedaços na faixa de cima, chatos e cobrindo boa parte da planta
#   pes     = em mesas, o que não é tampo; em móveis de caixa, o que fica abaixo da caixa
#   portas  = painéis finos e em pé na face da frente (lado comprido com mais painéis)
#   estofado = pedaços com material de tecido/couro (classes.json); espelho = material de espelho/vidro
#   estrutura/moldura/corpo/todo = o restante
# Correções à mão em partes-manual.json: {"<slug>": {"materiais": {"<material original>": "<papel>" | "-"}}}
#
# Lê conversao/<slug>/modelo-base.glb (cópia do modelo.glb original, criada na 1ª vez) e grava modelo.glb,
# partes.json ({papel: [materiais]}) e partes.png (conferência: cada papel numa cor).
# blender.exe -b -P blender-partes.py -- <pasta da marca> [slug ...]
import json
import os
import shutil
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
base, so = args[0], set(args[1:])
conv = os.path.join(base, "conversao")
defs = json.load(open(os.path.join(base, "partes-def.json"), encoding="utf-8"))
classes = json.load(open(os.path.join(base, "classes.json"), encoding="utf-8"))
_m = os.path.join(base, "partes-manual.json")
MANUAL = json.load(open(_m, encoding="utf-8")) if os.path.exists(_m) else {}

CORES = {"tampo": (0.15, 0.45, 0.95), "pes": (0.75, 0.3, 0.05), "corpo": (0.2, 0.7, 0.3), "portas": (0.6, 0.3, 0.85),
         "estofado": (0.9, 0.15, 0.2), "estrutura": (0.95, 0.75, 0.15), "moldura": (0.95, 0.75, 0.15), "espelho": (0.4, 0.9, 0.95),
         "todo": (0.2, 0.7, 0.3), "assento": (0.15, 0.45, 0.95), "cupula": (0.15, 0.45, 0.95), "haste": (0.6, 0.3, 0.85),
         "interno": (0.5, 0.9, 0.5), "detalhe": (0.6, 0.3, 0.85), "-": (0.85, 0.85, 0.85)}


def ilhas(ob):
    """Pedaços de faces conectadas de um objeto: lista de (índices das faces, dados geométricos em metros)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    mw = ob.matrix_world
    vistas, out = set(), []
    for f0 in bm.faces:
        if f0.index in vistas:
            continue
        pilha, faces = [f0], []
        vistas.add(f0.index)
        while pilha:
            f = pilha.pop()
            faces.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in vistas:
                        vistas.add(g.index)
                        pilha.append(g)
        pts = np.array([tuple(mw @ v.co) for f in faces for v in f.verts])
        area = sum(f.calc_area() for f in faces)
        nrm = [(mw.to_3x3() @ f.normal).normalized() for f in faces]
        horiz_cima = sum(f.calc_area() for f, n in zip(faces, nrm) if n.z > 0.9)
        mats = {}
        for f in faces:
            nome = ob.material_slots[f.material_index].material.name if ob.material_slots and ob.material_slots[f.material_index].material else "_"
            mats[nome] = mats.get(nome, 0) + f.calc_area()
        fz = np.array([[min((mw @ v.co).z for v in f.verts), max((mw @ v.co).z for v in f.verts)] for f in faces])
        fc = np.array([tuple(mw @ f.calc_center_median()) for f in faces])
        out.append({"faces": [f.index for f in faces], "lo": pts.min(0), "hi": pts.max(0), "area": area,
                    "horiz": horiz_cima, "mat": max(mats, key=mats.get), "ob": ob,
                    "fz": fz, "fc": fc, "fn": np.array([n.z for n in nrm]), "fa": np.array([f.calc_area() for f in faces])})
    bm.free()
    return out


def classe(slug, mat):
    return classes.get(slug, {}).get(mat, {}).get("classe")


def atribuir(slug, d, todas):
    papeis = [p["papel"] for p in d["partes"]]
    man = MANUAL.get(slug, {}).get("materiais", {})
    lo = np.min([i["lo"] for i in todas], 0)
    hi = np.max([i["hi"] for i in todas], 0)
    H = hi[2] - lo[2]
    planta = (hi[0] - lo[0]) * (hi[1] - lo[1])
    regioes = MANUAL.get(slug, {}).get("regioes", [])
    for i in todas:
        i["papel"] = None
        # regiões à mão: pedaços que acabam até z_max (m, a partir do chão) recebem o papel (ex.: base de luminária)
        for r in regioes:
            if i["hi"][2] - lo[2] <= r["z_max"] + 1e-4:
                i["papel"] = r["papel"]
                break
        if i["papel"] is None and i["mat"] in man:
            i["papel"] = man[i["mat"]]
    livres = lambda: [i for i in todas if i["papel"] is None]

    # colchão, almofadas soltas, ferragens marcadas à mão ficam fora ("-"); estofado e espelho pelo material
    if "estofado" in papeis:
        for i in livres():
            if classe(slug, i["mat"]) in ("tecido", "couro", "tela"):
                i["papel"] = "estofado"
    if "espelho" in papeis:
        for i in livres():
            if classe(slug, i["mat"]) in ("espelho", "vidro"):
                i["papel"] = "espelho"
        if not any(i["papel"] == "espelho" for i in todas):  # espelho sem material próprio: o maior painel plano
            cand = max(livres(), key=lambda i: i["area"], default=None)
            if cand:
                cand["papel"] = "espelho"

    if "tampo" in papeis:
        placas(todas, lo, hi, planta, varias=any(p["papel"] == "tampo" and p["rotulo"].endswith("s") for p in d["partes"])
               or d["categoria"] in ("Carro Bar",) or MANUAL.get(slug, {}).get("varios_tampos", False))
    if "portas" in papeis:
        # painéis finos e em pé, colados numa das faces compridas; a frente é a face com mais painéis
        eixo = 1 if (hi[0] - lo[0]) >= (hi[1] - lo[1]) else 0  # eixo da profundidade
        lados = {"min": [], "max": []}
        ripas = MANUAL.get(slug, {}).get("portas_ripadas")
        for i in livres():
            dim = i["hi"] - i["lo"]
            # portas lisas: painéis largos; portas ripadas (ajuste à mão): ripas estreitas
            largura_ok = dim[1 - eixo] < 0.06 if ripas else dim[1 - eixo] >= 0.12
            if dim[eixo] <= 0.05 and dim[2] >= 0.15 and largura_ok:
                if i["lo"][eixo] - lo[eixo] <= 0.04:
                    lados["min"].append(i)
                elif hi[eixo] - i["hi"][eixo] <= 0.04:
                    lados["max"].append(i)
        frente = max(lados.values(), key=len)
        if len(frente) >= 1 and len(frente) != len(lados["min"]) + len(lados["max"]) or len(frente) >= 2:
            for i in frente:
                i["papel"] = "portas"

    if "pes" in papeis:
        if "corpo" in papeis:
            # móvel de caixa: painéis da caixa são largos (>= 50% do comprimento) e fundos ou altos; o fundo da caixa
            # é o mais baixo deles. Pés são os pedaços que acabam até 3 cm acima desse fundo e não são painéis.
            comp = max(hi[0] - lo[0], hi[1] - lo[1])
            eixo_l = 0 if (hi[0] - lo[0]) >= (hi[1] - lo[1]) else 1
            prof = hi[1 - eixo_l] - lo[1 - eixo_l]
            todos_l = [i for i in todas if i["papel"] in (None, "portas", "tampo")]
            def painel(i):
                d = i["hi"] - i["lo"]
                largo = d[eixo_l] >= 0.5 * comp and (d[1 - eixo_l] >= 0.5 * prof or d[2] >= 0.25 * H)
                # chapa de verdade, não um quadro de pés (trilho em U) com a mesma caixa envolvente
                return largo and i["area"] >= 0.25 * d[eixo_l] * max(d[1 - eixo_l], d[2])
            paineis = [i for i in todos_l if painel(i)]
            if os.environ.get("DEPURAR"):
                for i in sorted(todos_l, key=lambda i: -i["area"])[:25]:
                    print("  ilha", i["mat"][:12], np.round(i["lo"] - lo, 3), np.round(i["hi"] - i["lo"], 3), round(i["area"], 3), "PAINEL" if painel(i) else "", flush=True)
            if paineis:
                zc = min(i["lo"][2] for i in paineis)
                if zc - lo[2] >= 0.02:
                    for i in livres():
                        dim = i["hi"] - i["lo"]
                        # gaveteiro/caixa pendurado abaixo do tampo (escrivaninha): volumoso e sem tocar o chão
                        # (volumoso, ou feito de placas: chapa fina mas larga; travessa de pé é fina nos dois sentidos)
                        gaveta = (min(dim) >= 0.08 and i["lo"][2] - lo[2] > 0.05) or \
                                 (sorted(dim)[1] >= 0.10 and i["lo"][2] - lo[2] > 0.3 * H)
                        # pé que sobe pela lateral da caixa: encosta no chão e não é painel da caixa
                        no_chao = i["lo"][2] - lo[2] <= 0.02 and min(dim) <= 0.06
                        if (i["hi"][2] <= zc + 0.03 or no_chao) and not painel(i) and not gaveta:
                            i["papel"] = "pes"
        else:
            for i in livres():
                i["papel"] = "pes"

    # o restante vai para a peça "principal" do produto
    resto = next((p for p in ("todo", "corpo", "estrutura", "moldura", "pes", "tampo") if p in papeis), None)
    for i in livres():
        i["papel"] = resto or "-"


def dividir(i, sel):
    """Separa uma ilha em duas pelas faces marcadas (sel = máscara booleana); devolve a parte marcada."""
    k = np.nonzero(sel)[0]
    r = np.nonzero(~sel)[0]
    novo = dict(i)
    for chave in ("fz", "fc", "fn", "fa"):
        novo[chave] = i[chave][k]
        i[chave] = i[chave][r]
    novo["faces"] = [i["faces"][j] for j in k]
    i["faces"] = [i["faces"][j] for j in r]
    for x in (novo, i):
        x["area"] = float(x["fa"].sum())
        x["lo"] = np.array([x["fc"][:, 0].min(), x["fc"][:, 1].min(), x["fz"][:, 0].min()]) if len(x["faces"]) else i["lo"]
        x["hi"] = np.array([x["fc"][:, 0].max(), x["fc"][:, 1].max(), x["fz"][:, 1].max()]) if len(x["faces"]) else i["hi"]
    return novo


def placas(todas, lo, hi, planta, varias):
    """Tampo(s): faixas horizontais com face de cima grande e face de baixo logo abaixo (placa de até 7 cm).
    Separa por face, então funciona mesmo quando o tampo está colado aos pés no modelo."""
    livres = [i for i in todas if i["papel"] is None and len(i["faces"])]
    if not livres:
        return
    fz = np.concatenate([i["fz"] for i in livres])
    fn = np.concatenate([i["fn"] for i in livres])
    fa = np.concatenate([i["fa"] for i in livres])
    fc = np.concatenate([i["fc"] for i in livres])
    cima = (fn > 0.85)  # tampos orgânicos têm leve curvatura
    # níveis de faces voltadas para cima, juntando alturas a menos de 1 cm (superfície levemente irregular)
    niveis = {}
    zs = sorted(zip(fz[cima, 1], fa[cima]), reverse=True)
    atual = None
    for z, a in zs:
        if atual is None or atual - z > 0.01:
            atual = z
        niveis[atual] = niveis.get(atual, 0) + a
    faixas = []
    def sobrepoe(a, b):
        """Um tampo está embaixo do outro (prateleira) quando a planta dele fica 70% ou mais sob o outro;
        mesas de conjunto que só encaixam por baixo uma da outra se sobrepõem menos que isso."""
        ix = max(0, min(a[3], b[3]) - max(a[2], b[2]))
        iy = max(0, min(a[5], b[5]) - max(a[4], b[4]))
        menor = min((a[3] - a[2]) * (a[5] - a[4]), (b[3] - b[2]) * (b[5] - b[4]))
        return ix * iy >= 0.7 * menor
    for zt in sorted(niveis, reverse=True):
        # nível de tampo: 15% da planta (ou 40% do maior nível, em conjuntos de mesas espalhadas)
        if niveis[zt] < min(0.15 * planta, 0.4 * max(niveis.values())):
            continue
        sel_t = cima & (fz[:, 1] <= zt + 0.001) & (fz[:, 1] >= zt - 0.011)
        x0, x1 = fc[sel_t, 0].min(), fc[sel_t, 0].max()
        y0, y1 = fc[sel_t, 1].min(), fc[sel_t, 1].max()
        # tampo côncavo ou levemente inclinado: junta as faces de cima até 5 cm abaixo, perto da área já achada
        mx, my = 0.25 * (x1 - x0) + 0.02, 0.25 * (y1 - y0) + 0.02
        cand = cima & (fz[:, 1] <= zt + 0.001) & (fz[:, 1] >= zt - 0.05) & ~sel_t & \
            (fc[:, 0] >= x0 - mx) & (fc[:, 0] <= x1 + mx) & (fc[:, 1] >= y0 - my) & (fc[:, 1] <= y1 + my)
        # ...mas não faces cobertas (topo da saia/travessa embaixo do tampo): há face virada para baixo logo acima
        ic = np.nonzero(cand)[0]
        if len(ic):
            ib = np.nonzero((fn < -0.85) & (fz[:, 0] >= zt - 0.06))[0]
            if len(ib):
                for k0 in range(0, len(ic), 2000):
                    bloco = ic[k0:k0 + 2000]
                    d2 = (fc[bloco, None, 0] - fc[None, ib, 0]) ** 2 + (fc[bloco, None, 1] - fc[None, ib, 1]) ** 2
                    acima = fz[None, ib, 0] > fz[bloco, None, 1] + 0.001
                    coberta = ((d2 < 0.03 ** 2) & acima).any(1)
                    cand[bloco[coberta]] = False
        sel_t = sel_t | cand
        x0, x1 = fc[sel_t, 0].min() - 0.01, fc[sel_t, 0].max() + 0.01
        y0, y1 = fc[sel_t, 1].min() - 0.01, fc[sel_t, 1].max() + 0.01
        z_cima = fz[sel_t, 0].min()
        dentro = (fc[:, 0] >= x0) & (fc[:, 0] <= x1) & (fc[:, 1] >= y0) & (fc[:, 1] <= y1)
        baixo = (fn < -0.85) & dentro & (fz[:, 0] < z_cima - 0.003) & (fz[:, 0] > z_cima - 0.07)
        if baixo.any() and fa[baixo].sum() >= 0.3 * fa[sel_t].sum():
            zmax_b = fz[baixo, 0].max()
            zb = fz[baixo & (fz[:, 0] >= zmax_b - 0.03), 0].min()  # face de baixo inclinada até 3 cm
        else:
            zb = z_cima - 0.02
        nova = (zb, zt, x0, x1, y0, y1)
        # prateleiras/tampos de baixo só quando a peça tem "Tampos"; mesas de conjunto (alturas diferentes, lado a
        # lado) entram sempre, desde que não fiquem embaixo de um tampo já achado
        if any(abs(zt - f[1]) < 0.08 and sobrepoe(nova, f) for f in faixas):
            continue
        if faixas and not varias and any(sobrepoe(nova, f) for f in faixas):
            continue
        faixas.append(nova)
    novos = []
    for i in livres:
        sel = np.zeros(len(i["faces"]), bool)
        for zb, zt, x0, x1, y0, y1 in faixas:
            sel |= (i["fz"][:, 0] >= zb - 0.003) & (i["fz"][:, 1] <= zt + 0.003) &                    (i["fc"][:, 0] >= x0) & (i["fc"][:, 0] <= x1) & (i["fc"][:, 1] >= y0) & (i["fc"][:, 1] <= y1)
        if sel.all():
            i["papel"] = "tampo"
        elif sel.any():
            n = dividir(i, sel)
            n["papel"] = "tampo"
            novos.append(n)
    todas.extend(novos)


def processar(slug):
    pasta = os.path.join(conv, slug)
    glb, glb_base = os.path.join(pasta, "modelo.glb"), os.path.join(pasta, "modelo-base.glb")
    if not os.path.exists(glb_base):
        shutil.copy(glb, glb_base)
    d = defs[slug]
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb_base)
    obs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    todas = [i for ob in obs for i in ilhas(ob)]
    atribuir(slug, d, todas)

    # materiais por peça: cópia do original com nome "<papel>|<original>"
    copias, partes = {}, {}
    for i in todas:
        if i["papel"] == "-":
            continue
        nome = f"{i['papel']}|{i['mat']}"
        if nome not in copias:
            orig = bpy.data.materials.get(i["mat"])
            m = orig.copy() if orig else bpy.data.materials.new(nome)
            m.name = nome
            copias[nome] = m
            partes.setdefault(i["papel"], []).append(m.name)
        ob = i["ob"]
        if copias[nome].name not in [s.material.name for s in ob.material_slots if s.material]:
            ob.data.materials.append(copias[nome])
        idx = [s.material.name if s.material else "" for s in ob.material_slots].index(copias[nome].name)
        for fi in i["faces"]:
            ob.data.polygons[fi].material_index = idx
    for ob in obs:  # tira slots que ficaram sem uso
        usados = {p.material_index for p in ob.data.polygons}
        for k in reversed(range(len(ob.material_slots))):
            if k not in usados:
                ob.active_material_index = k
                bpy.context.view_layer.objects.active = ob
                bpy.ops.object.material_slot_remove()
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_apply=True, export_yup=True, export_image_format="AUTO")
    json.dump(partes, open(os.path.join(pasta, "partes.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    conferencia(pasta, todas)
    resumo = {p: round(sum(i["area"] for i in todas if i["papel"] == p), 2) for p in {i["papel"] for i in todas}}
    print(f"OK {slug} {json.dumps(resumo, ensure_ascii=False)}", flush=True)


def conferencia(pasta, todas):
    cena = bpy.context.scene
    cena.render.engine = "BLENDER_WORKBENCH"
    cena.display.shading.light = "STUDIO"
    cena.display.shading.color_type = "OBJECT"
    cena.render.resolution_x = cena.render.resolution_y = 300
    cena.view_settings.view_transform = "Standard"
    # um objeto por papel, para colorir
    for ob in [o for o in cena.objects if o.type == "MESH"]:
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        if len(ob.material_slots) > 1:
            bpy.ops.mesh.separate(type="MATERIAL")
    for ob in [o for o in cena.objects if o.type == "MESH"]:
        nome = ob.material_slots[0].material.name if ob.material_slots and ob.material_slots[0].material else ""
        papel = nome.split("|")[0] if "|" in nome else "-"
        ob.color = (*CORES.get(papel, (1, 0, 1)), 1)
    obs = [o for o in cena.objects if o.type == "MESH"]
    lo = Vector([min(min((o.matrix_world @ v.co)[k] for v in o.data.vertices) for o in obs) for k in range(3)])
    hi = Vector([max(max((o.matrix_world @ v.co)[k] for v in o.data.vertices) for o in obs) for k in range(3)])
    centro, tam = (lo + hi) / 2, (hi - lo).length
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cena.collection.objects.link(cam)
    cena.camera = cam
    cam.location = centro + Vector((0.9, -1.6, 0.8)).normalized() * tam * 1.15
    cam.rotation_euler = (centro - cam.location).to_track_quat("-Z", "Y").to_euler()
    cena.render.filepath = os.path.join(pasta, "partes.png")
    bpy.ops.render.render(write_still=True)


for slug in sorted(defs):
    if so and slug not in so:
        continue
    if not os.path.exists(os.path.join(conv, slug, "modelo.glb")):
        print(f"ERRO {slug}: sem modelo", flush=True)
        continue
    try:
        processar(slug)
    except Exception as e:
        import traceback
        print(f"ERRO {slug}: {e}\n{traceback.format_exc()}", flush=True)
