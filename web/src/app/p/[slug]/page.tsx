import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { criarClientePublico } from "@/lib/supabase/server";
import { urlPublica } from "@/lib/supabase/env";
import Visualizador3D from "@/components/Visualizador3D";

export const dynamic = "force-dynamic";

type Aplicacao = { tipo: string; onde: string | null; opcoes: string[] };
type Especificacoes = { revestimentos?: string[]; aplicacoes?: Aplicacao[]; observacoes?: string[] };

async function buscar(slug: string) {
  const supabase = criarClientePublico();
  const { data } = await supabase
    .from("produtos")
    .select(
      "nome, linha, variante, referencia, categoria, descricao, largura_mm, profundidade_mm, altura_mm, glb_path, especificacoes, marcas(nome, slug), produto_medidas(rotulo, ordem), arquivos_download(formato, path, tamanho_bytes)"
    )
    .eq("slug", slug)
    .maybeSingle();
  return data;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await buscar((await params).slug);
  if (!p) return { title: "Produto não encontrado · Specifica" };
  const marca = p.marcas as unknown as { nome: string } | null;
  return { title: `${p.nome} · ${marca?.nome ?? ""} · Specifica`, description: p.descricao ?? undefined };
}

// Ordem e textos dos downloads. Formatos ainda não gerados aparecem como "Em breve".
const FORMATOS = [
  { formato: "dwg", titulo: "DWG", uso: "AutoCAD", extensao: ".dwg" },
  { formato: "dxf", titulo: "DXF 3D", uso: "AutoCAD, Revit, ArchiCAD · em milímetros", extensao: ".dxf" },
  { formato: "obj", titulo: "OBJ com texturas", uso: "Lumion, SketchUp, 3ds Max, Revit · em metros", extensao: ".zip" },
  { formato: "fbx", titulo: "FBX", uso: "Lumion, 3ds Max, Twinmotion, D5", extensao: ".fbx" },
  { formato: "dae", titulo: "DAE (Collada)", uso: "Lumion, SketchUp", extensao: ".zip" },
  { formato: "3ds", titulo: "3DS", uso: "3ds Max, Lumion", extensao: ".zip" },
  { formato: "glb", titulo: "GLB", uso: "Visualizadores web, Blender, realidade aumentada", extensao: ".glb" },
];

const tamanho = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

const cm = (mm: number | null) => (mm == null ? "—" : (mm / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 }));

// Link público do produto: é este endereço que as lojas colam nos catálogos.
export default async function PaginaProduto({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await buscar(slug);
  if (!p) notFound();

  const marca = p.marcas as unknown as { nome: string; slug: string } | null;
  const esp = (p.especificacoes ?? {}) as Especificacoes;
  const medidas = [...((p.produto_medidas as { rotulo: string; ordem: number }[]) ?? [])].sort((a, b) => a.ordem - b.ordem);
  const glb = urlPublica(p.glb_path);
  const downloads = (p.arquivos_download as { formato: string; path: string; tamanho_bytes: number | null }[]) ?? [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:py-10">
      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <section className="aspect-[4/3] w-full lg:aspect-auto lg:min-h-[560px]">
          {glb ? (
            <Visualizador3D
              url={glb}
              medidasMm={{ largura: p.largura_mm, profundidade: p.profundidade_mm, altura: p.altura_mm }}
            />
          ) : (
            <div className="grid h-full place-items-center rounded-xl bg-neutral-100 text-neutral-400">Modelo 3D em breve</div>
          )}
        </section>

        <section className="flex flex-col gap-6">
          <header>
            <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">{marca?.nome}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{p.nome}</h1>
            {p.referencia && <p className="mt-1 text-sm text-neutral-500">Ref. {p.referencia}</p>}
          </header>

          {p.descricao && <p className="leading-relaxed text-neutral-700">{p.descricao}</p>}

          <div className="rounded-lg border border-neutral-200 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Medidas do modelo 3D</h2>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[["Largura", p.largura_mm], ["Profundidade", p.profundidade_mm], ["Altura", p.altura_mm]].map(([r, v]) => (
                <div key={r as string}>
                  <dt className="text-[11px] text-neutral-500">{r}</dt>
                  <dd className="text-lg font-medium">{cm(v as number | null)} <span className="text-xs text-neutral-500">cm</span></dd>
                </div>
              ))}
            </dl>
            {medidas.length > 0 && (
              <>
                <h3 className="mt-4 text-[11px] font-medium text-neutral-500">Medidas disponíveis (L × P × A, cm)</h3>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {medidas.map((m) => (
                    <li key={m.rotulo} className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs">{m.rotulo.toLowerCase()}</li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-neutral-400">Outras medidas sob consulta à fábrica.</p>
              </>
            )}
          </div>

          {(esp.revestimentos?.length || esp.aplicacoes?.length) && (
            <div className="rounded-lg border border-neutral-200 p-4 text-sm">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Acabamentos</h2>
              {!!esp.revestimentos?.length && (
                <ul className="mt-3 space-y-1">
                  {esp.revestimentos.map((r) => <li key={r}>{r}</li>)}
                </ul>
              )}
              {!!esp.aplicacoes?.length && (
                <div className="mt-4 space-y-3">
                  {esp.aplicacoes.map((a) => (
                    <div key={a.tipo + a.onde}>
                      <p className="font-medium">{a.tipo}{a.onde && <span className="font-normal text-neutral-500"> · {a.onde}</span>}</p>
                      <p className="text-neutral-600">{a.opcoes.join(" · ")}</p>
                    </div>
                  ))}
                </div>
              )}
              {!!esp.observacoes?.length && (
                <p className="mt-4 text-xs text-neutral-500">{esp.observacoes.join(" · ")}</p>
              )}
            </div>
          )}

          <div className="rounded-lg border border-neutral-200 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Downloads</h2>
            <ul className="mt-3 divide-y divide-neutral-100">
              {FORMATOS.map((f) => {
                const arq = f.formato === "glb"
                  ? (p.glb_path ? { path: p.glb_path, tamanho_bytes: null } : null)
                  : downloads.find((d) => d.formato === f.formato);
                const url = arq ? urlPublica(arq.path) : null;
                return (
                  <li key={f.formato} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{f.titulo}</p>
                      <p className="text-xs text-neutral-500">{f.uso}</p>
                    </div>
                    {url ? (
                      <a
                        href={`${url}?download=${encodeURIComponent(slug + f.extensao)}`}
                        className="shrink-0 rounded-md bg-neutral-900 px-3 py-2 text-xs font-medium text-white hover:bg-neutral-700"
                      >
                        Baixar{arq?.tamanho_bytes ? ` · ${tamanho(arq.tamanho_bytes)}` : ""}
                      </a>
                    ) : (
                      <span className="shrink-0 rounded-md border border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-400">Em breve</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
