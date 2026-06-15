# Document Layer Event Wiring — Hardening Report

**Date:** 2026-05-27  
**Scope:** Align existing producers and consumers. No OCR, extraction, upload, or AI.

---

## Summary

Three production mismatches blocked the document/intake event mesh from creating queue projections. All are resolved via a shared contract module (`@execflow/db/types` → `document-layer-events.ts`) used by API producers and worker consumers.

---

## Mismatches fixed

### 1. Event type: `intake.bundle_received` → `intake.registered`

| Before | After |
|--------|-------|
| Producer: `intake.bundle_received` | Producer: `intake.registered` |
| Consumer queue: `intake.registered` | Unchanged |

**Canonical:** `intake.registered` (matches queue name, worker registry, and docs).

### 2. Payload field: `bundleId` → `intakeBundleId`

| Before | After |
|--------|-------|
| Producer: `bundleId` | Producer: `intakeBundleId` |
| Consumer: `intakeBundleId` | Parser accepts legacy `bundleId` for replay |

**Also added:** `ref` (display label for queue/task; falls back to `sourceChannel`).

### 3. Status field: `newStatus` vs `status` + extraction queue gate

| Before | After |
|--------|-------|
| Producer: `status: 'pending_extraction'` | Unchanged (correct DB state) |
| Consumer: `newStatus === 'extraction_review'` only | Consumer: `status` in `pending_extraction` **or** `extraction_review` |

**Canonical document status in `document.associated` payload:** `status` (current), `previousStatus` (prior).  
Consumer accepts legacy `newStatus` for replay.

**Queue mapping (pre-OCR):**

| Document status | extraction_review queue |
|-----------------|-------------------------|
| `pending_extraction` | Enter (associated, OCR not run) |
| `extraction_review` | Enter (OCR complete — Phase 5+) |
| Other | No extraction queue entry |

---

## Final contracts

Source of truth: `packages/db/src/types/document-layer-events.ts`

### `intake.registered`

```typescript
{
  intakeBundleId: string      // required
  organizationId: string
  sourceChannel: string
  receivedAt: string          // ISO 8601
  uploaderUserId: string
  status: 'received'
  ref: string                 // queue display label
  hasMissingFields: boolean
  missingFieldCount: number
}
```

### `document.associated`

```typescript
{
  documentId: string
  organizationId: string
  clientId: string | null
  executionCaseId: string | null
  documentClass: string | null
  previousStatus: string
  status: string              // canonical; NOT newStatus
}
```

### `document.confirmed` (consumer ready; producer Phase 5+)

```typescript
{
  documentId: string
  organizationId: string
  previousStatus: string
  status: 'confirmed'
}
```

---

## Event audit table

| Event | Producer | Consumer | Status |
|-------|----------|----------|--------|
| `intake.registered` | `apps/api/src/services/intake.ts` | `handleIntakeRegistered` → intake_review projection + triage task | **Active** |
| `document.registered` | `apps/api/src/services/document.ts` | — | **Future** (search/index) |
| `document.associated` | `apps/api/src/services/document.ts` | `handleDocumentAssociated` → extraction_review projection; delegates engine invalidation | **Active** |
| `document.archived` | `apps/api/src/services/document.ts` | — | **Future** (queue resolve) |
| `document.confirmed` | — (Phase 5+ confirm API) | `handleDocumentConfirmed` → resolve extraction_review | **Future producer** / **Active consumer** |
| `sentence.snapshot.proposed` | `sentence-snapshot.ts` | — | **Future** (review queue UI) |
| `snapshot.confirmed` | sentence + custody confirm | — | **Future** (engine trigger) |
| `sentence.snapshot.superseded` | `sentence-snapshot.ts` | `handleSentenceSnapshotSuperseded` | **Active** |
| `custody.snapshot.proposed` | `custody-snapshot.ts` | — | **Future** |
| `custody.snapshot.created` | `custody-snapshot.ts` | `handleCustodySnapshotCreated` | **Active** |
| `custody.snapshot.superseded` | `custody-snapshot.ts` | — | **Future** (recalculation mirror) |
| `engine.recalculation.scheduled` | — | — (queue reserved) | **Orphan queue** |

Registry reference: `packages/workers/src/contracts/event-consumer-registry.ts`

---

## Active vs future vs orphan

### Active (producer + consumer aligned)

- `intake.registered`
- `document.associated` (+ engine side-effect via `handleDocumentAssociatedForEngine`)
- `document.confirmed` (consumer only — resolves queues when producer exists)
- `sentence.snapshot.superseded`, `custody.snapshot.created`
- `timeline.event.appended`, `engine.evaluation.requested`, `engine.run.completed` (engine mesh — out of document scope)

### Future (documented, no new functionality added)

- `document.registered`, `document.archived`
- `document.confirmed` producer (extraction confirm)
- `sentence.snapshot.proposed`, `snapshot.confirmed`, `custody.snapshot.superseded`

### Orphan queues (no `boss.work` handler)

- `engine.recalculation.scheduled` — superseded by `engine.evaluation.requested` outbox flow; documented in `queues/names.ts`

---

## Tests

**Run:** `MIGRATION_TEST_DATABASE_URL=postgresql://... pnpm --filter @execflow/workers test:document-events`

| Test | Validates |
|------|-----------|
| `intake.registered` | intake_review projection + intake_triage workflow task |
| `document.associated` + `pending_extraction` | extraction_review projection |
| `document.confirmed` | extraction_review projection → `resolved` |
| Legacy `bundleId` payload | Replay-safe parser alias |

---

## Files changed

| File | Change |
|------|--------|
| `packages/db/src/types/document-layer-events.ts` | **New** — contracts, builders, parsers |
| `packages/db/src/types/index.ts` | Export contracts |
| `apps/api/src/services/intake.ts` | `intake.registered` + canonical payload |
| `apps/api/src/services/document.ts` | Constants + `buildDocumentAssociatedPayload` |
| `packages/workers/src/consumers/intake-events.ts` | Contract parsers + status gate |
| `packages/workers/src/queues/names.ts` | Document orphan queue |
| `packages/workers/src/contracts/event-consumer-registry.ts` | **New** — future/orphan registry |
| `packages/workers/src/bootstrap/worker-registry.ts` | Remove unused import |
| `packages/workers/src/__tests__/document-event-wiring.test.ts` | **New** — integration tests |
| `packages/workers/package.json` | `test:document-events` script |

---

## Residual risks

1. **Register with case at creation** — `registerDocument` with `executionCaseId` sets `pending_extraction` but emits only `document.registered`, not `document.associated`. No extraction_review projection until explicit associate (or future consumer on `document.registered`).

2. **Intake bundle queue resolution** — `handleDocumentAssociated` resolves `intake_review` by `Document` entityId; intake projections use `IntakeBundle` entityId. Bundle-level resolution when all docs are associated is not implemented.

3. **`document.confirmed` producer missing** — consumer is wired; extraction confirm API must emit canonical payload before queue exit works in production.

4. **Historical outbox rows** — events already written as `intake.bundle_received` will not match `intake.registered` queue unless replayed or manually republished. Parser accepts legacy `bundleId`; event **type** mismatch requires one-time backfill or accepting stale pending events.

5. **OCR pipeline** — when implemented, must transition `pending_extraction` → `extraction_review` and re-emit or upsert queue (contract already supports both statuses).

---

## Verification

```bash
pnpm --filter @execflow/db typecheck
pnpm --filter @execflow/api typecheck
pnpm --filter @execflow/workers typecheck

MIGRATION_TEST_DATABASE_URL=postgresql://execflow:execflow@localhost:5432/execflow \
  pnpm --filter @execflow/workers test:document-events
```
