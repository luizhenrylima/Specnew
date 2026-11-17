// Importa uma marca para o Supabase a partir de uma pasta preparada:
//   <pasta>/produtos.json          mapeamento modelo 3D -> produto + descrição (feito à mão)
//   <pasta>/tabela-extraida.json   medidas e acabamentos tirados da tabela da marca (sem preços)
//   <pasta>/modelos/catalogo.json  medidas reais de cada modelo 3D
//   <pasta>/modelos/*.glb          os modelos
//
// Uso (dentro de web/):  node scripts/importar-marca.mjs ../amostras/hommes "Hommes" hommes https://www.hommes.com.br
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const [pasta, nomeMarca, slugMarca, siteMarca] = process.argv.slice(2);
if (!pasta || !nomeMarca || !slugMarca) {
  console.error("uso: node scripts/importar-marca.mjs <pasta> <nome> <slug> [site]");
  process.exit(1);
}

// Lê .env.local sem depender de pacote extra.
const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const ler = (f) => JSON.parse(fs.readFileSync(path.join(pasta, f), "utf8"));
const produtos = ler("produtos.json");
const tabela = ler("tabela-extraida.json");
const dims = Object.fromEntries(ler("modelos/catalogo.json").map((d) => [d.arquivo, d]));

const slugify = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const titulo = (s) => s.toLowerCase().replace(/(^|\s|\/)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// "160 X 50 X 75" -> números em mm; formatos especiais ficam só como rótulo.
function lerMedida(rotulo) {
  const m = rotulo.replace(/,/g, ".").match(/^\s*(\d+(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)(?:\s*X\s*(\d+(?:\.\d+)?))?\s*$/i);
  if (!m) return { rotulo };
  const [l, p, a] = [m[1], m[2], m[3]].map((v) => (v ? Math.round(parseFloat(v) * 10) : null));
  return { rotulo, largura_mm: l, profundidade_mm: p, altura_mm: a };
}

function especificacoes(t) {
  if (!t) return {};
  const lixo = /CALCULO UNITARIO|^\s*$/i;
  return {
    revestimentos: t.revestimentos.filter((r) => !lixo.test(r)).map(titulo),
    aplicacoes: t.aplicacoes
      .filter((a) => a.opcoes.length)
      .map((a) => ({ tipo: titulo(a.tipo), onde: a.local ? titulo(a.local) : null, opcoes: a.opcoes.filter((o) => !/VEJA A ABA/i.test(o)).map(titulo) })),
    observacoes: t.notas.map((n) => titulo(n.replace(/^ESTE PRODUTO - /i, ""))),
  };
}

// 1) marca
const { data: marca, error: eMarca } = await sb
  .from("marcas").upsert({ nome: nomeMarca, slug: slugMarca, site: siteMarca ?? null }, { onConflict: "slug" })
  .select().single();
if (eMarca) throw eMarca;
console.log(`Marca: ${marca.nome} (${marca.id})`);

let ok = 0, pulados = 0;
for (const p of produtos) {
  const nome = [p.tipo, p.linha, p.variante && `(${p.variante})`].filter(Boolean).join(" ");
  if (p.publicar === false) { console.log(`  pulado: ${p.arquivo} — ${p.confirmar}`); pulados++; continue; }

  const slug = slugify([slugMarca, p.tipo, p.linha, p.variante].filter(Boolean).join(" "));
  const t = p.chave ? tabela.find((x) => x.aba === p.aba && x.nomes.includes(p.chave)) : null;
  if (p.chave && !t) console.warn(`  aviso: ${p.linha} não encontrado na tabela (${p.aba} / ${p.chave})`);
  const d = dims[p.arquivo];

  // 2) modelo 3D -> Storage (bucket público)
  const glbPath = `${slugMarca}/${slug}.glb`;
  const { error: eUp } = await sb.storage.from("publico")
    .upload(glbPath, fs.readFileSync(path.join(pasta, "modelos", p.arquivo)), { contentType: "model/gltf-binary", upsert: true });
  if (eUp) throw new Error(`${p.arquivo}: ${eUp.message}`);

  // 3) produto
  const registro = {
    marca_id: marca.id,
    nome,
    slug,
    linha: p.linha,
    variante: p.variante ?? null,
    referencia: t?.codigos[0] ?? t?.nomes.find((n) => /^\d{6}$/.test(n))?.replace(/^(\d{3})(\d{3})$/, "$1/$2") ?? null,
    categoria: p.tipo,
    descricao: p.descricao,
    largura_mm: d ? Math.round(d.largura_cm * 10) : null,
    profundidade_mm: d ? Math.round(d.profundidade_cm * 10) : null,
    altura_mm: d ? Math.round(d.altura_cm * 10) : null,
    unidade_obj: "cm",
    glb_path: glbPath,
    especificacoes: especificacoes(t),
    pendencia: p.confirmar ?? null,
    status: "publicado",
  };
  const { data: prod, error: eProd } = await sb.from("produtos").upsert(registro, { onConflict: "slug" }).select("id").single();
  if (eProd) throw new Error(`${slug}: ${eProd.message}`);

  // 4) medidas disponíveis (substitui as anteriores)
  await sb.from("produto_medidas").delete().eq("produto_id", prod.id);
  const medidas = (t?.medidas ?? []).map((m, i) => ({ produto_id: prod.id, ordem: i, ...lerMedida(m) }));
  if (medidas.length) {
    const { error: eMed } = await sb.from("produto_medidas").insert(medidas);
    if (eMed) throw new Error(`${slug} medidas: ${eMed.message}`);
  }
  ok++;
  console.log(`  ok: ${slug}  [${registro.referencia ?? "sem código"}]  ${medidas.length} medidas`);
}
console.log(`\nImportados: ${ok}  |  pulados: ${pulados}`);
