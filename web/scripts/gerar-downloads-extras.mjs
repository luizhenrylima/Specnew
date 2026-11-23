// Gera FBX, DAE, 3DS (Blender), DWG (ODA File Converter) e SKP (SketchUp C SDK) de cada produto e envia para o Storage.
// O DWG é um desenho técnico 2D (vista frontal, lateral e planta, só linhas visíveis, em cm), feito por
// desenho-2d.mjs a partir do GLB e convertido de DXF para DWG pelo ODA.
// As ferramentas ficam em ../ferramentas (fora do Git). Os arquivos de trabalho ficam em ../amostras/<marca>/conversao.
//
// Uso (dentro de web/):  node scripts/gerar-downloads-extras.mjs <slug-da-marca> [slug-do-produto] [--formatos=fbx,dae,3ds,dwg,skp] [--lote=20] [--refazer]
// Retoma de onde parou: produtos que já têm todos os formatos pedidos no banco são pulados.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { createClient } from "@supabase/supabase-js";
import { NodeIO } from "@gltf-transform/core";
import { extrair } from "./geometria.mjs";
import { gerarDxf2d } from "./desenho-2d.mjs";

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
// ODA: variável ODA, ou ../ferramentas/oda, ou a versão instalada em Arquivos de Programas.
const odaInstalado = () => {
  const base = "C:/Program Files/ODA";
  if (!fs.existsSync(base)) return null;
  const pasta = fs.readdirSync(base).filter((d) => d.startsWith("ODAFileConverter")).sort().at(-1);
  return pasta ? path.join(base, pasta, "ODAFileConverter.exe") : null;
};
const odaLocal = path.join(raiz, "ferramentas", "oda", "ODAFileConverter.exe");
const ODA = process.env.ODA ?? (fs.existsSync(odaLocal) ? odaLocal : odaInstalado() ?? odaLocal);
const SKP_SDK = process.env.SKETCHUP_SDK ?? path.join(raiz, "ferramentas", "sketchup-sdk");
const trabalho = path.join(raiz, "amostras", slugMarca, "conversao");
// trava: só uma geração por marca de cada vez (duas rodadas juntas disputam os mesmos arquivos de trabalho)
const trava = path.join(trabalho, "_gerando.lock");
const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
if (fs.existsSync(trava) && vivo(Number(fs.readFileSync(trava, "utf8")))) {
  console.error(`Já existe uma geração rodando para ${slugMarca} (processo ${fs.readFileSync(trava, "utf8")}).`);
  process.exit(1);
}
fs.mkdirSync(trabalho, { recursive: true });
fs.writeFileSync(trava, String(process.pid));
process.on("exit", () => { try { if (fs.readFileSync(trava, "utf8") === String(process.pid)) fs.rmSync(trava); } catch {} });
const usaBlender = ["fbx", "dae", "3ds", "skp"].some(quer);
const precisa = [...(usaBlender ? [BLENDER] : []), ...(quer("dwg") ? [ODA] : []), ...(quer("skp") ? [PYTHON, path.join(SKP_SDK, "SketchUpAPI.dll")] : [])];
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
// cada chamada tem prazo: um modelo problemático não pode travar a fila inteira
const rodar = (exe, args, rotulo, prazoMin = 30) => {
  const r = spawnSync(exe, args, { encoding: "utf8", maxBuffer: 1 << 28, timeout: prazoMin * 60000 });
  const saida = r.stdout || "";
  if (r.error?.code === "ETIMEDOUT") console.log(`  ${rotulo}: passou de ${prazoMin} min, interrompido`);
  const erros = saida.split("\n").filter((l) => l.startsWith("ERRO"));
  console.log(`${rotulo}: ${(saida.match(/^OK /gm) || []).length} ok, ${erros.length} com erro`);
  erros.forEach((e) => console.log("  " + e));
  return saida;
};

// 1) produtos que ainda não têm todos os formatos pedidos (retoma de onde parou; --refazer gera tudo de novo)
const LOTE = Number(flags.find((f) => f.startsWith("--lote="))?.split("=")[1] ?? 20);
const refazer = flags.includes("--refazer");
async function tentar(fn, rotulo) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= 4) throw new Error(`${rotulo}: ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 2000 * (i + 1)));
    }
  }
}
const { data: marca } = await sb.from("marcas").select("id").eq("slug", slugMarca).single();
let q = sb.from("produtos").select("id, slug, glb_path").eq("marca_id", marca.id).not("glb_path", "is", null).order("slug");
if (soProduto) q = q.eq("slug", soProduto);
const { data: todos, error } = await q;
if (error) throw error;
const feitos = new Map();
for (let i = 0; i < todos.length; i += 100) {
  const { data } = await sb.from("arquivos_download").select("produto_id, formato").in("produto_id", todos.slice(i, i + 100).map((p) => p.id));
  for (const d of data ?? []) feitos.set(d.produto_id, [...(feitos.get(d.produto_id) ?? []), d.formato]);
}
const produtos = refazer ? todos : todos.filter((p) => pedidos.some((f) => !(feitos.get(p.id) ?? []).includes(f)));
console.log(`Produtos: ${todos.length} · já completos: ${todos.length - produtos.length} · a gerar: ${produtos.length} · lotes de ${LOTE} · formatos: ${pedidos.join(", ")}`);

const zipPasta = (dir) => zipSync(Object.fromEntries(fs.readdirSync(dir).map((f) => [f, new Uint8Array(fs.readFileSync(path.join(dir, f)))])), { level: 6 });
const enviar = async (caminho, dados, tipo) => tentar(async () => {
  const { error: e } = await sb.storage.from("publico").upload(caminho, dados, { contentType: tipo, upsert: true });
  if (e) throw new Error(e.message);
  return dados.length;
}, caminho);

let ok = 0;
for (let ini = 0; ini < produtos.length; ini += LOTE) {
  const lote = produtos.slice(ini, ini + LOTE);
  console.log(`\n=== Lote ${ini / LOTE + 1} de ${Math.ceil(produtos.length / LOTE)} (${lote.length} produtos)`);
  const dxfDir = path.join(trabalho, "_dxf"), dwgDir = path.join(trabalho, "_dwg");
  if (quer("dwg")) {
    fs.rmSync(dxfDir, { recursive: true, force: true }); fs.rmSync(dwgDir, { recursive: true, force: true });
    fs.mkdirSync(dxfDir, { recursive: true }); fs.mkdirSync(dwgDir, { recursive: true });
  }
  // entradas do lote
  const linhasLista = [];
  for (const p of lote) {
    const dir = path.join(trabalho, p.slug);
    for (const f of pedidos) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
    fs.rmSync(path.join(dir, "_skp"), { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    await tentar(() => baixar(publico(p.glb_path), path.join(dir, "modelo.glb")), p.slug);
    if (quer("dwg")) {
      try {
        const g = extrair(await new NodeIO().readBinary(new Uint8Array(fs.readFileSync(path.join(dir, "modelo.glb")))));
        fs.writeFileSync(path.join(dxfDir, `${p.slug}.dxf`), gerarDxf2d(g));
      } catch (e) {
        console.log(`  ERRO desenho 2D ${p.slug}: ${e.message}`);
      }
    }
    linhasLista.push([path.join(dir, "modelo.glb"), dir, p.slug].join("|"));
  }
  const lista = path.join(trabalho, "lista.txt");
  fs.writeFileSync(lista, linhasLista.join("\n"));

  // Blender: FBX, DAE, 3DS (um processo por lote)
  // um processo por produto, com prazo; se estourar, fica o que já foi gravado por inteiro (FBX/DAE) e some o 3DS pela metade
  if (quer("fbx") || quer("dae") || quer("3ds")) {
    for (const linha of linhasLista) {
      const [, dir, slug] = linha.split("|");
      const um = path.join(trabalho, "_um.txt");
      fs.writeFileSync(um, linha);
      const saida = rodar(BLENDER, ["-b", "-P", path.join(aqui, "blender-exportar.py"), "--", um], `Blender ${slug}`, 6);
      if (!new RegExp(`^OK ${slug}`, "m").test(saida)) {
        for (const f of ["fbx", "dae", "3ds"]) if (!new RegExp(`^FEITO ${f} ${slug}`, "m").test(saida)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
      }
    }
  }
  // ODA: DXF -> DWG (AutoCAD 2013)
  if (quer("dwg")) {
    const oda = spawnSync(ODA, [dxfDir, dwgDir, "ACAD2013", "DWG", "0", "1", "*.DXF"], { encoding: "utf8", timeout: 10 * 60000 });
    if (oda.status !== 0) console.log(`ODA saiu com ${oda.status}: ${oda.stderr}`);
  }
  // SKP em duas etapas (a DLL do SketchUp trava dentro do Blender)
  if (quer("skp")) {
    rodar(BLENDER, ["-b", "-P", path.join(aqui, "blender-skp.py"), "--", lista], "Blender extração SKP");
    rodar(PYTHON, ["-I", path.join(aqui, "skp-gerar.py"), lista, SKP_SDK], "SketchUp SKP");
  }

  // envia e registra o lote
  for (const p of lote) {
    const dir = path.join(trabalho, p.slug);
    const base = `${slugMarca}/downloads/${p.slug}`;
    const linhas = [];
    // arquivo solto acima de 45 MB vai compactado (.zip), pois o Storage recusa objetos grandes;
    // se ainda assim falhar, registra o erro e segue (o produto fica INCOMPLETO e é retomado depois)
    const subir = async (formato, caminho, dados, tipo, nomeNoZip) => {
      if (nomeNoZip && dados.length > 45 * 1024 * 1024) {
        dados = zipSync({ [nomeNoZip]: new Uint8Array(dados) }, { level: 6 });
        caminho += ".zip"; tipo = "application/zip";
      }
      try {
        linhas.push({ formato, path: caminho, tamanho_bytes: await enviar(caminho, dados, tipo) });
      } catch (e) {
        console.log(`  ERRO envio ${formato} ${p.slug}: ${e.message}`);
      }
    };
    const fbx = path.join(dir, "fbx", `${p.slug}.fbx`);
    if (quer("fbx") && fs.existsSync(fbx)) await subir("fbx", `${base}.fbx`, fs.readFileSync(fbx), "application/octet-stream", `${p.slug}.fbx`);
    if (quer("dae") && fs.existsSync(path.join(dir, "dae", `${p.slug}.dae`))) await subir("dae", `${base}.dae.zip`, zipPasta(path.join(dir, "dae")), "application/zip");
    if (quer("3ds") && fs.existsSync(path.join(dir, "3ds", `${p.slug}.3ds`))) await subir("3ds", `${base}.3ds.zip`, zipPasta(path.join(dir, "3ds")), "application/zip");
    const dwg = path.join(dwgDir, `${p.slug}.dwg`);
    if (quer("dwg") && fs.existsSync(dwg)) await subir("dwg", `${base}.dwg`, fs.readFileSync(dwg), "application/acad");
    const skp = path.join(dir, "skp", `${p.slug}.skp`);
    if (quer("skp") && fs.existsSync(skp)) await subir("skp", `${base}.skp`, fs.readFileSync(skp), "application/octet-stream", `${p.slug}.skp`);
    if (linhas.length) {
      await tentar(async () => {
        const { error: e } = await sb.from("arquivos_download").upsert(linhas.map((l) => ({ produto_id: p.id, ...l })), { onConflict: "produto_id,formato" });
        if (e) throw new Error(e.message);
      }, p.slug);
    }
    const faltando = pedidos.filter((f) => !linhas.some((l) => l.formato === f));
    if (!faltando.length) ok++;
    console.log(`${faltando.length ? "INCOMPLETO" : "ok"} ${p.slug}  ${linhas.map((l) => `${l.formato} ${(l.tamanho_bytes / 1024).toFixed(0)}KB`).join("  ")}${faltando.length ? "  faltando: " + faltando.join(",") : ""}`);
  }
  // libera espaço: os arquivos do lote já estão no Storage
  for (const p of lote) for (const f of [...pedidos, "_skp"]) fs.rmSync(path.join(trabalho, p.slug, f), { recursive: true, force: true });
}
console.log(`\nCompletos nesta rodada: ${ok} de ${produtos.length}`);
