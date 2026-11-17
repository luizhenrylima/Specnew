-- Specifica: estrutura inicial
-- Marcas -> produtos -> partes do OBJ -> acabamentos permitidos
-- Escrita: apenas pelo servidor (service role). Leitura pública: só o que está publicado.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------
-- Marcas (cada fabricante cujo catálogo a Specifica atende)
-- ---------------------------------------------------------------
create table public.marcas (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  slug        text not null unique,
  logo_path   text,
  site        text,
  ativa       boolean not null default true,
  criado_em   timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Acabamentos (biblioteca padrão; marca_id nulo = vale para todas)
-- ---------------------------------------------------------------
create table public.acabamentos (
  id                   uuid primary key default gen_random_uuid(),
  marca_id             uuid references public.marcas(id) on delete cascade,
  nome                 text not null,
  codigo               text,
  categoria            text not null,              -- madeira, metal, tecido, pedra, laca...
  cor_hex              text,                       -- usado quando não há textura
  textura_cor_path     text,
  textura_normal_path  text,
  textura_rugosidade_path text,
  tamanho_real_cm      numeric(8,2),               -- quantos cm a imagem da textura representa
  rugosidade           numeric(3,2) default 0.5,   -- 0 = espelhado, 1 = fosco
  metalico             numeric(3,2) default 0,
  ativo                boolean not null default true,
  criado_em            timestamptz not null default now(),
  unique (marca_id, codigo)
);

-- ---------------------------------------------------------------
-- Produtos
-- ---------------------------------------------------------------
create type public.status_produto as enum ('rascunho', 'processando', 'publicado', 'erro');
create type public.unidade_obj   as enum ('mm', 'cm', 'm');

create table public.produtos (
  id               uuid primary key default gen_random_uuid(),
  marca_id         uuid not null references public.marcas(id) on delete cascade,
  nome             text not null,
  slug             text not null unique,           -- vira o link: /p/<slug>
  referencia       text,                           -- código do produto na tabela da marca
  categoria        text,                           -- mesa, cadeira, poltrona...
  descricao        text,
  largura_mm       numeric(10,2),
  profundidade_mm  numeric(10,2),
  altura_mm        numeric(10,2),
  unidade_obj      public.unidade_obj not null default 'cm',
  obj_path         text,                           -- original enviado (bucket privado)
  glb_path         text,                           -- versão web (bucket público)
  thumb_path       text,
  status           public.status_produto not null default 'rascunho',
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index on public.produtos (marca_id);

-- Medidas disponíveis (tirados da tabela da marca, sem preço)
create table public.produto_medidas (
  id               uuid primary key default gen_random_uuid(),
  produto_id       uuid not null references public.produtos(id) on delete cascade,
  rotulo           text not null,                  -- ex.: "1,80 m", "8 lugares"
  largura_mm       numeric(10,2),
  profundidade_mm  numeric(10,2),
  altura_mm        numeric(10,2),
  ordem            int not null default 0
);
create index on public.produto_medidas (produto_id);

-- Partes do modelo (nome do grupo/material no OBJ -> nome amigável)
create table public.produto_partes (
  id                    uuid primary key default gen_random_uuid(),
  produto_id            uuid not null references public.produtos(id) on delete cascade,
  nome_no_obj           text not null,             -- ex.: "tampo", "estrutura"
  rotulo                text not null,             -- ex.: "Tampo", "Estrutura"
  acabamento_padrao_id  uuid references public.acabamentos(id) on delete set null,
  ordem                 int not null default 0,
  unique (produto_id, nome_no_obj)
);
create index on public.produto_partes (produto_id);

-- Quais acabamentos cada parte aceita
create table public.parte_acabamentos (
  parte_id      uuid not null references public.produto_partes(id) on delete cascade,
  acabamento_id uuid not null references public.acabamentos(id) on delete cascade,
  primary key (parte_id, acabamento_id)
);

-- Arquivos para download (DWG, DAE/FBX p/ Lumion, SKP, OBJ, 3DS...)
create table public.arquivos_download (
  id             uuid primary key default gen_random_uuid(),
  produto_id     uuid not null references public.produtos(id) on delete cascade,
  formato        text not null,                    -- dwg, dae, fbx, skp, obj, 3ds, glb
  path           text not null,
  tamanho_bytes  bigint,
  criado_em      timestamptz not null default now(),
  unique (produto_id, formato)
);
create index on public.arquivos_download (produto_id);

-- Visualizações e downloads (para relatório por marca / loja)
create table public.eventos (
  id          bigint generated always as identity primary key,
  produto_id  uuid references public.produtos(id) on delete set null,
  tipo        text not null check (tipo in ('visualizacao', 'download')),
  formato     text,
  origem      text,                                -- site/catálogo de onde veio o acesso
  criado_em   timestamptz not null default now()
);
create index on public.eventos (produto_id, criado_em);

-- atualizado_em automático
create or replace function public.set_atualizado_em() returns trigger
language plpgsql as $$
begin
  new.atualizado_em = now();
  return new;
end $$;

create trigger produtos_atualizado_em
  before update on public.produtos
  for each row execute function public.set_atualizado_em();

-- ---------------------------------------------------------------
-- Segurança (RLS): leitura pública só do que está publicado/ativo.
-- Toda escrita passa pelo servidor com a service role key.
-- ---------------------------------------------------------------
alter table public.marcas            enable row level security;
alter table public.acabamentos       enable row level security;
alter table public.produtos          enable row level security;
alter table public.produto_medidas   enable row level security;
alter table public.produto_partes    enable row level security;
alter table public.parte_acabamentos enable row level security;
alter table public.arquivos_download enable row level security;
alter table public.eventos           enable row level security;

create policy "marcas ativas são públicas" on public.marcas
  for select using (ativa);

create policy "acabamentos ativos são públicos" on public.acabamentos
  for select using (ativo);

create policy "produtos publicados são públicos" on public.produtos
  for select using (status = 'publicado');

create policy "medidas de produtos publicados" on public.produto_medidas
  for select using (exists (select 1 from public.produtos p
                            where p.id = produto_id and p.status = 'publicado'));

create policy "partes de produtos publicados" on public.produto_partes
  for select using (exists (select 1 from public.produtos p
                            where p.id = produto_id and p.status = 'publicado'));

create policy "acabamentos das partes publicadas" on public.parte_acabamentos
  for select using (exists (select 1 from public.produto_partes pp
                            join public.produtos p on p.id = pp.produto_id
                            where pp.id = parte_id and p.status = 'publicado'));

create policy "downloads de produtos publicados" on public.arquivos_download
  for select using (exists (select 1 from public.produtos p
                            where p.id = produto_id and p.status = 'publicado'));

-- eventos: ninguém lê nem grava direto do navegador; só o servidor.

-- ---------------------------------------------------------------
-- Storage
--   originais : OBJ/MTL/texturas enviados (privado)
--   publico   : GLB, texturas de acabamento, miniaturas e arquivos de download
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('originais', 'originais', false),
       ('publico',   'publico',   true)
on conflict (id) do nothing;
