# Auditoria técnica + ambiente de teste — Cabana Afrodite

Documento da etapa de auditoria/hardening. **Nenhuma credencial de produção; sem cobranças reais.**

---

## A. Sincronização automática do Airbnb (iCal) — quando ocorre

O serviço consulta o iCal do Airbnb (`AIRBNB_ICAL_URL`) com **cache (5 min)** e
**throttle (mín. 30s entre tentativas por instância)**, nos seguintes momentos:

1. **Periodicamente** — Netlify Scheduled Function `ical-sync-scheduled` (cron `*/30 * * * *`).
2. **Ao consultar disponibilidade** — `checkAvailability()` (respeitando cache).
3. **Antes de criar a solicitação** — `requestReservation()`.
4. **Antes de o admin aprovar** — `approveReservation()`.
5. **Antes de criar a preferência de pagamento** — `createPaymentPreference()`.
6. **Antes de confirmar após o pagamento** — dentro de `processPaymentWebhook()`.
7. **Manualmente** — `POST /api/admin/ical-sync` (força, ignora cache).

Código: `src/services/ical-sync.ts` (`syncAirbnbIcal`, `ensureFreshIcal`) + integração em
`src/services/reservation-service.ts` (`syncIcal()` best-effort).

### Como o sistema reage
| Situação | Comportamento |
|---|---|
| iCal indisponível | timeout (15s) + 1 retry; **mantém o último estado bom** (não apaga eventos); registra erro em `ical_sync_logs`. |
| iCal lento | abortado por timeout; fluxo segue com o cache (fail-safe). |
| Evento alterado | parser resolve por `UID`/`SEQUENCE` (o mais novo vence). |
| Evento cancelado | excluído dos períodos ocupados (`STATUS:CANCELLED`). |
| Nova reserva no Airbnb durante o pagamento | re-sync antes de confirmar → exclusion check detecta → webhook retorna `mismatch` "conflito após pagamento — tratar manualmente". |
| Pagamento aprovado após a data ficar indisponível | **não confirma automaticamente**; sinaliza para análise; pagamento fica registrado para reembolso/tratamento manual. |

> Limitação: o Airbnb pode demorar horas para reimportar o `.ics` do site. Após cada
> confirmação, o painel deve avisar o admin a bloquear a data no Airbnb imediatamente.

---

## B. Prevenção de sobreposição — como funciona

**Camada 1 — banco (atômica):** `supabase/migrations/0001_init.sql`
```sql
alter table reservations add constraint no_overlap_active_reservations
  exclude using gist (during with &&)
  where (status in ('awaiting_payment','payment_pending','paid','confirmed'));
```
`during` é `daterange(check_in, check_out, '[)')` (semiaberto). Duas reservas em status
**bloqueante** não podem ter intervalos que se sobreponham — garantido pelo Postgres.

**Status que BLOQUEIAM:** `awaiting_payment`, `payment_pending`, `paid`, `confirmed`.
**Status que NÃO bloqueiam (liberam a data):** `pending_approval`, `rejected`, `expired`,
`cancelled`, `refunded`, `completed`. Assim, uma reserva recusada/expirada/cancelada libera
as datas para reutilização.

**Camada 2 — serviço (transacional):** `transitionStatus()` verifica conflito com
**reservas bloqueantes + bloqueios manuais + eventos do iCal** antes de virar bloqueante
(cobre o que a constraint de reserva-vs-reserva não cobre). Cobertura de testes:
`tests/overlap.test.ts` (5), `tests/reservation-service.test.ts` (anti-sobreposição, idempotência),
`tests/availability.test.ts`.

---

## C. Checklist — criar Supabase de TESTE (gratuito)

> Não me envie nenhuma chave por mensagem. Você cria o projeto e cola os valores no Netlify.

1. Entre em https://supabase.com → **Sign in** (GitHub) → **New project**.
2. Organização: a sua (ou crie uma). Plano: **Free**.
3. **Nome do projeto:** `cabana-afrodite-teste`.
4. **Database password:** gere uma forte e **guarde no seu gerenciador** (não envie por mensagem).
5. **Região:** `South America (São Paulo)`.
6. Aguarde ~2 min (provisionamento).
7. **Migrations:** SQL Editor → cole e rode, **nesta ordem**:
   `0001_init.sql` → `0002_rls.sql` → `0003_seed_demo.sql` (pasta `supabase/migrations/`).
8. **Seed:** o `0003_seed_demo.sql` já insere preços/DEMO. Ajuste depois pelo painel.
9. **Primeiro admin (Supabase Auth):** Authentication → **Users** → **Add user** →
   e-mail do admin + senha. Use esse e-mail em `ADMIN_EMAIL`.
10. **Valores a copiar** (Project Settings → API):
    - `Project URL` → `SUPABASE_URL` (**público**)
    - `anon public` → `SUPABASE_ANON_KEY` (**público**)
    - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (**SECRETO** — só no Netlify)
11. **Inserir no Netlify:** Site settings → Environment variables (ver seção E).
12. **Desfazer/recriar:** Project Settings → **General** → **Delete project**; recrie repetindo 1–11.
    (Ou apenas re-rode as migrations; `0003` usa `on conflict do nothing`.)

---

## D. Checklist — Mercado Pago **sandbox** (sem produção, sem cobrança real)

Confirmado na doc oficial (jul/2026): Checkout Pro via preferência; webhook validado por
`x-signature` (HMAC-SHA256, manifesto `id:...;request-id:...;ts:...;`); usa `init_point`
com **credenciais de teste**. Nosso adapter usa a API REST oficial (`api.mercadopago.com`);
o SDK oficial `mercadopago` pode ser plugado sem mudar a interface.

1. https://www.mercadopago.com.br/developers → **Suas integrações** → **Criar aplicação**
   (produto: **Checkout Pro**).
2. **Credenciais de teste** (na aplicação → *Credenciais de teste*):
   - `Access Token` (TEST-...) → `MERCADO_PAGO_ACCESS_TOKEN` (**SECRETO**)
   - `Public Key` (TEST-...) → `MERCADO_PAGO_PUBLIC_KEY` (**público**, usado só se necessário)
3. **Webhook de teste:** na aplicação → **Webhooks/Notificações** → URL
   `https://SEU-PREVIEW.netlify.app/api/webhooks/mercadopago`, evento **Pagamentos**.
   Gere a **assinatura secreta** → `MERCADO_PAGO_WEBHOOK_SECRET` (**SECRETO**).
4. **Usuário comprador de teste:** *Suas integrações → sua aplicação → Contas de teste →
   Criar conta* (crie um comprador; opcionalmente um vendedor).
5. **Cartões de teste (Brasil):**
   | Bandeira | Número | CVV | Validade |
   |---|---|---|---|
   | Mastercard | 5480 8328 0103 3311 | 123 | 11/30 |
   | Visa | 4235 6477 2802 5682 | 123 | 11/30 |
   | Amex | 3753 651535 56885 | 1234 | 11/30 |
   | Elo (débito) | 5067 7667 8388 8311 | 123 | 11/30 |
6. **Simular resultado** pelo **nome do titular**:
   - `APRO` → aprovado · `CONT` → pendente · `OTHE`/`FUND`/`SECU` → recusado.
7. Fluxo de teste: aprovar reserva no painel → gerar checkout → pagar com `APRO`
   (aprovado), depois `CONT` (pendente) e `OTHE` (recusado).
8. **Verificar webhook:** logs da function `mercadopago-webhook` (Netlify) devem mostrar
   `outcome: confirmed` (para APRO).
9. **Verificar status:** a reserva vira `confirmed` (APRO), permanece `awaiting_payment`
   (recusado) e o `.ics` do site passa a incluir o período confirmado.
10. **Limitações do sandbox:** Pix/Boleto ficam "pendentes" até pagamento simulado; use
    cartão para o fluxo aprovado completo. Nunca use credenciais de produção nesta etapa.

---

## E. Checklist — Netlify **preview** (deploy de teste)

> Preview da branch `feat/cabana-afrodite-reservas` — **não** publicar no domínio definitivo.

- **Base directory:** `landing-cabana-afrodite`
- **Publish directory:** `landing-cabana-afrodite/site`
- **Functions directory:** `landing-cabana-afrodite/netlify/functions`
- **Build command:** *(vazio)* — o `site/` já está versionado. (Se preferir gerar no build:
  `pip install pillow && python raw/build.py`.)
- **Node:** 20+ (`.nvmrc`/variável `NODE_VERSION=20` se necessário).
- **Redirects/headers/scheduled:** já no `netlify.toml` (raiz do projeto).

Variáveis de ambiente (Site settings → Environment variables):
```
APP_ENV=sandbox
SITE_URL=https://SEU-PREVIEW.netlify.app
TIMEZONE=America/Sao_Paulo
RESERVATION_PAYMENT_EXPIRATION_HOURS=24
AIRBNB_ICAL_URL=<link exportar calendário do Airbnb>   (secreto)
ICAL_EXPORT_TOKEN=<gerar: node -e "console.log(require('crypto').randomBytes(24).toString('hex'))">
MERCADO_PAGO_ACCESS_TOKEN=<TEST-...>       (secreto)
MERCADO_PAGO_PUBLIC_KEY=<TEST-...>
MERCADO_PAGO_WEBHOOK_SECRET=<...>          (secreto)
SUPABASE_URL=<...>
SUPABASE_ANON_KEY=<...>
SUPABASE_SERVICE_ROLE_KEY=<...>            (secreto)
ADMIN_EMAIL=<e-mail do admin no Supabase Auth>
EMAIL_PROVIDER=dev          # troque para "resend" quando tiver a key
EMAIL_API_KEY=              # (secreto, quando usar)
EMAIL_FROM="Cabana Afrodite <reservas@seudominio>"
```
> Em `sandbox`/`production` o login do painel é pelo **Supabase Auth** (não usa
> `ADMIN_PASSWORD_HASH`/`ADMIN_SESSION_SECRET`, que são só do modo `mock` local).

**Deploy preview:** conecte o repositório no Netlify e faça deploy da branch, **ou**
`npx netlify-cli deploy --dir site --functions netlify/functions` (deploy de teste, sem `--prod`).

Testar depois do deploy: (1) landing carrega, (2) responsivo, (3) imagens, (4) formulário,
(5) calendário/datas, (6) consulta de preço, (7) solicitação, (8) painel, (9) aprovação,
(10) checkout sandbox, (11) retorno do pagamento, (12) webhook, (13) acompanhamento, (14) `.ics`.

---

## F. E-mail — opções e estado

Abstração em `src/email/provider.ts` (`dev` | `resend`), templates em `src/email/templates.ts`.
Hoje roda em **dev** (registra o envio; nunca quebra o fluxo). Falha de e-mail é tolerada
(status `failed` no `notification_logs`), sem afetar a reserva.

| Provedor | Plano grátis | Domínio verificado? | Variáveis |
|---|---|---|---|
| **Resend** (recomendado) | ~100 e-mails/dia | Sim, p/ produção | `EMAIL_PROVIDER=resend`, `EMAIL_API_KEY`, `EMAIL_FROM` |
| **Brevo** | ~300 e-mails/dia | Sim, p/ produção | (stub preparado; completar adapter) |

Testar: definir `EMAIL_PROVIDER=resend` + `EMAIL_API_KEY` no Netlify; enviar uma solicitação;
conferir a caixa do e-mail informado. Sem key, cai automaticamente para `dev`.

---

## G. Resultado da auditoria de segurança (verificado no código)

| Item | Status |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` nunca vai ao frontend | ✅ só em `env.ts`/`db/supabase.ts`/`context.ts` (backend) |
| `MERCADO_PAGO_ACCESS_TOKEN` nunca vai ao frontend | ✅ só no adapter/functions |
| `AIRBNB_ICAL_URL` nunca vai ao frontend | ✅ só em `ical-sync`/functions |
| Logs não exibem tokens/segredos | ✅ nenhum `console.log` de segredo |
| Erros não exibem segredos | ✅ mensagens genéricas |
| `.ics` público sem dados pessoais | ✅ `tests/ical-generate.test.ts` |
| Webhook idempotente | ✅ `payment_webhook_events` + testes |
| Reserva não confirma só pela URL de retorno | ✅ só via webhook validado |
| Valor recalculado no backend | ✅ em solicitar/aprovar/preferência/confirmar |
| Nenhuma data confirmada duas vezes | ✅ exclusion constraint + máquina de estados |
| Rotas admin exigem autenticação | ✅ `authenticateAdmin` (Supabase Auth em prod) |
| Rate limiting não confia em header manipulável | ✅ usa `x-nf-client-connection-ip` (borda Netlify) |
| Tokens públicos imprevisíveis | ✅ `randomBytes(24)` base64url (192 bits) |
