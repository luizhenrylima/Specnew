// Grava em produto_partes.materiais quais materiais do GLB formam cada parte, a partir de
// ../amostras/<marca>/partes-materiais.json ({ "<slug sem marca>": { "<Parte>": ["mat24", ...] } }).
// Uso (dentro de web/): node scripts/partes-materiais.mjs <marca>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const [slugMarca] = process.argv.slice(2);
const aqui = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.join(aqui, "..", ".env.local"), "utf8").split(/\r?\n/).filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const mapa = JSON.parse(fs.readFileSync(path.resolve(aqui, "..", "..", "amostras", slugMarca, "partes-materiais.json"), "utf8"));

const { data: marca } = await sb.from("marcas").select("id").eq("slug", slugMarca).single();
const { data: partes, error } = await sb.from("produto_partes").select("id, rotulo, produtos!inner(slug, marca_id)").eq("produtos.marca_id", marca.id);
if (error) throw error;
let ligadas = 0;
for (const p of partes) {
  const materiais = mapa[p.produtos.slug.replace(`${slugMarca}-`, "")]?.[p.rotulo] ?? [];
  const { error: e } = await sb.from("produto_partes").update({ materiais }).eq("id", p.id);
  if (e) throw e;
  if (materiais.length) ligadas++;
}
console.log(`Partes: ${partes.length}, ligadas a materiais do 3D: ${ligadas}`);
