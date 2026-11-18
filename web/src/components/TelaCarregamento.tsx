"use client";

import { useEffect, useState } from "react";
import { Logo } from "./Logo";

// Evento que o visualizador dispara quando o modelo 3D terminou de carregar (ou falhou).
export const EVENTO_3D_PRONTO = "specifica:3d-pronto";

const MINIMO_MS = 900;   // tempo mínimo para a marca ser vista, sem piscar
const MAXIMO_MS = 12000; // nunca prende o arquiteto se o 3D demorar demais

// Tela inteira com o logo Specifica pulsando no centro enquanto a página carrega.
// Some com um fade quando o 3D fica pronto. É o único lugar onde a marca Specifica aparece.
export default function TelaCarregamento({ esperar3d }: { esperar3d: boolean }) {
  const [saindo, setSaindo] = useState(false);
  const [fora, setFora] = useState(false);

  useEffect(() => {
    const inicio = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sair = () => {
      const falta = Math.max(0, MINIMO_MS - (performance.now() - inicio));
      timer = setTimeout(() => setSaindo(true), falta);
    };
    const limite = setTimeout(() => setSaindo(true), MAXIMO_MS);
    if (!esperar3d) sair();
    else window.addEventListener(EVENTO_3D_PRONTO, sair, { once: true });
    return () => {
      window.removeEventListener(EVENTO_3D_PRONTO, sair);
      clearTimeout(timer);
      clearTimeout(limite);
    };
  }, [esperar3d]);

  useEffect(() => {
    if (!saindo) return;
    const t = setTimeout(() => setFora(true), 700);
    return () => clearTimeout(t);
  }, [saindo]);

  if (fora) return null;

  return (
    <div
      aria-hidden={saindo}
      role="status"
      aria-label="Carregando"
      className={`fixed inset-0 z-[60] grid place-items-center bg-white transition-opacity duration-700 ease-out ${saindo ? "pointer-events-none opacity-0" : "opacity-100"}`}
    >
      <div className="flex flex-col items-center gap-6">
        <span className="animate-[pulsar_1.8s_ease-in-out_infinite] text-grafite">
          <Logo className="h-14 sm:h-16" />
        </span>
        <span className="h-px w-24 overflow-hidden bg-nevoa">
          <span className="block h-full w-1/3 animate-[correr_1.4s_ease-in-out_infinite] bg-cobre" />
        </span>
      </div>
    </div>
  );
}
