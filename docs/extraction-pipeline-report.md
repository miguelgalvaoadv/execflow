# Extraction Pipeline Foundation — Implementation Report

**Date:** 2026-05-27  
**Scope:** Provider-agnostic structured extraction infrastructure. No legal AI, Claude, or document generation.

---

## Architecture

Event-driven, queue-first pipeline mirroring the OCR foundation:

```
ocr.completed (existing OCR runner output)
        ↓ consumer: handleOcrCompletedForExtraction
   extraction_runs INSERT (status=requested)
        ↓ outbox: extraction.requested
        ↓ consumer: handleExtractionRequested → executeExtractionRun
   documents.status: pending_extraction → extraction_running → extraction_review
        ↓ outbox: extraction.running → extraction.review
   document_extraction_results INSERT (append-only structured_data)
        ↓ upsert queue_projections (extraction_review)
   Human review (future API) → confirmExtractionRun
        ↓ outbox: extraction.confirmed + document.confirmed
        ↓ resolve extraction_review queue
   documents.status → confirmed
```

**Packages:**

| Package | Role |
|---------|------|
| `@execflow/extraction` | `ExtractionProvider` interface + `MockExtractionProvider` |
| `@execflow/workers` | Consumers + `extraction/runner.ts` lifecycle |
| `@execflow/db` | `extraction_runs`, `document_extraction_results` tables |

**Design principles:**

- **Provider-agnostic** — worker reads OCR text, calls `ExtractionProvider.extractStructured()`
- **Human-authority-first** — terminal success requires `confirmExtractionRun` (user actor)
- **Auditável** — every transition emits outbox domain events
- **Replay-safe** — idempotent scheduling on `(document_id, trigger_event_id)`
- **Append-only** — results immutable after insert; re-extraction creates new run
- **Deterministic-first** — mock provider derives fields from raw text metadata (no LLM)

---

## Extraction Provider Interface

```typescript
interface ExtractionProvider {
  readonly id: string
  extractStructured(input: ExtractionInput): Promise<ExtractionOutput>
}
```

**Input:** `documentId`, `organizationId`, `extractionType`, `rawText`, `ocrResultId`, `ocrRunId`, `documentClass`  
**Output:** `structuredData`, `confidence`, `providerMetadata`

**Initial provider:** `mock` (`EXTRACTION_PROVIDER=mock`)  
**Future:** Claude, rules engine, hybrid — same interface; worker unchanged.

---

## Lifecycle

| Stage | `extraction_runs.status` | `documents.status` | Domain event |
|-------|--------------------------|--------------------|--------------|
| Schedule | `requested` | unchanged | `extraction.requested` |
| Execute start | `running` | `extraction_running` | `extraction.running` |
| Proposed fields | `review` | `extraction_review` | `extraction.review` |
| Human confirm | `confirmed` | `confirmed` | `extraction.confirmed` + `document.confirmed` |
| Retryable fail | `requested` | unchanged | `extraction.failed` + `extraction.requested` |
| Final fail | `failed` | `pending_extraction` | `extraction.failed` |

**Retry policy:** `EXTRACTION_MAX_ATTEMPTS` (default 3). Retries are event-driven (new `extraction.requested` in outbox).

**Idempotency:**

- `extraction_runs` unique on `(document_id, trigger_event_id)` — one run per `ocr.completed` event
- Runs in `review` / `confirmed` skip re-execution
- `document_extraction_results` unique on `extraction_run_id`

---

## Domain events emitted

| Event | When |
|-------|------|
| `extraction.requested` | Run scheduled or retry scheduled |
| `extraction.running` | Worker started structured extraction |
| `extraction.review` | Structured data persisted; awaiting human review |
| `extraction.confirmed` | Human confirmed proposed fields |
| `extraction.failed` | Attempt failed (includes `retryable` flag) |

Consumers registered for: `ocr.completed`, `extraction.requested`.  
`extraction.running` / `extraction.review` / `extraction.confirmed` / `extraction.failed` are audit events (no downstream consumers yet).

---

## Tables

### `extraction_runs`

Job lifecycle: provider, attempts, OCR linkage (`ocr_run_id`, `ocr_result_id`), confirmation attribution (`confirmed_by_user_id`).

### `document_extraction_results`

Append-only structured output:

| Column | Purpose |
|--------|---------|
| `document_id` | Source document |
| `extraction_run_id` | Parent run (unique) |
| `extraction_type` | Schema discriminator (default `generic`) |
| `structured_data` | JSONB proposed fields |
| `confidence` | `confidence_level` enum |
| `provider_metadata` | Provider-specific audit trail |
| `extracted_at` | When extraction completed |

Migration: `packages/db/migrations/0010_extraction_pipeline.sql`

---

## Queue projections

On `extraction.review`, worker upserts `queue_projections` with:

- `queue_type`: `extraction_review`
- `entity_type`: `Document`
- SLA: 48h (aligned with document.associated consumer)
- Metadata: `extractionRunId`, `documentClass`, `confidence`

On `confirmExtractionRun`, projection is resolved. Also emits `document.confirmed` so existing `handleDocumentConfirmed` remains compatible for replay rebuilds.

---

## Runtime validation

`packages/db/src/validation/extraction-result.ts`:

- `assertExtractionStructuredData` — JSONB must be plain object
- `assertExtractionConfidenceLevel` — must be valid `confidence_level` enum
- `assertDocumentExtractionResultRow` — combined guard at read/write boundaries

Used in `executeExtractionRun` and `confirmExtractionRun`.

---

## Integration tests

```powershell
$env:MIGRATION_TEST_DATABASE_URL="postgresql://execflow:execflow@localhost:5432/execflow"
pnpm --filter @execflow/workers test:extraction
```

Covers:

1. `ocr.completed` → `extraction.requested`
2. Full extraction → `review` + queue projection + structured data
3. Human confirmation → `confirmed` + queue resolved
4. Failure after max attempts
5. Idempotency on `ocr.completed` trigger
6. Retry then complete

---

## Future integration: Snapshots

After `extraction.confirmed`, snapshot loaders can read `document_extraction_results.structured_data` as proposed case facts. Sentence/custody snapshot APIs already exist; wiring would be:

```
extraction.confirmed → (future) snapshot.proposed fields pre-fill
```

No snapshot coupling in this phase — extraction results are document-scoped only.

---

## Future integration: Claude / LLM

Implement `ClaudeExtractionProvider` (or similar) in `@execflow/extraction`:

1. Read `rawText` from `document_ocr_results`
2. Call LLM with schema-constrained prompt
3. Return `structuredData` + `confidence` + token usage in `providerMetadata`

Worker, tables, and review workflow unchanged. Human confirmation remains mandatory (`human-authority-first`).

---

## Residual risks

1. **No confirm API yet** — `confirmExtractionRun` is worker-internal; HTTP endpoint deferred to Phase 5+
2. **Migration 0010** — apply in dev: `pnpm --filter @execflow/db db:migrate`
3. **Dual queue entry** — documents may already be in `extraction_review` from `document.associated` at `pending_extraction`; extraction.review upsert refreshes metadata when OCR completes
4. **Schema evolution** — `extraction_type` is free text; typed schemas per document class need a registry (future)
5. **No LLM guardrails** — mock only; real providers need prompt versioning and output validation

---

## Key files

| File | Purpose |
|------|---------|
| `packages/db/migrations/0010_extraction_pipeline.sql` | Tables + enums |
| `packages/extraction/src/` | Provider interface + mock |
| `packages/workers/src/extraction/runner.ts` | Lifecycle + confirmation |
| `packages/workers/src/consumers/extraction-events.ts` | Event consumers |
| `packages/db/src/types/extraction-events.ts` | Event contracts |
| `packages/db/src/validation/extraction-result.ts` | Runtime validation |
