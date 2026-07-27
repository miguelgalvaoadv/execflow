-- ============================================================
--  Galeria gerenciável pelo painel.
--  As 102 fotos originais continuam servidas como arquivos estáticos
--  (source='builtin', url relativa). Fotos novas vão para o Supabase
--  Storage (source='upload', url absoluta). Excluir uma builtin apenas
--  a esconde (active=false) — o arquivo estático permanece no deploy.
-- ============================================================

create table if not exists photos (
  id          uuid primary key default gen_random_uuid(),
  url         text not null,
  storage_path text,                      -- preenchido quando source='upload'
  category    text not null default 'mais'
              check (category in ('externa','banho','quarto','interior','mais')),
  caption     text,
  sort_order  integer not null default 0,
  active      boolean not null default true,
  is_cover    boolean not null default false,
  source      text not null default 'upload' check (source in ('builtin','upload')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_photos_active_order on photos (active, sort_order);
create unique index if not exists uq_photos_url on photos (url);
-- no máximo uma capa
create unique index if not exists uq_photos_cover on photos (is_cover) where is_cover;

drop trigger if exists trg_photos_updated on photos;
create trigger trg_photos_updated before update on photos
  for each row execute function set_updated_at();

alter table photos enable row level security;
-- deny-all: leitura pública passa pela Function /api/photos (service role)

-- Bucket público para as fotos enviadas pelo painel.
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;
