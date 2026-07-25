-- ============================================================
--  Cabana Afrodite — sistema de reservas · schema inicial
--  Postgres / Supabase. Ordem de aplicação: 0001 (este) -> 0002 (RLS).
--  Ocupação em intervalo SEMIABERTO [check_in, check_out) via daterange '[)'.
-- ============================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "btree_gist";  -- exclusion constraint anti-sobreposição

-- ---------- enums ----------
do $$ begin
  create type reservation_status as enum (
    'pending_approval','rejected','awaiting_payment','payment_pending',
    'paid','confirmed','cancelled','refunded','expired','completed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type block_source as enum ('reservation','manual_block','ical_airbnb');
exception when duplicate_object then null; end $$;

-- ---------- updated_at trigger ----------
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

-- ============================================================
--  settings (config administrativa chave-valor em JSON)
-- ============================================================
create table if not exists settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
create trigger trg_settings_updated before update on settings
  for each row execute function set_updated_at();

-- ============================================================
--  pricing_rules (uma linha "ativa" com as regras de preço)
-- ============================================================
create table if not exists pricing_rules (
  id                       uuid primary key default gen_random_uuid(),
  is_active                boolean not null default true,
  default_nightly_cents    integer not null check (default_nightly_cents >= 0),
  weekday_nightly_cents    jsonb   not null default '{}'::jsonb, -- {"5":59000,...}
  cleaning_fee_cents       integer not null default 0 check (cleaning_fee_cents >= 0),
  included_guests          integer not null default 2 check (included_guests >= 1),
  extra_guest_fee_cents    integer not null default 0 check (extra_guest_fee_cents >= 0),
  extra_guest_per          text    not null default 'night' check (extra_guest_per in ('night','stay')),
  max_guests               integer not null default 4 check (max_guests >= 1),
  min_nights               integer not null default 1 check (min_nights >= 1),
  max_nights               integer,
  min_reservation_cents    integer not null default 0 check (min_reservation_cents >= 0),
  flat_discount_percent    numeric(5,2) not null default 0 check (flat_discount_percent between 0 and 100),
  length_of_stay_discounts jsonb   not null default '[]'::jsonb,
  security_deposit_cents   integer not null default 0 check (security_deposit_cents >= 0),
  charge_deposit_upfront   boolean not null default false,
  payment_mode             text    not null default 'full' check (payment_mode in ('full','signal')),
  signal_percent           numeric(5,2) not null default 30 check (signal_percent between 0 and 100),
  payment_expiration_hours integer not null default 24 check (payment_expiration_hours > 0),
  max_installments         integer not null default 12 check (max_installments between 1 and 24),
  prep_buffer_nights       integer not null default 0 check (prep_buffer_nights >= 0),
  updated_at               timestamptz not null default now()
);
create trigger trg_pricing_updated before update on pricing_rules
  for each row execute function set_updated_at();

-- ============================================================
--  special_periods (períodos/feriados com tarifa própria)
-- ============================================================
create table if not exists special_periods (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  start_date     date not null,             -- primeira NOITE (inclusive)
  end_date       date not null,             -- última NOITE (inclusive)
  nightly_cents  integer check (nightly_cents >= 0),
  min_nights     integer check (min_nights >= 1),
  discount_percent numeric(5,2) check (discount_percent between 0 and 100),
  created_at     timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists idx_special_periods_range on special_periods (start_date, end_date);

-- ============================================================
--  reservations
-- ============================================================
create table if not exists reservations (
  id                 uuid primary key default gen_random_uuid(),
  friendly_code      text unique not null,
  public_token       text unique not null,        -- página de acompanhamento
  external_reference text unique not null,         -- Mercado Pago
  status             reservation_status not null default 'pending_approval',
  check_in           date not null,
  check_out          date not null,
  during             daterange generated always as (daterange(check_in, check_out, '[)')) stored,
  adults             integer not null check (adults >= 1),
  children           integer not null default 0 check (children >= 0),
  -- valores congelados no momento da solicitação (em centavos)
  quote              jsonb not null,               -- detalhamento completo (Quote)
  total_cents        integer not null check (total_cents >= 0),
  pay_now_cents      integer not null check (pay_now_cents >= 0),
  currency           text not null default 'BRL',
  payment_expires_at timestamptz,
  approved_at        timestamptz,
  confirmed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (check_out > check_in)
);
create trigger trg_reservations_updated before update on reservations
  for each row execute function set_updated_at();
create index if not exists idx_reservations_status on reservations (status);
create index if not exists idx_reservations_during on reservations using gist (during);

-- GARANTIA ATÔMICA: duas reservas "bloqueantes" não podem ocupar o mesmo período.
alter table reservations drop constraint if exists no_overlap_active_reservations;
alter table reservations add constraint no_overlap_active_reservations
  exclude using gist (during with &&)
  where (status in ('awaiting_payment','payment_pending','paid','confirmed'));

-- ============================================================
--  reservation_guests (dados do hóspede — minimização LGPD)
-- ============================================================
create table if not exists reservation_guests (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  full_name      text not null,
  email          text not null,
  phone          text,
  document       text,               -- CPF só quando necessário
  notes          text,
  accepted_rules            boolean not null default false,
  accepted_cancellation     boolean not null default false,
  accepted_privacy          boolean not null default false,
  accepted_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists idx_guests_reservation on reservation_guests (reservation_id);

-- ============================================================
--  reservation_status_history (auditoria de status)
-- ============================================================
create table if not exists reservation_status_history (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  from_status    reservation_status,
  to_status      reservation_status not null,
  origin         text not null check (origin in ('guest','admin','system','webhook')),
  admin_user     text,
  external_event text,
  note           text,
  technical_id   text not null,
  created_at     timestamptz not null default now()
);
create index if not exists idx_status_history_res on reservation_status_history (reservation_id, created_at);

-- ============================================================
--  manual_blocks
-- ============================================================
create table if not exists manual_blocks (
  id          uuid primary key default gen_random_uuid(),
  check_in    date not null,
  check_out   date not null,
  during      daterange generated always as (daterange(check_in, check_out, '[)')) stored,
  reason      text,
  active      boolean not null default true,
  created_by  text,
  created_at  timestamptz not null default now(),
  check (check_out > check_in)
);
create index if not exists idx_manual_blocks_during on manual_blocks using gist (during);

-- ============================================================
--  ical_imported_events (períodos vindos do Airbnb)
-- ============================================================
create table if not exists ical_imported_events (
  id          uuid primary key default gen_random_uuid(),
  uid         text not null,
  check_in    date not null,
  check_out   date not null,
  during      daterange generated always as (daterange(check_in, check_out, '[)')) stored,
  cancelled   boolean not null default false,
  source_url  text,
  synced_at   timestamptz not null default now(),
  unique (uid)
);
create index if not exists idx_ical_events_during on ical_imported_events using gist (during);

-- ============================================================
--  ical_sync_logs
-- ============================================================
create table if not exists ical_sync_logs (
  id              uuid primary key default gen_random_uuid(),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  success         boolean,
  events_found    integer,
  periods_imported integer,
  duration_ms     integer,
  error_message   text,
  source_url      text
);
create index if not exists idx_ical_logs_started on ical_sync_logs (started_at desc);

-- ============================================================
--  payment_transactions
-- ============================================================
create table if not exists payment_transactions (
  id                 uuid primary key default gen_random_uuid(),
  reservation_id     uuid not null references reservations(id) on delete cascade,
  provider           text not null default 'mercadopago',
  preference_id      text,
  payment_id         text,
  status             text,
  amount_cents       integer,
  currency           text default 'BRL',
  live_mode          boolean,
  external_reference text,
  raw                jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger trg_payment_tx_updated before update on payment_transactions
  for each row execute function set_updated_at();
create index if not exists idx_payment_tx_res on payment_transactions (reservation_id);
create unique index if not exists uq_payment_tx_payment on payment_transactions (payment_id) where payment_id is not null;

-- ============================================================
--  payment_webhook_events (idempotência)
-- ============================================================
create table if not exists payment_webhook_events (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null default 'mercadopago',
  event_key     text not null,       -- chave idempotente (ex.: payment id + type)
  signature_ok  boolean not null,
  processed     boolean not null default false,
  payload       jsonb,
  received_at   timestamptz not null default now(),
  unique (provider, event_key)
);

-- ============================================================
--  admin_users (autenticação do painel — hash, nunca senha pura)
-- ============================================================
create table if not exists admin_users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  password_hash text not null,
  role          text not null default 'admin' check (role in ('admin','owner')),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ============================================================
--  notification_logs (mensagens enviadas)
-- ============================================================
create table if not exists notification_logs (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid references reservations(id) on delete set null,
  channel        text not null default 'email',
  template       text not null,
  recipient      text,
  status         text not null default 'queued',
  error_message  text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_notif_res on notification_logs (reservation_id);

-- ============================================================
--  audit_logs (ações administrativas relevantes)
-- ============================================================
create table if not exists audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor       text,
  action      text not null,
  entity      text,
  entity_id   text,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_created on audit_logs (created_at desc);
