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

## ⚠️ Parcial

| Seção | Item | Gap |
|---|---|---|
| 11 | Regenerar token do `.ics` pelo admin | Token existe e funciona, mas **não há função para trocá-lo** |
| 16 | Reembolso | Schema pronto, mas **sem função admin para registrar/iniciar** (mesmo que só o mock) |
| 17 | Painel administrativo | **Todas as ações existem como API, nenhuma tem interface visual** — ver pendências |

## ❌ Pendente (achado na auditoria de 27/07)

| Seção | Item | Por quê importa |
|---|---|---|
| 17 | **UI do painel** (login, lista, calendário, detalhes) | Hoje só eu opero via script — cliente não consegue usar sozinho |
| 17 | Cancelar reserva (admin) | Estado `cancelled` existe na máquina, mas nenhuma function aciona |
| 17 | Marcar como concluída (`completed`) | Idem |
| 17 | Consultar histórico de status de uma reserva | `reservation_status_history` é gravado mas nada lê de volta |
| 17 | Configurar preços/taxas/descontos/caução/sinal/parcelamento pelo painel | `pricing_rules` só existe via seed SQL — sem endpoint de update |
| 17 | Configurar períodos especiais/feriados pelo painel | `special_periods` idem — só SQL manual |
| 17 | Consultar pagamentos | Sem endpoint que liste `payment_transactions` |
| 17 | Ver última sincronização do iCal + erros | `ical_sync_logs` gravado mas não exposto |
| 17 | Reenviar link de pagamento | Existe `/api/pay` mas não uma ação admin dedicada com notificação |
| 17 | Consultar logs administrativos (`audit_logs`) | Tabela existe na migration, **nada grava nem lê nela ainda** |

**Conclusão:** o **núcleo/motor** (regras de negócio, segurança, banco, pagamento, e-mail,
iCal) está **completo e testado conforme a spec**. O que falta é majoritariamente a
**camada de operação do admin** — que é exatamente o que vamos construir agora.
