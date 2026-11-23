# Monta o GLB de cada produto a partir do cena.json gerado por skp-extrair.py e faz uma imagem de conferência.
# blender.exe -b -P blender-montar-glb.py -- <pasta com subpastas por produto> [slug ...]
#
# Saída por produto: modelo.glb (metros, Y para cima no glTF), previa.png.
# Peças viram objetos separados (nome da peça), o que permite ligar partes a acabamentos depois.
import json
import math
import os
import sys
import traceback

import bmesh
import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
base, so = args[0], set(args[1:])
MAX_OBJETOS = 250          # acima disso, junta as peças por material (glTF com milhares de nós fica pesado)
MAX_TRI_WEB = 400_000      # acima disso, simplifica a malha do GLB


def srgb_linear(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def criar_material(m, pasta):
    mat = bpy.data.materials.new(m["nome"][:60] or "material")
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*[srgb_linear(c) for c in m["cor"]], 1)
    b.inputs["Roughness"].default_value = 0.6
    if m.get("textura") and os.path.exists(os.path.join(pasta, m["textura"])):
        tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(os.path.join(pasta, m["textura"]))
        mat.node_tree.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    if m.get("alfa", 1) < 0.999:
        b.inputs["Alpha"].default_value = m["alfa"]
        mat.blend_method = "BLEND"
    return mat


def montar(pasta):
    bpy.ops.wm.read_homefile(use_empty=True)
    cena_j = json.load(open(os.path.join(pasta, "cena.json"), encoding="utf-8"))
    verts, tris = cena_j["vertices"], cena_j["triangulos"]
    mats = [criar_material(m, pasta) for m in cena_j["materiais"]]
    padrao = bpy.data.materials.new("padrao")
    pecas = cena_j["pecas"]
    agrupar_por_material = len(pecas) > MAX_OBJETOS
    grupos = {}
    for t in tris:
        chave = t[6] if agrupar_por_material else t[7]
        grupos.setdefault(chave, []).append(t)
    # centro no chão: x/y centralizados, z mínimo = 0
    lo = [min(v[k] for v in verts) for k in range(3)]
    hi = [max(v[k] for v in verts) for k in range(3)]
    desloc = Vector(((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]))
    for chave, lst in grupos.items():
        nome = (cena_j["materiais"][chave]["nome"] if agrupar_por_material and chave >= 0 else
                pecas[chave].split("/")[-1].split("#")[0] if not agrupar_por_material else "sem_material") or "peca"
        me = bpy.data.meshes.new(nome[:60])
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new("UVMap")
        mapa = {}
        usados = []
        for t in lst:
            mi = t[6]
            if mi not in usados:
                usados.append(mi)
        for i, m in enumerate(usados):
            me.materials.append(mats[m] if m >= 0 else padrao)
        for t in lst:
            vs = []
            for vi in t[:3]:
                if vi not in mapa:
                    mapa[vi] = bm.verts.new(Vector(verts[vi]) - desloc)
                vs.append(mapa[vi])
            try:
                f = bm.faces.new(vs)
            except ValueError:  # face repetida
                continue
            f.material_index = usados.index(t[6])
            for lp, u in zip(f.loops, t[3:6]):
                lp[uv].uv = u
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = False
        ob = bpy.data.objects.new(nome[:60], me)
        bpy.context.scene.collection.objects.link(ob)
    # simplifica para a web se muito pesado
    total = sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type == "MESH")
    if total > MAX_TRI_WEB:
        r = MAX_TRI_WEB / total
        for o in bpy.context.scene.objects:
            if o.type == "MESH" and len(o.data.polygons) > 200:
                mod = o.modifiers.new("dec", "DECIMATE")
                mod.ratio = r
                mod.use_collapse_triangulate = True
    bpy.ops.export_scene.gltf(filepath=os.path.join(pasta, "modelo.glb"), export_format="GLB", export_apply=True,
                              export_yup=True, export_image_format="AUTO")
    return total, len(grupos)


def previa(pasta):
    cena = bpy.context.scene
    cena.render.engine = "BLENDER_WORKBENCH"
    cena.display.shading.light = "STUDIO"
    cena.display.shading.color_type = "TEXTURE"
    cena.render.resolution_x, cena.render.resolution_y = 420, 320
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
    cena.render.filepath = os.path.join(pasta, "previa.png")
    bpy.ops.render.render(write_still=True)


for slug in sorted(os.listdir(base)):
    pasta = os.path.join(base, slug)
    if so and slug not in so or not os.path.exists(os.path.join(pasta, "cena.json")):
        continue
    try:
        total, nobj = montar(pasta)
        previa(pasta)
        print(f"OK {slug} tri {total} objetos {nobj}", flush=True)
    except Exception:
        print(f"ERRO {slug}\n{traceback.format_exc()}", flush=True)
