# OCR Pipeline Foundation — Implementation Report

**Date:** 2026-05-27  
**Scope:** Provider-agnostic OCR infrastructure. No extraction, AI, legal reading, or Textract.

---

## Architecture

Event-driven, queue-first pipeline using the existing transactional outbox + pg-boss pattern:

```
document.registered (existing)
        ↓ consumer: handleDocumentRegisteredForOcr
   ocr_run INSERT (status=requested)
        ↓ outbox: ocr.requested
        ↓ consumer: handleOcrRequested → executeOcrRun
   documents.ocr_status: pending → running → completed | failed
        ↓ outbox: ocr.running → ocr.completed | ocr.failed
   document_ocr_results INSERT (append-only raw text)
```

**Packages:**

| Package | Role |
|---------|------|
| `@execflow/ocr` | `OcrProvider` interface + `MockOcrProvider` |
| `@execflow/workers` | Consumers + `ocr/runner.ts` lifecycle |
| `@execflow/db` | `ocr_runs`, `document_ocr_results` tables |

---

## OCR Provider Interface

```typescript
interface OcrProvider {
  readonly id: string
  extractText(document: OcrDocumentInput): Promise<OcrExtractResult>
}
```

**Input:** `documentId`, `organizationId`, `storageKey`, `mimeType`, `fileName`, `byteSize`  
**Output:** `rawText`, `pageCount`, `providerMetadata`

**Initial provider:** `mock` (`OCR_PROVIDER=mock`) — deterministic text for tests.  
**Future:** Textract, Tesseract, etc. implement same interface; worker unchanged.

---

## Lifecycle

| Stage | `ocr_runs.status` | `documents.ocr_status` | Domain event |
|-------|-------------------|------------------------|--------------|
| Schedule | `requested` | `pending` | `ocr.requested` |
| Execute start | `running` | `running` | `ocr.running` |
| Success | `completed` | `completed` | `ocr.completed` |
| Retryable fail | `requested` | `pending` | `ocr.failed` + `ocr.requested` |
| Final fail | `failed` | `failed` | `ocr.failed` |

**Retry policy:** `OCR_MAX_ATTEMPTS` (default 3). Each attempt increments `attempt_count`. Non-retryable `OcrProviderError` fails immediately.

**Idempotency:**
- `ocr_runs` unique on `(document_id, trigger_event_id)` — one run per `document.registered` event
- Completed runs skip re-execution
- `document_ocr_results` unique on `ocr_run_id` — one result per run

---

## Domain events emitted

| Event | When |
|-------|------|
| `ocr.requested` | OCR run scheduled or retry scheduled |
| `ocr.running` | Worker started extraction |
| `ocr.completed` | Raw text persisted |
| `ocr.failed` | Attempt failed (includes `retryable` flag) |

Consumers registered for: `document.registered`, `ocr.requested`.  
`ocr.running` / `ocr.completed` / `ocr.failed` are outbox audit events (no downstream consumers yet).

---

## Tables

### `ocr_runs`

Job lifecycle — mutable status, immutable identity and run_number.

| Column | Purpose |
|--------|---------|
| `document_id`, `run_number` | Re-OCR = new run |
| `status` | requested / running / completed / failed |
| `provider_id` | Which OCR provider executed |
| `attempt_count`, `max_attempts` | Retry tracking |
| `trigger_event_id` | Idempotency anchor (`document.registered` event id) |

### `document_ocr_results`

Append-only OCR output — **never updated or deleted**.

| Column | Purpose |
|--------|---------|
| `raw_text` | Full extracted text (MVP in DB; future `raw_text_ref` to blob) |
| `page_count` | Page count from provider |
| `provider_metadata` | Opaque JSON from provider |
| `extracted_at` | Legal/system timestamp |

Migration: `0009_ocr_pipeline.sql`

---

## Workers

| Queue | Handler |
|-------|---------|
| `document.registered` | `handleDocumentRegisteredForOcr` |
| `ocr.requested` | `handleOcrRequested` |

Eligible MIME types: PDF + common images (`OCR_ELIGIBLE_MIME_TYPES`). Others → `ocr_status=not_applicable`.

---

## Tests

**Run:** `MIGRATION_TEST_DATABASE_URL=... pnpm --filter @execflow/workers test:ocr`

| Test | Validates |
|------|-----------|
| document.registered → ocr.requested | Run + outbox |
| ocr.requested → completed | Result row + events |
| Retry then complete | Failure → retry → success |
| Max attempts → failed | `ocr.failed` + terminal status |
| Idempotent register | Single run per trigger event |
| Ineligible MIME | `not_applicable`, no run |

---

## Future: Extraction layer

1. Consumer on `ocr.completed` schedules **field extraction** (separate from OCR).
2. Reads `document_ocr_results.raw_text` — no re-OCR.
3. Writes to future `document_extractions` with proposed fields.
4. Transitions `document.status` → `extraction_review` (already wired in intake queue consumer).

OCR foundation deliberately stops at raw text persistence.

---

## Future: Claude / AI

1. AI agents consume **confirmed** or **proposed** extraction — never raw OCR directly in legal paths.
2. `provider_metadata` on OCR results can carry model hints without coupling pipeline to Claude.
3. Human-authority-first: OCR → extraction review → confirm before any AI analysis.

---

## Residual risks

1. **Raw text in PostgreSQL** — large documents may need blob offload (`raw_text_ref`) at scale.
2. **Mock provider only** — production requires `OCR_PROVIDER=textract` (or similar) implementation + blob read from `@execflow/storage`.
3. **No automatic re-OCR API** — re-run requires new `document.registered`-equivalent trigger or future admin endpoint (new `run_number`).
4. **pg-boss retry + explicit retry** — failed attempts re-emit `ocr.requested`; monitor for duplicate job processing (mitigated by run status checks).
5. **Extraction queue** — `extraction_review` queue still keyed on `document.status`, not `ocr_status`; wiring extraction phase is next step after field extraction exists.

---

## Files created / modified

**New:** `packages/ocr/`, `packages/db/migrations/0009_ocr_pipeline.sql`, schema `ocr-run.ts`, `document-ocr-result.ts`, `types/ocr-events.ts`, `workers/src/ocr/runner.ts`, `workers/src/consumers/ocr-events.ts`, `workers/src/__tests__/ocr-pipeline.test.ts`, `docs/ocr-pipeline-report.md`

**Modified:** `worker-registry.ts`, `queues/names.ts`, `apply-migrations.ts` (0009), `event-consumer-registry.ts`, `workers/package.json`
