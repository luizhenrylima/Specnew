// Desenho técnico 2D (DXF) a partir da malha 3D do produto, no padrão dos blocos que os arquitetos usam:
// vista frontal e vista lateral em cima, planta embaixo, só linhas visíveis, em centímetros.
//
// Como funciona, em cada vista:
//   1. arestas candidatas = quinas reais da peça (normais diferentes dos dois lados) + contorno (silhueta) da vista
//      — as diagonais dos triângulos de superfícies planas ou curvas lisas ficam de fora;
//   2. as partes de cada aresta que ficam atrás de outra superfície são escondidas (z-buffer da vista);
//   3. linhas sobrepostas são unidas e os trechos são emendados em polilinhas.
//
// Uso direto para conferir um produto:  node scripts/desenho-2d.mjs <arquivo.glb ou URL> <saida.dxf>

const CM = 100; // a geometria vem em metros

// ---------- malha soldada ----------
function prepararMalha(g) {
  const ids = new Map();
  const V = []; // vértices soldados (cm)
  const tris = []; // { v:[a,b,c], n:[x,y,z], cn:[n0,n1,n2] (normais dos cantos, se houver) }
  const chave = (p) => `${Math.round(p[0] * CM * 1000)},${Math.round(p[1] * CM * 1000)},${Math.round(p[2] * CM * 1000)}`;
  const soldar = (p) => {
    const k = chave(p);
    let i = ids.get(k);
    if (i === undefined) { i = V.length; V.push([p[0] * CM, p[1] * CM, p[2] * CM]); ids.set(k, i); }
    return i;
  };
  for (const m of g.malhas) {
    for (let i = 0; i < m.I.length; i += 3) {
      const k = [m.I[i], m.I[i + 1], m.I[i + 2]];
      const v = k.map((j) => soldar(m.P[j]));
      if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
      const [a, b, c] = v.map((j) => V[j]);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const l = Math.hypot(...n);
      if (l < 1e-9) continue;
      tris.push({ v, n: n.map((x) => x / l), cn: m.N.length ? k.map((j) => m.N[j]) : null });
    }
  }
  return { V, tris };
}

// Arestas com os triângulos vizinhos e se são quinas "duras" (independente da vista).
function arestas({ tris }) {
  const mapa = new Map();
  tris.forEach((t, ti) => {
    for (let k = 0; k < 3; k++) {
      const a = t.v[k], b = t.v[(k + 1) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let e = mapa.get(key);
      if (!e) { e = { a: Math.min(a, b), b: Math.max(a, b), t: [], cantos: [] }; mapa.set(key, e); }
      e.t.push(ti);
      e.cantos.push(t.cn ? (a < b ? [t.cn[k], t.cn[(k + 1) % 3]] : [t.cn[(k + 1) % 3], t.cn[k]]) : null);
    }
  });
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const lista = [];
  for (const e of mapa.values()) {
    if (e.t.length !== 2) { e.dura = true; lista.push(e); continue; }
    const [t1, t2] = e.t.map((i) => tris[i]);
    const ang = Math.acos(Math.max(-1, Math.min(1, dot(t1.n, t2.n)))) * 180 / Math.PI;
    // normais dos cantos diferentes = o modelo tem uma quina ali (sombreamento "duro").
    // Ângulos pequenos são facetas de peças curvas (tubos, estofados), não quinas: ficam de fora.
    const [c1, c2] = e.cantos;
    const quina = c1 && c2 ? dot(c1[0], c2[0]) < 0.995 || dot(c1[1], c2[1]) < 0.995 : null;
    e.dura = quina === null ? ang > 35 : (quina && ang > 25) || ang > 60;
    lista.push(e);
  }
  return lista;
}

// ---------- vistas ----------
// proj(p) -> [u, v, profundidade] (maior profundidade = mais perto de quem olha); dir = de onde se olha.
const VISTAS = {
  frontal: { camada: "VISTA FRONTAL", dir: [0, 0, 1], proj: ([x, y, z]) => [x, y, z] },
  lateral: { camada: "VISTA LATERAL", dir: [1, 0, 0], proj: ([x, y, z]) => [-z, y, x] },
  planta: { camada: "PLANTA", dir: [0, 1, 0], proj: ([x, y, z]) => [x, -z, y] },
};

function desenharVista(malha, lista, vista) {
  const { V, tris } = malha;
  const P = V.map(vista.proj);
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const [u, v] of P) { u0 = Math.min(u0, u); v0 = Math.min(v0, v); u1 = Math.max(u1, u); v1 = Math.max(v1, v); }
  const tam = Math.max(u1 - u0, v1 - v0);
  const px = Math.max(tam / 2600, 0.02); // tamanho do pixel do z-buffer, em cm
  const W = Math.ceil((u1 - u0) / px) + 3, H = Math.ceil((v1 - v0) / px) + 3;
  const zb = new Float32Array(W * H).fill(-Infinity);
  const gx = (u) => (u - u0) / px + 1, gy = (v) => (v - v0) / px + 1;

  // z-buffer: guarda a superfície mais próxima em cada pixel
  for (const t of tris) {
    const [a, b, c] = t.v.map((i) => P[i]);
    const ax = gx(a[0]), ay = gy(a[1]), bx = gx(b[0]), by = gy(b[1]), cx = gx(c[0]), cy = gy(c[1]);
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) continue;
    const xi0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), xi1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const yi0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), yi1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = yi0; y <= yi1; y++) {
      for (let x = xi0; x <= xi1; x++) {
        const qx = x + 0.5, qy = y + 0.5;
        const w0 = ((bx - qx) * (cy - qy) - (cx - qx) * (by - qy)) / area;
        const w1 = ((cx - qx) * (ay - qy) - (ax - qx) * (cy - qy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const d = w0 * a[2] + w1 * b[2] + w2 * c[2];
        const i = y * W + x;
        if (d > zb[i]) zb[i] = d;
      }
    }
  }
  const tol = Math.max(0.08, px * 1.5);
  const visivel = (u, v, d) => {
    const x = Math.floor(gx(u)), y = Math.floor(gy(v));
    let menor = Infinity;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const xx = x + i, yy = y + j;
      const z = xx < 0 || yy < 0 || xx >= W || yy >= H ? -Infinity : zb[yy * W + xx];
      if (z < menor) menor = z;
    }
    return d >= menor - tol;
  };

  // arestas desta vista: quinas + silhueta
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const segs = [];
  for (const e of lista) {
    let usar = e.dura;
    if (!usar && e.t.length === 2) {
      const s1 = dot(tris[e.t[0]].n, vista.dir), s2 = dot(tris[e.t[1]].n, vista.dir);
      // silhueta: um lado vira para quem olha e o outro não
      usar = (s1 > 1e-4 && s2 < -1e-4) || (s1 < -1e-4 && s2 > 1e-4);
    }
    if (!usar) continue;
    const a = P[e.a], b = P[e.b];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.01) continue; // aresta vista de ponta
    const n = Math.max(2, Math.ceil(L / (px * 0.5)));
    let ini = null;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const u = a[0] + (b[0] - a[0]) * t, v = a[1] + (b[1] - a[1]) * t, d = a[2] + (b[2] - a[2]) * t;
      const vis = visivel(u, v, d);
      if (vis && ini === null) ini = t;
      if ((!vis || k === n) && ini !== null) {
        const fim = vis ? t : (k - 1) / n;
        if ((fim - ini) * L >= Math.min(px * 1.5, L * 0.99)) {
          segs.push([[a[0] + (b[0] - a[0]) * ini, a[1] + (b[1] - a[1]) * ini], [a[0] + (b[0] - a[0]) * fim, a[1] + (b[1] - a[1]) * fim]]);
        }
        ini = null;
      }
    }
  }
  if (process.env.DESENHO_DEBUG) {
    const cand = lista.filter((e) => e.dura).length;
    console.log(`[${vista.camada}] arestas ${lista.length}, duras ${cand}, segmentos ${segs.length}, px ${px.toFixed(3)}`);
  }
  // descarta riscos soltos minúsculos (sobras da ocultação)
  const comprimento = (p) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);
  return polilinhas(unirSobrepostas(segs)).filter((p) => comprimento(p) >= Math.max(0.3, px * 4));
}

// Une segmentos colineares que se sobrepõem (peças encostadas geram linhas duplicadas).
function unirSobrepostas(segs) {
  const grupos = new Map();
  for (const [p, q] of segs) {
    let dx = q[0] - p[0], dy = q[1] - p[1];
    const L = Math.hypot(dx, dy); if (L < 1e-6) continue;
    dx /= L; dy /= L;
    if (dx < -1e-9 || (Math.abs(dx) < 1e-9 && dy < 0)) { dx = -dx; dy = -dy; }
    const ang = Math.round(Math.atan2(dy, dx) * 180 / Math.PI * 20); // 0,05°
    const off = Math.round((-dy * p[0] + dx * p[1]) / 0.02); // 0,2 mm
    const k = `${ang}_${off}`;
    let gr = grupos.get(k);
    if (!gr) { gr = { dx, dy, off: -dy * p[0] + dx * p[1], iv: [] }; grupos.set(k, gr); }
    const t1 = dx * p[0] + dy * p[1], t2 = dx * q[0] + dy * q[1];
    gr.iv.push([Math.min(t1, t2), Math.max(t1, t2)]);
  }
  const out = [];
  for (const { dx, dy, off, iv } of grupos.values()) {
    iv.sort((a, b) => a[0] - b[0]);
    let [s, e] = iv[0];
    const emitir = () => out.push([[dx * s - dy * off, dy * s + dx * off], [dx * e - dy * off, dy * e + dx * off]]);
    for (let i = 1; i < iv.length; i++) {
      if (iv[i][0] <= e + 0.02) e = Math.max(e, iv[i][1]);
      else { emitir(); [s, e] = iv[i]; }
    }
    emitir();
  }
  return out;
}

// Emenda segmentos que se tocam em polilinhas e tira pontos alinhados.
function polilinhas(segs) {
  const q = (p) => `${Math.round(p[0] * 200)},${Math.round(p[1] * 200)}`; // 0,05 mm
  const nos = new Map();
  const usados = new Array(segs.length).fill(false);
  segs.forEach(([p, r], i) => {
    for (const k of [q(p), q(r)]) { if (!nos.has(k)) nos.set(k, []); nos.get(k).push(i); }
  });
  const outro = (i, k) => (q(segs[i][0]) === k ? segs[i][1] : segs[i][0]);
  const resultado = [];
  const andar = (lista, k) => {
    for (;;) {
      const prox = (nos.get(k) ?? []).filter((j) => !usados[j]);
      if (nos.get(k).length !== 2 || prox.length !== 1) return;
      usados[prox[0]] = true;
      const p = outro(prox[0], k);
      lista.push(p); k = q(p);
    }
  };
  segs.forEach((s, i) => {
    if (usados[i]) return;
    usados[i] = true;
    const fwd = [s[0], s[1]];
    andar(fwd, q(s[1]));
    const back = [s[0]];
    andar(back, q(s[0]));
    const pts = [...back.slice(1).reverse(), ...fwd];
    resultado.push(simplificar(pts));
  });
  return resultado;
}

function simplificar(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const cruz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    if (Math.abs(cruz) / L > 0.005) out.push(b); // desvio > 0,05 mm
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ---------- montagem e DXF ----------
const caixa = (polis) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polis) for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
};
const mover = (polis, dx, dy) => polis.map((p) => p.map(([x, y]) => [x + dx, y + dy]));

export function desenho2d(g) {
  const malha = prepararMalha(g);
  const lista = arestas(malha);
  const fr = desenharVista(malha, lista, VISTAS.frontal);
  const la = desenharVista(malha, lista, VISTAS.lateral);
  const pl = desenharVista(malha, lista, VISTAS.planta);
  const bf = caixa(fr), bl = caixa(la), bp = caixa(pl);
  const gap = Math.max(30, Math.max(bf.w, bf.h, bl.w) * 0.25);
  // frontal com o canto inferior esquerdo na origem; lateral à direita, apoiada na mesma linha de piso;
  // planta embaixo, alinhada com a frontal (mesmo eixo X).
  return [
    { camada: VISTAS.frontal.camada, polis: mover(fr, -bf.x0, -bf.y0) },
    { camada: VISTAS.lateral.camada, polis: mover(la, bf.w + gap - bl.x0, -bl.y0) },
    { camada: VISTAS.planta.camada, polis: mover(pl, -bf.x0, -gap - bp.y1) },
  ];
}

export function gerarDxf2d(g) {
  const vistas = desenho2d(g);
  const tudo = caixa(vistas.flatMap((v) => v.polis));
  const L = [];
  const add = (c, v) => L.push(String(c), String(v));
  const f = (v) => v.toFixed(4);
  add(0, "SECTION"); add(2, "HEADER");
  add(9, "$ACADVER"); add(1, "AC1009");
  add(9, "$INSUNITS"); add(70, 5); // centímetros
  add(9, "$MEASUREMENT"); add(70, 1);
  add(9, "$EXTMIN"); add(10, f(tudo.x0)); add(20, f(tudo.y0)); add(30, 0);
  add(9, "$EXTMAX"); add(10, f(tudo.x1)); add(20, f(tudo.y1)); add(30, 0);
  add(0, "ENDSEC");
  add(0, "SECTION"); add(2, "TABLES");
  add(0, "TABLE"); add(2, "LTYPE"); add(70, 1);
  add(0, "LTYPE"); add(2, "CONTINUOUS"); add(70, 0); add(3, "Solid line"); add(72, 65); add(73, 0); add(40, 0);
  add(0, "ENDTAB");
  add(0, "TABLE"); add(2, "LAYER"); add(70, vistas.length + 1);
  for (const nome of ["0", ...vistas.map((v) => v.camada)]) { add(0, "LAYER"); add(2, nome); add(70, 0); add(62, 7); add(6, "CONTINUOUS"); }
  add(0, "ENDTAB");
  add(0, "ENDSEC");
  add(0, "SECTION"); add(2, "ENTITIES");
  for (const { camada, polis } of vistas) {
    for (const p of polis) {
      if (p.length === 2) {
        add(0, "LINE"); add(8, camada);
        add(10, f(p[0][0])); add(20, f(p[0][1])); add(30, 0); add(11, f(p[1][0])); add(21, f(p[1][1])); add(31, 0);
        continue;
      }
      const fechada = Math.hypot(p[0][0] - p.at(-1)[0], p[0][1] - p.at(-1)[1]) < 0.001;
      const pts = fechada ? p.slice(0, -1) : p;
      add(0, "POLYLINE"); add(8, camada); add(66, 1); add(10, 0); add(20, 0); add(30, 0); add(70, fechada ? 1 : 0);
      for (const [x, y] of pts) { add(0, "VERTEX"); add(8, camada); add(10, f(x)); add(20, f(y)); add(30, 0); }
      add(0, "SEQEND"); add(8, camada);
    }
  }
  add(0, "ENDSEC"); add(0, "EOF");
  return L.join("\n") + "\n";
}

// ---------- uso direto ----------
import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const fs = await import("node:fs");
  const { NodeIO } = await import("@gltf-transform/core");
  const { extrair } = await import("./geometria.mjs");
  const [entrada, saida] = process.argv.slice(2);
  if (!entrada || !saida) { console.error("uso: node scripts/desenho-2d.mjs <arquivo.glb ou URL> <saida.dxf>"); process.exit(1); }
  const bytes = /^https?:/.test(entrada) ? new Uint8Array(await (await fetch(entrada)).arrayBuffer()) : new Uint8Array(fs.readFileSync(entrada));
  const g = extrair(await new NodeIO().readBinary(bytes));
  const t0 = Date.now();
  const dxf = gerarDxf2d(g);
  fs.writeFileSync(saida, dxf);
  console.log(`ok ${saida}  ${(dxf.length / 1024).toFixed(0)} KB  ${Date.now() - t0} ms`);
}
