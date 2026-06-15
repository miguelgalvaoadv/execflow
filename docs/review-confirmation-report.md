# Review & Confirmation Layer — Implementation Report

**Date:** 2026-05-27  
**Scope:** Human review and confirmation of extractions and snapshots via HTTP API. No AI, Claude, OCR, extraction pipeline, or engine modifications.

---

## Objective

Give lawyers and assistants **authoritative control** over document intelligence outputs before they affect case facts or engine recalculation. Every approve/reject action is audited, emits domain events, and resolves the corresponding queue projection.

---

## Endpoints

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| `GET` | `/api/v1/documents/:id/extraction` | assistant+ | Extraction payload + review history for a document |
| `POST` | `/api/v1/extractions/:id/confirm` | assistant+ | Approve extraction run (`status: review → confirmed`) |
| `POST` | `/api/v1/extractions/:id/reject` | assistant+ | Reject extraction (reason ≥ 10 chars) |
| `GET` | `/api/v1/snapshots/:id` | assistant+ | Unified snapshot review view (sentence or custody) |
| `POST` | `/api/v1/snapshots/:id/confirm` | lawyer+ | Approve proposed snapshot |
| `POST` | `/api/v1/snapshots/:id/reject` | lawyer+ | Reject proposed snapshot (reason ≥ 10 chars) |

**Request bodies**

```json
// confirm (optional reason)
{ "reason": "Campos validados com a sentença." }

// reject (required reason, min 10 chars)
{ "reason": "Valores inconsistentes com o documento original." }
```

**Response shape:** `{ "data": { ... } }` on success; standard API error envelope on failure.

---

## Operational flow

```mermaid
flowchart TD
  subgraph extraction [Extraction review]
    A[Document in extraction_review queue] --> B[GET /documents/:id/extraction]
    B --> C{Human decision}
    C -->|confirm| D[extraction.confirmed + document.confirmed]
    C -->|reject| E[extraction.rejected]
    D --> F[Resolve extraction_review queue]
    E --> F
    D --> G[Snapshot promotion worker]
  end

  subgraph snapshot [Snapshot review]
    G --> H[snapshot.proposed + snapshot_review queue]
    H --> I[GET /snapshots/:id]
    I --> J{Lawyer decision}
    J -->|confirm| K[snapshot.confirmed]
    J -->|reject| L[snapshot.rejected]
    K --> M[Resolve snapshot_review queue]
    L --> M
    K --> N[Engine recalculation chain]
  end
```

### Extraction confirm path

1. Assistant opens document from `extraction_review` queue.
2. `GET /documents/:id/extraction` returns structured data, confidence, document context, and prior `review_decisions`.
3. `POST /extractions/:id/confirm`:
   - Updates `extraction_runs` → `confirmed`
   - Updates `documents` → `confirmed`
   - Inserts `review_decisions` (`decision: approved`)
   - Emits `extraction.confirmed` + `document.confirmed`
   - Resolves `extraction_review` queue projection

### Extraction reject path

1. Same review GET.
2. `POST /extractions/:id/reject` with reason:
   - Updates `extraction_runs` → `rejected`
   - Updates `documents` → `rejected`
   - Inserts `review_decisions` (`decision: rejected`)
   - Emits `extraction.rejected`
   - Resolves queue — **no snapshot promotion**

### Snapshot confirm path (lawyer)

1. After promotion, item appears in `snapshot_review` queue.
2. `GET /snapshots/:id` resolves sentence or custody snapshot by ID.
3. `POST /snapshots/:id/confirm`:
   - Sentence: `sentence_snapshots.status` → `confirmed`
   - Custody: sets `confirmed_by_user_id` / `confirmed_at`
   - Inserts `review_decisions`
   - Emits `snapshot.confirmed` (+ `custody.snapshot.created` for custody → existing engine consumer)
   - Resolves `snapshot_review` queue

### Snapshot reject path (lawyer)

- Sentence: `status` → `rejected`
- Custody: `rejected_at` / `rejected_by_user_id`
- Emits `snapshot.rejected` — **no engine recalculation**

---

## Queue integration

| Queue type | Entity | Created by | Resolved by |
|------------|--------|------------|-------------|
| `intake_review` | Document | Intake worker | Unchanged — triage before OCR |
| `extraction_review` | Document | Extraction worker on `extraction.review` | API confirm/reject |
| `snapshot_review` | SentenceSnapshot / CustodySnapshot | Snapshot promotion on `snapshot.proposed` | API confirm/reject |

Queue projections remain **write-only from workers** except status transition to `resolved` via `resolveQueueProjection()` in the API layer after human decision.

Web UI queue page includes labels for `extraction_review` and `snapshot_review`.

---

## RBAC

| Action | Minimum role | Rationale |
|--------|--------------|-----------|
| View extraction / snapshot review | assistant | Operational prep and triage |
| Confirm / reject extraction | assistant | Assistants validate fields; lawyers retain snapshot authority |
| Confirm / reject snapshot | lawyer | Snapshot affects case facts and engine — lawyer authority boundary |

Enforced at route middleware (`requireMinRole`, `requireLawyer`) and service layer (`resolveMembershipRole` + `hasMinRole`).

---

## Audit trail

### `review_decisions` table (append-only)

| Column | Purpose |
|--------|---------|
| `reviewer_user_id` | Who decided |
| `reviewed_at` | When |
| `decision` | `approved` \| `rejected` |
| `reason` | Human justification (required on reject) |
| `subject_type` | `extraction` \| `snapshot` |
| `subject_id` | Extraction run ID or snapshot ID |

Also written on every action:

- `audit_logs` — entity state transition with reason
- `domain_events` — event-sourced chain for downstream workers

### Domain events

| Event | Trigger |
|-------|---------|
| `extraction.confirmed` | Extraction approved |
| `extraction.rejected` | Extraction rejected |
| `document.confirmed` | Extraction approved (existing promotion trigger) |
| `snapshot.confirmed` | Snapshot approved |
| `snapshot.rejected` | Snapshot rejected |

---

## Impact on snapshots

- **Extraction confirm** → unchanged promotion pipeline (`document.confirmed` → `snapshot.proposed`).
- **Extraction reject** → promotion never runs; document stays terminal `rejected`.
- **Snapshot confirm** → same lifecycle as existing sentence/custody confirm paths; custody still emits `custody.snapshot.created` for engine.
- **Snapshot reject** → proposed snapshot marked rejected; no supersede, no engine run.

Promotion worker now upserts `snapshot_review` queue when proposing a snapshot so lawyers see items in the operational queue.

---

## Impact on engine

**No engine code changes.**

| Path | Engine effect |
|------|---------------|
| Extraction confirm → promotion → snapshot confirm | Existing chain: `snapshot.confirmed` → invalidate → `engine.evaluation.requested` |
| Extraction reject | None |
| Snapshot reject | None |

Human rejection is a hard stop before facts enter the deterministic engine.

---

## Database migration

Apply: `pnpm --filter @execflow/db db:migrate`

Migration `0012_review_layer.sql`:

- Enum values: `rejected` on extraction/document/snapshot status; `snapshot_review` queue type
- Table `review_decisions`
- Custody snapshot rejection columns (`rejected_at`, `rejected_by_user_id`)

---

## Runtime validation

Integration tests against disposable PostgreSQL (`MIGRATION_TEST_DATABASE_URL`):

```powershell
$env:MIGRATION_TEST_DATABASE_URL="postgresql://execflow:execflow@localhost:5432/execflow"
pnpm --filter @execflow/api test:review
```

**Coverage (5/5 passing):**

1. Approve extraction — audit, events, queue resolved
2. Reject extraction — reason, events, terminal states
3. Approve snapshot — unified API, `snapshot.confirmed`
4. Reject snapshot — `snapshot.rejected`
5. RBAC — assistant blocked from snapshot confirm

---

## Key files

| File | Purpose |
|------|---------|
| `packages/db/migrations/0012_review_layer.sql` | Schema + enums |
| `packages/db/src/schema/review-decision.ts` | Drizzle schema |
| `apps/api/src/services/extraction-review.ts` | Extraction review logic |
| `apps/api/src/services/snapshot-review.ts` | Unified snapshot review |
| `apps/api/src/routes/extractions.ts` | Confirm/reject routes |
| `apps/api/src/routes/snapshots.ts` | GET/confirm/reject routes |
| `apps/api/src/routes/documents.ts` | GET extraction review |
| `apps/api/src/repositories/review-decision.ts` | Audit persistence |
| `apps/api/src/repositories/queue-projection.ts` | `resolveQueueProjection` |
| `packages/workers/src/snapshot-promotion/runner.ts` | `snapshot_review` queue upsert on propose |
| `apps/api/src/__tests__/review-confirmation.test.ts` | Integration tests |

---

## Next unlocks

1. **Review UI screens** — document extraction panel + snapshot diff view wired to these endpoints (queues page already lists items).
2. **Side-by-side review** — show OCR text next to structured fields for lawyer verification.
3. **Re-submission flow** — rejected extraction → re-upload or manual correction path.
4. **Notification hooks** — alert responsible lawyer when snapshot lands in `snapshot_review`.
5. **Metrics** — time-in-queue SLA for extraction vs snapshot review.
6. **Bulk review** — batch confirm for low-risk document classes (with lawyer policy gates).

---

## Residual risks

1. **Migration 0012** must be applied in all environments before deploying API.
2. **Dual confirm paths** — legacy sentence/custody confirm routes still exist; unified `/snapshots/:id/*` is the review surface; consider deprecating duplicates in a follow-up.
3. **Custody status model** — custody snapshots infer `proposed`/`confirmed`/`rejected` from columns; sentence uses explicit `status` enum.
4. **No HTTP E2E script yet** — integration tests cover service layer; optional `scripts/http-review-validation.ts` for live stack smoke.
