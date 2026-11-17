# Lê bibliotecas de acabamento em .skp (amostras 10x20 cm com o nome em texto 3D logo abaixo de cada uma),
# junta cada amostra ao nome mais próximo e grava as texturas + acabamentos.json.
#
# python.exe -I skp-ler-acabamentos.py <pasta com .skp> <pasta de saída> <pasta do sketchup-sdk>
import ctypes as C
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import skp_exportar as s  # noqa: E402

origem, saida, sdk = sys.argv[1:4]
su = s.carregar(sdk)
for f in ("SUGroupToDrawingElement", "SUComponentInstanceToDrawingElement"):
    getattr(su, f).restype = C.c_void_p
    getattr(su, f).argtypes = [C.c_void_p]

CM = 2.54


class Transf(C.Structure):
    _fields_ = [("v", C.c_double * 16)]


IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def mult(a, b):  # matrizes 4x4 em colunas (como o SketchUp)
    return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]


def aplicar(m, p):
    x, y, z = p
    w = m[3] * x + m[7] * y + m[11] * z + m[15]  # o SketchUp às vezes guarda a escala no w
    return ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
            (m[2] * x + m[6] * y + m[10] * z + m[14]) / w)


def texto(fn, obj):
    st = C.c_void_p()
    su.SUStringCreate(C.byref(st))
    fn(obj, C.byref(st))
    n = C.c_size_t()
    su.SUStringGetUTF8Length(st, C.byref(n))
    b = C.create_string_buffer(n.value + 1)
    su.SUStringGetUTF8(st, n.value + 1, b, C.byref(n))
    su.SUStringRelease(C.byref(st))
    return b.value.decode("utf-8", "replace")


def lista(fn_n, fn_g, ents):
    n = C.c_size_t()
    fn_n(ents, C.byref(n))
    a = (C.c_void_p * n.value)()
    fn_g(ents, n, a, C.byref(n))
    return [C.c_void_p(x) for x in a]


def caixa_mundo(ents, m):
    b = s.Caixa()
    su.SUEntitiesGetBoundingBox(ents, C.byref(b))
    cantos = [aplicar(m, (x, y, z)) for x in (b.min.x, b.max.x) for y in (b.min.y, b.max.y) for z in (b.min.z, b.max.z)]
    return [min(c[i] for c in cantos) * CM for i in range(3)], [max(c[i] for c in cantos) * CM for i in range(3)]


class UVQ(C.Structure):
    _fields_ = [("u", C.c_double), ("v", C.c_double), ("q", C.c_double)]


def face_principal(ents):
    """Maior face (de preferência com material próprio): dá o material e o tamanho real da textura aplicada nela."""
    melhor = None
    for f in lista(su.SUEntitiesGetNumFaces, su.SUEntitiesGetFaces, ents):
        m = C.c_void_p()
        if su.SUFaceGetFrontMaterial(f, C.byref(m)) != 0:
            m = None
        if melhor and melhor[1] is not None and m is None:
            continue
        a = C.c_double()
        su.SUFaceGetArea(f, C.byref(a))
        if not melhor or (m is not None and melhor[1] is None) or a.value > melhor[2]:
            melhor = (f, m, a.value)
    return melhor


def tamanho_textura(face):
    """cm cobertos por uma repetição da imagem (largura, altura), medido na própria face (coordenadas locais)."""
    n = C.c_size_t()
    su.SUFaceGetNumVertices(face, C.byref(n))
    vs = (C.c_void_p * n.value)()
    su.SUFaceGetVertices(face, n, vs, C.byref(n))
    h = C.c_void_p()
    if su.SUFaceGetUVHelper(face, True, False, C.c_void_p(), C.byref(h)) != 0:
        return None
    pts = []
    for v in vs:
        p = s.P3()
        su.SUVertexGetPosition(C.c_void_p(v), C.byref(p))
        q = UVQ()
        su.SUUVHelperGetFrontUVQ(h, C.byref(p), C.byref(q))
        pts.append(((p.x, p.y, p.z), (q.u / q.q, q.v / q.q)))
    su.SUUVHelperRelease(C.byref(h))
    p0, t0 = pts[0]
    for i in range(1, len(pts)):
        for j in range(i + 1, len(pts)):
            e1 = [pts[i][0][k] - p0[k] for k in range(3)]
            e2 = [pts[j][0][k] - p0[k] for k in range(3)]
            d1 = [pts[i][1][k] - t0[k] for k in range(2)]
            d2 = [pts[j][1][k] - t0[k] for k in range(2)]
            det = d1[0] * d2[1] - d2[0] * d1[1]
            if abs(det) < 1e-9:
                continue
            # A = [e1 e2] * inv([d1 d2]); colunas de A = vetor 3D de 1 unidade de u e de v
            au = [(e1[k] * d2[1] - e2[k] * d1[1]) / det for k in range(3)]
            av = [(-e1[k] * d2[0] + e2[k] * d1[0]) / det for k in range(3)]
            comp = lambda x: round(sum(c * c for c in x) ** 0.5 * CM, 1)
            return [comp(au), comp(av)]
    return None


def coletar(ents, m, amostras, rotulos):
    for g in lista(su.SUEntitiesGetNumGroups, su.SUEntitiesGetGroups, ents):
        t = Transf()
        su.SUGroupGetTransform(g, C.byref(t))
        e = C.c_void_p()
        su.SUGroupGetEntities(g, C.byref(e))
        mm = mult(m, list(t.v))
        lo, hi = caixa_mundo(e, mm)
        dims = sorted(hi[i] - lo[i] for i in range(3))
        filhos = len(lista(su.SUEntitiesGetNumGroups, su.SUEntitiesGetGroups, e)) + len(lista(su.SUEntitiesGetNumInstances, su.SUEntitiesGetInstances, e))
        fp = face_principal(e)
        mat_grupo = C.c_void_p()
        if su.SUDrawingElementGetMaterial(C.c_void_p(su.SUGroupToDrawingElement(g.value)), C.byref(mat_grupo)) != 0:
            mat_grupo = None
        mat = (fp[1] if fp else None) or mat_grupo
        # candidata a amostra: placa fina, sem subgrupos, com material (nas faces ou no grupo)
        if fp and mat is not None and not filhos and dims[1] > 0 and dims[0] < 0.2 * dims[1] and dims[1] > 0.25 * dims[2]:
            amostras.append({"face": fp[0] if fp[1] is not None else None, "mat": mat, "lo": lo, "hi": hi, "tam": dims[2]})
        coletar(e, mm, amostras, rotulos)
    for i in lista(su.SUEntitiesGetNumInstances, su.SUEntitiesGetInstances, ents):
        t = Transf()
        su.SUComponentInstanceGetTransform(i, C.byref(t))
        d, e = C.c_void_p(), C.c_void_p()
        su.SUComponentInstanceGetDefinition(i, C.byref(d))
        su.SUComponentDefinitionGetEntities(d, C.byref(e))
        lo, hi = caixa_mundo(e, mult(m, list(t.v)))
        # O nome do componente de texto 3D é cortado em 16 letras; a descrição guarda o texto inteiro.
        nome = re.sub(r"#\d+$", "", texto(su.SUComponentDefinitionGetName, d)).strip()
        desc = " ".join(texto(su.SUComponentDefinitionGetDescription, d).split())
        if desc and desc.upper().startswith(nome[:8].upper()):
            nome = desc
        rotulos.append({"nome": nome, "lo": lo, "hi": hi})


def seguro(nome):
    return re.sub(r'[<>:"/\\|?*]+', "-", nome).strip()


resultado, avisos = [], []
for raiz, _, arquivos in os.walk(origem):
    for arq in sorted(arquivos):
        if not arq.lower().endswith(".skp"):
            continue
        categoria = os.path.basename(raiz)
        modelo, ents = C.c_void_p(), C.c_void_p()
        if su.SUModelCreateFromFile(C.byref(modelo), os.path.join(raiz, arq).encode("utf-8")) != 0:
            avisos.append(f"não abriu {arq}")
            continue
        su.SUModelGetEntities(modelo, C.byref(ents))
        amostras, rotulos = [], []
        coletar(ents, IDENT, amostras, rotulos)
        # as amostras de um arquivo têm todas o mesmo tamanho: descarta painéis de fundo e faixas
        if amostras:
            med = sorted(a["tam"] for a in amostras)[len(amostras) // 2]
            amostras = [a for a in amostras if 0.6 * med < a["tam"] < 1.6 * med]
        W = med if amostras else 1
        if os.environ.get("DEBUG"):
            for a in amostras:
                print("  amostra x %.0f..%.0f z %.0f..%.0f" % (a["lo"][0], a["hi"][0], a["lo"][2], a["hi"][2]))
            for r in rotulos:
                print("  rotulo %-20s x %.0f..%.0f z %.0f..%.0f" % (r["nome"], r["lo"][0], r["hi"][0], r["lo"][2], r["hi"][2]))
        livres = list(rotulos)
        pasta = os.path.join(saida, seguro(os.path.splitext(arq)[0]))
        os.makedirs(pasta, exist_ok=True)
        # Pareia amostra e nome. Em cada fileira de amostras, os nomes ficam logo abaixo.
        # Se a fileira tem o mesmo número de nomes e amostras, pareia pela ordem da esquerda para a direita
        # (alguns arquivos têm os nomes um pouco deslocados); senão, cada amostra fica com o nome mais próximo.
        pares = []
        fileiras = {}
        for a in amostras:
            fileiras.setdefault(round(a["lo"][2] / (0.5 * W)), []).append(a)
        for fila in fileiras.values():
            base = min(a["lo"][2] for a in fila)
            abaixo = [r for r in livres if base - 0.8 * W <= r["lo"][2] and r["hi"][2] <= base + 0.1 * W]
            fila.sort(key=lambda a: a["lo"][0])
            if len(abaixo) == len(fila):
                abaixo.sort(key=lambda r: r["lo"][0])
                for a, r in zip(fila, abaixo):
                    pares.append((a, r))
                    livres.remove(r)
                continue
            for a in fila:
                cx = (a["lo"][0] + a["hi"][0]) / 2

                def dist(r):
                    rx = (r["lo"][0] + r["hi"][0]) / 2
                    d = a["lo"][2] - r["hi"][2]
                    return abs(rx - cx) * 2 + (d if d >= -0.1 * W else 1e6)
                cand = sorted(livres, key=dist)
                if not cand or dist(cand[0]) > 2 * W:
                    avisos.append(f"{arq}: amostra em x={cx:.0f} sem nome")
                    continue
                pares.append((a, cand[0]))
                livres.remove(cand[0])
        for a, r in pares:
            mat = a["mat"]
            cor = s.Cor()
            su.SUMaterialGetColor(mat, C.byref(cor))
            item = {"arquivo_skp": arq, "categoria": categoria, "nome": r["nome"],
                    "cor": "#%02x%02x%02x" % (cor.red, cor.green, cor.blue), "textura": None, "tamanho_real_cm": None,
                    "posicao": [round(a["lo"][0] / W, 1), round(a["lo"][2] / W, 1)]}
            t = C.c_void_p()
            if su.SUMaterialGetTexture(mat, C.byref(t)) == 0:
                w, h, ss, ts = C.c_size_t(), C.c_size_t(), C.c_double(), C.c_double()
                su.SUTextureGetDimensions(t, C.byref(w), C.byref(h), C.byref(ss), C.byref(ts))
                ext = os.path.splitext(texto(su.SUTextureGetFileName, t))[1].lower() or ".jpg"
                destino = os.path.join(pasta, seguro(r["nome"]) + ext)
                su.SUTextureWriteToFile(t, destino.encode("utf-8"))
                item["textura"] = os.path.relpath(destino, saida).replace("\\", "/")
                item["px"] = [w.value, h.value]
                item["tamanho_real_cm"] = (tamanho_textura(a["face"]) if a["face"] else None) or ([round(CM / ss.value, 1), round(CM / ts.value, 1)] if ss.value and ts.value else None)
            resultado.append(item)
        sobra = [r["nome"] for r in livres]
        print(f"OK {arq}: {len(amostras)} amostras, {len(rotulos)} rótulos, sem amostra: {sobra}", flush=True)
        su.SUModelRelease(C.byref(modelo))

with open(os.path.join(saida, "acabamentos.json"), "w", encoding="utf-8") as f:
    json.dump(resultado, f, ensure_ascii=False, indent=1)
for a in avisos:
    print("AVISO", a)
print(f"TOTAL {len(resultado)} acabamentos", flush=True)
