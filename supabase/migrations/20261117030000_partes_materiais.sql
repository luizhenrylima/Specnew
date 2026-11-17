-- Nomes dos materiais do GLB que formam cada parte (ex.: tampo = mat24, mat25). Vazio = parte não separada no modelo 3D.
alter table public.produto_partes
  add column if not exists materiais text[] not null default '{}';
