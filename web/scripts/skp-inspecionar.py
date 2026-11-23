# Mostra como um .skp está organizado: tags, grupos/componentes (com nome, material e tamanho), materiais e medidas.
# python.exe -I skp-inspecionar.py <arquivo.skp> <pasta do sketchup-sdk> [profundidade]
import ctypes as C
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import skp_exportar as s  # noqa: E402

arq, sdk = sys.argv[1], sys.argv[2]
prof = int(sys.argv[3]) if len(sys.argv) > 3 else 3
su = s.carregar(sdk)
for f in ("SUGroupToDrawingElement", "SUComponentInstanceToDrawingElement"):
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


def mat_de(elem):
    m = C.c_void_p()
    return texto(su.SUMaterialGetName, m) if su.SUDrawingElementGetMaterial(C.c_void_p(elem), C.byref(m)) == 0 else "-"


def tag_de(elem):
    l = C.c_void_p()
    return texto(su.SULayerGetName, l) if su.SUDrawingElementGetLayer(C.c_void_p(elem), C.byref(l)) == 0 else "-"


def caixa(ents):
    b = s.Caixa()
    su.SUEntitiesGetBoundingBox(ents, C.byref(b))
    return "%.0fx%.0fx%.0f" % tuple((getattr(b.max, k) - getattr(b.min, k)) * 2.54 for k in "xyz")


def faces_info(ents):
    fs = lista(su.SUEntitiesGetNumFaces, su.SUEntitiesGetFaces, ents)
    mats = {}
    for f in fs:
        m = C.c_void_p()
        k = texto(su.SUMaterialGetName, m) if su.SUFaceGetFrontMaterial(f, C.byref(m)) == 0 else "-"
        mats[k] = mats.get(k, 0) + 1
    return len(fs), mats


def andar(ents, nivel):
    pad = "  " * nivel
    nf, mats = faces_info(ents)
    if nf:
        print(f"{pad}faces {nf} {dict(sorted(mats.items(), key=lambda x: -x[1])[:5])}")
    if nivel >= prof:
        return
    for g in lista(su.SUEntitiesGetNumGroups, su.SUEntitiesGetGroups, ents):
        e = C.c_void_p()
        su.SUGroupGetEntities(g, C.byref(e))
        de = su.SUGroupToDrawingElement(g.value)
        print(f"{pad}GRUPO {texto(su.SUGroupGetName, g)!r} mat={mat_de(de)} tag={tag_de(de)} {caixa(e)}cm")
        andar(e, nivel + 1)
    for i in lista(su.SUEntitiesGetNumInstances, su.SUEntitiesGetInstances, ents):
        d, e = C.c_void_p(), C.c_void_p()
        su.SUComponentInstanceGetDefinition(i, C.byref(d))
        su.SUComponentDefinitionGetEntities(d, C.byref(e))
        de = su.SUComponentInstanceToDrawingElement(i.value)
        print(f"{pad}COMP {texto(su.SUComponentInstanceGetName, i)!r} def={texto(su.SUComponentDefinitionGetName, d)!r} mat={mat_de(de)} tag={tag_de(de)} {caixa(e)}cm")
        andar(e, nivel + 1)


m = C.c_void_p()
r = su.SUModelCreateFromFile(C.byref(m), arq.encode("utf-8"))
if r != 0:
    print("ERRO ao abrir", r)
    sys.exit(1)
raiz = C.c_void_p()
su.SUModelGetEntities(m, C.byref(raiz))
print("TAGS:", [texto(su.SULayerGetName, l) for l in lista(su.SUModelGetNumLayers, su.SUModelGetLayers, m)])
nm = C.c_size_t()
su.SUModelGetNumMaterials(m, C.byref(nm))
mats = (C.c_void_p * nm.value)()
su.SUModelGetMaterials(m, nm, mats, C.byref(nm))
desc = []
for x in mats:
    t = C.c_void_p()
    tem = su.SUMaterialGetTexture(C.c_void_p(x), C.byref(t)) == 0
    desc.append(texto(su.SUMaterialGetName, C.c_void_p(x)) + (" [tex]" if tem else ""))
print(f"MATERIAIS ({nm.value}):", desc)
print("CAIXA TOTAL:", caixa(raiz), "cm")
andar(raiz, 0)
su.SUModelRelease(C.byref(m))
