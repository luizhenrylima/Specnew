import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { criarClientePublico } from "@/lib/supabase/server";
import { urlPublica } from "@/lib/supabase/env";
import Visualizador3D from "@/components/Visualizador3D";
import { type AcabamentoLib, type FamiliaMarca, type ParteProduto } from "@/components/AcabamentosProduto";
import { Configurador } from "@/components/Configurador";
import PainelOpcoes, { type Especificacoes } from "@/components/PainelOpcoes";
import Downloads, { type ArquivoDownload } from "@/components/Downloads";
import { Logo } from "@/components/Logo";

export const dynamic = "force-dynamic";

async function buscar(slug: string) {
  const supabase = criarClientePublico();
  const { data } = await supabase
    .from("produtos")
    .select(
      "nome, linha, variante, referencia, categoria, descricao, largura_mm, profundidade_mm, altura_mm, glb_path, especificacoes, notas_acabamento, marca_id, marcas(nome, slug), produto_medidas(rotulo, ordem), arquivos_download(formato, path, tamanho_bytes), produto_partes(rotulo, familias, materiais, ordem)"
    )
    .eq("slug", slug)
    .maybeSingle();
  return data;
}

// Regra da marca (família -> coleções) e os acabamentos das coleções usadas pelas partes deste produto.
async function buscarAcabamentos(marcaId: string, partes: ParteProduto[]) {
  const familiasUsadas = [...new Set(partes.flatMap((p) => p.familias))];
  if (!familiasUsadas.length) return { familias: [], acabamentos: [] };
  const supabase = criarClientePublico();
  const { data: familias } = await supabase
    .from("marca_familias").select("familia, rotulo, colecoes, brilho, ordem").eq("marca_id", marcaId).in("familia", familiasUsadas);
  const colecoes = [...new Set((familias ?? []).flatMap((f) => f.colecoes as string[]))];
  const { data: acabamentos } = colecoes.length
    ? await supabase.from("acabamentos")
        .select("id, nome, colecao, cor_hex, textura_cor_path, textura_miniatura_path, tamanho_real_cm, tamanho_real_altura_cm, rugosidade, metalico")
        .eq("ativo", true).in("colecao", colecoes).order("ordem")
    : { data: [] };
  return { familias: (familias ?? []) as FamiliaMarca[], acabamentos: (acabamentos ?? []) as AcabamentoLib[] };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await buscar((await params).slug);
  if (!p) return { title: "Produto não encontrado · Specifica" };
  const marca = p.marcas as unknown as { nome: string } | null;
  return { title: `${p.nome} · ${marca?.nome ?? ""} · Specifica`, description: p.descricao ?? undefined };
}

// Ordem e textos dos downloads. Formatos ainda não gerados aparecem como "Em breve".
const FORMATOS = [
  { formato: "dwg", titulo: "DWG", uso: "AutoCAD · planta e vistas 2D em centímetros", extensao: ".dwg", grupo: "cad" },
  { formato: "dxf", titulo: "DXF 3D", uso: "AutoCAD, Revit, ArchiCAD · em milímetros", extensao: ".dxf", grupo: "cad" },
  { formato: "skp", titulo: "SKP", uso: "SketchUp 2017 ou mais recente · em centímetros", extensao: ".skp", grupo: "3d" },
  { formato: "obj", titulo: "OBJ com texturas", uso: "Lumion, SketchUp, 3ds Max, Revit · em metros", extensao: "-obj.zip", grupo: "3d" },
  { formato: "fbx", titulo: "FBX", uso: "Lumion, 3ds Max, Twinmotion, D5", extensao: ".fbx", grupo: "3d" },
  { formato: "dae", titulo: "DAE (Collada)", uso: "Lumion, SketchUp", extensao: "-dae.zip", grupo: "3d" },
  { formato: "3ds", titulo: "3DS", uso: "3ds Max, Lumion", extensao: "-3ds.zip", grupo: "3d" },
  { formato: "glb", titulo: "GLB", uso: "Visualizadores web, Blender, realidade aumentada", extensao: ".glb", grupo: "3d" },
] as const;

const tamanho = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

const cm = (mm: number | null) => (mm == null ? "—" : (mm / 10).toLocaleString("pt-BR", { maximumFractionDigits: 1 }));

// Link público do produto: é este endereço que as lojas colam nos catálogos.
// Layout de configurador: produto em destaque à esquerda, opções em seções que abrem à direita, downloads no rodapé.
export default async function PaginaProduto({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await buscar(slug);
  if (!p) notFound();

  const marca = p.marcas as unknown as { nome: string; slug: string } | null;
  const medidas = [...((p.produto_medidas as { rotulo: string; ordem: number }[]) ?? [])].sort((a, b) => a.ordem - b.ordem);
  const glb = urlPublica(p.glb_path);
  const gerados = (p.arquivos_download as { formato: string; path: string; tamanho_bytes: number | null }[]) ?? [];
  const partes = (p.produto_partes as ParteProduto[]) ?? [];
  const dados = await buscarAcabamentos(p.marca_id, partes);

  const arquivos: ArquivoDownload[] = FORMATOS.map((f) => {
    const arq = f.formato === "glb"
      ? (p.glb_path ? { path: p.glb_path, tamanho_bytes: null } : null)
      : gerados.find((d) => d.formato === f.formato);
    const url = arq ? urlPublica(arq.path) : null;
    return {
      formato: f.formato, titulo: f.titulo, uso: f.uso, grupo: f.grupo,
      url: url ? `${url}?download=${encodeURIComponent(slug + f.extensao)}` : null,
      tamanho: arq?.tamanho_bytes ? tamanho(arq.tamanho_bytes) : null,
    };
  });

  return (
    <Configurador partes={partes.map((x) => ({ rotulo: x.rotulo, materiais: x.materiais ?? [] }))}>
      <div className="min-h-screen bg-white pb-[72px]">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-nevoa bg-white/95 px-4 backdrop-blur lg:px-8">
          {/* Sem links: a página do produto é embutida nos catálogos e o arquiteto fica só neste produto. */}
          <span className="text-grafite">
            <Logo className="h-9" />
          </span>
          {marca && <span className="text-xs uppercase tracking-[0.2em] text-pedra">{marca.nome}</span>}
        </header>

        <div className="lg:grid lg:h-[calc(100vh-64px-72px)] lg:grid-cols-[minmax(0,1fr)_460px]">
          {/* Palco do 3D: preso no topo no celular, ocupa a altura toda no computador. */}
          <section className="sticky top-16 z-10 h-[46vh] min-h-[280px] bg-linho lg:static lg:h-full">
            {glb ? (
              <Visualizador3D
                url={glb}
                medidasMm={{ largura: p.largura_mm, profundidade: p.profundidade_mm, altura: p.altura_mm }}
              />
            ) : (
              <div className="grid h-full place-items-center text-sm text-pedra">Modelo 3D em breve</div>
            )}
          </section>

          <section className="px-5 pb-10 pt-8 lg:overflow-y-auto lg:border-l lg:border-nevoa lg:px-10 lg:pt-12">
            <p className="text-[11px] uppercase tracking-[0.25em] text-cobre">{[marca?.nome, p.categoria].filter(Boolean).join(" · ")}</p>
            <h1 className="mt-3 text-4xl font-extralight leading-tight tracking-tight text-tinta">{p.nome}</h1>
            {p.referencia && <p className="mt-2 text-xs tracking-wider text-pedra">Ref. {p.referencia}</p>}
            {p.descricao && <p className="mt-6 text-sm font-light leading-relaxed text-grafite">{p.descricao}</p>}

            <div className="mt-8 border-t border-nevoa">
              <PainelOpcoes
                medidasCm={{ largura: cm(p.largura_mm), profundidade: cm(p.profundidade_mm), altura: cm(p.altura_mm) }}
                medidasDisponiveis={medidas.map((m) => m.rotulo)}
                partes={partes}
                dados={dados}
                notas={(p.notas_acabamento as string[]) ?? []}
                especificacoes={(p.especificacoes ?? {}) as Especificacoes}
              />
            </div>
          </section>
        </div>

        <Downloads nome={p.nome} referencia={p.referencia} arquivos={arquivos} />
      </div>
    </Configurador>
  );
}
