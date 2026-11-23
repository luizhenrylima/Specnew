"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

// Como um acabamento aparece no 3D.
export type AcabamentoVisual = {
  id: string;
  nome: string;
  cor: string | null;
  textura: string | null;        // URL da imagem (2048 px)
  miniatura: string | null;      // URL da miniatura (amostras do painel)
  normal: string | null;         // mapa de relevo (normal map), mesma repetição da textura
  larguraCm: number | null;      // quantos cm uma repetição da imagem cobre
  alturaCm: number | null;
  rugosidade: number;            // 0 espelhado, 1 fosco
  metalico: number;
  verniz: boolean;               // camada de brilho (highgloss, vidro)
};

type Escolha = { parte: string; acabamento: AcabamentoVisual; ordem: number };

type Ctx = {
  escolhas: Record<string, Escolha>;
  escolher: (parte: string, a: AcabamentoVisual) => void;
  limpar: () => void;
  // material do GLB -> acabamento (se dois cliques afetam o mesmo material, vale o último)
  porMaterial: Record<string, AcabamentoVisual>;
};

const Contexto = createContext<Ctx | null>(null);

export function useConfigurador() {
  return useContext(Contexto);
}

// Guarda o acabamento escolhido em cada parte e traduz para "material do modelo -> acabamento" para o visualizador.
export function Configurador({ partes, children }: { partes: { rotulo: string; materiais: string[] }[]; children: ReactNode }) {
  const [escolhas, setEscolhas] = useState<Record<string, Escolha>>({});
  const escolher = useCallback((parte: string, acabamento: AcabamentoVisual) => {
    setEscolhas((e) => ({ ...e, [parte]: { parte, acabamento, ordem: Date.now() } }));
  }, []);
  const limpar = useCallback(() => setEscolhas({}), []);

  const porMaterial = useMemo(() => {
    const m: Record<string, AcabamentoVisual> = {};
    const materiaisDe = new Map(partes.map((p) => [p.rotulo, p.materiais]));
    for (const e of Object.values(escolhas).sort((a, b) => a.ordem - b.ordem)) {
      for (const mat of materiaisDe.get(e.parte) ?? []) m[mat] = e.acabamento;
    }
    return m;
  }, [escolhas, partes]);

  return <Contexto.Provider value={{ escolhas, escolher, limpar, porMaterial }}>{children}</Contexto.Provider>;
}
