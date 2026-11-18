"use client";

import { useState, type ReactNode } from "react";
import { useConfigurador } from "./Configurador";
import { Amostra, OpcoesParte, notasVisiveis, type DadosAcabamento, type ParteProduto } from "./AcabamentosProduto";

type Aplicacao = { tipo: string; onde: string | null; opcoes: string[] };
export type Especificacoes = { revestimentos?: string[]; aplicacoes?: Aplicacao[]; observacoes?: string[] };

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
  const obs = notasVisiveis(notas);

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

      {!partes.length && (esp.revestimentos?.length || esp.aplicacoes?.length) ? (
        <Sanfona titulo="Acabamentos" aberta={aberta === "esp"} alternar={alternar("esp")}>
          <div className="space-y-4 text-sm">
            {!!esp.revestimentos?.length && <ul className="space-y-1 text-grafite">{esp.revestimentos.map((r) => <li key={r}>{r}</li>)}</ul>}
            {esp.aplicacoes?.map((a) => (
              <div key={a.tipo + a.onde}>
                <p className="font-medium text-tinta">{a.tipo}{a.onde && <span className="font-normal text-pedra"> · {a.onde}</span>}</p>
                <p className="text-grafite">{a.opcoes.join(" · ")}</p>
              </div>
            ))}
            {!!esp.observacoes?.length && <p className="text-xs text-pedra">{esp.observacoes.join(" · ")}</p>}
          </div>
        </Sanfona>
      ) : null}

      {(obs.length > 0 || partes.length > 0) && (
        <div className="space-y-2 pt-6 text-xs leading-relaxed text-pedra">
          {obs.length > 0 && <p>{obs.join(" · ")}</p>}
          {partes.length > 0 && <p>Cores e texturas aproximadas. Confirme o acabamento com a amostra física.</p>}
        </div>
      )}
    </div>
  );
}
