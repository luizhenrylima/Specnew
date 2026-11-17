-- Biblioteca de acabamentos por coleção (ex.: "Sier · Lâminas") e regra por marca:
-- cada parte de produto aceita famílias (lamina, pintura_micro...), e cada marca diz quais coleções formam cada família.

alter table public.acabamentos
  add column if not exists fornecedor            text,          -- ex.: Sier; null = padrão criado pela Specifica
  add column if not exists colecao               text,          -- ex.: "Lâminas", "Lacas", "Inox"
  add column if not exists tamanho_real_altura_cm numeric(8,2), -- tamanho_real_cm passa a ser a largura
  add column if not exists textura_miniatura_path text,
  add column if not exists ordem                 int not null default 0;

create index if not exists acabamentos_colecao_idx on public.acabamentos (fornecedor, colecao);

-- Família de acabamento de uma marca -> coleções que aparecem para o arquiteto.
create table if not exists public.marca_familias (
  marca_id  uuid not null references public.marcas(id) on delete cascade,
  familia   text not null,          -- lamina, pintura_micro, pintura_hg, inox, inox_pintura, pedra, couro_sintetico...
  rotulo    text not null,          -- como aparece na página: "Lâmina de madeira", "Pintura Highgloss"...
  colecoes  text[] not null default '{}',  -- valores de acabamentos.colecao; vazio = "sob consulta"
  brilho    text,                   -- fosco, acetinado, brilho: muda só o reflexo no visualizador
  ordem     int not null default 0,
  primary key (marca_id, familia)
);
alter table public.marca_familias enable row level security;
drop policy if exists "familias de marcas ativas" on public.marca_familias;
create policy "familias de marcas ativas" on public.marca_familias
  for select using (exists (select 1 from public.marcas m where m.id = marca_id and m.ativa));

alter table public.produto_partes
  add column if not exists familias text[] not null default '{}';

alter table public.produtos
  add column if not exists notas_acabamento text[] not null default '{}';
