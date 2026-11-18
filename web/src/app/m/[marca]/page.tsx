import { notFound } from "next/navigation";
import Link from "next/link";
import { criarClientePublico } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Lista de produtos de uma marca, com o link de cada um para colar nos catálogos.
export default async function PaginaMarca({ params }: { params: Promise<{ marca: string }> }) {
  const { marca: slugMarca } = await params;
  const supabase = criarClientePublico();
  const { data: marca } = await supabase.from("marcas").select("id, nome").eq("slug", slugMarca).maybeSingle();
  if (!marca) notFound();

  const { data: produtos } = await supabase
    .from("produtos")
    .select("nome, slug, referencia, categoria, largura_mm, profundidade_mm, altura_mm")
    .eq("marca_id", marca.id)
    .order("categoria")
    .order("nome");

  const porCategoria = new Map<string, NonNullable<typeof produtos>>();
  for (const p of produtos ?? []) {
    const c = p.categoria ?? "Outros";
    porCategoria.set(c, [...(porCategoria.get(c) ?? []), p]);
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/m" className="text-sm text-neutral-500 hover:underline">
        ← Marcas
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">{marca.nome}</h1>
      <p className="mt-1 text-sm text-neutral-500">{produtos?.length ?? 0} produtos com visualizador 3D</p>

      {[...porCategoria].map(([cat, itens]) => (
        <section key={cat} className="mt-8">
          <h2 className="border-b border-neutral-200 pb-2 text-sm font-semibold uppercase tracking-wider text-neutral-500">
            {cat} <span className="font-normal">({itens.length})</span>
          </h2>
          <ul className="mt-2 divide-y divide-neutral-100">
            {itens.map((p) => (
              <li key={p.slug} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <Link href={`/p/${p.slug}`} className="font-medium hover:underline">{p.nome}</Link>
                <span className="text-xs text-neutral-500">
                  {p.referencia && <>Ref. {p.referencia} · </>}
                  {[p.largura_mm, p.profundidade_mm, p.altura_mm].map((v) => (v ? Math.round(v / 10) : "—")).join(" × ")} cm
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
