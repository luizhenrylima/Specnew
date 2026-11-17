"use client";

import { urlPublica } from "@/lib/supabase/env";
import { useConfigurador, type AcabamentoVisual } from "./Configurador";

export type FamiliaMarca = { familia: string; rotulo: string; colecoes: string[]; brilho: string | null; ordem: number };
export type AcabamentoLib = {
  id: string; nome: string; colecao: string; cor_hex: string | null;
  textura_cor_path: string | null; textura_miniatura_path: string | null;
  tamanho_real_cm: number | null; tamanho_real_altura_cm: number | null;
  rugosidade: number | null; metalico: number | null;
};
export type ParteProduto = { rotulo: string; familias: string[]; materiais: string[]; ordem: number };

// Notas da tabela que não interessam ao arquiteto (preço, cálculo) ou que já viraram regra.
const NOTA_INTERNA = /medidas intermediarias|calculo do par|inox tonalizado citado|nao faz/i;
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

// O brilho vem da família (a mesma laca é fosca na pintura e brilhante no highgloss/vidro).
function visual(a: AcabamentoLib, f: FamiliaMarca): AcabamentoVisual {
  const b = f.brilho;
  const rug = b === "vidro" ? 0.05 : b === "brilho" ? 0.18 : b === "acetinado" ? 0.45 : b === "fosco" ? 0.8 : (a.rugosidade ?? 0.5);
  return {
    id: `${a.id}:${f.familia}`, nome: a.nome, cor: a.cor_hex,
    textura: a.textura_cor_path ? urlPublica(a.textura_cor_path) : null,
    larguraCm: a.tamanho_real_cm, alturaCm: a.tamanho_real_altura_cm,
    rugosidade: rug, metalico: a.metalico ?? 0, verniz: b === "vidro" || b === "brilho",
  };
}

function Amostra({ a, grande, ativo }: { a: AcabamentoLib; grande?: boolean; ativo?: boolean }) {
  return (
    <span
      className={`block shrink-0 rounded border bg-cover bg-center ${grande ? "aspect-square w-full" : "h-6 w-6"} ${ativo ? "border-neutral-900 ring-2 ring-neutral-900 ring-offset-1" : "border-black/10"}`}
      style={{
        backgroundColor: a.cor_hex ?? "#ddd",
        backgroundImage: a.textura_miniatura_path ? `url(${urlPublica(a.textura_miniatura_path)})` : undefined,
      }}
    />
  );
}

// Acabamentos permitidos em cada parte do produto, conforme a regra da marca. Clicar aplica no modelo 3D.
export default function AcabamentosProduto({
  partes, familias, acabamentos, notas,
}: { partes: ParteProduto[]; familias: FamiliaMarca[]; acabamentos: AcabamentoLib[]; notas: string[] }) {
  const config = useConfigurador();
  const fam = new Map(familias.map((f) => [f.familia, f]));
  const porColecao = new Map<string, AcabamentoLib[]>();
  for (const a of acabamentos) porColecao.set(a.colecao, [...(porColecao.get(a.colecao) ?? []), a]);
  const notasVisiveis = notas.filter((n) => !NOTA_INTERNA.test(semAcento(n)));

  return (
    <div className="rounded-lg border border-neutral-200 p-4 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Acabamentos</h2>
        <p className="text-[11px] text-neutral-400">Clique para aplicar no 3D</p>
      </div>
      <div className="mt-3 divide-y divide-neutral-100">
        {[...partes].sort((a, b) => a.ordem - b.ordem).map((p) => {
          const escolhido = config?.escolhas[p.rotulo]?.acabamento;
          const opcoes = p.familias
            .map((f) => fam.get(f))
            .filter((f): f is FamiliaMarca => !!f)
            .sort((a, b) => a.ordem - b.ordem);
          return (
            <div key={p.rotulo} className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">
                {p.rotulo}
                {escolhido && <span className="font-normal text-neutral-500"> · {escolhido.nome}</span>}
              </p>
              {!p.materiais.length && (
                <p className="text-[11px] text-neutral-400">Esta parte não está separada no modelo 3D.</p>
              )}
              <div className="mt-2 space-y-1.5">
                {opcoes.map((f) => {
                  const itens = f.colecoes.flatMap((c) => porColecao.get(c) ?? []);
                  if (!itens.length) {
                    return <p key={f.familia} className="text-neutral-600">{f.rotulo} <span className="text-xs text-neutral-400">· sob consulta</span></p>;
                  }
                  const ativoNaFamilia = escolhido && escolhido.id.endsWith(`:${f.familia}`);
                  return (
                    <details key={f.familia} className="group" open={!!ativoNaFamilia || undefined}>
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
                              {lista.map((a) => {
                                const v = visual(a, f);
                                const ativo = escolhido?.id === v.id;
                                return (
                                  <li key={a.id}>
                                    <button
                                      type="button"
                                      onClick={() => config?.escolher(p.rotulo, v)}
                                      aria-pressed={ativo}
                                      title={`${a.nome} · ${a.colecao}`}
                                      className="block w-full text-center"
                                    >
                                      <Amostra a={a} grande ativo={ativo} />
                                      <span className={`mt-1 block text-[10px] leading-tight ${ativo ? "font-medium text-neutral-900" : "text-neutral-600"}`}>{a.nome}</span>
                                    </button>
                                  </li>
                                );
                              })}
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
