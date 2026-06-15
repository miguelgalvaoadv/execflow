# Snapshot Promotion Pipeline — Implementation Report

**Date:** 2026-05-27  
**Scope:** Connect confirmed document extractions to snapshot lifecycle and engine recalculation. No AI, Claude, or engine modifications.

---

## Architecture

Event-driven promotion pipeline closing the document → engine chain:

```
document.confirmed (from extraction confirm path)
        ↓ handleDocumentConfirmedForSnapshotPromotion
   snapshot_promotions INSERT (requested)
        ↓ outbox: snapshot.promotion.requested
        ↓ handleSnapshotPromotionRequested → executeSnapshotPromotion
   sentence_snapshots | execution_custody_snapshots INSERT (proposed)
        ↓ outbox: snapshot.proposed
   Human review → confirmPromotedSnapshot (future API; worker helper today)
        ↓ outbox: snapshot.confirmed (+ custody.snapshot.created for custody)
        ↓ handleSnapshotConfirmed (sentence)
   invalidateDependencies → scheduleRecalculation
        ↓ outbox: engine.evaluation.requested
        ↓ handleEngineEvaluationRequested → runEvaluation + commitEngineRun
```

**Packages:**

| Package | Role |
|---------|------|
| `@execflow/workers` | Promotion service, consumers, engine hook |
| `@execflow/db` | `snapshot_promotions` table, event contracts, validation |
| `@execflow/engine` | Unchanged — `invalidateDependencies`, `scheduleRecalculation`, `runEvaluation` |

---

## Promotion rules

Rules in `packages/workers/src/snapshot-promotion/rules.ts` — first match wins:

| extractionType | documentClass | Snapshot kind |
|----------------|---------------|---------------|
| `sentence`, `sentenca` | — | sentence |
| `custody`, `certidao_carceraria` | — | custody |
| `generic` | `sentenca`, `acordao`, `despacho` | sentence |
| `generic` | `certidao_carceraria`, `guia_de_execucao` | custody |

No match → promotion skipped (no event).

**Structured data mapping** (`mapper.ts`):

- **Sentence:** reads `structured_data.sentence` (or `fields.sentence`) → arithmetic fields
- **Custody:** reads `structured_data.custody` → `regime`, `notes`

Deterministic defaults when fields absent (sentence: 3650/0/0/0; custody: `unknown`).

---

## Snapshot types supported

| Kind | Target table | Confirm emits |
|------|--------------|---------------|
| `sentence` | `sentence_snapshots` | `snapshot.confirmed` |
| `custody` | `execution_custody_snapshots` | `snapshot.confirmed` + `custody.snapshot.created` |

Future snapshot types: extend `PROMOTION_RULES` + mapper + propose insert branch.

---

## Promotion record (`snapshot_promotions`)

| Column | Purpose |
|--------|---------|
| `source_document_id` | Confirmed document |
| `extraction_run_id` | Source extraction (unique) |
| `snapshot_id` | Proposed/confirmed snapshot |
| `snapshot_kind` | `sentence` \| `custody` |
| `promoted_by_user_id` | Human from document confirm |
| `promoted_at` | Promotion timestamp |
| `trigger_event_id` | Idempotency on `document.confirmed` |

Migration: `packages/db/migrations/0011_snapshot_promotion.sql`

---

## Domain events

| Event | When |
|-------|------|
| `snapshot.promotion.requested` | Promotion scheduled from confirmed document |
| `snapshot.proposed` | Snapshot row inserted as `proposed` |
| `snapshot.confirmed` | Human confirmed promoted snapshot (reused) |
| `custody.snapshot.created` | Custody confirm only (existing engine consumer) |
| `engine.evaluation.requested` | From `scheduleRecalculation` (existing) |

Consumers registered: `document.confirmed`, `snapshot.promotion.requested`, `snapshot.confirmed`.

---

## Engine integration

Uses existing mechanisms only — no bypass:

1. **`handleSnapshotConfirmed`** — sentence kind only; calls `invalidateDependencies({ dependencyType: 'sentence_snapshot' })` then `scheduleRecalculation`
2. **Custody** — `custody.snapshot.created` from confirm path → existing `handleCustodySnapshotCreated`
3. **Evaluation** — existing `handleEngineEvaluationRequested` → `runEvaluation` + `commitEngineRun`

---

## Runtime validation

- `assertSnapshotKind` / `assertSnapshotPromotionRow` — promotion record guards
- Reuses `assertDocumentExtractionResultRow` before mapping

---

## Integration tests

```powershell
$env:MIGRATION_TEST_DATABASE_URL="postgresql://execflow:execflow@localhost:5432/execflow"
pnpm --filter @execflow/workers test:snapshot-promotion
```

Covers:

1. `document.confirmed` → `snapshot.promotion.requested`
2. Promotion → `snapshot.proposed` + proposed sentence row
3. Full chain: confirm → `snapshot.confirmed` → recalculation → evaluation completed
4. Idempotency on `document.confirmed` trigger

---

## Future integration: Claude

LLM extraction would populate `structured_data.sentence` / `.custody` with richer fields. Promotion rules and mapper unchanged — only extraction provider output evolves. Human confirmation gate remains mandatory.

---

## Residual risks

1. **No HTTP confirm API for promoted snapshots** — `confirmPromotedSnapshot` is worker-internal (mirror extraction confirm gap)
2. **Migration 0011** — apply in dev: `pnpm --filter @execflow/db db:migrate`
3. **Sentence-only engine trigger via `snapshot.confirmed`** — custody uses dual-event path to avoid duplicate recalc
4. **No promotion for documents without `execution_case_id`** — skipped silently
5. **API snapshot propose/confirm still separate** — promotion path parallel to manual API lifecycle

---

## Key files

| File | Purpose |
|------|---------|
| `packages/db/migrations/0011_snapshot_promotion.sql` | Promotion audit table |
| `packages/workers/src/snapshot-promotion/runner.ts` | Request, execute, confirm |
| `packages/workers/src/snapshot-promotion/rules.ts` | Promotion mapping |
| `packages/workers/src/consumers/snapshot-promotion-events.ts` | Event consumers |
| `packages/workers/src/consumers/engine-events.ts` | `handleSnapshotConfirmed` |
| `packages/db/src/types/snapshot-promotion-events.ts` | Event contracts |
