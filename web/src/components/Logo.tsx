// Logo Specifica (tirado da identidade visual). A imagem é usada como máscara, então a cor vem do texto (currentColor).
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Specifica"
      className={`inline-block aspect-[1040/362] bg-current ${className}`}
      style={{
        maskImage: "url(/marca/specifica-logo.png)",
        WebkitMaskImage: "url(/marca/specifica-logo.png)",
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
      }}
    />
  );
}
