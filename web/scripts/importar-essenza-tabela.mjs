// Grava nas fichas dos produtos da Essenza as informações técnicas da tabela de vendas (tabela-extraida.json),
// no mesmo padrão da Hommes: referência, medidas disponíveis, combinações de acabamento, opções e observações.
// Uso (dentro de web/): node scripts/importar-essenza-tabela.mjs ../amostras/essenza
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const [pasta] = process.argv.slice(2);
const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
// rede instável: repete cada chamada ao banco até 5 vezes
async function tentar(fn) {
  for (let i = 0; ; i++) {
    try {
      const r = await fn();
      if (r?.error && /fetch failed|network|timeout/i.test(r.error.message) && i < 4) throw new Error(r.error.message);
      return r;
    } catch (e) {
      if (i >= 4) throw e;
      await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
    }
  }
}
const tabela = JSON.parse(fs.readFileSync(path.join(pasta, "tabela-extraida.json"), "utf8"));

// nome normalizado para comparar arquivo x tabela ("Criado-Mudo Alabama" = "Mesa de Cabeceira Alabama")
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/criado[- ]mudo/g, "mesa de cabeceira").replace(/mesa cabeceira/g, "mesa de cabeceira").replace(/mesa centro/g, "mesa de centro")
  .replace(/mesa jantar/g, "mesa de jantar").replace(/\bcomcomoda\b/g, "comoda").replace(/\bfinal\b|\bfaenza\b|\bessenza\b/g, "")
  .replace(/[^a-z0-9]+/g, " ").trim();
const porNome = new Map(tabela.map((t) => [norm(t.nome), t]));
// último recurso: mesmo nome sem a categoria, dentro de categorias compatíveis
const nucleo = (s) => norm(s).replace(/^(mesa de jantar|mesa de centro|mesa lateral|mesa de cabeceira|mesa bistro|comoda dupla|comoda|aparador|buffet|cadeira|poltrona|banqueta|banco|cama|carro bar|bar|escrivaninha|espelho|luminaria|rack|pufe?|puff|estante|cristaleira|penteadeira|mancebo)\s+/, "");
const categoriaDe = (s) => norm(s).split(" ").slice(0, 2).join(" ");

// grafias diferentes entre o arquivo .skp e a tabela (conferidas à mão)
const MANUAL = {
  "Mesa Cannes": [/^Mesa de Jantar Cannes$/], "Mesa de Jantar Swiss Redonda": [/^Mesa de Jantar Swiss$/],
  "Mesa de Jantar Soft Redonda": [/^Mesa de Jantar Soft$/], "Mesa de Jantar Bell Redonda": [/^Mesa de Jantar Bell$/],
  "Mesa de Centro York Retangular": [/^Mesa de Centro York$/], "Mesa de Centro Minato Retangular": [/^Mesa de Centro Minato$/],
  "Mesa de Centro Chanell": [/^Mesa de Centro Chanel$/], "Mesa de Centro Yin Yang": [/^Mesa de Centro Yin$/],
  "Rack Planíce": [/^Rack Planície$/], "Espelho Eros Redondo": [/^Espelho Eros$/], "Espelho Urca Orgânico": [/^Espelho Urca Irregular/],
};
const { data: marca } = await sb.from("marcas").select("id").eq("slug", "essenza").single();
const { data: produtos } = await sb.from("produtos").select("id, slug, nome, especificacoes").eq("marca_id", marca.id);
let ligados = 0;
const sem = [];
for (const p of produtos) {
  let t = porNome.get(norm(p.nome));
  if (!t) {
    const cands = tabela.filter((x) => nucleo(x.nome) === nucleo(p.nome) && categoriaDe(x.nome).split(" ")[0] === categoriaDe(p.nome).split(" ")[0]);
    if (cands.length === 1) t = cands[0];
  }
  if (!t && MANUAL[p.nome]) {
    const versoes = tabela.filter((x) => MANUAL[p.nome].some((re) => re.test(x.nome)));
    if (versoes.length) {
      const uniao = (k) => [...new Set(versoes.flatMap((v) => v[k]))];
      t = {
        nome: p.nome, referencias: uniao("referencias"), revestimentos: uniao("revestimentos"), observacoes: uniao("observacoes"),
        opcoes: [...(versoes.length > 1 ? versoes.map((v) => v.nome) : []), ...uniao("opcoes")],
        medidas: [...new Map(versoes.flatMap((v) => v.medidas).map((m) => [m.rotulo, m])).values()],
      };
    }
  }
  if (!t) {
    // versões do mesmo produto na tabela ("Cadeira Golf Sem Braço Tela Fina", "Espelho de Chão Beirute", "Luminária Alta Lux"):
    // linhas da mesma categoria cujo nome contém o nome do produto; junta todas
    const nu = nucleo(p.nome);
    const re = new RegExp(`(^| )${nu.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`);
    const cat = norm(p.nome).split(" ")[0];
    const versoes = nu.length >= 3 ? tabela.filter((x) => norm(x.nome).split(" ")[0] === cat && re.test(norm(x.nome))) : [];
    if (versoes.length) {
      const uniao = (k) => [...new Set(versoes.flatMap((v) => v[k]))];
      t = {
        nome: p.nome, referencias: uniao("referencias"), revestimentos: uniao("revestimentos"), observacoes: uniao("observacoes"),
        opcoes: [...(versoes.length > 1 ? versoes.map((v) => v.nome) : []), ...uniao("opcoes")],
        medidas: [...new Map(versoes.flatMap((v) => v.medidas).map((m) => [m.rotulo, m])).values()],
      };
    }
  }
  if (!t) { sem.push(p.nome); continue; }
  ligados++;
  const esp = p.especificacoes ?? {};
  const atualizar = {
    referencia: t.referencias[0] ?? null,
    especificacoes: {
      ...esp,
      referencias: t.referencias,
      revestimentos: t.revestimentos,
      aplicacoes: t.opcoes.length ? [{ tipo: "Opções", onde: null, opcoes: t.opcoes }] : [],
      observacoes: t.observacoes,
      medidas_tabela: t.medidas.map((m) => ({ rotulo: m.rotulo, ref: m.ref, base: m.base })),
    },
    notas_acabamento: t.observacoes,
  };
  const { error } = await tentar(() => sb.from("produtos").update(atualizar).eq("id", p.id));
  if (error) throw new Error(`${p.slug}: ${error.message}`);
  // medidas disponíveis: as da tabela (oficiais), sem repetir
  if (t.medidas.length) {
    const unicas = [...new Map(t.medidas.map((m) => [m.rotulo, m])).values()];
    await tentar(() => sb.from("produto_medidas").delete().eq("produto_id", p.id));
    const { error: e2 } = await tentar(() => sb.from("produto_medidas").insert(unicas.map((m, i) => ({
      produto_id: p.id, rotulo: m.rotulo, largura_mm: m.largura_mm, profundidade_mm: m.profundidade_mm, altura_mm: m.altura_mm, ordem: i,
    }))));
    if (e2) throw new Error(`${p.slug} medidas: ${e2.message}`);
  }
}
console.log(`Produtos ligados à tabela: ${ligados} de ${produtos.length}`);
console.log(`Sem linha na tabela (${sem.length}): ${sem.join(", ")}`);
