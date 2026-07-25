-- ============================================================
--  SEED DE DEMONSTRAÇÃO — valores provisórios (NÃO são reais).
--  Substituir pelos valores reais do cliente via painel administrativo.
-- ============================================================

insert into pricing_rules (
  is_active, default_nightly_cents, weekday_nightly_cents, cleaning_fee_cents,
  included_guests, extra_guest_fee_cents, extra_guest_per, max_guests,
  min_nights, max_nights, min_reservation_cents, flat_discount_percent,
  length_of_stay_discounts, security_deposit_cents, charge_deposit_upfront,
  payment_mode, signal_percent, payment_expiration_hours, max_installments, prep_buffer_nights
) values (
  true, 45000, '{"5":59000,"6":65000}'::jsonb, 15000,
  2, 8000, 'night', 4,
  2, 30, 45000, 0,
  '[{"minNights":5,"percent":5},{"minNights":7,"percent":10}]'::jsonb, 30000, false,
  'full', 30, 24, 12, 0
)
on conflict do nothing;

insert into settings (key, value) values
  ('contact', '{"whatsapp":"+5521972887766","email":"reservas@exemplo.com","instagram":"@cabanaafrodite"}'::jsonb),
  ('policies', '{"checkIn":"15:00","checkOut":"11:00","cancellation":"DEMO — não reembolsável; troca de data uma vez até 15 dias antes.","houseRules":"DEMO — não fumantes; silêncio após 22h."}'::jsonb),
  ('special_periods', '[{"id":"demo-reveillon","name":"Réveillon (DEMO)","start":"2026-12-28","end":"2027-01-02","nightlyCents":120000,"minNights":4}]'::jsonb)
on conflict (key) do nothing;

-- Admin de demonstração — DEFINIR hash real via painel/variável antes de produção.
-- (senha nunca em texto puro; este placeholder não autentica)
insert into admin_users (email, password_hash, role)
values ('admin@exemplo.com', 'PLACEHOLDER_TROCAR_POR_HASH_REAL', 'owner')
on conflict (email) do nothing;
