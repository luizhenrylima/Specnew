// Leitura da geometria de um GLB (já em coordenadas do mundo, metros, Y para cima). Usada pelos geradores de download.

function aplicar(m, x, y, z, w = 1) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w, m[2] * x + m[6] * y + m[10] * z + m[14] * w];
}
function normalizar([x, y, z]) { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; }
const nomeLimpo = (s, i) => ((s || `material_${i}`).replace(/[^A-Za-z0-9_-]+/g, "_") || `material_${i}`);

export function extrair(doc) {
  const root = doc.getRoot();
  const materiais = root.listMaterials();
  const texturas = new Map(); // Texture -> nome do arquivo
  root.listTextures().forEach((t, i) => texturas.set(t, `textura_${i + 1}.${t.getMimeType() === "image/png" ? "png" : "jpg"}`));
  const malhas = [];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const M = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue; // só triângulos
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const nor = prim.getAttribute("NORMAL"), uv = prim.getAttribute("TEXCOORD_0"), idx = prim.getIndices();
      const n = pos.getCount();
      const P = [], N = [], T = [];
      for (let i = 0; i < n; i++) {
        const p = pos.getElement(i, []); P.push(aplicar(M, p[0], p[1], p[2]));
        if (nor) { const q = nor.getElement(i, []); N.push(normalizar(aplicar(M, q[0], q[1], q[2], 0))); }
        if (uv) { const t = uv.getElement(i, []); T.push([t[0], t[1]]); }
      }
      const I = idx ? Array.from(idx.getArray()) : [...Array(n).keys()];
      const mat = prim.getMaterial();
      malhas.push({ P, N, T, I, mat: mat ? materiais.indexOf(mat) : -1 });
    }
  }
  return {
    materiais: materiais.map((m, i) => ({
      nome: nomeLimpo(m.getName(), i),
      cor: m.getBaseColorFactor(),
      textura: m.getBaseColorTexture() ? texturas.get(m.getBaseColorTexture()) : null,
    })),
    imagens: [...texturas].map(([t, nome]) => [nome, t.getImage()]),
    malhas,
  };
}
