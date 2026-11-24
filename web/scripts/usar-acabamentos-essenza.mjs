// Deixa só a biblioteca da Essenza no sistema: as famílias da Hommes passam a apontar para as coleções da Essenza
// e os acabamentos da Sier (e os genéricos de Inox/Espelhos) são excluídos, com as imagens no Storage.
// Uso (dentro de web/): node scripts/usar-acabamentos-essenza.mjs [--excluir]
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const excluir = process.argv.includes("--excluir");

// família da Hommes -> coleções da Essenza (regra da Hommes mantida: lâmina, pinturas, pedra, couro sintético, vidro, espelho)
const HOMMES = {
  lamina: ["Lâminas de Madeira (Essenza)"],
  pintura_micro: ["Lacas (Essenza)"],
  pintura_hg: ["Lacas (Essenza)"],
  inox: [], // a Essenza não tem cartela de inox: fica "sob consulta"
  inox_pintura: ["Lacas (Essenza)"],
  pedra: ["Pedras Sinterizadas (Essenza)", "TS (Essenza)"],
  couro_sintetico: ["Couríssimos (Essenza)", "Recouro (Essenza)"],
  couro_natural: [],
  camurca_sintetica: [],
  vidro: ["Vidros (Essenza)"],
  espelho: ["Espelhos (Essenza)"],
};
const { data: hommes } = await sb.from("marcas").select("id").eq("slug", "hommes").single();
for (const [familia, colecoes] of Object.entries(HOMMES)) {
  const { error } = await sb.from("marca_familias").update({ colecoes }).eq("marca_id", hommes.id).eq("familia", familia);
  if (error) throw new Error(`${familia}: ${error.message}`);
}
console.log("Hommes: famílias apontando para as coleções da Essenza");

const { data: fora } = await sb.from("acabamentos").select("id, codigo, fornecedor, colecao, textura_cor_path, textura_normal_path, textura_miniatura_path")
  .or("fornecedor.is.null,fornecedor.neq.Essenza");
console.log(`Acabamentos que não são da Essenza: ${fora.length}`);
if (!excluir) { console.log("(rode com --excluir para apagar)"); process.exit(0); }
const arquivos = fora.flatMap((a) => [a.textura_cor_path, a.textura_normal_path, a.textura_miniatura_path]).filter(Boolean);
for (let i = 0; i < arquivos.length; i += 100) {
  const { error } = await sb.storage.from("publico").remove(arquivos.slice(i, i + 100));
  if (error) throw new Error(error.message);
}
for (let i = 0; i < fora.length; i += 100) {
  const { error } = await sb.from("acabamentos").delete().in("id", fora.slice(i, i + 100).map((a) => a.id));
  if (error) throw new Error(error.message);
}
console.log(`Excluídos: ${fora.length} acabamentos e ${arquivos.length} imagens`);
