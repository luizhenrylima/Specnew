import Link from "next/link";
import { criarClientePublico } from "@/lib/supabase/server";
import { supabaseConfigurado } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

async function statusSupabase() {
  if (!supabaseConfigurado()) {
    return { ok: false, msg: "Variáveis do Supabase não configuradas." };
  }
  const supabase = criarClientePublico();
  const { count, error } = await supabase
    .from("marcas")
    .select("*", { count: "exact", head: true });
  if (error) return { ok: false, msg: `Erro ao consultar o banco: ${error.message}` };
  return { ok: true, msg: `Conectado. ${count ?? 0} marca(s) cadastrada(s).` };
}

export default async function Home() {
  const status = await statusSupabase();

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4">
      <h1 className="text-3xl font-semibold tracking-tight">Specifica</h1>
      <p className="text-neutral-500">
        Visualizador 3D e downloads técnicos para arquitetos.
      </p>
      <Link
        href="/m"
        className="self-start rounded-lg bg-neutral-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-neutral-700"
      >
        Ver marcas →
      </Link>
      <div
        className={`rounded-lg border px-4 py-3 text-sm ${
          status.ok
            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
            : "border-amber-300 bg-amber-50 text-amber-800"
        }`}
      >
        <strong>Supabase:</strong> {status.msg}
      </div>
    </main>
  );
}
