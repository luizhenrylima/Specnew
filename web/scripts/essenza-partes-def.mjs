// Monta, para cada produto da Essenza, as PEÇAS que o arquiteto pode configurar e as famílias de acabamento de cada
// uma, seguindo a ficha técnica (configurações da tabela de vendas) e, onde a tabela não diz, os grupos do site.
// Exemplos: "Pé Madeira + Tampo Carvalho" -> Pés (lâmina) + Tampo (lâmina); "Corpo Carvalho com portas laca" ->
// Corpo + Portas; "Toda Carvalho/Nogueira/Laca" -> uma peça só; cadeira -> Estrutura + Estofado.
// Grava <pasta>/partes-def.json, lido por blender-partes.py (separa o 3D) e importar-partes-essenza.mjs (grava no banco).
// Uso (dentro de web/): node scripts/essenza-partes-def.mjs ../amostras/essenza
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const [pasta] = process.argv.slice(2);
const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sa = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const classes = JSON.parse(fs.readFileSync(path.join(pasta, "classes.json"), "utf8"));
// o modelo 3D tem material de tecido/couro (assento estofado) mesmo quando o site só lista madeira e laca
const temEstofado = (s) => Object.values(classes[s] ?? {}).some((v) => v.classe === "tecido" || v.classe === "couro");
const manual = fs.existsSync(path.join(pasta, "partes-manual.json")) ? JSON.parse(fs.readFileSync(path.join(pasta, "partes-manual.json"), "utf8")) : {};

// peça citada na configuração -> papel geométrico (como achar no 3D) e rótulo
const PECAS = [
  [/portas? ripadas?/, "portas", "Portas ripadas"],
  [/\bportas?\b/, "portas", "Portas"],
  [/borda do tampo/, "tampo", "Borda do tampo"],
  [/\btampos\b/, "tampo", "Tampos"],
  [/\btampo\b|bandeja/, "tampo", "Tampo"],
  [/\bcupula/, "cupula", "Cúpula"],
  [/\bhaste/, "haste", "Haste"],
  [/\bassento/, "assento", "Assento"],
  [/\balmofada/, "estofado", "Almofada"],
  [/\binterno|\binterna/, "interno", "Interno"],
  [/\bdetalhe/, "detalhe", "Detalhe"],
  [/\bpuxador/, "detalhe", "Puxador"],
  [/\bexterno/, "corpo", "Externo"],
  [/\bcaixa|\bcorpo/, "corpo", "Caixa"],
  [/\bbase superior/, "corpo", "Base superior"],
  [/\bpes?\b|\bpes\b/, "pes", "Pés"],
  [/\bbase\b/, "pes", "Base"],
  [/\bestrutura/, "pes", "Estrutura"],
];
// acabamento citado -> família da biblioteca (null = material fixo, sem troca no 3D)
const MATERIAIS = [
  [/cobre|latao/, null, "Cobre ou latão"],
  [/porcelana/, null, "Porcelana"],
  [/linho|cupula .*preta/, null, "Linho ou preta"],
  [/espelho|esp\. ?prata/, "espelho"],
  [/\bvidro|\bvd\b|\bvd\./, "vidro"],
  [/recouro/, "recouro"],
  [/couri/, "courissimo"],
  [/tecido/, "tecido"],
  [/laca|pint|laque|textura/, "laca"],
  [/carvalho|nogueira|lamina|madeira|jequitiba|tingi/, "lamina"],
];
const familiasDe = (s) => {
  const out = new Set(), fixos = new Set();
  for (const [re, f, rot] of MATERIAIS) {
    if (!re.test(s)) continue;
    if (f) out.add(f); else fixos.add(rot);
    if (f === "vidro" && /sem vidro/.test(s) && !/com (ou sem )?vidro|com vd/.test(s)) out.delete("vidro");
  }
  return { familias: out, fixos };
};
const ASSENTO = /^(cadeira|poltrona|banco|banqueta|puff|pufe)/;
const ESTOFADOS = ["tecido", "courissimo", "recouro", "tela"];
const ROTULO_ESTOFADO = (fams) => (fams.includes("tela") && fams.length === 1 ? "Tela" : "Estofado");

const { data: marca } = await sb.from("marcas").select("id").eq("slug", "essenza").single();
const { data: produtos } = await sb.from("produtos").select("slug, nome, categoria, especificacoes").eq("marca_id", marca.id).order("slug");
const saida = {};
for (const p of produtos) {
  const s = p.slug.replace(/^essenza-/, "");
  const esp = p.especificacoes ?? {};
  const site = new Set(esp.grupos ?? []);
  const confs = (esp.revestimentos ?? []).filter((r) => r.length < 120 && !/^(atencao|para pes|valor|estrutura em mdf|medida)/.test(sa(r)));
  const opcoes = (esp.aplicacoes ?? []).flatMap((a) => a.opcoes).map(sa);
  const cat = sa(p.categoria ?? "");
  const pecas = new Map(); // papel -> { rotulo, familias:Set }
  const fixos = new Set();
  let todo = false;
  const add = (papel, rotulo, fams) => {
    const x = pecas.get(papel) ?? { papel, rotulo, familias: new Set() };
    fams.forEach((f) => x.familias.add(f));
    pecas.set(papel, x);
  };
  for (const c of confs.map(sa)) {
    const segs = c.split(/\s*\+\s*|\s+com\s+|\s+c\/\s*|\/\s+|\s+e\s+(?=caixa|cupula|tampo)/);
    let algum = false;
    for (const seg of segs) {
      const peca = PECAS.find(([re]) => re.test(seg));
      const { familias, fixos: fx } = familiasDe(seg);
      fx.forEach((f) => fixos.add(f));
      if (peca) {
        algum = true;
        // "Base e Cúpula Carvalho": as duas peças levam o acabamento
        if (/base e cupula/.test(seg)) { add("pes", "Base", familias); add("cupula", "Cúpula", familias); continue; }
        if (/\bpes? e puxador/.test(seg)) { add("pes", "Pés", familias); add("detalhe", "Puxador", familias); continue; }
        add(peca[1], peca[2], familias);
      } else if (familias.size && algum) {
        // "Pé Madeira + Tampo Laca com Vidro": "Vidro" sem peça vale para a peça anterior do mesmo trecho
        const ult = [...pecas.values()].at(-1);
        familias.forEach((f) => ult.familias.add(f));
      } else if (familias.size) {
        if (/^tod[ao]/.test(seg)) todo = true;
        add("todo", "Peça toda", familias);
      }
    }
  }
  // opções da tabela: "Tampo com Vidro 4mm" -> o tampo aceita vidro
  const vidroNoTampo = opcoes.some((o) => /tampo com vidro/.test(o));

  let partes = [];
  const ehMesa = /^mesa (de jantar|de centro|lateral|bistro)|^mesas/.test(cat) || /^aparador|^carro bar/.test(cat);
  if (ASSENTO.test(cat)) {
    // assentos: estrutura (madeira/laca da tabela) + estofado (grupos de tecido/couro do site)
    const est = pecas.get("todo") ?? pecas.get("pes") ?? { familias: new Set(["lamina", "laca"].filter((f) => site.has(f))) };
    let estof = ESTOFADOS.filter((f) => site.has(f));
    if (!estof.length && temEstofado(s)) estof = ["tecido", "courissimo"];
    if (pecas.get("assento")) partes.push({ papel: "assento", rotulo: "Assento", familias: [...pecas.get("assento").familias] });
    partes.push({ papel: "estrutura", rotulo: pecas.get("pes")?.rotulo === "Pés" ? "Pés e estrutura" : "Estrutura", familias: [...est.familias] });
    if (estof.length) partes.push({ papel: "estofado", rotulo: ROTULO_ESTOFADO(estof), familias: estof });
  } else if (/^cama/.test(cat)) {
    const est = pecas.get("todo")?.familias ?? new Set(["lamina", "laca"].filter((f) => site.has(f)));
    const estof = [...new Set([...ESTOFADOS.filter((f) => site.has(f)), ...[...(pecas.get("todo")?.familias ?? [])].filter((f) => ESTOFADOS.includes(f))])];
    const madeira = [...est].filter((f) => !ESTOFADOS.includes(f));
    if (madeira.length) partes.push({ papel: "estrutura", rotulo: "Estrutura da cama", familias: madeira });
    if (estof.length) partes.push({ papel: "estofado", rotulo: "Estofado", familias: estof });
  } else if (/^espelho/.test(cat)) {
    const mold = pecas.get("todo")?.familias ?? new Set(["lamina", "laca"].filter((f) => site.has(f)));
    partes.push({ papel: "moldura", rotulo: "Moldura", familias: [...mold] });
    partes.push({ papel: "espelho", rotulo: "Espelho", familias: ["espelho"] });
  } else if (todo && pecas.size === 1) {
    partes.push({ papel: "todo", rotulo: "Peça toda", familias: [...pecas.get("todo").familias] });
  } else if (ehMesa) {
    // mesas/aparadores: tampo + base. Configuração sem peça ("Carvalho; Nogueira; Laca") vale para as duas;
    // o tampo ainda aceita vidro (opção da tabela) e pedra/TS/vidro quando o site da marca oferece para o produto.
    const geral = pecas.get("todo")?.familias ?? new Set();
    const base = pecas.get("pes") ?? { rotulo: "Base", familias: new Set() };
    const tampo = pecas.get("tampo") ?? { rotulo: "Tampo", familias: new Set() };
    const fb = new Set([...base.familias, ...geral]);
    const ft = new Set([...tampo.familias, ...geral]);
    if (!confs.length) ["lamina", "laca"].filter((f) => site.has(f)).forEach((f) => { fb.add(f); ft.add(f); });
    if (vidroNoTampo) ft.add("vidro");
    if (!pecas.get("tampo") || !/sem vidro/.test(confs.map(sa).join(" "))) ["pedra", "ts"].filter((f) => site.has(f)).forEach((f) => ft.add(f));
    if (!confs.length && site.has("vidro")) ft.add("vidro");
    if (pecas.get("corpo")) partes.push({ papel: "corpo", rotulo: pecas.get("corpo").rotulo, familias: [...pecas.get("corpo").familias] });
    partes.push({ papel: "tampo", rotulo: tampo.rotulo, familias: [...ft] });
    partes.push({ papel: "pes", rotulo: base.rotulo, familias: [...fb] });
  } else {
    // móveis de caixa (buffet, cômoda, rack, criado, bar, escrivaninha, cristaleira...) e o resto
    const geral = pecas.get("todo")?.familias;
    if (!pecas.size && site.size) {
      partes.push({ papel: "todo", rotulo: "Peça toda", familias: ["lamina", "laca"].filter((f) => site.has(f)) });
    }
    // móvel de caixa com "Pé + Tampo" e sem caixa citada: o tampo é a caixa inteira (o que não é pé)
    const tp = pecas.get("tampo");
    if (tp && !pecas.get("corpo")) { pecas.delete("tampo"); pecas.set("corpo", { papel: "corpo", rotulo: "Caixa e tampo", familias: tp.familias }); }
    for (const x of pecas.values()) {
      if (x.papel === "todo") continue;
      partes.push({ papel: x.papel, rotulo: x.rotulo, familias: [...x.familias] });
    }
    if (geral) {
      // "Carvalho; Nogueira; Laca" junto com peças citadas: é o acabamento do corpo
      const corpo = partes.find((x) => x.papel === "corpo");
      if (corpo) geral.forEach((f) => corpo.familias.includes(f) || corpo.familias.push(f));
      else partes.unshift({ papel: partes.length ? "corpo" : "todo", rotulo: partes.length ? "Caixa" : "Peça toda", familias: [...geral] });
    }
  }
  // portas acompanham as famílias do corpo quando a tabela só cita a troca ("portas laca" num corpo de lâmina)
  const portas = partes.find((x) => x.papel === "portas"), corpo = partes.find((x) => x.papel === "corpo");
  if (portas && corpo) corpo.familias.forEach((f) => portas.familias.includes(f) || portas.familias.push(f));
  partes = partes.filter((x) => x.familias.length);
  const ordem = ["todo", "tampo", "corpo", "portas", "assento", "estofado", "estrutura", "moldura", "espelho", "pes", "cupula", "haste", "interno", "detalhe"];
  partes.sort((a, b) => ordem.indexOf(a.papel) - ordem.indexOf(b.papel));
  saida[s] = { nome: p.nome, categoria: p.categoria, partes, fixos: [...fixos], ...(manual[s] ?? {}) };
}
fs.writeFileSync(path.join(pasta, "partes-def.json"), JSON.stringify(saida, null, 1));
const cont = {};
Object.values(saida).forEach((d) => d.partes.forEach((x) => (cont[x.rotulo] = (cont[x.rotulo] || 0) + 1)));
console.log(`Produtos: ${Object.keys(saida).length}`, cont);
