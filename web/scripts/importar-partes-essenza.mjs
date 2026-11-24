// Grava as peças configuráveis de cada produto da Essenza (partes-def.json) com os materiais separados por
// blender-partes.py (conversao/<slug>/partes.json) e sobe o modelo.glb novo no lugar do antigo.
// Peça da ficha que não dá para separar no 3D (ex.: interno, puxador) entra sem materiais: o site avisa que a troca
// não aparece na visualização, mas o arquiteto vê as opções.
// Uso (dentro de web/): node scripts/importar-partes-essenza.mjs ../amostras/essenza [slug ...]
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const [pasta, ...so] = process.argv.slice(2);
const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function tentar(fn, rotulo) {
  for (let i = 0; ; i++) {
    try {
      const r = await fn();
      if (r?.error) throw new Error(r.error.message);
      return r;
    } catch (e) {
      if (i >= 4) throw new Error(`${rotulo}: ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
    }
  }
}
const nomeObj = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const defs = JSON.parse(fs.readFileSync(path.join(pasta, "partes-def.json"), "utf8"));
const { data: marca } = await sb.from("marcas").select("id").eq("slug", "essenza").single();
const { data: produtos } = await sb.from("produtos").select("id, slug, glb_path").eq("marca_id", marca.id);
let n = 0;
for (const p of produtos) {
  const s = p.slug.replace(/^essenza-/, "");
  if (so.length && !so.includes(s)) continue;
  const dir = path.join(pasta, "conversao", s);
  const arq = path.join(dir, "partes.json");
  if (!defs[s] || !fs.existsSync(arq)) { console.log(`PULADO ${s}: sem peças separadas`); continue; }
  const mats = JSON.parse(fs.readFileSync(arq, "utf8"));
  await tentar(() => sb.storage.from("publico").upload(p.glb_path, fs.readFileSync(path.join(dir, "modelo.glb")), { contentType: "model/gltf-binary", upsert: true }), `${s} glb`);
  await tentar(() => sb.from("produto_partes").delete().eq("produto_id", p.id), `${s} apagar`);
  const linhas = defs[s].partes.map((x, i) => ({
    produto_id: p.id, nome_no_obj: nomeObj(x.rotulo), rotulo: x.rotulo, familias: x.familias, materiais: mats[x.papel] ?? [], ordem: i,
  }));
  if (linhas.length) await tentar(() => sb.from("produto_partes").insert(linhas), `${s} partes`);
  n++;
  console.log(`ok ${s}  ${linhas.map((l) => `${l.rotulo}${l.materiais.length ? "" : " (sem 3D)"}`).join(" · ")}`);
}
console.log(`Produtos atualizados: ${n}`);
