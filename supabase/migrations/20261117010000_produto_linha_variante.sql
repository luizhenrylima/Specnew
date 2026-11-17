-- Linha do produto (ex.: "Aspen" existe como mesa de centro, lateral e cabeceira),
-- variante (ex.: "alta" / "baixa" quando um mesmo produto tem mais de um modelo 3D)
-- e especificações tiradas da tabela da marca (revestimentos, aplicações, observações — sem preços).
alter table public.produtos
  add column if not exists linha          text,
  add column if not exists variante       text,
  add column if not exists especificacoes jsonb not null default '{}'::jsonb,
  add column if not exists pendencia      text;   -- algo a confirmar com a marca

create index if not exists produtos_linha_idx on public.produtos (marca_id, linha);
