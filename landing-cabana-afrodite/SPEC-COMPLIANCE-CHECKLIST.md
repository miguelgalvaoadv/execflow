# Checklist de conformidade — vs. `SPEC-ORIGINAL.md`

> Atualizado em 27/07/2026. Marca o que está ✅ feito, ⚠️ parcial, ❌ pendente, com
> referência a arquivos. Reavaliar sempre que uma seção grande mudar (ex.: painel admin).

## ✅ Totalmente feito

| Seção | Item | Onde |
|---|---|---|
| 6 | Arquitetura Netlify Functions + Supabase, sem introduzir 2º banco | `netlify.toml`, `src/db/supabase.ts` |
| 7 | Fluxo completo de 32 passos (solicitação→aprovação→pagamento→confirmação) | `src/services/reservation-service.ts` |
| 7 | Nunca confirma só pela URL de retorno (webhook + reconciliação) | `reservation-service.ts` (`processPaymentWebhook`, `reconcileReservation`) |
| 8 | 10 estados + máquina de transições + histórico completo | `src/domain/reservation-state.ts` |
| 9 | Semiaberto `[in,out)`, buffer, anti-sobreposição no front/back/**banco** (exclusion constraint) | `src/domain/availability.ts`, migration `0001_init.sql` |
| 9 | Fuso `America/Sao_Paulo` sem bug de UTC/DST | `src/domain/dates.ts` (testado) |
| 10 | Parser iCal completo + cache/throttle + retry + logs + `.ics` de teste (11 cenários) | `src/ical/parse.ts`, `src/services/ical-sync.ts`, `tests/fixtures/airbnb-sample.ics` |
| 10 | Fail-closed nos pontos críticos (aprovar/pagar/confirmar exigem sync recente) | `src/services/ical-sync.ts` (`requireFreshIcal`), `ICAL_MAX_STALENESS_MINUTES` |
| 11 | `.ics` exportado sem dado pessoal, token imprevisível | `src/ical/generate.ts`, `netlify/functions/ical-export.ts` (token **não regenerável ainda**, ver pendências) |
| 12 | Motor de preços completo (dia da semana, período especial, feriado, taxas, descontos, caução, sinal), sempre em centavos, recalculado em 4 pontos | `src/domain/pricing.ts` |
| 13 | Dados mínimos do hóspede, aceites obrigatórios, sanitização | `src/db/repository.ts` (`GuestData`), `create-reservation.ts` |
| 14 | Checkout Pro, sem cartão no site, assinatura de webhook validada (HMAC conforme doc oficial) | `src/payments/*`, `netlify/functions/mercadopago-webhook.ts` |
| 14 | Idempotência de webhook (evento processado 1x) | `payment_webhook_events`, testado |
| 15 | Expiração configurável; pagamento pós-expiração não confirma sozinho | `expireOverdue()` |
| 16 | Estrutura de cancelamento/reembolso no schema (`refunded`, campos) — reembolso real **não automatizado** (por decisão da spec) | migration `0001_init.sql` |
| 18 | Interface pública preservando design, responsiva, com aceites/erros/loading | `site/booking/*`, testado ponta a ponta |
| 19 | Página de acompanhamento com token imprevisível, sem ID sequencial | `get-reservation.ts` |
| 20 | Templates de mensagem + camada abstrata (dev/Resend) | `src/email/*` — **testado enviando de verdade (Resend)** |
| 21 | Segurança: env vars, `.gitignore`, rate limit, HMAC, RLS, tokens imprevisíveis, sem segredo no código/Git | ver `AUDITORIA-E-TESTE.md` seção G |
| 22 | 14 tabelas migradas no Supabase real, RLS deny-all, FKs, índices | `supabase/migrations/`, verificado no projeto `cabana-afrodite-teste` |
| 23 | `.env.example` completo, validação na inicialização com mensagem clara | `src/config/env.ts` |
| 24 | 100 testes cobrindo praticamente toda a lista da seção 24 | `tests/*.test.ts` |
| 25 | Lint/typecheck/testes/build rodados a cada marco | histórico de commits |

## ✅ Painel administrativo (seção 17) — concluído em 27/07

UI em `site/admin/` (fonte em `raw/admin.{css,js}` + `raw/admin-index.html`), vanilla JS com
a identidade visual da landing. Login por Supabase Auth (sandbox/prod) ou sessão HMAC (mock),
token em `sessionStorage`, 401 devolve ao login. Abas: Reservas · Calendário · Preços ·
Pagamentos · Sincronização · Logs.

| Item da spec | Onde |
|---|---|
| Área protegida por autenticação | `site/admin/` + `src/auth/admin.ts` |
| Calendário mensal com ocupação/bloqueios | aba Calendário (`admin-blocks.ts`) |
| Listar/pesquisar por hóspede/filtrar por status/abrir detalhes | aba Reservas (`admin-reservations.ts`, filtro `search`) |
| Aprovar · recusar | `admin-approve.ts`, `admin-reject.ts` |
| **Cancelar** · **marcar concluída** | `admin-cancel.ts`, `admin-complete.ts` + `cancelReservation`/`completeReservation` |
| **Consultar histórico** | `admin-history.ts` + `listStatusHistory` |
| Bloquear/remover datas manualmente | `admin-block.ts` + `listManualBlocks` |
| **Configurar preços/taxas/hóspedes/mín. noites/descontos/caução/sinal/prazo/parcelamento** | `admin-pricing.ts` + `updatePricingConfig` |
| **Configurar datas especiais** | `admin-special-periods.ts` |
| **Consultar pagamentos** | `admin-payments.ts` |
| Copiar link do `.ics` · **regenerar token** | `admin-ical-token.ts` (token em `settings`, fallback env) |
| Forçar sync do Airbnb · **ver última sync e erros** | `admin-ical-sync.ts`, `admin-sync-status.ts` |
| **Reenviar link de pagamento** | `admin-resend-payment-link.ts` |
| Exportar CSV | `admin-export-csv.ts` |
| **Consultar logs administrativos** | `admin-audit-logs.ts` + `logAudit` (grava em cancel/complete/pricing/períodos/token/reenvio) |
| Nunca alterar silenciosamente para `paid` | confirmação manual exige nota e registra origem `admin` no histórico |

**Verificado ao vivo** (dev-server em modo mock, navegador): login, listagem, aprovar,
cancelar (com histórico e audit log), editar preços (persistidos e refletidos na cotação
pública), criar período especial, bloquear datas (data fica indisponível na API pública),
todas as 6 abas carregando. **111 testes verdes**, typecheck exit 0.

## ⚠️ Parcial (por decisão, documentado)

| Seção | Item | Situação |
|---|---|---|
| 16 | Reembolso | Cancelar uma reserva paga registra valor/observação de reembolso no histórico e sinaliza `requiresManualRefund`. O **estorno real continua manual** no painel do Mercado Pago — a spec exige confirmação administrativa explícita e proíbe estorno automático em teste. |

**Conclusão:** núcleo e painel administrativo agora **completos conforme a spec**. Resta
apenas o que depende do cliente (link iCal do Airbnb, importar o `.ics` no Airbnb,
credenciais de produção do Mercado Pago + domínio).
