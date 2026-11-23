// Importa a biblioteca de acabamentos extraída dos .skp do fornecedor (skp-ler-acabamentos.py) + os padrões
// criados pela Specifica (inox, espelhos), envia as texturas para o Storage e grava em public.acabamentos.
// Depois grava a regra da marca (família -> coleções) em public.marca_familias.
//
// Uso (dentro de web/): node scripts/importar-acabamentos.mjs <pasta extraída> <fornecedor> <marca>
//   ex.: node scripts/importar-acabamentos.mjs ../amostras/sier/acabamentos Sier hommes
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const [pasta, fornecedor, slugMarca] = process.argv.slice(2);
if (!pasta || !fornecedor || !slugMarca) { console.error("uso: node scripts/importar-acabamentos.mjs <pasta> <fornecedor> <marca>"); process.exit(1); }
const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, "..", "..");
const BLENDER = process.env.BLENDER ?? path.join(raiz, "ferramentas", "blender-4.2.23-windows-x64", "blender.exe");
const env = Object.fromEntries(
  fs.readFileSync(path.join(aqui, "..", ".env.local"), "utf8").split(/\r?\n/).filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const titulo = (s) => s.toLowerCase().replace(/(^|\s|\(|-)(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(De|Di|Da|Do|Dos|Das|E)\b/g, (m) => m.toLowerCase());

// Coleção por pasta/arquivo do fornecedor e como a luz reage (0 = espelhado, 1 = fosco).
const COLECOES = {
  "CR METALIZADOS": { colecao: "Carvalho Metalizado", rug: 0.45, met: 0.3 },
  "LACAS": { colecao: "Lacas", rug: 0.3, met: 0 },
  "LÂMINAS": { colecao: "Lâminas", rug: 0.6, met: 0 },
  "MADEIRAS": { colecao: "Madeiras", rug: 0.6, met: 0 },
  "MICROTEXTURAS": { colecao: "Microtexturas", rug: 0.75, met: 0.2 },
  "PETRAS E ROCHAS": { colecao: "Petras e Rochas", rug: 0.45, met: 0 },
  "RECOUROS": { colecao: "Recouros", rug: 0.55, met: 0 },
  "STONES": { colecao: "Stones", rug: 0.8, met: 0 },
  "TECIDOS": { colecao: null, rug: 0.95, met: 0 }, // coleção = linha (1000, 2000, 3000, Premium)
};

// 1) itens do fornecedor
const extraidos = JSON.parse(fs.readFileSync(path.join(pasta, "acabamentos.json"), "utf8"));
const itens = extraidos.map((x, ordem) => {
  const c = COLECOES[x.categoria];
  if (!c) throw new Error(`Categoria sem regra: ${x.categoria}`);
  const colecao = c.colecao ?? `Tecidos ${x.arquivo_skp.match(/LINHA\s+(\S+)/i)?.[1] ?? ""}`.trim().replace("PREMIUM", "Premium");
  // "LC.02 BRANCA" -> código LC.02, nome Branca; "1402" -> Tecido 1402
  const m = x.nome.match(/^((?:[A-Z]{2}\.\d+(?:\.[A-Z]{2})?)|(?:[A-Z]{2}\d+)|(?:CR\.MT\.))\s+(.+)$/);
  const codigoFornecedor = /^\d+$|^P\d+$/.test(x.nome) ? x.nome : m && m[1] !== "CR.MT." ? m[1] : null;
  let nome = m ? titulo(m[2]) : /^\d+$|^P\d+$/.test(x.nome) ? `Tecido ${x.nome}` : titulo(x.nome);
  if (m && m[1] === "CR.MT.") nome = `Carvalho Metalizado ${titulo(m[2])}`;
  return {
    codigo: `${slug(fornecedor)}-${slug(colecao)}-${slug(x.nome)}`, nome, codigo_fornecedor: codigoFornecedor,
    fornecedor, colecao, categoria: x.categoria, cor_hex: x.cor, textura: x.textura ? path.join(pasta, x.textura) : null,
    tamanho: x.tamanho_real_cm, rugosidade: c.rug, metalico: c.met, ordem,
  };
});

// 2) padrões da Specifica (sem textura)
const padrao = (colecao, categoria, lista, rug, met) => lista.map(([nome, cor, r], i) => ({
  codigo: `specifica-${slug(colecao)}-${slug(nome)}`, nome, codigo_fornecedor: null, fornecedor: null, colecao, categoria,
  cor_hex: cor, textura: null, tamanho: null, rugosidade: r ?? rug, metalico: met, ordem: i,
}));
itens.push(
  ...padrao("Inox", "INOX", [
    ["Inox Escovado", "#b9b9b6"], ["Inox Polido", "#d4d4d2", 0.08], ["Inox Dourado", "#c9a45c"], ["Inox Champagne", "#c7b38f"],
    ["Inox Bronze", "#8a6a4b"], ["Inox Grafite", "#55565a"], ["Inox Preto", "#2b2b2b"],
  ], 0.35, 1),
  ...padrao("Espelhos", "ESPELHOS", [["Espelho Cristal", "#e8eeee"], ["Espelho Fumê", "#5a5c5c"], ["Espelho Bronze", "#9a7b5c"]], 0.03, 1),
);

// 3) texturas para a web, feitas pelo Blender numa passada só: recorta o cartão do catálogo, tira a variação de luz
//    da foto, deixa emendável e gera o mapa de relevo (-cor.jpg 2048 px, -normal.jpg, -mini.jpg 256 px)
const web = path.join(pasta, "_web");
const comTextura = itens.filter((x) => x.textura);
fs.mkdirSync(web, { recursive: true });
const lista = path.join(web, "lista.txt");
fs.writeFileSync(lista, comTextura.map((x) => `${path.resolve(x.textura)}|${path.resolve(web, x.codigo)}`).join("\n"));
const bl = spawnSync(BLENDER, ["-b", "-P", path.join(aqui, "blender-texturas-melhorar.py"), "--", lista], { encoding: "utf8", maxBuffer: 1 << 28, timeout: 3_600_000 });
const erros = (bl.stdout || "").split("\n").filter((l) => l.startsWith("ERRO"));
console.log(`Texturas web: ${(bl.stdout.match(/^OK /gm) || []).length} ok, ${erros.length} com erro`);
erros.forEach((e) => console.log("  " + e));

// 4) envia e grava
const enviar = async (destino, arquivo) => {
  const { error } = await sb.storage.from("publico").upload(destino, fs.readFileSync(arquivo), { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`${destino}: ${error.message}`);
  return destino;
};
const { data: existentes } = await sb.from("acabamentos").select("id, codigo").is("marca_id", null);
const idPorCodigo = new Map(existentes.map((x) => [x.codigo, x.id]));
let n = 0;
for (const x of itens) {
  const linha = {
    marca_id: null, codigo: x.codigo, nome: x.nome, categoria: x.categoria, fornecedor: x.fornecedor, colecao: x.colecao,
    cor_hex: x.cor_hex, rugosidade: x.rugosidade, metalico: x.metalico, ordem: x.ordem, ativo: true,
    tamanho_real_cm: x.tamanho?.[0] ?? null, tamanho_real_altura_cm: x.tamanho?.[1] ?? null,
    textura_cor_path: null, textura_normal_path: null, textura_miniatura_path: null,
  };
  if (x.textura && fs.existsSync(path.join(web, `${x.codigo}-cor.jpg`))) {
    const base = `acabamentos/${slug(x.fornecedor ?? "specifica")}/${slug(x.colecao)}/${x.codigo}`;
    linha.textura_cor_path = await enviar(`${base}-cor.jpg`, path.join(web, `${x.codigo}-cor.jpg`));
    linha.textura_normal_path = await enviar(`${base}-normal.jpg`, path.join(web, `${x.codigo}-normal.jpg`));
    linha.textura_miniatura_path = await enviar(`${base}-mini.jpg`, path.join(web, `${x.codigo}-mini.jpg`));
    // recorte do cartão: a imagem passa a cobrir só uma fração do tamanho real medido no .skp
    const rec = JSON.parse(fs.readFileSync(path.join(web, `${x.codigo}-recorte.json`), "utf8"));
    if (linha.tamanho_real_cm) linha.tamanho_real_cm = +(linha.tamanho_real_cm * rec.largura).toFixed(2);
    if (linha.tamanho_real_altura_cm) linha.tamanho_real_altura_cm = +(linha.tamanho_real_altura_cm * rec.altura).toFixed(2);
  }
  if (x.codigo_fornecedor) linha.nome = `${x.nome}`;
  const id = idPorCodigo.get(x.codigo);
  const { error } = id ? await sb.from("acabamentos").update(linha).eq("id", id) : await sb.from("acabamentos").insert(linha);
  if (error) throw new Error(`${x.codigo}: ${error.message}`);
  n++;
}
console.log(`Acabamentos gravados: ${n}`);

// 5) regra da marca: família -> coleções (decidido com o usuário em 2026-11-17 para a Hommes)
const { data: marca } = await sb.from("marcas").select("id").eq("slug", slugMarca).single();
const familias = [
  ["lamina", "Lâmina de madeira", ["Lâminas", "Madeiras", "Carvalho Metalizado"], "acetinado"],
  ["pintura_micro", "Pintura Microtextura", ["Microtexturas"], "fosco"],
  ["pintura_hg", "Pintura Highgloss", ["Lacas"], "brilho"],
  ["inox", "Inox Color", ["Inox"], null],
  ["inox_pintura", "Inox com pintura", ["Lacas"], "acetinado"],
  ["pedra", "Pedra", ["Petras e Rochas", "Stones"], null],
  ["couro_sintetico", "Couro sintético", ["Recouros"], null],
  ["couro_natural", "Couro natural", [], null],
  ["camurca_sintetica", "Camurça sintética", [], null],
  ["vidro", "Vidro pintado", ["Lacas"], "vidro"],
  ["espelho", "Espelho", ["Espelhos"], null],
].map(([familia, rotulo, colecoes, brilho], ordem) => ({ marca_id: marca.id, familia, rotulo, colecoes, brilho, ordem }));
const { error: ef } = await sb.from("marca_familias").upsert(familias, { onConflict: "marca_id,familia" });
if (ef) throw ef;
console.log(`Famílias da marca ${slugMarca}: ${familias.length}`);
