// Gera FBX, DAE, 3DS (Blender), DWG (ODA File Converter) e SKP (SketchUp C SDK) de cada produto e envia para o Storage.
// Roda depois de gerar-downloads.mjs (usa o DXF que ele publicou para fazer o DWG).
// As ferramentas ficam em ../ferramentas (fora do Git). Os arquivos de trabalho ficam em ../amostras/<marca>/conversao.
//
// Uso (dentro de web/):  node scripts/gerar-downloads-extras.mjs <slug-da-marca> [slug-do-produto] [--formatos=fbx,dae,3ds,dwg,skp]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { createClient } from "@supabase/supabase-js";

const TODOS = ["fbx", "dae", "3ds", "dwg", "skp"];
const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const [slugMarca, soProduto] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const pedidos = (flags.find((f) => f.startsWith("--formatos="))?.split("=")[1].split(",") ?? TODOS).map((f) => f.trim());
if (!slugMarca || pedidos.some((f) => !TODOS.includes(f))) {
  console.error("uso: node scripts/gerar-downloads-extras.mjs <marca> [produto] [--formatos=fbx,dae,3ds,dwg,skp]");
  process.exit(1);
}
const quer = (f) => pedidos.includes(f);

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, "..", "..");
const BLENDER_DIR = path.join(raiz, "ferramentas", "blender-4.2.23-windows-x64");
const BLENDER = process.env.BLENDER ?? path.join(BLENDER_DIR, "blender.exe");
const PYTHON = process.env.BLENDER_PYTHON ?? path.join(BLENDER_DIR, "4.2", "python", "bin", "python.exe");
const ODA = process.env.ODA ?? path.join(raiz, "ferramentas", "oda", "ODAFileConverter.exe");
const SKP_SDK = process.env.SKETCHUP_SDK ?? path.join(raiz, "ferramentas", "sketchup-sdk");
const trabalho = path.join(raiz, "amostras", slugMarca, "conversao");
const precisa = [BLENDER, ...(quer("dwg") ? [ODA] : []), ...(quer("skp") ? [PYTHON, path.join(SKP_SDK, "SketchUpAPI.dll")] : [])];
for (const f of precisa) if (!fs.existsSync(f)) { console.error(`Ferramenta não encontrada: ${f}`); process.exit(1); }

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
const rodar = (exe, args, rotulo) => {
  const r = spawnSync(exe, args, { encoding: "utf8", maxBuffer: 1 << 28 });
  const saida = r.stdout || "";
  const erros = saida.split("\n").filter((l) => l.startsWith("ERRO"));
  console.log(`${rotulo}: ${(saida.match(/^OK /gm) || []).length} ok, ${erros.length} com erro`);
  erros.forEach((e) => console.log("  " + e));
  return saida;
};

// 1) produtos e arquivos de entrada
const { data: marca } = await sb.from("marcas").select("id").eq("slug", slugMarca).single();
let q = sb.from("produtos").select("id, slug, glb_path").eq("marca_id", marca.id).not("glb_path", "is", null);
if (soProduto) q = q.eq("slug", soProduto);
const { data: produtos, error } = await q;
if (error) throw error;

const dxfDir = path.join(trabalho, "_dxf"), dwgDir = path.join(trabalho, "_dwg");
if (quer("dwg")) {
  fs.rmSync(dxfDir, { recursive: true, force: true }); fs.rmSync(dwgDir, { recursive: true, force: true });
  fs.mkdirSync(dxfDir, { recursive: true }); fs.mkdirSync(dwgDir, { recursive: true });
}

const linhasLista = [];
for (const p of produtos) {
  const dir = path.join(trabalho, p.slug);
  for (const f of pedidos) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  fs.rmSync(path.join(dir, "_skp"), { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  await baixar(publico(p.glb_path), path.join(dir, "modelo.glb"));
  if (quer("dwg")) await baixar(publico(`${slugMarca}/downloads/${p.slug}.dxf`), path.join(dxfDir, `${p.slug}.dxf`));
  linhasLista.push([path.join(dir, "modelo.glb"), dir, p.slug].join("|"));
}
const lista = path.join(trabalho, "lista.txt");
fs.writeFileSync(lista, linhasLista.join("\n"));
console.log(`Entradas prontas: ${produtos.length} produtos · formatos: ${pedidos.join(", ")}`);

// 2) Blender: FBX, DAE, 3DS (um único processo para todos)
if (quer("fbx") || quer("dae") || quer("3ds")) rodar(BLENDER, ["-b", "-P", path.join(aqui, "blender-exportar.py"), "--", lista], "Blender FBX/DAE/3DS");

// 3) ODA: DXF -> DWG (AutoCAD 2013), pasta inteira de uma vez
if (quer("dwg")) {
  const oda = spawnSync(ODA, [dxfDir, dwgDir, "ACAD2013", "DWG", "0", "1", "*.DXF"], { encoding: "utf8" });
  if (oda.status !== 0) console.log(`ODA saiu com ${oda.status}: ${oda.stderr}`);
}

// 4) SKP em duas etapas: o Blender extrai a geometria; o Python do Blender (processo separado) grava o .skp.
//    A DLL do SketchUp trava se for carregada dentro do processo do Blender.
if (quer("skp")) {
  rodar(BLENDER, ["-b", "-P", path.join(aqui, "blender-skp.py"), "--", lista], "Blender extração SKP");
  const s = rodar(PYTHON, ["-I", path.join(aqui, "skp-gerar.py"), lista, SKP_SDK], "SketchUp SKP");
  s.split("\n").filter((l) => l.startsWith("OK ")).forEach((l) => console.log("  " + l.trim()));
}

// 5) empacota, envia e registra
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
  if (quer("fbx") && fs.existsSync(fbx)) linhas.push({ formato: "fbx", path: `${base}.fbx`, tamanho_bytes: await enviar(`${base}.fbx`, fs.readFileSync(fbx), "application/octet-stream") });
  if (quer("dae") && fs.existsSync(path.join(dir, "dae", `${p.slug}.dae`))) linhas.push({ formato: "dae", path: `${base}.dae.zip`, tamanho_bytes: await enviar(`${base}.dae.zip`, zipPasta(path.join(dir, "dae")), "application/zip") });
  if (quer("3ds") && fs.existsSync(path.join(dir, "3ds", `${p.slug}.3ds`))) linhas.push({ formato: "3ds", path: `${base}.3ds.zip`, tamanho_bytes: await enviar(`${base}.3ds.zip`, zipPasta(path.join(dir, "3ds")), "application/zip") });
  const dwg = path.join(dwgDir, `${p.slug}.dwg`);
  if (quer("dwg") && fs.existsSync(dwg)) linhas.push({ formato: "dwg", path: `${base}.dwg`, tamanho_bytes: await enviar(`${base}.dwg`, fs.readFileSync(dwg), "application/acad") });
  const skp = path.join(dir, "skp", `${p.slug}.skp`);
  if (quer("skp") && fs.existsSync(skp)) linhas.push({ formato: "skp", path: `${base}.skp`, tamanho_bytes: await enviar(`${base}.skp`, fs.readFileSync(skp), "application/octet-stream") });

  if (linhas.length) {
    const { error: e } = await sb.from("arquivos_download").upsert(linhas.map((l) => ({ produto_id: p.id, ...l })), { onConflict: "produto_id,formato" });
    if (e) throw new Error(`${p.slug}: ${e.message}`);
  }
  const faltando = pedidos.filter((f) => !linhas.some((l) => l.formato === f));
  if (!faltando.length) ok++;
  console.log(`${faltando.length ? "INCOMPLETO" : "ok"} ${p.slug}  ${linhas.map((l) => `${l.formato} ${(l.tamanho_bytes / 1024).toFixed(0)}KB`).join("  ")}${faltando.length ? "  faltando: " + faltando.join(",") : ""}`);
}
console.log(`\nCompletos: ${ok} de ${produtos.length}`);
