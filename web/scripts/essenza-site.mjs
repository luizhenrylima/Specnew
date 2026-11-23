// Lê as páginas públicas de produto do site da Essenza (sitemap) e grava, por produto: nome, categoria, descrição,
// designer, medidas disponíveis e acabamentos permitidos (por grupo). Baixa as fotos de acabamento em 1000 px.
// Respeita o robots.txt (só /produto/, nada de /api/) e faz uma requisição por segundo.
//
// Uso (dentro de web/): node scripts/essenza-site.mjs ../amostras/essenza
import fs from "node:fs";
import path from "node:path";

const [pasta] = process.argv.slice(2);
const BASE = "https://www.essenzamoveis.com.br";
const UA = { "User-Agent": "Mozilla/5.0 (Specifica catalogo; leitura do catalogo publico)" };
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const limpar = (h) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;/g, "'")
  .replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

async function buscar(url, binario = false) {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`${r.status}`);
      return binario ? Buffer.from(await r.arrayBuffer()) : await r.text();
    } catch (e) {
      await esperar(2000 * (t + 1));
    }
  }
  return null;
}

function trecho(html, classe) {
  const i = html.indexOf(`class="${classe}`);
  if (i < 0) return "";
  const abre = html.lastIndexOf("<", i);
  const tag = html.slice(abre + 1).match(/^[a-z0-9]+/)[0];
  // acha o fechamento correspondente contando aberturas da mesma tag
  let prof = 0, j = abre;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
  re.lastIndex = abre;
  let m;
  while ((m = re.exec(html))) {
    prof += m[1] ? -1 : 1;
    if (prof === 0) { j = m.index + m[0].length; break; }
  }
  return html.slice(abre, j);
}

function ler(html, url) {
  const nome = limpar(trecho(html, "c-produto__titulo"));
  const migalhas = limpar(trecho(html, "c-produto__breadcrumb")).split("/").map((x) => x.trim()).filter(Boolean);
  const descricao = limpar(trecho(html, "c-produto__descricao"));
  const ficha = html.slice(html.indexOf("produto-ficha-titulo"), html.indexOf("produto-acabamentos-titulo") > 0 ? html.indexOf("produto-acabamentos-titulo") : undefined);
  const designer = (limpar(ficha).match(/Designer\s+(.+?)\s+Medidas/) || [])[1] ?? null;
  const medidas = [...new Set([...limpar(ficha).matchAll(/(\d{2,4})\s*x\s*(\d{2,4})\s*x\s*(\d{2,4})\s*mm/gi)].map((m) => `${m[1]} x ${m[2]} x ${m[3]}`))];
  const grupos = [];
  const reG = /<section class="c-lista-acabamentos__grupo"[\s\S]*?<\/section>/g;
  for (const g of html.match(reG) ?? []) {
    const titulo = limpar((g.match(/<h3[\s\S]*?<\/h3>/) || [""])[0]);
    const itens = [...g.matchAll(/<img src="(\/uploads\/acabamentos\/[^"]+)"[^>]*alt="([^"]*)"/g)].map((m) => ({
      nome: limpar(m[2]), imagem: BASE + m[1].replace(/-thumb\.(jpg|webp)$/, "-md.jpg"),
    }));
    grupos.push({ grupo: titulo, itens });
  }
  return { url, nome, categoria: migalhas.length >= 2 ? migalhas[migalhas.length - 2] : null, descricao, designer, medidas, acabamentos: grupos };
}

const sitemap = await buscar(`${BASE}/sitemap.xml`);
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => /\/produto\//.test(u) && !/\/en\//.test(u));
console.log(`Páginas de produto: ${urls.length}`);
const saida = path.join(pasta, "site.json");
const prontos = fs.existsSync(saida) ? JSON.parse(fs.readFileSync(saida, "utf8")) : [];
const feitos = new Set(prontos.map((p) => p.url));
for (const u of urls) {
  if (feitos.has(u)) continue;
  const html = await buscar(u);
  if (html) prontos.push(ler(html, u));
  if (prontos.length % 25 === 0) { fs.writeFileSync(saida, JSON.stringify(prontos, null, 1)); console.log(`${prontos.length} lidos`); }
  await esperar(1000);
}
fs.writeFileSync(saida, JSON.stringify(prontos, null, 1));
console.log(`Produtos lidos: ${prontos.length}`);

// fotos de acabamento em 1000 px
const dirFotos = path.join(pasta, "acabamentos-site");
fs.mkdirSync(dirFotos, { recursive: true });
const fotos = new Map();
for (const p of prontos) for (const g of p.acabamentos) for (const it of g.itens) fotos.set(it.imagem, { ...it, grupo: g.grupo });
let baixadas = 0;
for (const [url, it] of fotos) {
  const arq = path.join(dirFotos, url.split("/uploads/acabamentos/")[1].replace(/\//g, "_"));
  if (fs.existsSync(arq)) { baixadas++; continue; }
  const b = await buscar(url, true);
  if (b) { fs.writeFileSync(arq, b); baixadas++; }
  await esperar(500);
}
fs.writeFileSync(path.join(dirFotos, "acabamentos.json"), JSON.stringify([...fotos.values()].map((x) => ({
  ...x, arquivo: x.imagem.split("/uploads/acabamentos/")[1].replace(/\//g, "_"),
})), null, 1));
console.log(`Acabamentos distintos: ${fotos.size}, fotos baixadas: ${baixadas}`);
