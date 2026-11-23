// Completa o cadastro da Essenza com o que vem do site da marca e da classificação dos materiais:
//  1) biblioteca de acabamentos da Essenza (fotos de 1000 px do site, tratadas; lacas/vidros/espelhos como cor)
//  2) famílias da marca (grupo do site -> coleção)
//  3) por produto: descrição, designer, medidas disponíveis e partes (material do 3D -> famílias permitidas pelo site)
//
// Entradas em <pasta>: site-casado.json (essenza-casar.mjs), classes.json (blender-classificar-materiais.py),
//   acabamentos-site/ (essenza-site.mjs), conversao/<slug>/cena.json
// Uso (dentro de web/): node scripts/importar-essenza.mjs ../amostras/essenza
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const [pasta] = process.argv.slice(2);
const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, "..", "..");
const BLENDER = process.env.BLENDER ?? path.join(raiz, "ferramentas", "blender-4.2.23-windows-x64", "blender.exe");
const env = Object.fromEntries(
  fs.readFileSync(path.join(aqui, "..", ".env.local"), "utf8").split(/\r?\n/).filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const ler = (f) => JSON.parse(fs.readFileSync(path.join(pasta, f), "utf8"));

// grupo do site -> família, coleção, rótulo, como aparece no 3D
const GRUPOS = {
  "Lâminas de Madeira": { familia: "lamina", rotulo: "Lâmina de madeira", tipo: "textura", rug: 0.55, met: 0, cm: 30, brilho: "acetinado" },
  "Lacas": { familia: "laca", rotulo: "Laca", tipo: "cor", rug: 0.45, met: 0, brilho: "acetinado" },
  "Vidros": { familia: "vidro", rotulo: "Vidro", tipo: "cor", rug: 0.05, met: 0, brilho: "vidro" },
  "TS": { familia: "ts", rotulo: "TS", tipo: "textura", rug: 0.3, met: 0, cm: 60 },
  "Pedras Sinterizadas": { familia: "pedra", rotulo: "Pedra sinterizada", tipo: "textura", rug: 0.25, met: 0, cm: 60 },
  "Tecidos e Revestimentos": { familia: "tecido", rotulo: "Tecido", tipo: "textura", rug: 0.95, met: 0, cm: 12 },
  "Courissímos": { familia: "courissimo", rotulo: "Couríssimo", tipo: "textura", rug: 0.55, met: 0, cm: 20 },
  "Recouro": { familia: "recouro", rotulo: "Recouro", tipo: "textura", rug: 0.55, met: 0, cm: 20 },
  "Espelhos": { familia: "espelho", rotulo: "Espelho", tipo: "cor", rug: 0.03, met: 1 },
  "Telas": { familia: "tela", rotulo: "Tela", tipo: "textura", rug: 0.7, met: 0, cm: 10 },
};
const colecao = (grupo) => `${grupo.replace("Courissímos", "Couríssimos")} (Essenza)`;
// classe do material no 3D -> famílias que aquela peça pode receber (cortadas pelo que o site permite no produto)
const CLASSE = {
  madeira: { rotulo: "Madeira", familias: ["lamina", "laca"] },
  laca: { rotulo: "Pintura", familias: ["laca", "lamina"] },
  pedra: { rotulo: "Pedra", familias: ["pedra", "ts", "vidro"] },
  vidro: { rotulo: "Vidro", familias: ["vidro"] },
  espelho: { rotulo: "Espelho", familias: ["espelho"] },
  tecido: { rotulo: "Estofado", familias: ["tecido", "courissimo", "recouro"] },
  couro: { rotulo: "Estofado", familias: ["courissimo", "recouro", "tecido"] },
  tela: { rotulo: "Tela", familias: ["tela"] },
};

const { data: marca } = await sb.from("marcas").select("id").eq("slug", "essenza").single();

// ---------------------------------------------------------------- 1) biblioteca
const dirFotos = path.join(pasta, "acabamentos-site");
const lista = JSON.parse(fs.readFileSync(path.join(dirFotos, "acabamentos.json"), "utf8"));
const web = path.join(dirFotos, "_web");
fs.mkdirSync(web, { recursive: true });
const codigo = (it) => `essenza-${slug(it.grupo)}-${it.arquivo.split("_")[0]}`;
const texturas = lista.filter((it) => GRUPOS[it.grupo]?.tipo === "textura");
const cores = lista.filter((it) => GRUPOS[it.grupo]?.tipo === "cor");
fs.writeFileSync(path.join(web, "lista.txt"), texturas.map((it) => `${path.resolve(dirFotos, it.arquivo)}|${path.resolve(web, codigo(it))}`).join("\n"));
let r = spawnSync(BLENDER, ["-b", "-P", path.join(aqui, "blender-texturas-melhorar.py"), "--", path.join(web, "lista.txt")], { encoding: "utf8", maxBuffer: 1 << 28, timeout: 3_600_000 });
console.log(`Texturas: ${(r.stdout.match(/^OK /gm) || []).length} de ${texturas.length}`);
r = spawnSync(BLENDER, ["-b", "-P", path.join(aqui, "blender-cor-media.py"), "--", path.join(web, "cores.json"), ...cores.map((it) => path.resolve(dirFotos, it.arquivo))], { encoding: "utf8", maxBuffer: 1 << 28 });
const corDe = JSON.parse(fs.readFileSync(path.join(web, "cores.json"), "utf8"));
console.log(`Cores: ${Object.keys(corDe).length} de ${cores.length}`);

const enviar = async (destino, arquivo) => {
  const { error } = await sb.storage.from("publico").upload(destino, fs.readFileSync(arquivo), { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`${destino}: ${error.message}`);
  return destino;
};
const { data: existentes } = await sb.from("acabamentos").select("id, codigo").eq("marca_id", marca.id);
const idPorCodigo = new Map(existentes.map((x) => [x.codigo, x.id]));
let n = 0;
for (const [ordem, it] of lista.entries()) {
  const g = GRUPOS[it.grupo];
  if (!g) { console.log(`grupo desconhecido: ${it.grupo}`); continue; }
  const cod = codigo(it);
  const linha = {
    marca_id: marca.id, codigo: cod, nome: it.nome, categoria: it.grupo, fornecedor: "Essenza", colecao: colecao(it.grupo),
    rugosidade: g.rug, metalico: g.met, ordem, ativo: true, cor_hex: corDe[it.arquivo] ?? null,
    tamanho_real_cm: null, tamanho_real_altura_cm: null, textura_cor_path: null, textura_normal_path: null, textura_miniatura_path: null,
  };
  if (g.tipo === "textura" && fs.existsSync(path.join(web, `${cod}-cor.jpg`))) {
    const base = `acabamentos/essenza/${slug(it.grupo)}/${cod}`;
    linha.textura_cor_path = await enviar(`${base}-cor.jpg`, path.join(web, `${cod}-cor.jpg`));
    linha.textura_normal_path = await enviar(`${base}-normal.jpg`, path.join(web, `${cod}-normal.jpg`));
    linha.textura_miniatura_path = await enviar(`${base}-mini.jpg`, path.join(web, `${cod}-mini.jpg`));
    const rec = JSON.parse(fs.readFileSync(path.join(web, `${cod}-recorte.json`), "utf8"));
    linha.tamanho_real_cm = +(g.cm * rec.largura).toFixed(1);
    linha.tamanho_real_altura_cm = +(g.cm * rec.altura).toFixed(1);
  }
  const id = idPorCodigo.get(cod);
  const { error } = id ? await sb.from("acabamentos").update(linha).eq("id", id) : await sb.from("acabamentos").insert(linha);
  if (error) throw new Error(`${cod}: ${error.message}`);
  n++;
}
console.log(`Acabamentos Essenza gravados: ${n}`);

// ---------------------------------------------------------------- 2) famílias da marca
const familias = Object.entries(GRUPOS).map(([grupo, g], ordem) => ({
  marca_id: marca.id, familia: g.familia, rotulo: g.rotulo, colecoes: [colecao(grupo)], brilho: g.brilho ?? null, ordem,
}));
let { error: ef } = await sb.from("marca_familias").upsert(familias, { onConflict: "marca_id,familia" });
if (ef) throw ef;

// ---------------------------------------------------------------- 3) produtos
const casado = ler("site-casado.json");
const classes = ler("classes.json");
const { data: produtos } = await sb.from("produtos").select("id, slug").eq("marca_id", marca.id);
let comPartes = 0, comDescricao = 0;
for (const p of produtos) {
  const s = p.slug.replace(/^essenza-/, "");
  const site = casado[s];
  const cls = classes[s] ?? {};
  const atualizar = {};
  if (site?.descricao) { atualizar.descricao = site.descricao; comDescricao++; }
  const permitidas = new Set((site?.acabamentos ?? []).map((g) => GRUPOS[g.grupo]?.familia).filter(Boolean));
  atualizar.especificacoes = { designer: site?.designer ?? null, pagina: site?.url ?? null, grupos: [...permitidas] };
  atualizar.notas_acabamento = site ? [] : ["Produto sem página no site da Essenza: acabamentos sob consulta"];
  const { error: eu } = await sb.from("produtos").update(atualizar).eq("id", p.id);
  if (eu) throw new Error(`${p.slug}: ${eu.message}`);

  // medidas oficiais do site
  if (site?.medidas?.length) {
    await sb.from("produto_medidas").delete().eq("produto_id", p.id);
    await sb.from("produto_medidas").insert(site.medidas.map((m, i) => {
      const [l, pr, a] = m.split(" x ").map(Number);
      return { produto_id: p.id, rotulo: `${l / 10} X ${pr / 10} X ${a / 10}`, largura_mm: l, profundidade_mm: pr, altura_mm: a, ordem: i };
    }));
  }

  // correções conferidas nas imagens de classes:
  //  - material com nome de metal cobrindo grande parte do produto é pintura (o projetista usa "Aluminum..." como cor)
  //  - em assentos sem estofado identificado, a maior superfície pintada é o estofado (estofado de cor lisa)
  for (const v of Object.values(cls)) if (v.classe === "metal" && (v.area ?? 0) > 0.25) v.classe = "laca";
  if (/^(cadeira|poltrona|banco|banqueta|cama|puff|pufe)/.test(s) && !Object.values(cls).some((v) => v.classe === "tecido" || v.classe === "couro")) {
    const pint = Object.values(cls).filter((v) => v.classe === "laca").sort((a, b) => (b.area ?? 0) - (a.area ?? 0))[0];
    if (pint && (pint.area ?? 0) > 0.08) pint.classe = "tecido";
  }
  // partes: materiais do 3D agrupados por classe; cada parte recebe as famílias da classe que o site permite
  const partes = new Map();
  for (const [mat, v] of Object.entries(cls)) {
    const c = CLASSE[v.classe];
    if (!c) continue; // metal e outros: ficam com o acabamento original
    const fams = c.familias.filter((f) => permitidas.has(f));
    if (!fams.length) continue;
    const parte = partes.get(c.rotulo) ?? { rotulo: c.rotulo, familias: new Set(), materiais: [], area: 0 };
    fams.forEach((f) => parte.familias.add(f));
    parte.materiais.push(mat);
    parte.area += v.area ?? 0;
    partes.set(c.rotulo, parte);
  }
  // grupos do site sem peça correspondente no 3D (ex.: tampo em pedra num modelo todo em madeira): vão para a maior peça
  const cobertas = new Set([...partes.values()].flatMap((x) => [...x.familias]));
  const faltam = [...permitidas].filter((f) => !cobertas.has(f));
  if (faltam.length && partes.size) {
    const maior = [...partes.values()].sort((a, b) => b.area - a.area)[0];
    faltam.forEach((f) => maior.familias.add(f));
  }
  await sb.from("produto_partes").delete().eq("produto_id", p.id);
  const linhas = [...partes.values()].sort((a, b) => b.area - a.area).map((x, i) => ({
    produto_id: p.id, nome_no_obj: slug(x.rotulo), rotulo: x.rotulo, familias: [...x.familias], materiais: x.materiais, ordem: i,
  }));
  if (linhas.length) {
    const { error: ep } = await sb.from("produto_partes").insert(linhas);
    if (ep) throw new Error(`${p.slug} partes: ${ep.message}`);
    comPartes++;
  }
}
console.log(`Produtos: ${produtos.length} · com descrição: ${comDescricao} · com acabamentos por peça: ${comPartes}`);
