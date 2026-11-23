// Cadastra uma marca cujos modelos vieram em .skp (convertidos por skp-extrair.py + blender-montar-glb.py).
//   <pasta>/arquivos.json                 lista dos .skp (slug, nome do arquivo, pasta de origem)
//   <pasta>/conversao/<slug>/cena.json    medidas e tamanhos disponíveis (meta)
//   <pasta>/conversao/<slug>/modelo.glb   modelo para o visualizador
//   <pasta>/conversao/<slug>/previa.png   imagem do produto
//   <pasta>/descricoes.json (opcional)    { "<slug>": "descrição" }
//
// Uso (dentro de web/): node scripts/importar-skp-marca.mjs ../amostras/essenza "Essenza" essenza [site]
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const [pasta, nomeMarca, slugMarca, siteMarca] = process.argv.slice(2);
if (!pasta || !nomeMarca || !slugMarca) { console.error("uso: node scripts/importar-skp-marca.mjs <pasta> <nome> <slug> [site]"); process.exit(1); }
const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const arquivos = JSON.parse(fs.readFileSync(path.join(pasta, "arquivos.json"), "utf8"));
const descArq = path.join(pasta, "descricoes.json");
const descricoes = fs.existsSync(descArq) ? JSON.parse(fs.readFileSync(descArq, "utf8")) : {};

// Nome do arquivo -> nome do produto com acentos e preposições ("Mesa Centro Alfa" -> "Mesa de Centro Alfa")
const ACENTOS = [[/\bcomoda\b/gi, "Cômoda"], [/\bcomcomoda\b/gi, "Cômoda"], [/\bluminaria\b/gi, "Luminária"], [/\bbistro\b/gi, "Bistrô"],
  [/\bgavea\b/gi, "Gávea"], [/\borganico\b/gi, "Orgânico"], [/\bigarape\b/gi, "Igarapé"]];
const titulo = (s) => s.toLowerCase().replace(/(^|[\s\-(/])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(De|Da|Do|Das|Dos|E|Com|Sem)\b/g, (m) => m.toLowerCase()).replace(/\b(Ii|Iii|Iv)\b/g, (m) => m.toUpperCase());
function nomeProduto(bruto) {
  let n = titulo(bruto.replace(/\s+/g, " ").trim());
  for (const [re, s] of ACENTOS) n = n.replace(re, s);
  n = n.replace(/^Mesa Centro\b/, "Mesa de Centro").replace(/^Mesa Cabeceira\b/, "Mesa de Cabeceira")
    .replace(/^Mesa Jantar\b/, "Mesa de Jantar").replace(/^Criado Mudo\b/, "Criado-Mudo");
  return n.charAt(0).toUpperCase() + n.slice(1);
}
const CATEGORIAS = [
  ["Mesa de Jantar"], ["Mesa de Centro"], ["Mesa Lateral"], ["Mesa de Cabeceira"], ["Criado-Mudo", "Mesa de Cabeceira"],
  ["Mesa Bistrô"], ["Cômoda Dupla", "Cômoda"], ["Cômoda"], ["Buffet"], ["Aparador"], ["Banqueta"], ["Banco"], ["Cadeira"],
  ["Poltrona"], ["Cama"], ["Carro Bar"], ["Bar"], ["Escrivaninha"], ["Espelho"], ["Luminária"], ["Rack"], ["Puff"],
];
function categoria(nome, pastaOrigem) {
  for (const [prefixo, cat] of CATEGORIAS) if (nome.startsWith(prefixo + " ") || nome === prefixo) return { cat: cat ?? prefixo, prefixo };
  return { cat: titulo(pastaOrigem), prefixo: "" };
}
const fmt = (cm) => Math.round(cm);

const { data: marca, error: em } = await sb.from("marcas")
  .upsert({ nome: nomeMarca, slug: slugMarca, site: siteMarca ?? null, ativa: true }, { onConflict: "slug" }).select("id").single();
if (em) throw em;

const enviar = async (destino, arquivo, tipo) => {
  const { error } = await sb.storage.from("publico").upload(destino, fs.readFileSync(arquivo), { contentType: tipo, upsert: true });
  if (error) throw new Error(`${destino}: ${error.message}`);
  return destino;
};

let ok = 0, pulados = 0;
for (const a of arquivos) {
  const dir = path.join(pasta, "conversao", a.slug);
  const glb = path.join(dir, "modelo.glb");
  if (!fs.existsSync(glb) || !fs.existsSync(path.join(dir, "cena.json"))) { console.log(`PULADO ${a.slug}: sem modelo`); pulados++; continue; }
  const { meta } = JSON.parse(fs.readFileSync(path.join(dir, "cena.json"), "utf8"));
  const nome = nomeProduto(a.nome_arquivo);
  const { cat, prefixo } = categoria(nome, a.categoria_pasta);
  const slug = `${slugMarca}-${a.slug}`;
  const [L, P, A] = meta.medidas_cm;
  const glbPath = await enviar(`${slugMarca}/${slug}.glb`, glb, "model/gltf-binary");
  const thumb = fs.existsSync(path.join(dir, "previa.png")) ? await enviar(`${slugMarca}/miniaturas/${slug}.png`, path.join(dir, "previa.png"), "image/png") : null;
  const linha = {
    marca_id: marca.id, slug, nome, categoria: cat, linha: prefixo ? nome.slice(prefixo.length).trim() || null : null,
    descricao: descricoes[a.slug] ?? null, largura_mm: Math.round(L * 10), profundidade_mm: Math.round(P * 10), altura_mm: Math.round(A * 10),
    glb_path: glbPath, thumb_path: thumb, unidade_obj: "m", status: "publicado",
    pendencia: meta.avisos?.length ? meta.avisos.join(" | ") : null,
  };
  const { data: prod, error } = await sb.from("produtos").upsert(linha, { onConflict: "slug" }).select("id").single();
  if (error) throw new Error(`${slug}: ${error.message}`);
  // tamanhos disponíveis (variações no mesmo arquivo)
  await sb.from("produto_medidas").delete().eq("produto_id", prod.id);
  const tams = (meta.tamanhos_cm ?? []).map((t) => [...t]);
  if (tams.length) {
    const { error: e2 } = await sb.from("produto_medidas").insert(tams.map((t, i) => ({
      produto_id: prod.id, rotulo: `${fmt(t[0])} X ${fmt(t[1])} X ${fmt(t[2])}`, ordem: i,
      largura_mm: Math.round(t[0] * 10), profundidade_mm: Math.round(t[1] * 10), altura_mm: Math.round(t[2] * 10),
    })));
    if (e2) throw new Error(`${slug} medidas: ${e2.message}`);
  }
  ok++;
  if (ok % 25 === 0) console.log(`${ok} produtos...`);
}
console.log(`Cadastrados: ${ok} · sem modelo: ${pulados}`);
