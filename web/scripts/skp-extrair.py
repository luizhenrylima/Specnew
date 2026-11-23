# Extrai o produto de cada .skp de fábrica (cena com câmeras, piso, figura humana, variações de tamanho...)
# e grava, por produto, <saida>/<slug>/cena.json + texturas, no formato lido por blender-montar-glb.py.
#
# python.exe -I skp-extrair.py <pasta com .skp> <pasta de saída> <pasta do sketchup-sdk> [slug ...]
#
# Escolha do produto na cena (nível de cima do modelo):
#  - descarta câmeras, itens ocultos, piso/fundo (> 6 m) e adereços que se repetem em arquivos de outros produtos;
#  - se o mesmo componente aparece em vários tamanhos, usa um (o do meio) e guarda os outros como medidas disponíveis;
#  - se sobram peças diferentes, junta (produto montado em partes), a não ser que estejam longe umas das outras.
import ctypes as C
import json
import math
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import skp_exportar as s  # noqa: E402

pasta, saida, sdk = sys.argv[1:4]
so = set(sys.argv[4:])
su = s.carregar(sdk)
for f in ("SUGroupToDrawingElement", "SUComponentInstanceToDrawingElement", "SUFaceToDrawingElement"):
    getattr(su, f).restype = C.c_void_p
    getattr(su, f).argtypes = [C.c_void_p]
POL_M = 0.0254


class Transf(C.Structure):
    _fields_ = [("v", C.c_double * 16)]


IDENT = [1.0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def mult(a, b):
    return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]


def det3(m):
    return (m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]))


def aplicar(m, x, y, z):
    w = m[3] * x + m[7] * y + m[11] * z + m[15]
    return ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
            (m[2] * x + m[6] * y + m[10] * z + m[14]) / w)


def texto(fn, obj):
    st = C.c_void_p()
    su.SUStringCreate(C.byref(st))
    r = fn(obj, C.byref(st))
    n = C.c_size_t()
    su.SUStringGetUTF8Length(st, C.byref(n))
    b = C.create_string_buffer(n.value + 1)
    su.SUStringGetUTF8(st, n.value + 1, b, C.byref(n))
    su.SUStringRelease(C.byref(st))
    return b.value.decode("utf-8", "replace") if r == 0 else ""


def lista(fn_n, fn_g, ents):
    n = C.c_size_t()
    fn_n(ents, C.byref(n))
    a = (C.c_void_p * n.value)()
    fn_g(ents, n, a, C.byref(n))
    return [C.c_void_p(x) for x in a]


def elem_info(elem):
    h = C.c_bool()
    su.SUDrawingElementGetHidden(C.c_void_p(elem), C.byref(h))
    lay = C.c_void_p()
    tag = texto(su.SULayerGetName, lay) if su.SUDrawingElementGetLayer(C.c_void_p(elem), C.byref(lay)) == 0 else ""
    vis = C.c_bool(True)
    if lay.value:
        su.SULayerGetVisibility(lay, C.byref(vis))
    m = C.c_void_p()
    mat = m if su.SUDrawingElementGetMaterial(C.c_void_p(elem), C.byref(m)) == 0 else None
    return h.value or not vis.value, tag, mat


def caixa(ents, t):
    b = s.Caixa()
    su.SUEntitiesGetBoundingBox(ents, C.byref(b))
    pts = [aplicar(t, x, y, z) for x in (b.min.x, b.max.x) for y in (b.min.y, b.max.y) for z in (b.min.z, b.max.z)]
    return [min(p[i] for p in pts) * 2.54 for i in range(3)], [max(p[i] for p in pts) * 2.54 for i in range(3)]


def norm_def(n):
    n = unicodedata.normalize("NFD", n).encode("ascii", "ignore").decode().lower().strip()
    base = re.sub(r"#\d+$", "", n).strip()
    # nomes genéricos ("Componente#4", "Grupo#2") são peças diferentes: não junta
    if re.fullmatch(r"(g:)?(soltas\d*|componente|component|grupo|group|diferenca|difference|uniao|union|intersecao|intersect|recorte|trim)?", base):
        return n
    return base


def palavras(t):
    t = unicodedata.normalize("NFD", t).encode("ascii", "ignore").decode().lower()
    return {w for w in re.findall(r"[a-z]{3,}", t) if w not in {"skp", "dwg", "final", "componente", "faenza", "essenza", "mesa", "de", "jantar"}}


# ---------------------------------------------------------------- 1) itens do nível de cima

def itens_topo(raiz, tpai=IDENT):
    itens = []
    for g in lista(su.SUEntitiesGetNumGroups, su.SUEntitiesGetGroups, raiz):
        t, e = Transf(), C.c_void_p()
        su.SUGroupGetTransform(g, C.byref(t))
        su.SUGroupGetEntities(g, C.byref(e))
        oculto, tag, _ = elem_info(su.SUGroupToDrawingElement(g.value))
        tt = mult(tpai, list(t.v))
        lo, hi = caixa(e, tt)
        itens.append({"ref": g, "grupo": True, "def": "g:" + texto(su.SUGroupGetName, g), "tag": tag, "oculto": oculto,
                      "t": tt, "ents": e, "lo": lo, "hi": hi})
    for i in lista(su.SUEntitiesGetNumInstances, su.SUEntitiesGetInstances, raiz):
        t, d, e = Transf(), C.c_void_p(), C.c_void_p()
        su.SUComponentInstanceGetTransform(i, C.byref(t))
        su.SUComponentInstanceGetDefinition(i, C.byref(d))
        su.SUComponentDefinitionGetEntities(d, C.byref(e))
        oculto, tag, _ = elem_info(su.SUComponentInstanceToDrawingElement(i.value))
        tt = mult(tpai, list(t.v))
        lo, hi = caixa(e, tt)
        itens.append({"ref": i, "grupo": False, "def": texto(su.SUComponentDefinitionGetName, d), "tag": tag, "oculto": oculto,
                      "t": tt, "ents": e, "lo": lo, "hi": hi})
    # geometria solta no nível de cima (sem grupo): parte do produto em alguns arquivos; ignora faces enormes (piso).
    # Separa em pedaços conectados: cada pedaço vira um item, como se fosse um grupo.
    faces, pts_face = [], []
    for f in lista(su.SUEntitiesGetNumFaces, su.SUEntitiesGetFaces, raiz):
        oculto, _, _ = elem_info(su.SUFaceToDrawingElement(f.value))
        area = C.c_double()
        su.SUFaceGetArea(f, C.byref(area))
        if oculto or area.value > 2300:  # > ~1,5 m²
            continue
        n = C.c_size_t()
        su.SUFaceGetNumVertices(f, C.byref(n))
        vs = (C.c_void_p * n.value)()
        su.SUFaceGetVertices(f, n, vs, C.byref(n))
        ps = []
        for v in vs:
            p3 = s.P3()
            su.SUVertexGetPosition(C.c_void_p(v), C.byref(p3))
            q = aplicar(tpai, p3.x, p3.y, p3.z)
            ps.append((round(q[0] * 2.54, 2), round(q[1] * 2.54, 2), round(q[2] * 2.54, 2)))
        faces.append(f)
        pts_face.append(ps)
    pai = list(range(len(faces)))
    def raiz_uf(i):
        while pai[i] != i:
            pai[i] = pai[pai[i]]
            i = pai[i]
        return i
    dono = {}
    for i, ps in enumerate(pts_face):
        for p in ps:
            if p in dono:
                a_, b_ = raiz_uf(i), raiz_uf(dono[p])
                if a_ != b_:
                    pai[a_] = b_
            else:
                dono[p] = i
    pedacos = defaultdict(list)
    for i in range(len(faces)):
        pedacos[raiz_uf(i)].append(i)
    for k, idx in enumerate(sorted(pedacos.values(), key=len, reverse=True)):
        pts = [p for i in idx for p in pts_face[i]]
        itens.append({"ref": raiz, "grupo": True, "def": f"g:soltas{k}", "tag": "", "oculto": False, "t": tpai, "ents": raiz,
                      "faces": [faces[i] for i in idx], "lo": [min(p[j] for p in pts) for j in range(3)],
                      "hi": [max(p[j] for p in pts) for j in range(3)]})
    for it in itens:
        it["dims"] = [round(it["hi"][k] - it["lo"][k], 1) for k in range(3)]
        it["assin"] = (norm_def(it["def"]), tuple(sorted(round(x) for x in it["dims"])))
    return itens


def candidatos(itens, pal=frozenset()):
    out = []
    for it in itens:
        if it["oculto"] or re.search(r"camera|fov", it["tag"], re.I):
            continue
        # caixa enorme mas com o nome do produto: o componente traz algo grande junto (plano oculto, guia);
        # aceita e deixa a medida sair da geometria coletada
        if max(it["dims"]) > 600 and palavras(it["def"]) & pal and not it.get("faces"):
            it["dims"] = [min(v, 599) for v in it["dims"]]
            it["caixa_grande"] = True
        if max(it["dims"]) > 600 or max(it["dims"]) < 2:
            continue
        if re.search(r"fundo infinito|stacy|pessoa|person|human|escala", it["def"], re.I):
            continue
        out.append(it)
    return out


# ---------------------------------------------------------------- 2) geometria

class Coletor:
    def __init__(self, pasta_tex):
        self.pasta_tex = pasta_tex
        self.verts, self.idx_v = [], {}
        self.tris = []          # [i0, i1, i2, uv0, uv1, uv2, material, peca]
        self.mats, self.idx_m = [], {}
        self.pecas, self.idx_p = [], {}

    def vid(self, p):
        k = (round(p[0], 5), round(p[1], 5), round(p[2], 5))
        if k not in self.idx_v:
            self.idx_v[k] = len(self.verts)
            self.verts.append(k)
        return self.idx_v[k]

    def mid(self, mat):
        if mat is None:
            return -1
        nome = texto(su.SUMaterialGetName, mat)
        if nome in self.idx_m:
            return self.idx_m[nome]
        cor = s.Cor()
        su.SUMaterialGetColor(mat, C.byref(cor))
        alfa = C.c_double(1)
        su.SUMaterialGetOpacity(mat, C.byref(alfa))
        usa = C.c_bool()
        su.SUMaterialGetUseOpacity(mat, C.byref(usa))
        item = {"nome": nome, "cor": [cor.red, cor.green, cor.blue], "alfa": alfa.value if usa.value else 1.0,
                "textura": None, "escala": [1.0, 1.0]}
        t = C.c_void_p()
        if su.SUMaterialGetTexture(mat, C.byref(t)) == 0:
            w, h, ss, ts = C.c_size_t(), C.c_size_t(), C.c_double(), C.c_double()
            su.SUTextureGetDimensions(t, C.byref(w), C.byref(h), C.byref(ss), C.byref(ts))
            ext = os.path.splitext(texto(su.SUTextureGetFileName, t))[1].lower()
            ext = ext if ext in (".jpg", ".jpeg", ".png") else ".png"
            arq = os.path.join(self.pasta_tex, f"tex_{len(self.mats)}{ext}")
            if su.SUTextureWriteToFile(t, arq.encode("utf-8")) == 0:
                item["textura"] = os.path.basename(arq)
                item["escala"] = [ss.value, ts.value]
        self.idx_m[nome] = len(self.mats)
        self.mats.append(item)
        return self.idx_m[nome]

    def pid(self, caminho):
        if caminho not in self.idx_p:
            self.idx_p[caminho] = len(self.pecas)
            self.pecas.append(caminho)
        return self.idx_p[caminho]


class UVQ(C.Structure):
    _fields_ = [("u", C.c_double), ("v", C.c_double), ("q", C.c_double)]


def coletar(col, ents, m, mat_herdado, caminho, limite, so_faces=None):
    espelhado = det3(m) < 0
    peca = col.pid(caminho)
    for f in (so_faces if so_faces is not None else lista(su.SUEntitiesGetNumFaces, su.SUEntitiesGetFaces, ents)):
        oculto, _, _ = elem_info(su.SUFaceToDrawingElement(f.value))
        if oculto:
            continue
        fm, bm = C.c_void_p(), C.c_void_p()
        tem_f = su.SUFaceGetFrontMaterial(f, C.byref(fm)) == 0
        tem_b = su.SUFaceGetBackMaterial(f, C.byref(bm)) == 0
        # material da frente; se só o verso foi pintado, usa o verso; senão herda do grupo/componente
        if tem_f:
            mat, frente, proprio = fm, True, True
        elif tem_b:
            mat, frente, proprio = bm, False, True
        else:
            mat, frente, proprio = mat_herdado, True, False
        mh = C.c_void_p()
        if su.SUMeshHelperCreate(C.byref(mh), f) != 0:
            continue
        nv, nt = C.c_size_t(), C.c_size_t()
        su.SUMeshHelperGetNumVertices(mh, C.byref(nv))
        su.SUMeshHelperGetNumTriangles(mh, C.byref(nt))
        pts = (s.P3 * nv.value)()
        su.SUMeshHelperGetVertices(mh, nv, pts, C.byref(nv))
        idx = (C.c_size_t * (nt.value * 3))()
        cnt = C.c_size_t()
        su.SUMeshHelperGetVertexIndices(mh, C.c_size_t(nt.value * 3), idx, C.byref(cnt))
        stq = (s.P3 * nv.value)()
        (su.SUMeshHelperGetFrontSTQCoords if frente else su.SUMeshHelperGetBackSTQCoords)(mh, nv, stq, C.byref(nv))
        su.SUMeshHelperRelease(C.byref(mh))
        mi = col.mid(mat) if mat is not None else -1
        esc = col.mats[mi]["escala"] if mi >= 0 and col.mats[mi]["textura"] and not proprio else [1.0, 1.0]
        ids = [col.vid([c * POL_M for c in aplicar(m, p.x, p.y, p.z)]) for p in pts]
        uvs = [((q.x / q.z if q.z else q.x) * esc[0], (q.y / q.z if q.z else q.y) * esc[1]) for q in stq]
        for k in range(nt.value):
            a, b, c = idx[k * 3], idx[k * 3 + 1], idx[k * 3 + 2]
            if not frente:  # verso pintado: inverte para a normal apontar para fora
                a, c = c, a
            if espelhado:
                a, c = c, a
            if len({ids[a], ids[b], ids[c]}) < 3:
                continue
            col.tris.append([ids[a], ids[b], ids[c], uvs[a], uvs[b], uvs[c], mi, peca])
        if len(col.tris) > limite:
            raise RuntimeError(f"mais de {limite} triângulos")
    if so_faces is not None:
        return
    for g in lista(su.SUEntitiesGetNumGroups, su.SUEntitiesGetGroups, ents):
        oculto, _, gm = elem_info(su.SUGroupToDrawingElement(g.value))
        if oculto:
            continue
        t, e = Transf(), C.c_void_p()
        su.SUGroupGetTransform(g, C.byref(t))
        su.SUGroupGetEntities(g, C.byref(e))
        nome = texto(su.SUGroupGetName, g) or "grupo"
        coletar(col, e, mult(m, list(t.v)), gm or mat_herdado, f"{caminho}/{nome}#{g.value % 100000}", limite)
    for i in lista(su.SUEntitiesGetNumInstances, su.SUEntitiesGetInstances, ents):
        oculto, _, im = elem_info(su.SUComponentInstanceToDrawingElement(i.value))
        if oculto:
            continue
        t, d, e = Transf(), C.c_void_p(), C.c_void_p()
        su.SUComponentInstanceGetTransform(i, C.byref(t))
        su.SUComponentInstanceGetDefinition(i, C.byref(d))
        su.SUComponentDefinitionGetEntities(d, C.byref(e))
        nome = texto(su.SUComponentInstanceGetName, i) or texto(su.SUComponentDefinitionGetName, d) or "componente"
        coletar(col, e, mult(m, list(t.v)), im or mat_herdado, f"{caminho}/{nome}#{i.value % 100000}", limite)


# ---------------------------------------------------------------- 3) por arquivo

arquivos = sorted(a for a in os.listdir(pasta) if a.endswith(".skp") and (not so or a[:-4] in so))

# adereços: assinaturas (nome + medidas) que aparecem em arquivos de produtos diferentes
assin_por_arq = {}
if os.path.exists(os.path.join(saida, "_assinaturas.json")) and not so:
    os.remove(os.path.join(saida, "_assinaturas.json"))
cache_assin = os.path.join(saida, "_assinaturas.json")
if os.path.exists(cache_assin):
    assin_por_arq = {k: [tuple([a[0], tuple(a[1])]) for a in v] for k, v in json.load(open(cache_assin, encoding="utf-8")).items()}
else:
    for a in sorted(x for x in os.listdir(pasta) if x.endswith(".skp")):
        m = C.c_void_p()
        if su.SUModelCreateFromFile(C.byref(m), os.path.join(pasta, a).encode("utf-8")) != 0:
            continue
        r = C.c_void_p()
        su.SUModelGetEntities(m, C.byref(r))
        assin_por_arq[a[:-4]] = list({it["assin"] for it in candidatos(itens_topo(r))})
        su.SUModelRelease(C.byref(m))
    os.makedirs(saida, exist_ok=True)
    json.dump({k: [[a[0], list(a[1])] for a in v] for k, v in assin_por_arq.items()}, open(cache_assin, "w", encoding="utf-8"))
freq = Counter(a for v in assin_por_arq.values() for a in v)


def perto(a, b, folga=5):
    return all(a["lo"][k] - folga <= b["hi"][k] and b["lo"][k] - folga <= a["hi"][k] for k in range(3))


def agrupar(itens):
    grupos = []
    for c in itens:
        juntos = [g for g in grupos if any(perto(c, x) for x in g)]
        novo = [c] + [x for g in juntos for x in g]
        grupos = [g for g in grupos if g not in juntos] + [novo]
    return grupos


def humano(c):
    """Figura humana de escala: em pé (a altura é a maior medida, 1,40 a 2,10 m) e base pequena nos dois lados."""
    x, y, z = c["dims"]
    return 140 <= z <= 210 and x <= 80 and y <= 80


def escolher(cands, pal):
    """Escolhe, entre os itens de um nível do modelo, os que formam o produto. Devolve (itens, tamanhos, avisos)."""
    avisos = []
    if os.environ.get("DEPURAR"):
        for c in cands:
            print("  cand", c["def"], c["dims"], [round(x) for x in c["lo"]], [round(x) for x in c["hi"]], "freq", freq[c["assin"]], flush=True)
    # adereço: assinatura em 3+ arquivos, nome sem relação com o produto e solto na cena; figura humana sai sempre
    def adereco(c):
        if palavras(c["def"]) & pal:
            return False
        if humano(c) and (freq[c["assin"]] >= 2 or re.search(r"stacy|sumele|pessoa|person|human", c["def"], re.I)):
            return True
        return freq[c["assin"]] >= 3 and not any(perto(c, o, 5) for o in cands if o is not c)
    filtrados = [c for c in cands if not adereco(c)]
    if len(filtrados) < len(cands):
        avisos.append(f"adereços descartados: {[c['def'] for c in cands if c not in filtrados]}")
    cands = filtrados or cands
    por_def = defaultdict(list)
    for c in cands:
        por_def[norm_def(c["def"])].append(c)
    tamanhos, escolhidos = [], []
    maior = max(max(c["dims"]) for c in cands)
    for d, lst in por_def.items():
        dims = {tuple(round(x) for x in c["dims"]) for c in lst}
        # variação de tamanho: mesmo componente, 2+ medidas, cada uma do tamanho de um móvel, lado a lado sem se tocar
        separadas = all(not perto(a, b, 0) for i, a in enumerate(lst) for b in lst[i + 1:])
        if len(lst) >= 2 and len(dims) >= 2 and separadas and all(max(c["dims"]) >= 0.5 * maior for c in lst):
            lst = sorted(lst, key=lambda c: c["dims"][0] * c["dims"][1] * c["dims"][2])
            tamanhos = [c["dims"] for c in lst]
            escolhidos.append(lst[(len(lst) - 1) // 2])
        else:
            escolhidos.extend(lst)
    if tamanhos and len(escolhidos) > 1:
        principal = [c for c in escolhidos if tuple(c["dims"]) in {tuple(t) for t in tamanhos}]
        if principal:
            avisos.append(f"itens fora da variação ignorados: {len(escolhidos) - len(principal)}")
            escolhidos = principal[:1]
    if not escolhidos:
        raise RuntimeError("nenhum item de produto na cena")
    if len(escolhidos) > 1:
        grupos = agrupar(escolhidos)
        if len(grupos) > 1:
            vol = lambda g: math.prod(max(x["hi"][k] for x in g) - min(x["lo"][k] for x in g) for k in range(3))
            def nota(g):
                pg = set().union(*(palavras(x["def"]) for x in g))
                return len(pg & pal) - len(pg - pal)
            # prefere o conjunto cujo nome bate com o arquivo, depois o com mais peças nomeadas, depois o maior
            grupos.sort(key=lambda g: (nota(g), sum(1 for x in g if not x.get("faces")), vol(g)), reverse=True)
            avisos.append(f"{len(grupos)} conjuntos separados; usado {[x['def'] for x in grupos[0]][:3]}")
            escolhidos = grupos[0]
    return escolhidos, tamanhos, avisos


for arq in arquivos:
    slug = arq[:-4]
    destino = os.path.join(saida, slug)
    os.makedirs(destino, exist_ok=True)
    m = C.c_void_p()
    if su.SUModelCreateFromFile(C.byref(m), os.path.join(pasta, arq).encode("utf-8")) != 0:
        print(f"ERRO {slug}: não abriu", flush=True)
        continue
    try:
        raiz = C.c_void_p()
        su.SUModelGetEntities(m, C.byref(raiz))
        cands = candidatos(itens_topo(raiz), palavras(slug))
        avisos = [f"componente com caixa enorme aceito pelo nome: {c['def']}" for c in cands if c.get("caixa_grande")]
        pal = palavras(slug)
        escolhidos, tamanhos, av = escolher(cands, pal)
        avisos += av
        # o produto escolhido é um grupo com conjuntos separados dentro (ex.: duas versões no mesmo grupo):
        # repete a escolha um nível abaixo
        for _ in range(3):
            if len(escolhidos) != 1 or escolhidos[0].get("faces"):
                break
            dentro = candidatos(itens_topo(escolhidos[0]["ents"], escolhidos[0]["t"]), pal)
            if len(dentro) < 2:
                break
            grupos_d = agrupar(dentro)
            grandes = [g for g in grupos_d if max(max(x["hi"][k] for x in g) - min(x["lo"][k] for x in g) for k in range(3)) >= 40]
            if len(grandes) < 2:
                break
            _, _, mat_pai = elem_info((su.SUGroupToDrawingElement if escolhidos[0]["grupo"] else su.SUComponentInstanceToDrawingElement)(escolhidos[0]["ref"].value))
            for c in dentro:
                c.setdefault("mat_pai", mat_pai)
            escolhidos, tam2, av = escolher(dentro, pal)
            tamanhos = tamanhos or tam2
            avisos += ["escolha feita dentro do grupo principal"] + av
        col = Coletor(destino)
        for c in escolhidos:
            if c.get("faces"):
                coletar(col, c["ents"], c["t"], c.get("mat_pai"), "soltas", 1_500_000, so_faces=c["faces"])
                continue
            _, _, mat = elem_info((su.SUGroupToDrawingElement if c["grupo"] else su.SUComponentInstanceToDrawingElement)(c["ref"].value))
            coletar(col, c["ents"], c["t"], mat or c.get("mat_pai"), f"{norm_def(c['def'])}#{c['ref'].value % 100000}", 1_500_000)
        lo = [min(v[k] for v in col.verts) for k in range(3)]
        hi = [max(v[k] for v in col.verts) for k in range(3)]
        meta = {
            "slug": slug, "triangulos": len(col.tris), "materiais": len(col.mats), "pecas": len(col.pecas),
            "medidas_cm": [round((hi[k] - lo[k]) * 100, 1) for k in range(3)],
            "tamanhos_cm": tamanhos, "itens": [c["def"] for c in escolhidos], "avisos": avisos,
        }
        json.dump({"vertices": col.verts, "triangulos": col.tris, "materiais": col.mats, "pecas": col.pecas, "meta": meta},
                  open(os.path.join(destino, "cena.json"), "w", encoding="utf-8"))
        print(f"OK {slug} {meta['medidas_cm']} tri {len(col.tris)} mat {len(col.mats)} pecas {len(col.pecas)}"
              f"{' tamanhos ' + str(len(tamanhos)) if tamanhos else ''}{' | ' + ' | '.join(avisos) if avisos else ''}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"ERRO {slug}: {e}", flush=True)
    finally:
        su.SUModelRelease(C.byref(m))
