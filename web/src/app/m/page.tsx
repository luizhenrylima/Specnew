import Link from "next/link";
import type { Metadata } from "next";
import { criarClientePublico } from "@/lib/supabase/server";
import { urlPublica } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Marcas · Specifica" };

// Menu de marcas: lista as marcas ativas com a quantidade de produtos de cada uma.
export default async function PaginaMarcas() {
  const supabase = criarClientePublico();
  const { data: marcas } = await supabase
    .from("marcas")
    .select("nome, slug, logo_path, produtos(count)")
    .order("nome");

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/" className="text-sm text-neutral-500 hover:underline">
        ← Início
      </Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">Marcas</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Escolha uma marca para ver os produtos com visualizador 3D.
      </p>

      {marcas && marcas.length > 0 ? (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {marcas.map((m) => {
            const logo = urlPublica(m.logo_path);
            const total = (m.produtos as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
            return (
              <li key={m.slug}>
                <Link
                  href={`/m/${m.slug}`}
                  className="flex items-center gap-4 rounded-xl border border-neutral-200 p-4 transition hover:border-neutral-400 hover:shadow-sm"
                >
                  {logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logo} alt="" className="h-12 w-12 rounded-full object-contain" />
                  ) : (
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-900 text-lg font-semibold text-white">
                      {m.nome.charAt(0)}
                    </span>
                  )}
                  <span>
                    <span className="block font-medium">{m.nome}</span>
                    <span className="block text-xs text-neutral-500">{total} produtos</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-8 text-neutral-500">Nenhuma marca cadastrada ainda.</p>
      )}
    </main>
  );
}
