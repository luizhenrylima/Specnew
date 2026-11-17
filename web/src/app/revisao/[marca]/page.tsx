import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { criarClientePublico } from "@/lib/supabase/server";
import { urlPublica } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Revisão de acabamentos · Specifica", robots: { index: false, follow: false } };

type Familia = { familia: string; rotulo: string; colecoes: string[]; brilho: string | null; ordem: number };
type Acabamento = { id: string; nome: string; colecao: string; cor_hex: string | null; textura_miniatura_path: string | null; tamanho_real_cm: number | null; tamanho_real_altura_cm: number | null; ordem: number };
type Parte = { rotulo: string; familias: string[]; ordem: number };

// Página de conferência (fora do menu, sem indexação): mostra, por produto, que acabamentos o arquiteto vai poder escolher.
export default async function Revisao({ params }: { params: Promise<{ marca: string }> }) {
  const { marca: slugMarca } = await params;
  const sb = criarClientePublico();
  const { data: marca } = await sb.from("marcas").select("id, nome").eq("slug", slugMarca).maybeSingle();
  if (!marca) notFound();

  const [{ data: fams }, { data: acabs }, { data: produtos }] = await Promise.all([
    sb.from("marca_familias").select("familia, rotulo, colecoes, brilho, ordem").eq("marca_id", marca.id).order("ordem"),
    sb.from("acabamentos").select("id, nome, colecao, cor_hex, textura_miniatura_path, tamanho_real_cm, tamanho_real_altura_cm, ordem").eq("ativo", true).order("ordem"),
    sb.from("produtos").select("slug, nome, categoria, notas_acabamento, produto_partes(rotulo, familias, ordem)").eq("marca_id", marca.id).order("nome"),
  ]);
  const familias = (fams ?? []) as Familia[];
  const porColecao = new Map<string, Acabamento[]>();
  for (const a of (acabs ?? []) as Acabamento[]) porColecao.set(a.colecao, [...(porColecao.get(a.colecao) ?? []), a]);
  const rotuloFamilia = new Map(familias.map((f) => [f.familia, f]));
  const usadas = new Set(familias.flatMap((f) => f.colecoes));
  const foraDaMarca = [...porColecao.keys()].filter((c) => !usadas.has(c));
  const total = (f: Familia) => f.colecoes.reduce((n, c) => n + (porColecao.get(c)?.length ?? 0), 0);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">Revisão · não publicado</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Acabamentos {marca.nome}</h1>
      <p className="mt-2 max-w-3xl text-sm text-neutral-600">
        Cada parte de produto aceita algumas famílias de acabamento, conforme a tabela da marca. Cada família mostra as coleções
        abaixo. Confira as duas listas e aponte o que estiver errado.
      </p>
      {foraDaMarca.length > 0 && (
        <p className="mt-3 text-sm text-neutral-600">
          Coleções que <strong>não aparecem</strong> para a {marca.nome}: {foraDaMarca.join(", ")}.
        </p>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">1. Famílias e o que cada uma mostra</h2>
        <div className="mt-4 space-y-6">
          {familias.map((f) => (
            <div key={f.familia} className="rounded-lg border border-neutral-200 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-medium">{f.rotulo}</h3>
                <p className="text-xs text-neutral-500">
                  {f.colecoes.length ? `${f.colecoes.join(" + ")} · ${total(f)} opções` : "Sob consulta (sem amostras na biblioteca)"}
                  {f.brilho ? ` · acabamento ${f.brilho}` : ""}
                </p>
              </div>
              {f.colecoes.map((c) => (
                <div key={c} className="mt-3">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">{c}</p>
                  <ul className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-10">
                    {(porColecao.get(c) ?? []).map((a) => (
                      <li key={a.id} className="text-center">
                        <div
                          className="aspect-square w-full rounded-md border border-neutral-200 bg-cover bg-center"
                          style={{
                            backgroundColor: a.cor_hex ?? "#ddd",
                            backgroundImage: a.textura_miniatura_path ? `url(${urlPublica(a.textura_miniatura_path)})` : undefined,
                          }}
                          title={a.tamanho_real_cm ? `Uma repetição da imagem = ${a.tamanho_real_cm} × ${a.tamanho_real_altura_cm} cm` : undefined}
                        />
                        <p className="mt-1 text-[11px] leading-tight text-neutral-700">{a.nome}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">2. Produtos: partes e famílias permitidas</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-neutral-200 text-xs uppercase tracking-wider text-neutral-500">
              <tr><th className="py-2 pr-4">Produto</th><th className="py-2 pr-4">Parte</th><th className="py-2">Pode receber</th></tr>
            </thead>
            <tbody>
              {(produtos ?? []).map((p) => {
                const partes = [...((p.produto_partes ?? []) as Parte[])].sort((a, b) => a.ordem - b.ordem);
                const notas = (p.notas_acabamento ?? []).filter((n: string) => !/^Inox tonalizado citado/.test(n));
                return partes.map((pt, i) => (
                  <tr key={p.slug + pt.rotulo} className={i === 0 ? "border-t border-neutral-200" : ""}>
                    {i === 0 && (
                      <td rowSpan={partes.length} className="py-2 pr-4 align-top">
                        <a href={`/p/${p.slug}`} className="font-medium hover:underline">{p.nome}</a>
                        {notas.length > 0 && <p className="mt-1 max-w-xs text-xs text-neutral-500">{notas.join(" · ")}</p>}
                      </td>
                    )}
                    <td className="py-2 pr-4 align-top text-neutral-700">{pt.rotulo}</td>
                    <td className="py-2 align-top">
                      <div className="flex flex-wrap gap-1.5">
                        {pt.familias.map((f) => {
                          const fam = rotuloFamilia.get(f);
                          const sem = fam && !fam.colecoes.length;
                          return (
                            <span key={f} className={`rounded-full px-2.5 py-1 text-xs ${sem ? "border border-dashed border-neutral-300 text-neutral-500" : "bg-neutral-100"}`}>
                              {fam?.rotulo ?? f}{fam && !sem ? ` · ${total(fam)}` : sem ? " · sob consulta" : ""}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
