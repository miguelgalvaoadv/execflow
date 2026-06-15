# Relatório — Correção P0: Recalculation orchestration loop

**Data:** 2026-05-27  
**Estado:** Implementado e validado (6/6 testes de integração)

---

## 1. Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `packages/engine/src/propagation/recalculation.ts` | TX atómica: `recalculation_runs` + `engine.evaluation.requested` |
| `packages/engine/src/types/index.ts` | `RecalculationRequest`: `causationId`, `jurisdictionScope?` |
| `packages/workers/src/consumers/engine-events.ts` | `parseRelayEnvelope` estendido; lifecycle no consumer; `causationId` nos callers |
| `packages/workers/src/__tests__/recalculation-orchestration.test.ts` | **Novo** — 6 testes de integração |
| `packages/workers/src/__tests__/fixtures/engine-eval-fixture.ts` | **Novo** — fixtures de teste |
| `packages/workers/package.json` | Script `test:orchestration`; devDeps `pg` |
| `packages/workers/tsconfig.json` | Exclui `src/__tests__` do typecheck |

**Não alterados (conforme requisito):**

- `commit-propagation.ts` — propagation pós-commit intacta
- `apps/api/src/routes/engine.ts` — HTTP sync inalterado
- Outbox relay — inalterado
- Replay semantics — inalteradas

---

## 2. Fluxo final (fechado)

```
Upstream domain event (timeline / document / snapshot)
        │
        ▼
[outbox relay] boss.send(event_type)
        │
        ▼
Engine consumer (engine-events.ts)
  → invalidateDependencies()
  → scheduleRecalculation()  ── TX ──┬── INSERT recalculation_runs (scheduled)
                                      └── INSERT domain_events (engine.evaluation.requested)
        │
        ▼
[outbox relay] boss.send('engine.evaluation.requested')
        │
        ▼
handleEngineEvaluationRequested
  → parseRelayEnvelope (payload nested)
  → startRecalculation (scheduled → running)
  → runEvaluation (trigger='recalculation')
  → commitEngineRun (isReplay=false, propagation.correlationId)
  → completeRecalculation (running → completed, produced_engine_run_id)
        │
        ▼
[commit-propagation] opportunity.created + engine.run.completed (inalterado)
```

**Failure path:** `failRecalculation` + `failEngineRun`; status terminal `failed`.

---

## 3. Garantias preservadas

| Princípio | Como preservado |
|-----------|-----------------|
| Append-only | `recalculation_runs` só INSERT + status UPDATE; domain_events imutáveis |
| Replayable | Evaluation determinística; `isReplay: false` em recalculations operacionais |
| Deterministic-first | `runEvaluation` permanece pure-read; commit separado |
| Event-driven | Scheduling emite outbox; worker consome via relay |
| Queue-first | Execução async via pg-boss; sem evaluation inline na API |
| Human-authority-first | HTTP manual continua disponível; async não bypassa lawyer review |
| Causal chain | `causationId` = upstream `eventId`; `correlationId` propagado |

---

## 4. Payload canónico `engine.evaluation.requested`

```json
{
  "recalculationRunId": "<uuid>",
  "executionCaseId": "<uuid>",
  "organizationId": "<uuid>",
  "trigger": "recalculation",
  "triggerEntityType": "<string>",
  "triggerEntityId": "<uuid>",
  "jurisdictionScope": "BR-FED"
}
```

Envelope relay (root): `eventId`, `organizationId`, `correlationId`, `causationId`, `payload`.

---

## 5. Testes (6/6 pass)

Comando: `MIGRATION_TEST_DATABASE_URL=... pnpm --filter @execflow/workers test:orchestration`

| # | Cobertura |
|---|-----------|
| 1 | Schedule → `recalculation_runs` + domain event + causality |
| 2 | Worker → evaluation → commit → `completed` + `producedEngineRunId` |
| 3 | Failure → `failed` + `errorDetails` |
| 4 | Timeline event → invalidate → schedule → domain event |
| 5 | Idempotência — delivery duplicada não cria segundo EngineRun |
| 6 | `invalidateDependencies` integração |

---

## 6. Riscos residuais

| Risco | Severidade | Notas |
|-------|------------|-------|
| `materialChangeDetected` sempre `true` | P2 | Sem detecção no-op; status nunca `skipped` por diff |
| `engine.recalculation.scheduled` órfão em `names.ts` | P3 | Constante legacy; não usada — considerar remoção futura |
| Snapshot upstream sem producers | P1 separado | `sentence.snapshot.superseded` / `custody.snapshot.created` ainda sem API writers |
| Rows `scheduled` pré-deploy | P2 | Migração operacional: reprocessar ou marcar failed manualmente |
| `hasStaleDependencies` morto | P3 | SLA sweep de recalculation ainda não implementado |

---

## 7. Componentes ainda não conectados

- **API producers** para supersession de `SentenceSnapshot` e criação de `CustodySnapshot`
- **Fila `engine.recalculation.scheduled`** — artefacto de design; substituída por `engine.evaluation.requested`
- **`runRecalculation()`** — wrapper disponível; consumer usa `runEvaluation` directamente (equivalente)
- **Material change detection** — `changeSummary` / status `skipped` aguardam comparação EngineRun

---

## 8. Impacto em replay

**Nenhum impacto negativo.**

- Replay (`isReplay: true`) continua sem emitir domain events pós-commit
- Recalculation operacional usa `isReplay: false` explicitamente
- Cadeia async é forward-only; replay histórico não depende de `recalculation_runs`

---

## 9. Impacto em propagation

**Positivo — cadeia completa.**

- Propagation pós-commit (`opportunity.created`, `engine.run.completed`) dispara **após** commit bem-sucedido do worker
- `correlationId` propagado do evento upstream → schedule → evaluation → commit → downstream events
- Invalidation → scheduling → evaluation agora ligados causalmente via outbox

---

## 10. Causa raiz (resolvida)

`scheduleRecalculation` persistia rows `scheduled` sem emitir evento. Consumer existia mas com envelope incompatível e lifecycle nunca fechado.

**Correção:** outbox na mesma TX do schedule + consumer alinhado ao relay + lifecycle `start/complete/fail`.
