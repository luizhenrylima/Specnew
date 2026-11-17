// Transforma as regras de acabamento da tabela (produtos.especificacoes) em partes + famílias permitidas por parte.
// Saída: ../amostras/<marca>/regras-acabamento.json (para revisão) e, com --gravar, grava em produto_partes.
//
// Famílias: lamina, pintura_micro, pintura_hg, inox, inox_pintura, pedra, couro_sintetico, couro_natural,
//           camurca_sintetica, vidro, espelho.
// Uso (dentro de web/): node scripts/regras-acabamento.mjs <marca> [--gravar]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const [slugMarca] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const gravar = process.argv.includes("--gravar");
const aqui = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.join(aqui, "..", ".env.local"), "utf8").split(/\r?\n/).filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const sem = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Nome da parte a partir de um trecho do texto da tabela (ordem importa: o mais específico primeiro).
const PARTES = [
  [/frente.{0,6}gav|frentes de gav/, "Frentes de gaveta"],
  [/porta/, "Portas"],
  [/prateleira/, "Prateleira"],
  [/bandej|bandj/, "Bandeja"],
  [/puxador/, "Puxador"],
  [/lateral|laterais/, "Laterais"],
  [/\btampo|\btp\b|\btmp\b|superior/, "Tampo"],
  [/\bpe\b|\bpes\b/, "Pés"],
  [/estrut|extrut/, "Estrutura"],
  [/\bbase\b/, "Base"],
  [/\bcorpo\b/, "Corpo"],
  [/\bapoio/, "Apoio"],
  [/\bdet\b|detalhe/, "Detalhes"],
  [/\bint\b|intern/, "Interno"],
  [/\bext\b|extern/, "Externo"],
];
const parteDe = (t) => { const s = sem(t); const p = PARTES.find(([re]) => re.test(s)); return p ? p[1] : null; };

// Famílias de material citadas num trecho.
function familiasDe(t) {
  const s = sem(t), f = [];
  if (/lamina|\blam\b|madeira|\bmad\b/.test(s)) f.push("lamina");
  if (/pintura|\bpint\b/.test(s)) f.push("pintura");
  if (/inox|\baco\b/.test(s)) f.push("inox");
  if (/espelho/.test(s)) f.push("espelho");
  if (/vidro|\bvd\b/.test(s)) f.push("vidro");
  if (/pedra/.test(s)) f.push("pedra");
  return f;
}

function regrasProduto(esp) {
  const partes = new Map(); // nome -> Set(famílias)
  const notas = [];
  const add = (parte, fams) => {
    if (!parte || !fams.length) return;
    if (!partes.has(parte)) partes.set(parte, new Set());
    fams.forEach((f) => partes.get(parte).add(f));
  };
  const obs = (esp.observacoes ?? []).map(sem);
  const semHG = obs.some((o) => /nao faz em high/.test(o));
  const pesSemLamina = obs.some((o) => /nao faz os pes em lamina/.test(o));

  // 1) revestimentos: "Pes Inox/Tampo Lamina — Microtextura"
  for (const r of esp.revestimentos ?? []) {
    const [esq, dir = ""] = r.split("—").map((x) => x.trim());
    const sd = sem(dir);
    if (/quando usar pedra/.test(sem(esq))) { add("Tampo", ["pedra"]); continue; }
    if (/medidas intermediarias|calculo do par|bipartido|nao vende separado|pode ser em duas cores/.test(sem(esq))) {
      notas.push(esq); continue;
    }
    const hg = /highgloss|highloss/.test(sd);
    const hgParte = hg ? parteDe(dir.replace(/highgloss/i, "")) : null; // "(tampo) Highgloss" -> Tampo
    const trechos = esq.split(/\/|\+|_| ou /i).map((x) => x.trim()).filter(Boolean);
    let parteAnterior = null;
    for (const tr of trechos) {
      let parte = parteDe(tr);
      let fams = familiasDe(tr);
      // sem nome de parte: espelho vira a parte "Espelho", vidro vai no tampo, o resto é a estrutura
      if (!parte && fams.includes("espelho")) parte = "Espelho";
      else if (!parte && fams.length === 1 && fams[0] === "vidro") parte = "Tampo";
      else if (!parte && fams.length) parte = parteAnterior ?? "Estrutura";
      if (parte && !fams.length) continue;
      parteAnterior = parte;
      fams = fams.flatMap((f) => {
        if (f !== "pintura") return [f];
        const usaHG = hg && !semHG && (!hgParte || hgParte === parte);
        return usaHG ? ["pintura_micro", "pintura_hg"] : ["pintura_micro"];
      });
      if (/espelho/.test(sem(tr))) fams = ["espelho"];
      add(parte, fams);
    }
    // "Mxt. / Externo. Highgloss" e "(tampo) Highgloss": highgloss na parte citada mesmo que a pintura venha de outra linha
    if (hg && !semHG && hgParte && partes.has(hgParte) && partes.get(hgParte).has("pintura_micro")) partes.get(hgParte).add("pintura_hg");
  }

  // 2) aplicações (couro, vidro/espelho, pedra, inox tonalizado, opções de tampo)
  for (const a of esp.aplicacoes ?? []) {
    const tipo = sem(a.tipo ?? ""), onde = a.onde ?? "", ops = (a.opcoes ?? []).map(sem).join(" | ");
    if (/revest\. (gav|prat)/.test(tipo)) { notas.push(`${a.tipo}: ${a.opcoes.join(", ")} (interno)`); continue; }
    if (/medidas intermediarias|nao vende separado/.test(ops)) { notas.push(a.opcoes.join(" ")); continue; }
    if (tipo === "couro" || tipo === "estofado") {
      const fams = [];
      if (/sintetico|estampado/.test(ops)) fams.push("couro_sintetico");
      if (/natural/.test(ops)) fams.push("couro_natural");
      if (/camurca/.test(ops)) fams.push("camurca_sintetica");
      // "no tampo e frentes de gavetas" -> duas partes
      const alvo = onde.split(/,| e /i).map(parteDe).filter(Boolean);
      const lista = alvo.length ? [...new Set(alvo)] : [tipo === "estofado" ? "Estofado" : "Peça"];
      lista.forEach((p) => add(p, fams));
      continue;
    }
    if (tipo.includes("vidro") || tipo.includes("espelho") || tipo.includes("pedra")) {
      const fams = [];
      if (/vidro|acidato/.test(ops)) fams.push("vidro");
      if (/espelho|argentato/.test(ops)) fams.push("espelho");
      if (tipo.includes("pedra")) fams.push("pedra");
      add(parteDe(onde) ?? "Tampo", fams);
      continue;
    }
    if (tipo.includes("inox")) {
      for (const [p, s] of partes) if (s.has("inox")) s.add("inox_pintura");
      if (![...partes.values()].some((s) => s.has("inox"))) notas.push("Inox tonalizado citado, mas nenhuma parte em inox nas combinações");
      continue;
    }
    // códigos de tampo (124/208, 113202...): "Tampo 36mm - Lamina", "Vidro 12mm"
    if (/tampo|vidro|lamina|pintura/.test(ops)) {
      const fams = [...new Set(familiasDe(ops).flatMap((f) => (f === "pintura" ? (semHG ? ["pintura_micro"] : ["pintura_micro"]) : [f])))];
      add("Tampo", fams);
      continue;
    }
    notas.push(`${a.tipo}: ${a.opcoes.join(", ")}`);
  }

  if (pesSemLamina && partes.has("Pés")) partes.get("Pés").delete("lamina");
  if (semHG) for (const s of partes.values()) s.delete("pintura_hg");
  for (const o of esp.observacoes ?? []) notas.push(o);

  return {
    partes: [...partes].map(([nome, s]) => ({ nome, familias: [...s].sort() })).filter((p) => p.familias.length),
    notas: [...new Set(notas)],
  };
}

const { data: marca } = await sb.from("marcas").select("id").eq("slug", slugMarca).single();
const { data: produtos, error } = await sb.from("produtos").select("id, slug, nome, especificacoes").eq("marca_id", marca.id).order("slug");
if (error) throw error;

const saida = produtos.map((p) => ({ slug: p.slug, nome: p.nome, ...regrasProduto(p.especificacoes ?? {}) }));
const arq = path.resolve(aqui, "..", "..", "amostras", slugMarca, "regras-acabamento.json");
fs.writeFileSync(arq, JSON.stringify(saida, null, 1));
for (const p of saida) {
  console.log(`${p.nome}`);
  p.partes.forEach((x) => console.log(`   ${x.nome.padEnd(18)} ${x.familias.join(", ")}`));
  if (p.notas.length) console.log(`   notas: ${p.notas.join(" | ")}`);
}

if (gravar) {
  const slugParte = (n) => sem(n).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  for (const p of saida) {
    const id = produtos.find((x) => x.slug === p.slug).id;
    await sb.from("produto_partes").delete().eq("produto_id", id);
    const linhas = p.partes.map((x, i) => ({ produto_id: id, nome_no_obj: slugParte(x.nome), rotulo: x.nome, familias: x.familias, ordem: i }));
    if (linhas.length) {
      const { error: e } = await sb.from("produto_partes").insert(linhas);
      if (e) throw new Error(`${p.slug}: ${e.message}`);
    }
    await sb.from("produtos").update({ notas_acabamento: p.notas }).eq("id", id);
  }
  console.log(`\nGravado: ${saida.length} produtos`);
}
