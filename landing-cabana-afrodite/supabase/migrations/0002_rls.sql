-- ============================================================
--  RLS — negação por padrão. Todo acesso de dados passa pelas
--  Netlify Functions usando a SERVICE ROLE KEY (que ignora RLS).
--  A chave ANON (pública) NÃO deve ler/escrever estas tabelas.
-- ============================================================

alter table settings                  enable row level security;
alter table pricing_rules             enable row level security;
alter table special_periods           enable row level security;
alter table reservations              enable row level security;
alter table reservation_guests        enable row level security;
alter table reservation_status_history enable row level security;
alter table manual_blocks             enable row level security;
alter table ical_imported_events      enable row level security;
alter table ical_sync_logs            enable row level security;
alter table payment_transactions      enable row level security;
alter table payment_webhook_events    enable row level security;
alter table admin_users               enable row level security;
alter table notification_logs         enable row level security;
alter table audit_logs                enable row level security;

-- Sem policies permissivas => anon/authenticated ficam sem acesso (deny-all).
-- A service role ignora RLS e é usada apenas no backend/Functions.
-- Se futuramente o painel usar Supabase Auth diretamente, adicionar policies
-- específicas por role aqui (ex.: admin_users lê/edita via JWT com claim de admin).
