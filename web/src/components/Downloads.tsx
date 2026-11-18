"use client";

import { useEffect, useState } from "react";
import { useConfigurador } from "./Configurador";

export type ArquivoDownload = {
  formato: string;
  titulo: string;
  uso: string;
  grupo: "cad" | "3d";
  url: string | null;   // null = ainda não gerado
  tamanho: string | null;
};

const GRUPOS = [
  { id: "cad", titulo: "Desenho técnico" },
  { id: "3d", titulo: "Modelos 3D e renderização" },
] as const;

function IconeBaixar({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M8 2v8m0 0L4.5 6.5M8 10l3.5-3.5M2.5 13.5h11" />
    </svg>
  );
}

// Barra fixa no rodapé (como o resumo dos configuradores): produto, escolhas e os downloads em destaque.
// "Ver todos" abre a gaveta com todos os formatos.
export default function Downloads({ nome, referencia, arquivos }: { nome: string; referencia: string | null; arquivos: ArquivoDownload[] }) {
  const [aberto, setAberto] = useState(false);
  const config = useConfigurador();
  const escolhas = config ? Object.values(config.escolhas) : [];
  const prontos = arquivos.filter((a) => a.url);
  const rapidos = ["dwg", "skp"].map((f) => prontos.find((a) => a.formato === f)).filter((a): a is ArquivoDownload => !!a);

  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("keydown", fechar);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", fechar);
      document.body.style.overflow = "";
    };
  }, [aberto]);

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-nevoa bg-white/95 backdrop-blur">
        <div className="flex h-[72px] items-center gap-4 px-4 lg:px-8">
          <div className="hidden min-w-0 flex-1 sm:block">
            <p className="truncate text-sm font-medium text-tinta">
              {nome}
              {referencia && <span className="font-light text-pedra"> · Ref. {referencia}</span>}
            </p>
            <p className="truncate text-xs text-pedra">
              {escolhas.length
                ? escolhas.map((e) => `${e.parte}: ${e.acabamento.nome}`).join(" · ")
                : "Acabamento original"}
            </p>
          </div>

          <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
            {rapidos.map((a) => (
              <a
                key={a.formato}
                href={a.url!}
                className="hidden items-center gap-2 rounded-full border border-grafite/20 px-4 py-2.5 text-xs font-medium text-grafite transition hover:border-grafite md:inline-flex"
              >
                <IconeBaixar /> {a.titulo}
              </a>
            ))}
            <button
              type="button"
              onClick={() => setAberto(true)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-grafite px-6 py-3 text-sm font-medium text-white transition hover:bg-tinta sm:w-auto"
            >
              <IconeBaixar />
              Downloads 3D e CAD
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px]">{prontos.length}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Gaveta: lateral no computador, de baixo para cima no celular. */}
      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-300 ${aberto ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={() => setAberto(false)}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Downloads"
        aria-hidden={!aberto}
        inert={!aberto}
        className={`fixed z-50 flex flex-col bg-white transition-[transform,visibility] duration-300 ease-out
          inset-x-0 bottom-0 max-h-[85vh] rounded-t-3xl
          sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[440px] sm:rounded-none
          ${aberto ? "visible translate-x-0 translate-y-0 shadow-2xl" : "invisible translate-y-full sm:translate-x-full sm:translate-y-0"}`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-nevoa px-6 py-6">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-pedra">Downloads</p>
            <h2 className="mt-1 text-xl font-light text-tinta">{nome}</h2>
          </div>
          <button
            type="button"
            onClick={() => setAberto(false)}
            aria-label="Fechar"
            className="grid h-9 w-9 place-items-center rounded-full border border-nevoa text-grafite transition hover:bg-nevoa"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.4" aria-hidden><path d="M1 1l10 10M11 1L1 11" /></svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {GRUPOS.map((g) => {
            const lista = arquivos.filter((a) => a.grupo === g.id);
            if (!lista.length) return null;
            return (
              <section key={g.id} className="mb-8 last:mb-0">
                <h3 className="mb-3 text-[10px] font-medium uppercase tracking-[0.2em] text-pedra">{g.titulo}</h3>
                <ul className="space-y-2">
                  {lista.map((a) => {
                    const conteudo = (
                      <>
                        <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-[11px] font-semibold tracking-wide ${a.url ? "bg-nevoa text-grafite" : "bg-linho text-pedra/60"}`}>
                          {a.formato.toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block text-sm font-medium ${a.url ? "text-tinta" : "text-pedra"}`}>{a.titulo}</span>
                          <span className="block text-xs leading-snug text-pedra">{a.uso}</span>
                        </span>
                        {a.url ? (
                          <span className="flex shrink-0 items-center gap-2 text-xs text-pedra">
                            {a.tamanho}
                            <span className="grid h-9 w-9 place-items-center rounded-full bg-grafite text-white transition group-hover:bg-cobre">
                              <IconeBaixar />
                            </span>
                          </span>
                        ) : (
                          <span className="shrink-0 text-xs text-pedra">Em breve</span>
                        )}
                      </>
                    );
                    return (
                      <li key={a.formato}>
                        {a.url ? (
                          <a href={a.url} className="group flex items-center gap-4 rounded-2xl border border-nevoa p-3 transition hover:border-grafite/30 hover:shadow-sm">
                            {conteudo}
                          </a>
                        ) : (
                          <div className="flex items-center gap-4 rounded-2xl border border-dashed border-nevoa p-3">{conteudo}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          <p className="mt-6 text-xs leading-relaxed text-pedra">
            Os arquivos trazem o acabamento original do produto. Medidas reais, prontas para usar no seu projeto.
          </p>
        </div>
      </aside>
    </>
  );
}
