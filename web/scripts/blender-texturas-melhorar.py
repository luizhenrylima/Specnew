# Melhora as texturas de acabamento para o visualizador:
#  1) tira a variação de luz da foto da amostra (centro claro, bordas escuras) mantendo cor média e veio;
#  2) torna a imagem emendável (sem costura ao repetir), misturando com a cópia deslocada de meia imagem;
#  3) gera um mapa de relevo (normal map) a partir do detalhe da imagem.
# blender.exe -b -P blender-texturas-melhorar.py -- lista.txt
# lista.txt: "entrada|saida_base" por linha -> <saida_base>-cor.jpg, <saida_base>-normal.jpg, <saida_base>-mini.jpg
import json
import sys

import bpy
import numpy as np

lista = sys.argv[sys.argv.index("--") + 1]
TAM = 2048


def ler(arq):
    img = bpy.data.images.load(arq)
    img.colorspace_settings.name = "sRGB"
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[:, :, :3]
    bpy.data.images.remove(img)
    return a


def redimensionar(a, nw, nh):
    h, w, _ = a.shape
    ys = (np.arange(nh) + 0.5) * h / nh - 0.5
    xs = (np.arange(nw) + 0.5) * w / nw - 0.5
    y0 = np.clip(np.floor(ys).astype(int), 0, h - 1); y1 = np.clip(y0 + 1, 0, h - 1); fy = (ys - y0)[:, None, None]
    x0 = np.clip(np.floor(xs).astype(int), 0, w - 1); x1 = np.clip(x0 + 1, 0, w - 1); fx = (xs - x0)[None, :, None]
    a = a[y0] * (1 - fy) + a[y1] * fy
    return a[:, x0] * (1 - fx) + a[:, x1] * fx


def desfocar(a, sigma):
    """Desfoque gaussiano periódico via FFT (canal único ou RGB)."""
    h, w = a.shape[:2]
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    g = np.exp(-2 * (np.pi * sigma) ** 2 * (fx ** 2 + fy ** 2))
    if a.ndim == 2:
        return np.real(np.fft.ifft2(np.fft.fft2(a) * g))
    return np.stack([np.real(np.fft.ifft2(np.fft.fft2(a[:, :, c]) * g)) for c in range(a.shape[2])], axis=2)


def salvar(a, arq, qualidade=88):
    h, w = a.shape[:2]
    if a.ndim == 2:
        a = np.repeat(a[:, :, None], 3, axis=2)
    rgba = np.concatenate([np.clip(a, 0, 1), np.ones((h, w, 1), np.float32)], axis=2)
    img = bpy.data.images.new("t", w, h, alpha=False)
    img.colorspace_settings.name = "sRGB"
    img.pixels = rgba.ravel()
    img.filepath_raw = arq
    img.file_format = "JPEG"
    bpy.context.scene.render.image_settings.quality = qualidade
    img.save()
    bpy.data.images.remove(img)


def recortar(a):
    """Algumas texturas do fornecedor são o cartão do catálogo: amostra + margem branca + nome impresso embaixo,
    às vezes com selo ("LANÇAMENTO 2024") dentro da amostra. Recorta para a área só de amostra."""
    h, w, _ = a.shape
    lum = a.mean(axis=2)
    centro = lum[int(h * .2):int(h * .8), int(w * .2):int(w * .8)]
    # amostra clara (mármore branco, laca off white): só o branco puro do papel do cartão conta como margem
    limite = 0.9 if np.percentile(centro, 95) <= 0.85 else max(0.965, float(np.percentile(centro, 99.5)) + 0.015)
    branco = lum > limite
    # 1) margem e faixa do nome: maior trecho de linhas/colunas quase sem branco (medido longe das bordas)
    fr_l = branco[:, int(w * .1):int(w * .9)].mean(axis=1)
    fr_c = branco[int(h * .1):int(h * .9), :].mean(axis=0)
    def trecho(v):
        melhor, ini, tam = (0, len(v)), None, 0
        for k, ok in enumerate(list(v < 0.02) + [False]):
            if ok and ini is None:
                ini = k
            if not ok and ini is not None:
                if k - ini > tam:
                    tam, melhor = k - ini, (ini, k)
                ini = None
        return melhor
    y0, y1 = trecho(fr_l)
    x0, x1 = trecho(fr_c)
    if (y1 - y0) < 0.3 * h or (x1 - x0) < 0.3 * w:
        return a, False
    # 2) selos/textos dentro da amostra: corta faixas de 4% nas bordas enquanto tiverem pixel branco
    passo_y, passo_x = max(1, int((y1 - y0) * .04)), max(1, int((x1 - x0) * .04))
    for _ in range(6):
        mudou = False
        if branco[y0:y0 + passo_y, x0:x1].mean() > 0.002: y0 += passo_y; mudou = True
        if branco[y1 - passo_y:y1, x0:x1].mean() > 0.002: y1 -= passo_y; mudou = True
        if branco[y0:y1, x0:x0 + passo_x].mean() > 0.002: x0 += passo_x; mudou = True
        if branco[y0:y1, x1 - passo_x:x1].mean() > 0.002: x1 -= passo_x; mudou = True
        if not mudou:
            break
    fy, fx = int((y1 - y0) * 0.01), int((x1 - x0) * 0.01)
    cortou = (y1 - y0) < 0.98 * h or (x1 - x0) < 0.98 * w
    return a[y0 + fy:y1 - fy, x0 + fx:x1 - fx], cortou


def melhorar(entrada, saida):
    a = ler(entrada)
    h0, w0, _ = a.shape
    a, cortou = recortar(a)
    # fração da imagem original que sobrou: o tamanho real coberto pela textura diminui na mesma proporção
    json.dump({"largura": a.shape[1] / w0, "altura": a.shape[0] / h0}, open(saida + "-recorte.json", "w"))
    if cortou:
        print(f"RECORTE {entrada} {a.shape[1] / w0:.2f} x {a.shape[0] / h0:.2f}", flush=True)
    h, w, _ = a.shape
    f = min(1.0, TAM / max(w, h))
    nw, nh = max(64, round(w * f)), max(64, round(h * f))
    if (nw, nh) != (w, h):
        a = redimensionar(a, nw, nh)
    h, w, _ = a.shape
    media = a.reshape(-1, 3).mean(axis=0)

    # 1) luz uniforme: divide pela luminosidade de baixa frequência (sigma ~ 1/6 da imagem)
    #    por canal, porque algumas fotos também mudam de cor de um lado ao outro (cinza em cima, laranja embaixo)
    baixa = desfocar(a, max(h, w) / 10)
    a = a * (media[None, None, :] / np.clip(baixa, 1e-3, None))

    # 2) emendável, um eixo de cada vez: a costura vertical (bordas esquerda/direita) é coberta pela cópia
    #    deslocada só na horizontal, cuja própria costura cai no meio, onde a mistura não usa a cópia; depois o mesmo
    #    na vertical. Faixa estreita e suave, para não criar degrau de cor.
    faixa = 0.14
    def peso(n):
        d = np.abs(np.linspace(-1, 1, n))
        b = np.clip((d - (1 - faixa)) / faixa, 0, 1)
        return b * b * (3 - 2 * b)
    bx = peso(w)[None, :, None]
    a = a * (1 - bx) + np.roll(a, w // 2, axis=1) * bx
    by = peso(h)[:, None, None]
    a = a * (1 - by) + np.roll(a, h // 2, axis=0) * by

    # 3) relevo: altura = detalhe fino da luminância (sem a variação larga), gradiente -> normal
    lum = a.mean(axis=2)
    altura = lum - desfocar(lum, 6)
    altura = desfocar(altura, 0.8)
    escala = 4.0 / (np.std(altura) * 40 + 1e-4)
    dx = (np.roll(altura, -1, axis=1) - np.roll(altura, 1, axis=1)) * escala
    dy = (np.roll(altura, -1, axis=0) - np.roll(altura, 1, axis=0)) * escala
    n = np.stack([-dx, -dy, np.ones_like(dx)], axis=2)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    normal = n * 0.5 + 0.5

    # imagens do Blender começam embaixo: pixels já estão nessa ordem, salvar mantém
    salvar(a, saida + "-cor.jpg")
    salvar(normal, saida + "-normal.jpg", 92)
    mini = redimensionar(a, 256, max(64, round(256 * h / w)))
    salvar(mini, saida + "-mini.jpg", 85)


with open(lista, encoding="utf-8") as fh:
    itens = [l.strip().split("|") for l in fh if l.strip()]
for entrada, saida in itens:
    try:
        melhorar(entrada, saida)
        print(f"OK {saida}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"ERRO {entrada}: {e}", flush=True)
