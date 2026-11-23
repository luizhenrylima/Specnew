"use client";

import { useState, type ReactNode } from "react";
import { useConfigurador } from "./Configurador";
import { Amostra, OpcoesParte, notasVisiveis, type DadosAcabamento, type ParteProduto } from "./AcabamentosProduto";

type Aplicacao = { tipo: string; onde: string | null; opcoes: string[] };
export type Especificacoes = {
  revestimentos?: string[]; aplicacoes?: Aplicacao[]; observacoes?: string[];
  designer?: string | null; referencias?: string[];
  medidas_tabela?: { rotulo: string; ref: string | null; base: string | null }[];
};

type Props = {
  medidasCm: { largura: string; profundidade: string; altura: string };
  medidasDisponiveis: string[];
  partes: ParteProduto[];
  dados: DadosAcabamento;
  notas: string[];
  especificacoes: Especificacoes;
};

// Uma seção que abre e fecha, no estilo dos configuradores de luxo: título, resumo da escolha e conteúdo escondido.
function Sanfona({
  titulo, resumo, aberta, alternar, children,
}: { titulo: string; resumo?: ReactNode; aberta: boolean; alternar: () => void; children: ReactNode }) {
  return (
    <section className="border-b border-nevoa">
      <button
        type="button"
        onClick={alternar}
        aria-expanded={aberta}
        className="flex w-full items-center gap-4 py-5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-tinta">{titulo}</span>
          {resumo && <span className="mt-1 flex items-center gap-2 text-xs text-pedra">{resumo}</span>}
        </span>
        <span
          aria-hidden
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border border-nevoa text-grafite transition duration-300 ${aberta ? "rotate-45 bg-grafite text-white" : ""}`}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M6 1v10M1 6h10" /></svg>
        </span>
      </button>
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${aberta ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <div className="pb-6">{children}</div>
        </div>
      </div>
    </section>
  );
}

// Painel lateral: medidas e uma seção por parte do produto. Tudo começa fechado; abre o que o arquiteto quiser ver.
export default function PainelOpcoes({ medidasCm, medidasDisponiveis, partes, dados, notas, especificacoes: esp }: Props) {
  const config = useConfigurador();
  const [aberta, setAberta] = useState<string | null>(null);
  const alternar = (id: string) => () => setAberta((a) => (a === id ? null : id));
  const ordenadas = [...partes].sort((a, b) => a.ordem - b.ordem);
  // observações da fábrica (tabela) sem as notas internas de preço/regra; sem repetir
  const obs = [...new Set(notasVisiveis([...(esp.observacoes ?? []), ...notas]))];
  const refs = esp.referencias ?? [];
  // configurações da tabela: "X — X" vira "X"; somem notas de preço e o que já está nas observações
  const revestimentos = [...new Set((esp.revestimentos ?? []).map((r) => {
    const [a, b] = r.split(" — ");
    return a === b ? a : r;
  }))].filter((r) => notasVisiveis([r]).length > 0 && !obs.includes(r));
  const comBase = !!esp.medidas_tabela?.some((m) => m.base) || (esp.medidas_tabela?.length ?? 0) > 1;
  const temFicha = !!(esp.designer || refs.length > 1 || revestimentos.length || esp.aplicacoes?.length || comBase || obs.length);

  return (
    <div>
      <Sanfona
        titulo="Dimensões"
        resumo={<>{medidasCm.largura} × {medidasCm.profundidade} × {medidasCm.altura} cm</>}
        aberta={aberta === "medidas"}
        alternar={alternar("medidas")}
      >
        <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-nevoa">
          {([["Largura", medidasCm.largura], ["Profundidade", medidasCm.profundidade], ["Altura", medidasCm.altura]] as const).map(([r, v]) => (
            <div key={r} className="bg-white px-3 py-4 text-center">
              <dt className="text-[10px] uppercase tracking-[0.18em] text-pedra">{r}</dt>
              <dd className="mt-1 text-xl font-light text-tinta">{v}<span className="ml-1 text-xs text-pedra">cm</span></dd>
            </div>
          ))}
        </dl>
        {medidasDisponiveis.length > 0 && (
          <>
            <p className="mt-5 text-[10px] uppercase tracking-[0.18em] text-pedra">Medidas disponíveis · L × P × A cm</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {medidasDisponiveis.map((m) => (
                <li key={m} className="rounded-full border border-nevoa px-3 py-1.5 text-xs text-grafite">{m.toLowerCase()}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-pedra">Outras medidas sob consulta à fábrica.</p>
          </>
        )}
      </Sanfona>

      {ordenadas.map((p) => {
        const escolhido = config?.escolhas[p.rotulo]?.acabamento;
        return (
          <Sanfona
            key={p.rotulo}
            titulo={p.rotulo}
            resumo={
              escolhido ? (
                <>
                  <Amostra cor={escolhido.cor} miniatura={escolhido.miniatura} tamanho="sm" />
                  <span className="text-grafite">{escolhido.nome}</span>
                </>
              ) : (
                <>Acabamento original</>
              )
            }
            aberta={aberta === p.rotulo}
            alternar={alternar(p.rotulo)}
          >
            <OpcoesParte parte={p} dados={dados} />
          </Sanfona>
        );
      })}

      {temFicha && (
        <Sanfona
          titulo="Ficha técnica"
          resumo={esp.designer ? <>Design {esp.designer}</> : <>Configurações, opções e observações da fábrica</>}
          aberta={aberta === "ficha"}
          alternar={alternar("ficha")}
        >
          <div className="space-y-5 text-sm">
            {(refs.length > 1 || esp.designer) && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                {esp.designer && (<><dt className="text-pedra">Designer</dt><dd className="text-grafite">{esp.designer}</dd></>)}
                {refs.length > 1 && (<><dt className="text-pedra">Referências</dt><dd className="text-grafite">{refs.join(" · ")}</dd></>)}
              </dl>
            )}
            {revestimentos.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-pedra">Configurações de acabamento</p>
                <ul className="mt-2 space-y-1 text-grafite">{revestimentos.map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
            )}
            {esp.aplicacoes?.map((a) => (
              <div key={a.tipo + a.onde}>
                <p className="text-[10px] uppercase tracking-[0.18em] text-pedra">{a.tipo}{a.onde && <span className="normal-case tracking-normal"> · {a.onde}</span>}</p>
                <p className="mt-2 text-grafite">{a.opcoes.join(" · ")}</p>
              </div>
            ))}
            {comBase && (
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-pedra">Medidas por referência · cm</p>
                <ul className="mt-2 space-y-1 text-grafite">
                  {esp.medidas_tabela!.map((m) => (
                    <li key={m.rotulo + m.ref + m.base}>
                      {m.rotulo}{m.ref && <span className="text-pedra"> · ref. {m.ref}</span>}{m.base && <span className="text-pedra"> · base {m.base.replace(/x/gi, " × ")} mm</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {obs.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-pedra">Observações</p>
                <ul className="mt-2 space-y-1 text-grafite">{obs.map((o) => <li key={o}>{o}</li>)}</ul>
              </div>
            )}
          </div>
        </Sanfona>
      )}

      {partes.length > 0 && (
        <div className="space-y-2 pt-6 text-xs leading-relaxed text-pedra">
          <p>Cores e texturas aproximadas. Confirme o acabamento com a amostra física.</p>
        </div>
      )}
    </div>
  );
}
