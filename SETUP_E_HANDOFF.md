# ExecFlow — Setup e Handoff

> Documento prático para colocar o ExecFlow de pé. Atualizado após migração de
> Escavador → Jusbrasil como motor único de tribunais.

---

## 1. Estado atual

✅ **O monorepo inteiro compila limpo** (db, engine, api, workers, web).

✅ **Acesso a tribunais via Jusbrasil** (agregador licenciado):
- `packages/workers/src/integrations/jusbrasil-client.ts` — cliente da API Jusbrasil
  (monitoramento por CNJ, consulta de capa/partes/movimentações, download de PDF).
- `apps/api/src/routes/webhooks.ts` → **`POST /api/v1/webhooks/jusbrasil`** —
  recebe movimentações por callback, grava na timeline, dispara detecção de
  oportunidades por IA e notifica por e-mail.
- `crawler-sync.ts` usa **somente o Jusbrasil** (motor único): consulta capa/partes,
  importa movimentações, baixa PDFs disponíveis e cria o monitoramento contínuo.
  Sem `JUSBRASIL_API_KEY` o caso fica como `manual_review` (sem dados falsos).

✅ **Download de autos em PDF** — o sync baixa PDFs quando a resposta do Jusbrasil
traz links, gravando em `documents` (status `confirmed`) para o Claude ler.

✅ **Storage server-side habilitado** (`putObject` no provider S3/R2).

✅ **Claude atualizado** para `claude-sonnet-4-6`; lê os autos ao redigir peças.

✅ **Frontend reformulado** — abas Movimentações/Documentos/Oportunidades/Prazos/Cálculos;
documentos e peças baixáveis; oportunidades futuras com prazo/previsão.

---

## 2. Como subir local (passo a passo)

Pré-requisitos: Node ≥ 20, pnpm ≥ 9, um Postgres (Supabase recomendado).

```bash
# 1. Dependências
pnpm install

# 2. Variáveis de ambiente — copie o modelo e preencha
cp .env.example packages/db/.env.local
cp .env.example apps/api/.env.local
cp .env.example packages/workers/.env.local
cp .env.example apps/web/.env.local
# No mínimo: DATABASE_URL, BETTER_AUTH_SECRET, ANTHROPIC_API_KEY, NEXT_PUBLIC_API_URL.
# (JUSBRASIL_API_KEY/SMTP podem ficar vazios no 1º teste local.)

# 3. Banco: aplicar migrations e popular dados de demonstração
pnpm -F @execflow/db db:migrate
pnpm -F @execflow/db db:seed:demo

# 4. Subir os serviços (3 terminais)
pnpm -F @execflow/api dev        # API   → http://localhost:3001
pnpm -F @execflow/web dev        # Web   → http://localhost:3000
pnpm -F @execflow/workers dev    # Workers (fila pg-boss)
```

---

## 3. ✅ O que depende de VOCÊ (Miguel) — checklist

| # | Item | Onde | Sem isso… |
|---|------|------|-----------|
| 1 | **DATABASE_URL** (Supabase) | `.env.local` (db/api/workers) | nada funciona |
| 2 | **BETTER_AUTH_SECRET** (`openssl rand -base64 32`) | api | login não funciona |
| 3 | **ANTHROPIC_API_KEY** | api/workers | não redige peças |
| 4 | **JUSBRASIL_API_KEY** (contrato com Jusbrasil) | workers/api | sem movimentações reais |
| 5 | **Confirmar endpoints Jusbrasil** com o suporte | `jusbrasil-client.ts` | sync pode falhar |
| 6 | **JUSBRASIL_WEBHOOK_TOKEN** + URL no painel Jusbrasil | api/workers | sem push em tempo real |
| 7 | **SMTP_USER/SMTP_PASS** (senha de app Gmail) | api/workers | sem e-mail de alerta |
| 8 | **STORAGE_PROVIDER=s3** + chaves R2 (produção) | api/workers | autos não persistem em prod |

Consulte `GUIA_JUSBRASIL.md` para o passo a passo completo.

---

## 4. O que ainda NÃO está pronto (próximas fases)

- **Motor de cálculo de pena (LEP)**: hoje o Claude propõe e o advogado confirma.
  O próximo passo seria ingerir o cálculo do SEEU e usar o Claude para conferir.
- **Varredura anual de indulto/comutação (decreto natalino)**: passar todos os
  clientes pelos critérios do decreto de uma vez — feature de alto valor.
- **OCR/extração estruturada**: infra existe, providers são stub.
- **Notificação in-app**: hoje vai por e-mail; falta o feed in-app.

---

## 5. Custos estimados (escritório com ~200 casos)

- **Jusbrasil**: ~R$ 1.000/mês (plano Legal — até 2.000 processos monitorados).
  Confirme o plano exato com o suporte antes de assinar.
- **Claude (Sonnet 4.6)**: ~US$ 1–3 por peça gerada.
- **Hospedagem** (Render + Supabase): ~US$ 30–60/mês.

Estimativa total realista: **R$ 1,5–3 mil/mês** para 200 casos ativos.
