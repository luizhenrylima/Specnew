"use client";

import { useState } from "react";
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
export const notasVisiveis = (notas: string[]) => notas.filter((n) => !NOTA_INTERNA.test(semAcento(n)));

// O brilho vem da família (a mesma laca é fosca na pintura e brilhante no highgloss/vidro).
function visual(a: AcabamentoLib, f: FamiliaMarca): AcabamentoVisual {
  const b = f.brilho;
  const rug = b === "vidro" ? 0.05 : b === "brilho" ? 0.18 : b === "acetinado" ? 0.45 : b === "fosco" ? 0.8 : (a.rugosidade ?? 0.5);
  return {
    id: `${a.id}:${f.familia}`, nome: a.nome, cor: a.cor_hex,
    textura: a.textura_cor_path ? urlPublica(a.textura_cor_path) : null,
    miniatura: a.textura_miniatura_path ? urlPublica(a.textura_miniatura_path) : null,
    larguraCm: a.tamanho_real_cm, alturaCm: a.tamanho_real_altura_cm,
    rugosidade: rug, metalico: a.metalico ?? 0, verniz: b === "vidro" || b === "brilho",
  };
}

// Amostra redonda, como as esferas de material da identidade.
export function Amostra({ cor, miniatura, tamanho = "md", ativo }: { cor: string | null; miniatura: string | null; tamanho?: "sm" | "md"; ativo?: boolean }) {
  return (
    <span
      className={`block shrink-0 rounded-full bg-cover bg-center shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] transition ${
        tamanho === "sm" ? "h-6 w-6" : "aspect-square w-full"
      } ${ativo ? "outline-2 outline-offset-[3px] outline-cobre outline" : ""}`}
      style={{ backgroundColor: cor ?? "#ddd", backgroundImage: miniatura ? `url(${miniatura})` : undefined }}
    />
  );
}

export type DadosAcabamento = { familias: FamiliaMarca[]; acabamentos: AcabamentoLib[] };

function agrupar({ familias, acabamentos }: DadosAcabamento) {
  const fam = new Map(familias.map((f) => [f.familia, f]));
  const porColecao = new Map<string, AcabamentoLib[]>();
  for (const a of acabamentos) porColecao.set(a.colecao, [...(porColecao.get(a.colecao) ?? []), a]);
  return { fam, porColecao };
}

// Conteúdo de uma parte: abas das famílias permitidas e as amostras da família escolhida. Clicar aplica no 3D.
export function OpcoesParte({ parte, dados }: { parte: ParteProduto; dados: DadosAcabamento }) {
  const config = useConfigurador();
  const { fam, porColecao } = agrupar(dados);
  const escolhido = config?.escolhas[parte.rotulo]?.acabamento;
  const opcoes = parte.familias
    .map((f) => fam.get(f))
    .filter((f): f is FamiliaMarca => !!f)
    .sort((a, b) => a.ordem - b.ordem)
    .map((f) => ({ f, itens: f.colecoes.flatMap((c) => porColecao.get(c) ?? []) }));

  const inicial = opcoes.find((o) => escolhido?.id.endsWith(`:${o.f.familia}`)) ?? opcoes.find((o) => o.itens.length) ?? opcoes[0];
  const [aba, setAba] = useState(inicial?.f.familia);
  const atual = opcoes.find((o) => o.f.familia === aba) ?? inicial;

  if (!opcoes.length) return <p className="text-sm text-pedra">Acabamentos sob consulta.</p>;

  return (
    <div>
      {!parte.materiais.length && (
        <p className="mb-3 text-xs text-pedra">Esta parte não está separada no modelo 3D: a troca não aparece na visualização.</p>
      )}

      {opcoes.length > 1 && (
        <div role="tablist" className="-mx-1 mb-5 flex gap-1 overflow-x-auto px-1 pb-1">
          {opcoes.map(({ f, itens }) => {
            const ativa = f.familia === atual?.f.familia;
            return (
              <button
                key={f.familia}
                role="tab"
                aria-selected={ativa}
                onClick={() => setAba(f.familia)}
                className={`shrink-0 rounded-full px-4 py-2 text-xs transition ${
                  ativa ? "bg-grafite text-white" : "bg-nevoa text-grafite hover:bg-[#e4e4e4]"
                }`}
              >
                {f.rotulo}
                <span className={ativa ? "text-white/60" : "text-pedra"}> {itens.length || "—"}</span>
              </button>
            );
          })}
        </div>
      )}

      {atual && !atual.itens.length ? (
        <p className="text-sm text-pedra">{atual.f.rotulo}: sob consulta à fábrica.</p>
      ) : (
        atual?.f.colecoes.map((c) => {
          const lista = porColecao.get(c) ?? [];
          if (!lista.length) return null;
          return (
            <div key={c} className="mb-5 last:mb-0">
              {atual.f.colecoes.length > 1 && <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.18em] text-pedra">{c}</p>}
              <ul className="grid grid-cols-5 gap-x-3 gap-y-4">
                {lista.map((a) => {
                  const v = visual(a, atual.f);
                  const ativo = escolhido?.id === v.id;
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => config?.escolher(parte.rotulo, v)}
                        aria-pressed={ativo}
                        title={`${a.nome} · ${a.colecao}`}
                        className="group block w-full text-center"
                      >
                        <span className="mx-auto block max-w-[60px] transition group-hover:scale-[1.04]">
                          <Amostra cor={v.cor} miniatura={v.miniatura} ativo={ativo} />
                        </span>
                        <span className={`mt-2 block text-[10px] leading-tight ${ativo ? "font-medium text-tinta" : "text-pedra"}`}>{a.nome}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })
      )}
    </div>
  );
}
