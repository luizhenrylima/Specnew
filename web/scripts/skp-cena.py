# Levanta o que há no nível de cima de cada .skp (produto, câmeras, piso, figura humana...) para achar o produto na cena.
# python.exe -I skp-cena.py <pasta com .skp> <saida.json> <pasta do sketchup-sdk>
import ctypes as C
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import skp_exportar as s  # noqa: E402

pasta, saida, sdk = sys.argv[1:4]
su = s.carregar(sdk)
for f in ("SUGroupToDrawingElement", "SUComponentInstanceToDrawingElement", "SUFaceToDrawingElement", "SUEdgeToDrawingElement"):
    getattr(su, f).restype = C.c_void_p
    getattr(su, f).argtypes = [C.c_void_p]


class Transf(C.Structure):
    _fields_ = [("v", C.c_double * 16)]


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


def tag_de(elem):
    l = C.c_void_p()
    return texto(su.SULayerGetName, l) if su.SUDrawingElementGetLayer(C.c_void_p(elem), C.byref(l)) == 0 else ""


def oculto(elem):
    h = C.c_bool()
    su.SUDrawingElementGetHidden(C.c_void_p(elem), C.byref(h))
    return h.value


cache = {}


def contar(ents):
    """faces (recursivo) por entities; definições repetidas contam uma vez por uso."""
    k = ents.value
    if k in cache:
        return cache[k]
    n = C.c_size_t()
    su.SUEntitiesGetNumFaces(ents, C.byref(n))
    total = n.value
    for g in lista(su.SUEntitiesGetNumGroups, su.SUEntitiesGetGroups, ents):
        e = C.c_void_p()
        su.SUGroupGetEntities(g, C.byref(e))
        total += contar(e)
    for i in lista(su.SUEntitiesGetNumInstances, su.SUEntitiesGetInstances, ents):
        d, e = C.c_void_p(), C.c_void_p()
        su.SUComponentInstanceGetDefinition(i, C.byref(d))
        su.SUComponentDefinitionGetEntities(d, C.byref(e))
        total += contar(e)
    cache[k] = total
    return total


def caixa_mundo(ents, t):
    b = s.Caixa()
    su.SUEntitiesGetBoundingBox(ents, C.byref(b))
    m = list(t.v)
    pts = []
    for x in (b.min.x, b.max.x):
        for y in (b.min.y, b.max.y):
            for z in (b.min.z, b.max.z):
                w = m[3] * x + m[7] * y + m[11] * z + m[15]
                pts.append([(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
                            (m[2] * x + m[6] * y + m[10] * z + m[14]) / w])
    return [round(min(p[i] for p in pts) * 2.54, 1) for i in range(3)], [round(max(p[i] for p in pts) * 2.54, 1) for i in range(3)]


resultado = {}
for arq in sorted(os.listdir(pasta)):
    if not arq.endswith(".skp"):
        continue
    slug = arq[:-4]
    m = C.c_void_p()
    r = su.SUModelCreateFromFile(C.byref(m), os.path.join(pasta, arq).encode("utf-8"))
    if r != 0:
        resultado[slug] = {"erro": r}
        print("ERRO", slug, r, flush=True)
        continue
    cache.clear()
    raiz = C.c_void_p()
    su.SUModelGetEntities(m, C.byref(raiz))
    itens = []
    nf = C.c_size_t()
    su.SUEntitiesGetNumFaces(raiz, C.byref(nf))
    if nf.value:
        itens.append({"tipo": "faces_soltas", "faces": nf.value})
    for g in lista(su.SUEntitiesGetNumGroups, su.SUEntitiesGetGroups, raiz):
        t, e = Transf(), C.c_void_p()
        su.SUGroupGetTransform(g, C.byref(t))
        su.SUGroupGetEntities(g, C.byref(e))
        de = su.SUGroupToDrawingElement(g.value)
        lo, hi = caixa_mundo(e, t)
        itens.append({"tipo": "grupo", "nome": texto(su.SUGroupGetName, g), "tag": tag_de(de), "oculto": oculto(de),
                      "min": lo, "max": hi, "faces": contar(e)})
    for i in lista(su.SUEntitiesGetNumInstances, su.SUEntitiesGetInstances, raiz):
        t, d, e = Transf(), C.c_void_p(), C.c_void_p()
        su.SUComponentInstanceGetTransform(i, C.byref(t))
        su.SUComponentInstanceGetDefinition(i, C.byref(d))
        su.SUComponentDefinitionGetEntities(d, C.byref(e))
        de = su.SUComponentInstanceToDrawingElement(i.value)
        lo, hi = caixa_mundo(e, t)
        itens.append({"tipo": "componente", "nome": texto(su.SUComponentInstanceGetName, i), "def": texto(su.SUComponentDefinitionGetName, d),
                      "tag": tag_de(de), "oculto": oculto(de), "min": lo, "max": hi, "faces": contar(e)})
    resultado[slug] = {"itens": itens}
    su.SUModelRelease(C.byref(m))
    print("OK", slug, len(itens), flush=True)

json.dump(resultado, open(saida, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
