import { notFound } from "next/navigation";
import { criarClientePublico } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Link público do produto: é este endereço que as lojas colam nos catálogos.
// O visualizador 3D entra aqui na próxima etapa.
export default async function PaginaProduto({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = criarClientePublico();

  const { data: produto } = await supabase
    .from("produtos")
    .select(
      "nome, referencia, descricao, largura_mm, profundidade_mm, altura_mm, marcas(nome), arquivos_download(formato)"
    )
    .eq("slug", slug)
    .maybeSingle();

  if (!produto) notFound();

  const marca = produto.marcas as unknown as { nome: string } | null;
  const medidas = [produto.largura_mm, produto.profundidade_mm, produto.altura_mm];

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-sm text-neutral-500">{marca?.nome}</p>
      <h1 className="text-2xl font-semibold">{produto.nome}</h1>
      {produto.referencia && (
        <p className="text-sm text-neutral-500">Ref. {produto.referencia}</p>
      )}

      <div className="mt-6 flex aspect-video items-center justify-center rounded-lg bg-neutral-100 text-neutral-400">
        Visualizador 3D (em construção)
      </div>

      {medidas.every(Boolean) && (
        <p className="mt-4 text-sm">
          L {medidas[0]} × P {medidas[1]} × A {medidas[2]} mm
        </p>
      )}
      {produto.descricao && <p className="mt-4 leading-relaxed">{produto.descricao}</p>}
    </main>
  );
}
