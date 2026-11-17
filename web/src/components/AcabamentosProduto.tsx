import { urlPublica } from "@/lib/supabase/env";

export type FamiliaMarca = { familia: string; rotulo: string; colecoes: string[]; ordem: number };
export type AcabamentoLib = {
  id: string; nome: string; colecao: string; cor_hex: string | null;
  textura_miniatura_path: string | null; tamanho_real_cm: number | null; tamanho_real_altura_cm: number | null;
};
export type ParteProduto = { rotulo: string; familias: string[]; ordem: number };

// Notas da tabela que não interessam ao arquiteto (preço, cálculo) ou que já viraram regra.
const NOTA_INTERNA = /medidas intermediarias|calculo do par|inox tonalizado citado|nao faz/i;
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

function Amostra({ a, grande }: { a: AcabamentoLib; grande?: boolean }) {
  const titulo = `${a.nome} · ${a.colecao}`;
  return (
    <span
      title={titulo}
      className={`block shrink-0 rounded border border-black/10 bg-cover bg-center ${grande ? "aspect-square w-full" : "h-6 w-6"}`}
      style={{
        backgroundColor: a.cor_hex ?? "#ddd",
        backgroundImage: a.textura_miniatura_path ? `url(${urlPublica(a.textura_miniatura_path)})` : undefined,
      }}
    />
  );
}

// Acabamentos permitidos em cada parte do produto, conforme a regra da marca.
export default function AcabamentosProduto({
  partes, familias, acabamentos, notas,
}: { partes: ParteProduto[]; familias: FamiliaMarca[]; acabamentos: AcabamentoLib[]; notas: string[] }) {
  const fam = new Map(familias.map((f) => [f.familia, f]));
  const porColecao = new Map<string, AcabamentoLib[]>();
  for (const a of acabamentos) porColecao.set(a.colecao, [...(porColecao.get(a.colecao) ?? []), a]);
  const notasVisiveis = notas.filter((n) => !NOTA_INTERNA.test(semAcento(n)));

  return (
    <div className="rounded-lg border border-neutral-200 p-4 text-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Acabamentos</h2>
      <div className="mt-3 divide-y divide-neutral-100">
        {[...partes].sort((a, b) => a.ordem - b.ordem).map((p) => {
          const opcoes = p.familias
            .map((f) => fam.get(f))
            .filter((f): f is FamiliaMarca => !!f)
            .sort((a, b) => a.ordem - b.ordem);
          return (
            <div key={p.rotulo} className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">{p.rotulo}</p>
              <div className="mt-2 space-y-1.5">
                {opcoes.map((f) => {
                  const itens = f.colecoes.flatMap((c) => porColecao.get(c) ?? []);
                  if (!itens.length) {
                    return <p key={f.familia} className="text-neutral-600">{f.rotulo} <span className="text-xs text-neutral-400">· sob consulta</span></p>;
                  }
                  return (
                    <details key={f.familia} className="group">
                      <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                        <span className="min-w-0 flex-1 text-neutral-700">
                          {f.rotulo} <span className="text-xs text-neutral-400">· {itens.length}</span>
                        </span>
                        <span className="flex gap-1 group-open:hidden">
                          {itens.slice(0, 6).map((a) => <Amostra key={a.id} a={a} />)}
                        </span>
                        <span className="text-xs text-neutral-400 transition group-open:rotate-90" aria-hidden>›</span>
                      </summary>
                      {f.colecoes.map((c) => {
                        const lista = porColecao.get(c) ?? [];
                        if (!lista.length) return null;
                        return (
                          <div key={c} className="mt-2">
                            {f.colecoes.length > 1 && <p className="text-[11px] uppercase tracking-wider text-neutral-400">{c}</p>}
                            <ul className="mt-1.5 grid grid-cols-5 gap-2 sm:grid-cols-6">
                              {lista.map((a) => (
                                <li key={a.id} className="text-center">
                                  <Amostra a={a} grande />
                                  <p className="mt-1 text-[10px] leading-tight text-neutral-600">{a.nome}</p>
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </details>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {notasVisiveis.length > 0 && <p className="mt-4 text-xs text-neutral-500">{notasVisiveis.join(" · ")}</p>}
      <p className="mt-3 text-[11px] text-neutral-400">Cores e texturas aproximadas. Confirme o acabamento com a amostra física.</p>
    </div>
  );
}
