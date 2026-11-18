// Gera os arquivos de download de cada produto a partir do GLB publicado e envia para o Storage.
// Formatos gerados só com código (sem programas externos):
//   OBJ (.zip com .obj + .mtl + texturas, em metros, Y para cima — Lumion, SketchUp, 3ds Max, Revit)
//   DXF (faces 3D em milímetros, Z para cima, uma camada por material — AutoCAD e similares)
//
// Uso (dentro de web/):  node scripts/gerar-downloads.mjs <slug-da-marca> [slug-do-produto]
import fs from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { zipSync } from "fflate";
import { createClient } from "@supabase/supabase-js";
import { extrair } from "./geometria.mjs";

const [slugMarca, soProduto] = process.argv.slice(2);
if (!slugMarca) { console.error("uso: node scripts/gerar-downloads.mjs <marca> [produto]"); process.exit(1); }

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const io = new NodeIO();


// ---------- OBJ ----------
function gerarObj(g, nome) {
  const f = (v) => +v.toFixed(5);
  let obj = `# ${nome}\n# Gerado pela Specifica - unidades em metros, Y para cima\nmtllib ${nome}.mtl\no ${nome}\n`;
  let base = 1;
  for (const m of g.malhas) {
    for (const p of m.P) obj += `v ${f(p[0])} ${f(p[1])} ${f(p[2])}\n`;
    for (const t of m.T) obj += `vt ${f(t[0])} ${f(1 - t[1])}\n`;
    for (const n of m.N) obj += `vn ${f(n[0])} ${f(n[1])} ${f(n[2])}\n`;
    obj += `usemtl ${m.mat >= 0 ? g.materiais[m.mat].nome : "padrao"}\n`;
    const temT = m.T.length > 0, temN = m.N.length > 0;
    const ref = (i) => { const k = base + i; return temT && temN ? `${k}/${k}/${k}` : temT ? `${k}/${k}` : temN ? `${k}//${k}` : `${k}`; };
    for (let i = 0; i < m.I.length; i += 3) obj += `f ${ref(m.I[i])} ${ref(m.I[i + 1])} ${ref(m.I[i + 2])}\n`;
    base += m.P.length;
  }
  let mtl = "# Materiais gerados pela Specifica\n";
  for (const m of g.materiais) {
    const [r, gg, b, a] = m.cor;
    mtl += `\nnewmtl ${m.nome}\nKa 0 0 0\nKd ${r.toFixed(4)} ${gg.toFixed(4)} ${b.toFixed(4)}\nKs 0.05 0.05 0.05\nNs 20\nd ${a.toFixed(3)}\nillum 2\n`;
    if (m.textura) mtl += `map_Kd ${m.textura}\n`;
  }
  mtl += "\nnewmtl padrao\nKd 0.8 0.8 0.8\n";
  return { obj, mtl };
}

// ---------- DXF ----------
// Cor ACI aproximada a partir do RGB, para as camadas não ficarem todas iguais no CAD.
function aci([r, g, b]) {
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  if (Math.max(r, g, b) - Math.min(r, g, b) < 0.08) return lum > 0.85 ? 7 : lum > 0.6 ? 9 : lum > 0.35 ? 8 : 250;
  const h = (Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * 180) / Math.PI;
  const hue = (h + 360) % 360;
  return [1, 30, 40, 50, 3, 130, 4, 150, 5, 190, 6, 230][Math.round(hue / 30) % 12];
}
function gerarDxf(g) {
  const L = [];
  const add = (c, v) => L.push(String(c), String(v));
  const mm = (v) => (v * 1000).toFixed(2);
  add(0, "SECTION"); add(2, "HEADER");
  add(9, "$ACADVER"); add(1, "AC1009");
  add(9, "$INSUNITS"); add(70, 4);
  add(0, "ENDSEC");
  add(0, "SECTION"); add(2, "TABLES");
  add(0, "TABLE"); add(2, "LAYER"); add(70, g.materiais.length + 1);
  const camadas = g.materiais.map((m) => ({ nome: m.nome.toUpperCase(), cor: aci(m.cor) }));
  for (const c of [...camadas, { nome: "PADRAO", cor: 7 }]) { add(0, "LAYER"); add(2, c.nome); add(70, 0); add(62, c.cor); add(6, "CONTINUOUS"); }
  add(0, "ENDTAB"); add(0, "ENDSEC");
  add(0, "SECTION"); add(2, "ENTITIES");
  for (const m of g.malhas) {
    const camada = m.mat >= 0 ? camadas[m.mat].nome : "PADRAO";
    for (let i = 0; i < m.I.length; i += 3) {
      // glTF (Y para cima) -> CAD (Z para cima)
      const v = [m.I[i], m.I[i + 1], m.I[i + 2], m.I[i + 2]].map((k) => { const [x, y, z] = m.P[k]; return [x, -z, y]; });
      add(0, "3DFACE"); add(8, camada);
      v.forEach(([x, y, z], j) => { add(10 + j, mm(x)); add(20 + j, mm(y)); add(30 + j, mm(z)); });
    }
  }
  add(0, "ENDSEC"); add(0, "EOF");
  return L.join("\n") + "\n";
}

// ---------- execução ----------
const { data: marca } = await sb.from("marcas").select("id").eq("slug", slugMarca).single();
let q = sb.from("produtos").select("id, slug, glb_path").eq("marca_id", marca.id).not("glb_path", "is", null);
if (soProduto) q = q.eq("slug", soProduto);
const { data: produtos, error } = await q;
if (error) throw error;

const enviar = async (caminho, dados, tipo) => {
  const { error: e } = await sb.storage.from("publico").upload(caminho, dados, { contentType: tipo, upsert: true });
  if (e) throw new Error(`${caminho}: ${e.message}`);
};

for (const p of produtos) {
  const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/publico/${p.glb_path}`;
  const glb = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const g = extrair(await io.readBinary(glb));
  const base = `${slugMarca}/downloads/${p.slug}`;

  const { obj, mtl } = gerarObj(g, p.slug);
  const zip = zipSync({
    [`${p.slug}.obj`]: new TextEncoder().encode(obj),
    [`${p.slug}.mtl`]: new TextEncoder().encode(mtl),
    ...Object.fromEntries(g.imagens.map(([n, img]) => [n, img])),
  }, { level: 6 });
  const dxf = new TextEncoder().encode(gerarDxf(g));

  await enviar(`${base}.obj.zip`, zip, "application/zip");
  await enviar(`${base}.dxf`, dxf, "application/dxf");

  const linhas = [
    { produto_id: p.id, formato: "obj", path: `${base}.obj.zip`, tamanho_bytes: zip.length },
    { produto_id: p.id, formato: "dxf", path: `${base}.dxf`, tamanho_bytes: dxf.length },
  ];
  const { error: e2 } = await sb.from("arquivos_download").upsert(linhas, { onConflict: "produto_id,formato" });
  if (e2) throw new Error(`${p.slug}: ${e2.message}`);
  const tri = g.malhas.reduce((s, m) => s + m.I.length / 3, 0);
  console.log(`ok ${p.slug}  ${tri} tri  obj.zip ${(zip.length / 1024).toFixed(0)} KB  dxf ${(dxf.length / 1024).toFixed(0)} KB`);
}
console.log(`\nProdutos processados: ${produtos.length}`);
