# Cabana Afrodite — Sistema de Reservas

Sistema de reservas diretas sobre a landing estática existente. **O design, as imagens
e a landing original foram preservados**; a reserva foi adicionada como uma seção
(`#reservar-online`) apenas na versão publicada (`site/`).

## Arquitetura

| Camada | Tecnologia |
|---|---|
| Frontend | Site estático (`site/`) + widget de reserva (`site/booking/*`) |
| Backend | **Netlify Functions** (TypeScript, `netlify/functions/`) |
| Banco | **Supabase (Postgres)** — migrations em `supabase/migrations/` |
| Pagamento | **Mercado Pago Checkout Pro** (adapter `mock \| sandbox \| production`) |
| Núcleo | Módulos TS puros e testáveis (`src/domain`, `src/ical`, `src/payments`, `src/services`) |

Modo de operação por `APP_ENV`:
- **mock** — repositório em memória + Mercado Pago simulado. Roda sem nenhuma credencial.
- **sandbox** — Supabase + credenciais de TESTE do Mercado Pago.
- **production** — Supabase + credenciais de produção.

## Estrutura

```
landing-cabana-afrodite/
├── site/                      # publicado no Netlify (estático)
│   ├── index.html             # landing + seção de reserva
│   ├── assets/img/            # 102 fotos
│   └── booking/               # booking.css + booking.js (widget)
├── netlify/functions/         # API serverless (14 funções)
├── src/
│   ├── domain/                # dates, money, pricing, availability, reservation-state, tokens
│   ├── ical/                  # parse (Airbnb) + generate (.ics do site)
│   ├── payments/              # signature (webhook MP) + adapter Mercado Pago
│   ├── db/                    # repository (interface) + memory + supabase
│   ├── services/              # reservation-service (fluxo obrigatório)
│   ├── config/                # env + settings (DEMO)
│   └── runtime/               # context (monta o serviço por APP_ENV)
├── supabase/migrations/       # 0001 schema · 0002 RLS · 0003 seed DEMO
├── tests/                     # 67 testes (vitest) + fixtures .ics
├── raw/                       # build.py (gera site) + fontes do widget
├── netlify.toml               # publish=site, functions, redirects /api/*
└── .env.example
```

## Comandos

```bash
npm install            # instala dependências (projeto isolado, fora do pnpm workspace)
npm test               # roda os 67 testes (vitest)
npm run typecheck      # tsc --noEmit (estrito)
npm run build          # typecheck (as functions são empacotadas pelo Netlify/esbuild)
npm run dev            # netlify dev (requer netlify-cli: npm i -g netlify-cli)
python raw/build.py    # regenera site/ e index.html a partir do template + fotos
```

## Rotas da API (`netlify.toml`)

| Rota | Função | Uso |
|---|---|---|
| `POST /api/availability` | availability | disponibilidade + preço |
| `POST /api/reservations` | create-reservation | cria solicitação (pending_approval) |
| `GET /api/reservations/:token` | get-reservation | acompanhamento público |
| `POST /api/pay` | create-preference | gera checkout (após aprovação) |
| `POST /api/webhooks/mercadopago` | mercadopago-webhook | confirmação por webhook |
| `GET /api/calendar/reservations-<TOKEN>.ics` | ical-export | calendário para o Airbnb importar |
| `POST /api/admin/login` | admin-login | sessão do painel |
| `GET /api/admin/reservations` | admin-reservations | listar |
| `POST /api/admin/approve` \| `/reject` \| `/block` | admin-* | ações |
| `POST /api/admin/ical-sync` | admin-ical-sync | força importar o iCal do Airbnb |
| `GET /api/admin/export-csv` | admin-export-csv | exporta CSV |

## Banco de dados (Supabase)

Aplique as migrations na ordem (SQL Editor ou `supabase db push`):

1. `0001_init.sql` — extensões (`pgcrypto`, `btree_gist`), enums, 14 tabelas,
   **exclusion constraint anti-sobreposição** (`no_overlap_active_reservations`).
2. `0002_rls.sql` — RLS deny-all (acesso só via service role no backend).
3. `0003_seed_demo.sql` — dados de DEMONSTRAÇÃO (trocar pelos reais no painel).

## Fluxo de reserva (nunca confia na URL de retorno)

`solicitação → aprovação admin → preferência MP → checkout hospedado → webhook
validado (assinatura + re-consulta na API + conferência de valor/moeda/referência) →
paid → confirmed → período entra no .ics do site`.

Idempotência garantida por `payment_webhook_events`. Anti-sobreposição garantida pela
constraint do Postgres **e** por verificação transacional no serviço.

## Segurança

- Segredos só em variáveis de ambiente (`.env` no `.gitignore`; `.env.example` versionado).
- Webhook MP: assinatura `x-signature` (HMAC-SHA256, manifesto `id:..;request-id:..;ts:..;`).
- Painel: senha em hash **scrypt** (`ADMIN_PASSWORD_HASH`), sessão HMAC (`ADMIN_SESSION_SECRET`).
- Rate limiting nas rotas públicas; validação/sanitização no backend; nunca dados de cartão.
- `.ics` exportado não contém nenhum dado pessoal; token longo e regenerável.
- Preço sempre recalculado no backend (proteção contra adulteração no navegador).

## Gerar o hash da senha do admin

```bash
node -e "import('./netlify/functions/_shared.js').then(m=>console.log(m.hashPassword('SUA_SENHA')))"
# cole o resultado (scrypt$...$...) em ADMIN_PASSWORD_HASH
```

## Publicação no Netlify (IMPORTANTE)

Agora é um **projeto Netlify completo** (não só estático). Publique a **pasta raiz
`landing-cabana-afrodite/`** (base directory), com `publish=site` e
`functions=netlify/functions` — já configurados no `netlify.toml`.
**Não** arraste só a pasta `site/` (isso perderia as Functions).

## Limitações conhecidas

- iCal do Airbnb pode demorar horas para consultar/atualizar — por isso o painel avisa
  o admin para bloquear manualmente a data no Airbnb após cada confirmação.
- Rate limiting é por instância de função (best-effort); para produção pesada, usar
  um store compartilhado (ex.: tabela/Upstash).
- E-mail: por padrão só registra em `notification_logs`; conectar provedor real
  (Resend/SendGrid) via `EMAIL_PROVIDER`/`EMAIL_API_KEY`.
- Reembolso real exige confirmação administrativa explícita (não automatizado).
