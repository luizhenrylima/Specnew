# Gera .skp (SketchUp) chamando a DLL do SketchUp C SDK via ctypes. Não precisa de compilador: a API é C puro.
# A DLL fica em ferramentas/sketchup-sdk (fora do Git; o SDK é baixado com login da Trimble).
#
# São duas etapas, porque a DLL do SketchUp trava se for carregada dentro do processo do Blender:
#   1) extrair_cena()  roda dentro do Blender: grava triângulos, UVs, materiais e texturas num cena.json.
#   2) gerar_skp()     roda no Python do Blender, em processo separado: lê o cena.json e grava o .skp.
import ctypes as C
import json
import math
import os

POL = 1 / 0.0254  # metros -> polegadas (unidade interna do SketchUp)
VERSAO_SU2017 = 10  # SUModelVersion_SU2017: abre em qualquer SketchUp de 2017 em diante
ANGULO_SUAVE = math.radians(30)  # arestas entre faces com menos que isso ficam suavizadas (sem linha)


# ---------------------------------------------------------------- 1) dentro do Blender

def _srgb(c):
    c = max(0.0, min(1.0, c))
    return round(255 * (12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055))


def _material_blender(mat, pasta, n):
    cor, img, alfa = (0.8, 0.8, 0.8), None, 1.0
    if mat and mat.use_nodes:
        bsdf = next((x for x in mat.node_tree.nodes if x.type == "BSDF_PRINCIPLED"), None)
        if bsdf:
            base = bsdf.inputs["Base Color"]
            cor = tuple(base.default_value[:3])
            alfa = bsdf.inputs["Alpha"].default_value
            pilha = [l.from_node for l in base.links]
            while pilha:
                x = pilha.pop()
                if x.type == "TEX_IMAGE" and x.image:
                    img = x.image
                    break
                pilha += [l.from_node for i in x.inputs for l in i.links]
    textura = None
    if img and img.size[0] > 0:  # ler .size carrega a imagem embutida no GLB
        ext = ".png" if (img.file_format or "").upper() == "PNG" else ".jpg"
        textura = os.path.join(pasta, f"textura_{n}{ext}")
        img.filepath_raw = textura
        img.file_format = "PNG" if ext == ".png" else "JPEG"
        img.save()
    return {"nome": mat.name if mat else "Padrao", "cor": [_srgb(c) for c in cor], "alfa": alfa, "textura": textura}


def extrair_cena(pasta):
    """Grava <pasta>/cena.json com todas as malhas da cena (polegadas, Z para cima) e as texturas ao lado."""
    import bpy

    os.makedirs(pasta, exist_ok=True)
    deps = bpy.context.evaluated_depsgraph_get()
    verts, idx_vert, tris, mats, idx_mat = [], {}, [], [], {}

    def vid(co):
        k = (round(co[0], 4), round(co[1], 4), round(co[2], 4))
        if k not in idx_vert:
            idx_vert[k] = len(verts)
            verts.append(k)
        return idx_vert[k]

    def mid(mat):
        chave = mat.name if mat else ""
        if chave not in idx_mat:
            idx_mat[chave] = len(mats)
            mats.append(_material_blender(mat, pasta, len(mats)))
        return idx_mat[chave]

    for ob in bpy.context.scene.objects:
        if ob.type != "MESH":
            continue
        me = ob.evaluated_get(deps).to_mesh()
        me.calc_loop_triangles()
        mw = ob.matrix_world
        uv = me.uv_layers.active.data if me.uv_layers.active else None
        for t in me.loop_triangles:
            ids = [vid(mw @ me.vertices[v].co * POL) for v in t.vertices]
            if len(set(ids)) < 3:
                continue
            uvs = [list(uv[l].uv) if uv else [0.0, 0.0] for l in t.loops]
            mat = ob.material_slots[t.material_index].material if ob.material_slots else None
            tris.append([ids, uvs, mid(mat)])
        ob.evaluated_get(deps).to_mesh_clear()

    with open(os.path.join(pasta, "cena.json"), "w", encoding="utf-8") as f:
        json.dump({"vertices": verts, "triangulos": tris, "materiais": mats}, f)
    return len(tris)


# ---------------------------------------------------------------- 2) fora do Blender

class P3(C.Structure):
    _fields_ = [("x", C.c_double), ("y", C.c_double), ("z", C.c_double)]


class P2(C.Structure):
    _fields_ = [("x", C.c_double), ("y", C.c_double)]


class MatInput(C.Structure):
    _fields_ = [("num_uv_coords", C.c_size_t), ("uv_coords", P2 * 4), ("vertex_indices", C.c_size_t * 4), ("material", C.c_void_p)]


class Cor(C.Structure):
    _fields_ = [("red", C.c_ubyte), ("green", C.c_ubyte), ("blue", C.c_ubyte), ("alpha", C.c_ubyte)]


class Caixa(C.Structure):
    _fields_ = [("min", P3), ("max", P3)]


_su = None


def carregar(sdk_dir):
    global _su
    if _su is None:
        os.add_dll_directory(sdk_dir)
        _su = C.CDLL(os.path.join(sdk_dir, "SketchUpAPI.dll"))
        _su.SUTextureCreateFromFile.argtypes = [C.POINTER(C.c_void_p), C.c_char_p, C.c_double, C.c_double]
        _su.SUInitialize()
    return _su


class ErroSU(Exception):
    pass


def chamar(nome, *args):
    r = getattr(_su, nome)(*args)
    if r != 0:
        raise ErroSU(f"{nome} retornou {r}")


def ref():
    return C.c_void_p()


def _definir_cm(modelo):
    """Unidades do modelo em centímetros, formato decimal."""
    try:
        om, prov = ref(), ref()
        chamar("SUModelGetOptionsManager", modelo, C.byref(om))
        chamar("SUOptionsManagerGetOptionsProviderByName", om, b"UnitsOptions", C.byref(prov))
        for chave, valor in ((b"LengthFormat", 0), (b"LengthUnit", 3), (b"LengthPrecision", 1)):
            v = ref()
            chamar("SUTypedValueCreate", C.byref(v))
            chamar("SUTypedValueSetInt32", v, C.c_int32(valor))
            chamar("SUOptionsProviderSetValue", prov, chave, v)
            chamar("SUTypedValueRelease", C.byref(v))
    except ErroSU as e:
        print(f"AVISO SKP unidades: {e}", flush=True)


def _criar_material(modelo, m):
    r = ref()
    chamar("SUMaterialCreate", C.byref(r))
    chamar("SUMaterialSetName", r, m["nome"].encode("utf-8"))
    chamar("SUMaterialSetColor", r, C.byref(Cor(*m["cor"], 255)))
    if m["alfa"] < 0.999:
        chamar("SUMaterialSetOpacity", r, C.c_double(m["alfa"]))
        chamar("SUMaterialSetUseOpacity", r, C.c_bool(True))
    if m["textura"]:
        t = ref()
        # Com UVs explícitos a escala só define o tamanho exibido no editor de materiais (1 m).
        chamar("SUTextureCreateFromFile", C.byref(t), m["textura"].encode("utf-8"), POL, POL)
        chamar("SUMaterialSetTexture", r, t)
    chamar("SUModelAddMaterials", modelo, C.c_size_t(1), C.byref(r))
    return r


def gerar_skp(cena_json, caminho, nome, sdk_dir):
    """Lê o cena.json e grava um .skp com um único componente chamado `nome`. Retorna nº de faces enviadas."""
    carregar(sdk_dir)
    with open(cena_json, encoding="utf-8") as f:
        cena = json.load(f)
    verts, tris = cena["vertices"], cena["triangulos"]

    def normal(a, b, c):
        ax, ay, az = verts[a]; bx, by, bz = verts[b]; cx, cy, cz = verts[c]
        u = (bx - ax, by - ay, bz - az); w = (cx - ax, cy - ay, cz - az)
        n = (u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0])
        s = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2)
        return (n[0] / s, n[1] / s, n[2] / s) if s > 0 else None

    normais = [normal(*t[0]) for t in tris]
    arestas = {}
    for i, (ids, _, _) in enumerate(tris):
        for a, b in ((ids[0], ids[1]), (ids[1], ids[2]), (ids[2], ids[0])):
            arestas.setdefault((min(a, b), max(a, b)), []).append(i)

    def suave(a, b):
        f = arestas.get((min(a, b), max(a, b)), [])
        if len(f) != 2 or not normais[f[0]] or not normais[f[1]]:
            return False
        return abs(sum(x * y for x, y in zip(normais[f[0]], normais[f[1]]))) >= math.cos(ANGULO_SUAVE)

    modelo, geo, defn, ents, inst, raiz = ref(), ref(), ref(), ref(), ref(), ref()
    chamar("SUModelCreate", C.byref(modelo))
    try:
        _definir_cm(modelo)
        mats = [_criar_material(modelo, m) for m in cena["materiais"]]
        texturizado = [bool(m["textura"]) for m in cena["materiais"]]
        chamar("SUGeometryInputCreate", C.byref(geo))
        arr = (P3 * len(verts))(*[P3(*v) for v in verts])
        chamar("SUGeometryInputSetVertices", geo, C.c_size_t(len(verts)), arr)
        faces = 0
        for i, (ids, uvs, mi_idx) in enumerate(tris):
            if normais[i] is None:  # triângulo degenerado
                continue
            loop = ref()
            chamar("SULoopInputCreate", C.byref(loop))
            for v in ids:
                chamar("SULoopInputAddVertexIndex", loop, C.c_size_t(v))
            for e, (a, b) in enumerate(((ids[0], ids[1]), (ids[1], ids[2]), (ids[2], ids[0]))):
                if suave(a, b):
                    chamar("SULoopInputEdgeSetSoft", loop, C.c_size_t(e), C.c_bool(True))
                    chamar("SULoopInputEdgeSetSmooth", loop, C.c_size_t(e), C.c_bool(True))
            fi = C.c_size_t()
            if _su.SUGeometryInputAddFace(geo, C.byref(loop), C.byref(fi)) != 0:
                _su.SULoopInputRelease(C.byref(loop))
                continue
            mi = MatInput()
            mi.material = mats[mi_idx]
            if texturizado[mi_idx]:
                mi.num_uv_coords = 3
                for k in range(3):
                    mi.uv_coords[k] = P2(*uvs[k])
                    mi.vertex_indices[k] = ids[k]
            chamar("SUGeometryInputFaceSetFrontMaterial", geo, fi, C.byref(mi))
            chamar("SUGeometryInputFaceSetBackMaterial", geo, fi, C.byref(mi))
            faces += 1

        chamar("SUComponentDefinitionCreate", C.byref(defn))
        chamar("SUComponentDefinitionSetName", defn, nome.encode("utf-8"))
        chamar("SUModelAddComponentDefinitions", modelo, C.c_size_t(1), C.byref(defn))
        chamar("SUComponentDefinitionGetEntities", defn, C.byref(ents))
        chamar("SUEntitiesFill", ents, geo, C.c_bool(True))
        chamar("SUComponentDefinitionCreateInstance", defn, C.byref(inst))
        chamar("SUModelGetEntities", modelo, C.byref(raiz))
        chamar("SUEntitiesAddInstance", raiz, inst, None)
        os.makedirs(os.path.dirname(caminho), exist_ok=True)
        chamar("SUModelSaveToFileWithVersion", modelo, caminho.encode("utf-8"), C.c_int(VERSAO_SU2017))
        return faces
    finally:
        if geo:
            _su.SUGeometryInputRelease(C.byref(geo))
        _su.SUModelRelease(C.byref(modelo))


def conferir_skp(caminho):
    """Reabre o .skp e devolve medidas (cm, L x P x A), nº de faces, materiais e materiais com textura."""
    modelo, raiz = ref(), ref()
    chamar("SUModelCreateFromFile", C.byref(modelo), caminho.encode("utf-8"))
    try:
        chamar("SUModelGetEntities", modelo, C.byref(raiz))
        n = C.c_size_t()
        chamar("SUEntitiesGetNumInstances", raiz, C.byref(n))
        insts = (C.c_void_p * n.value)()
        chamar("SUEntitiesGetInstances", raiz, n, insts, C.byref(n))
        defn, ents = ref(), ref()
        chamar("SUComponentInstanceGetDefinition", C.c_void_p(insts[0]), C.byref(defn))
        chamar("SUComponentDefinitionGetEntities", defn, C.byref(ents))
        cx = Caixa()
        chamar("SUEntitiesGetBoundingBox", ents, C.byref(cx))
        nf, nm = C.c_size_t(), C.c_size_t()
        chamar("SUEntitiesGetNumFaces", ents, C.byref(nf))
        chamar("SUModelGetNumMaterials", modelo, C.byref(nm))
        mats = (C.c_void_p * nm.value)()
        chamar("SUModelGetMaterials", modelo, nm, mats, C.byref(nm))
        tex = sum(1 for m in mats if _su.SUMaterialGetTexture(C.c_void_p(m), C.byref(ref())) == 0)
        cm = lambda a, b: round((b - a) * 2.54, 1)
        return {"cm": [cm(cx.min.x, cx.max.x), cm(cx.min.y, cx.max.y), cm(cx.min.z, cx.max.z)],
                "faces": nf.value, "materiais": nm.value, "texturas": tex}
    finally:
        _su.SUModelRelease(C.byref(modelo))
