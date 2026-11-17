// Gera FBX, DAE, 3DS (Blender) e DWG (ODA File Converter) de cada produto e envia para o Storage.
// Roda depois de gerar-downloads.mjs (usa o DXF que ele publicou para fazer o DWG).
// As ferramentas ficam em ../ferramentas (fora do Git). Os arquivos de trabalho ficam em ../amostras/<marca>/conversao.
//
// Uso (dentro de web/):  node scripts/gerar-downloads-extras.mjs <slug-da-marca> [slug-do-produto]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { createClient } from "@supabase/supabase-js";

const [slugMarca, soProduto] = process.argv.slice(2);
if (!slugMarca) { console.error("uso: node scripts/gerar-downloads-extras.mjs <marca> [produto]"); process.exit(1); }

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, "..", "..");
const BLENDER = process.env.BLENDER ?? path.join(raiz, "ferramentas", "blender-4.2.23-windows-x64", "blender.exe");
const ODA = process.env.ODA ?? path.join(raiz, "ferramentas", "oda", "ODAFileConverter.exe");
const trabalho = path.join(raiz, "amostras", slugMarca, "conversao");
for (const f of [BLENDER, ODA]) if (!fs.existsSync(f)) { console.error(`Ferramenta não encontrada: ${f}`); process.exit(1); }

const env = Object.fromEntries(
  fs.readFileSync(path.join(aqui, "..", ".env.local"), "utf8")
    .split(/\r?\n/).filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const publico = (p) => `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/publico/${p}`;
const baixar = async (url, destino) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  fs.writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
};

// 1) produtos e arquivos de entrada
const { data: marca } = await sb.from("marcas").select("id").eq("slug", slugMarca).single();
let q = sb.from("produtos").select("id, slug, glb_path").eq("marca_id", marca.id).not("glb_path", "is", null);
if (soProduto) q = q.eq("slug", soProduto);
const { data: produtos, error } = await q;
if (error) throw error;

const dxfDir = path.join(trabalho, "_dxf"), dwgDir = path.join(trabalho, "_dwg");
fs.rmSync(dxfDir, { recursive: true, force: true }); fs.rmSync(dwgDir, { recursive: true, force: true });
fs.mkdirSync(dxfDir, { recursive: true }); fs.mkdirSync(dwgDir, { recursive: true });

const linhasLista = [];
for (const p of produtos) {
  const dir = path.join(trabalho, p.slug);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  await baixar(publico(p.glb_path), path.join(dir, "modelo.glb"));
  await baixar(publico(`${slugMarca}/downloads/${p.slug}.dxf`), path.join(dxfDir, `${p.slug}.dxf`));
  linhasLista.push([path.join(dir, "modelo.glb"), dir, p.slug].join("|"));
}
const lista = path.join(trabalho, "lista.txt");
fs.writeFileSync(lista, linhasLista.join("\n"));
console.log(`Entradas prontas: ${produtos.length} produtos`);

// 2) Blender: FBX, DAE, 3DS (um único processo para todos)
const bl = spawnSync(BLENDER, ["-b", "-P", path.join(aqui, "blender-exportar.py"), "--", lista], { encoding: "utf8", maxBuffer: 1 << 28 });
const errosBlender = (bl.stdout || "").split("\n").filter((l) => l.startsWith("ERRO"));
console.log(`Blender: ${(bl.stdout.match(/^OK /gm) || []).length} ok, ${errosBlender.length} com erro`);
errosBlender.forEach((e) => console.log("  " + e));

// 3) ODA: DXF -> DWG (AutoCAD 2013), pasta inteira de uma vez
const oda = spawnSync(ODA, [dxfDir, dwgDir, "ACAD2013", "DWG", "0", "1", "*.DXF"], { encoding: "utf8" });
if (oda.status !== 0) console.log(`ODA saiu com ${oda.status}: ${oda.stderr}`);

// 4) empacota, envia e registra
const zipPasta = (dir) => zipSync(Object.fromEntries(fs.readdirSync(dir).map((f) => [f, new Uint8Array(fs.readFileSync(path.join(dir, f)))])), { level: 6 });
const enviar = async (caminho, dados, tipo) => {
  const { error: e } = await sb.storage.from("publico").upload(caminho, dados, { contentType: tipo, upsert: true });
  if (e) throw new Error(`${caminho}: ${e.message}`);
  return dados.length;
};

let ok = 0;
for (const p of produtos) {
  const dir = path.join(trabalho, p.slug);
  const base = `${slugMarca}/downloads/${p.slug}`;
  const linhas = [];
  const fbx = path.join(dir, "fbx", `${p.slug}.fbx`);
  if (fs.existsSync(fbx)) linhas.push({ formato: "fbx", path: `${base}.fbx`, tamanho_bytes: await enviar(`${base}.fbx`, fs.readFileSync(fbx), "application/octet-stream") });
  if (fs.existsSync(path.join(dir, "dae", `${p.slug}.dae`))) linhas.push({ formato: "dae", path: `${base}.dae.zip`, tamanho_bytes: await enviar(`${base}.dae.zip`, zipPasta(path.join(dir, "dae")), "application/zip") });
  if (fs.existsSync(path.join(dir, "3ds", `${p.slug}.3ds`))) linhas.push({ formato: "3ds", path: `${base}.3ds.zip`, tamanho_bytes: await enviar(`${base}.3ds.zip`, zipPasta(path.join(dir, "3ds")), "application/zip") });
  const dwg = path.join(dwgDir, `${p.slug}.dwg`);
  if (fs.existsSync(dwg)) linhas.push({ formato: "dwg", path: `${base}.dwg`, tamanho_bytes: await enviar(`${base}.dwg`, fs.readFileSync(dwg), "application/acad") });

  if (linhas.length) {
    const { error: e } = await sb.from("arquivos_download").upsert(linhas.map((l) => ({ produto_id: p.id, ...l })), { onConflict: "produto_id,formato" });
    if (e) throw new Error(`${p.slug}: ${e.message}`);
  }
  const faltando = ["fbx", "dae", "3ds", "dwg"].filter((f) => !linhas.some((l) => l.formato === f));
  if (!faltando.length) ok++;
  console.log(`${faltando.length ? "INCOMPLETO" : "ok"} ${p.slug}  ${linhas.map((l) => `${l.formato} ${(l.tamanho_bytes / 1024).toFixed(0)}KB`).join("  ")}${faltando.length ? "  faltando: " + faltando.join(",") : ""}`);
}
console.log(`\nCompletos: ${ok} de ${produtos.length}`);
