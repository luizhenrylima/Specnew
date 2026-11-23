# Roda dentro do Blender (modo sem janela). Para cada linha "entrada.glb|pasta_saida|nome" do arquivo de lista,
# importa o GLB e exporta FBX (texturas embutidas), DAE (Collada, texturas ao lado) e 3DS (se disponível).
#
# blender.exe -b -P blender-exportar.py -- lista.txt
import bpy
import os
import sys
import traceback

lista = sys.argv[sys.argv.index("--") + 1]

# Exportador 3DS é uma extensão oficial no Blender 4.2+ (instalada no Blender portátil em ferramentas/).
try:
    bpy.ops.preferences.addon_enable(module="bl_ext.user_default.autodesk_3ds_format")
except Exception:
    pass
TEM_3DS = "max3ds" in dir(bpy.ops.export_scene)


def limpar():
    # read_homefile mantém as extensões ativas (read_factory_settings desligaria o 3DS).
    bpy.ops.wm.read_homefile(use_empty=True)
    cena = bpy.context.scene
    cena.unit_settings.system = "METRIC"
    cena.unit_settings.scale_length = 1.0


def salvar_texturas(pasta):
    """Grava as imagens embutidas no GLB como arquivos, para o Collada/3DS referenciarem por nome."""
    for i, img in enumerate(bpy.data.images):
        if img.type != "IMAGE" or not img.has_data:
            continue
        ext = ".png" if (img.file_format or "").upper() == "PNG" else ".jpg"
        nome = f"textura_{i + 1}{ext}"
        img.filepath_raw = os.path.join(pasta, nome)
        img.file_format = "PNG" if ext == ".png" else "JPEG"
        img.save()


LIMITE_3DS = 60000  # o formato 3DS aceita no máximo 65.535 vértices por objeto


def dividir_para_3ds():
    """Separa as malhas por material e, se ainda passarem do limite do 3DS, por partes soltas."""
    def separar(tipo):
        for ob in [o for o in bpy.context.scene.objects if o.type == "MESH" and len(o.data.vertices) > LIMITE_3DS]:
            bpy.ops.object.select_all(action="DESELECT")
            ob.select_set(True)
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.mesh.separate(type=tipo)
            bpy.ops.object.mode_set(mode="OBJECT")
    separar("MATERIAL")
    # Separar por partes soltas trava em malhas densas (milhares de pedaços); em vez disso,
    # corta cada malha grande em blocos de faces seguidas, cada um abaixo do limite.
    import bmesh
    for ob in [o for o in bpy.context.scene.objects if o.type == "MESH" and len(o.data.vertices) > LIMITE_3DS]:
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.mode_set(mode="EDIT")
        while True:
            bm = bmesh.from_edit_mesh(ob.data)
            if len(bm.verts) <= LIMITE_3DS:
                break
            for f in bm.faces:
                f.select_set(False)
            usados = set()
            marcadas = 0
            for f in bm.faces:
                novos = [v for v in f.verts if v not in usados]
                if len(usados) + len(novos) > LIMITE_3DS - 100:
                    break
                usados.update(novos)
                f.select_set(True)
                marcadas += 1
            if not marcadas:
                break
            bmesh.update_edit_mesh(ob.data)
            bpy.ops.mesh.separate(type="SELECTED")
        bpy.ops.object.mode_set(mode="OBJECT")
    grandes = [o.name for o in bpy.context.scene.objects if o.type == "MESH" and len(o.data.vertices) > 65535]
    if grandes:
        print(f"AVISO 3DS: objetos ainda acima do limite: {grandes}", flush=True)


def exportar(glb, pasta, nome):
    limpar()
    bpy.ops.import_scene.gltf(filepath=glb)
    # Agrupa tudo num objeto vazio com o nome do produto (fica organizado no Lumion/3ds Max/SketchUp).
    raiz = bpy.data.objects.new(nome, None)
    bpy.context.scene.collection.objects.link(raiz)
    for ob in list(bpy.context.scene.objects):
        if ob is not raiz and ob.parent is None:
            ob.parent = raiz
    for ob in bpy.context.scene.objects:
        if ob.type == "MESH":
            ob.name = nome if len(bpy.data.meshes) == 1 else ob.name

    os.makedirs(os.path.join(pasta, "fbx"), exist_ok=True)
    bpy.ops.export_scene.fbx(
        filepath=os.path.join(pasta, "fbx", f"{nome}.fbx"),
        path_mode="COPY", embed_textures=True,
        apply_unit_scale=True, apply_scale_options="FBX_SCALE_UNITS",
        axis_forward="-Z", axis_up="Y", use_mesh_modifiers=True, mesh_smooth_type="FACE",
    )
    print(f"FEITO fbx {nome}", flush=True)

    dae = os.path.join(pasta, "dae")
    os.makedirs(dae, exist_ok=True)
    bpy.ops.wm.collada_export(
        filepath=os.path.join(dae, f"{nome}.dae"),
        use_texture_copies=True, export_global_forward_selection="-Z", export_global_up_selection="Y",
        apply_global_orientation=False, triangulate=False,
    )
    print(f"FEITO dae {nome}", flush=True)

    if TEM_3DS:
        dividir_para_3ds()
        tds = os.path.join(pasta, "3ds")
        os.makedirs(tds, exist_ok=True)
        salvar_texturas(tds)
        bpy.ops.export_scene.max3ds(filepath=os.path.join(tds, f"{nome}.3ds"))


with open(lista, encoding="utf-8") as f:
    itens = [l.strip().split("|") for l in f if l.strip()]

for glb, pasta, nome in itens:
    try:
        exportar(glb, pasta, nome)
        print(f"OK {nome}", flush=True)
    except Exception:
        print(f"ERRO {nome}\n{traceback.format_exc()}", flush=True)
