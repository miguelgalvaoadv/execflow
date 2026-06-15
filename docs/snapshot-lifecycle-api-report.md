# Snapshot Lifecycle API — Implementation Report

**Date:** 2026-05-27  
**Scope:** propose → confirm → supersede for SentenceSnapshot and CustodySnapshot (no OCR, upload, extraction, or AI).

---

## Summary

HTTP endpoints now create and confirm snapshots through real application flows, replacing manual inserts and CLI bootstrap scripts for engine evaluation prerequisites.

---

## Files changed / created

### New — API layer

| File | Role |
|------|------|
| `apps/api/src/lib/snapshot-arithmetic.ts` | Server-side `remainingDays` / `percentServed` derivation |
| `apps/api/src/repositories/sentence-snapshot.ts` | Insert, confirm, supersede repository ops |
| `apps/api/src/repositories/custody-snapshot.ts` | Insert, confirm, supersede repository ops |
| `apps/api/src/services/sentence-snapshot.ts` | Propose / confirm / supersede + audit + events |
| `apps/api/src/services/custody-snapshot.ts` | Propose / confirm / supersede + audit + events |
| `apps/api/src/routes/case-snapshots.ts` | `POST /cases/:caseId/*-snapshots` |
| `apps/api/src/routes/sentence-snapshots.ts` | `POST /sentence-snapshots/:id/confirm\|supersede` |
| `apps/api/src/routes/custody-snapshots.ts` | `POST /custody-snapshots/:id/confirm\|supersede` |
| `apps/api/src/__tests__/snapshot-lifecycle.test.ts` | Integration tests |
| `apps/api/src/__tests__/fixtures/snapshot-lifecycle-fixture.ts` | Test DB fixture |

### Modified

| File | Change |
|------|--------|
| `apps/api/src/app.ts` | Mount snapshot routers |
| `apps/api/package.json` | `test:snapshots` script; `pg` devDependency |
| `apps/api/tsconfig.json` | Exclude `src/__tests__` from typecheck |
| `apps/api/scripts/http-engine-flow-validation.ts` | HTTP snapshot bootstrap replaces CLI seed |
| `packages/engine/src/index.ts` | Export `loadCaseFacts` (loader unchanged) |

### Unchanged (still usable, no longer required for HTTP validate)

| File | Notes |
|------|-------|
| `packages/db/src/seed-http-engine-snapshots.ts` | Legacy bootstrap; superseded by HTTP flow |
| `packages/engine/src/snapshots/loader.ts` | **No changes** — same query semantics |

---

## Endpoints

| Method | Path | RBAC | Action |
|--------|------|------|--------|
| `POST` | `/api/v1/cases/:caseId/sentence-snapshots` | assistant+ | Propose sentence snapshot (`status=proposed`) |
| `POST` | `/api/v1/cases/:caseId/custody-snapshots` | assistant+ | Propose custody snapshot (`confirmedByUserId=null`) |
| `POST` | `/api/v1/sentence-snapshots/:id/confirm` | lawyer+ | Confirm proposed sentence snapshot |
| `POST` | `/api/v1/custody-snapshots/:id/confirm` | lawyer+ | Confirm proposed custody snapshot |
| `POST` | `/api/v1/sentence-snapshots/:id/supersede` | lawyer+ | Mark confirmed → superseded; insert replacement (proposed) |
| `POST` | `/api/v1/custody-snapshots/:id/supersede` | lawyer+ | Mark confirmed → superseded; insert replacement (proposed) |

---

## Lifecycle flow

```mermaid
sequenceDiagram
  participant A as Assistant
  participant L as Lawyer
  participant API as Snapshot API
  participant DB as PostgreSQL
  participant Outbox as domain_events

  A->>API: POST /cases/:id/sentence-snapshots
  API->>DB: INSERT status=proposed
  API->>Outbox: sentence.snapshot.proposed

  L->>API: POST /sentence-snapshots/:id/confirm
  API->>DB: UPDATE status=confirmed
  API->>Outbox: snapshot.confirmed

  L->>API: POST /sentence-snapshots/:id/supersede
  API->>DB: UPDATE old→superseded, INSERT replacement proposed
  API->>Outbox: sentence.snapshot.superseded + sentence.snapshot.proposed

  L->>API: POST /sentence-snapshots/:replacementId/confirm
  API->>DB: UPDATE replacement→confirmed
  API->>Outbox: snapshot.confirmed
```

Custody follows the same pattern; confirm emits `custody.snapshot.created` (worker consumer) plus `snapshot.confirmed`.

---

## Domain events emitted

| Operation | Event type(s) | Consumer relevance |
|-----------|---------------|-------------------|
| Sentence propose | `sentence.snapshot.proposed` | Audit / future UI queue |
| Sentence confirm | `snapshot.confirmed` | Engine triggers (generic) |
| Sentence supersede | `sentence.snapshot.superseded`, `sentence.snapshot.proposed` | `handleSentenceSnapshotSuperseded` → recalculation |
| Custody propose | `custody.snapshot.proposed` | Audit |
| Custody confirm | `custody.snapshot.created`, `snapshot.confirmed` | `handleCustodySnapshotCreated` → recalculation |
| Custody supersede | `custody.snapshot.superseded`, `custody.snapshot.proposed` | Audit (replacement confirm emits `custody.snapshot.created`) |

All writes co-commit **entity + AuditLog + DomainEvent** inside `withTx` via `writeAuditAndEvent`.

---

## Design rules enforced

- **Append-only arithmetic:** sentence totals/served/remission/detraction set at INSERT only; confirm/supersede touch lifecycle columns only.
- **Human-authority-first:** confirm and supersede require `requireLawyer` (lawyer+).
- **Auditable:** every transition writes `audit_logs` with actor attribution.
- **Replay-safe:** historical rows preserved; supersede never deletes.
- **Supersede gap:** after supersede, engine loader returns no confirmed sentence until replacement is confirmed (intentional confirmation gate).

---

## Tests

**Run:** `MIGRATION_TEST_DATABASE_URL=postgresql://... pnpm --filter @execflow/api test:snapshots`

| Test | Validates |
|------|-----------|
| Sentence propose → confirm | Arithmetic derivation, `snapshot.confirmed`, engine `loadCaseFacts` |
| Sentence supersede | History preserved (2 rows), `sentence.snapshot.superseded`, loader gap + post-confirm |
| Custody propose → confirm | `custody.snapshot.created`, engine custody facts |
| Custody supersede | `supersededAt` / `supersededBySnapshotId`, replacement requires confirm |
| Double confirm rejected | `VALIDATION` error on second confirm |

**HTTP validation:** `validate:http-engine` step 9 now calls snapshot API instead of `seed-http-engine-snapshots.ts`.

---

## Impact on engine context loading

`packages/engine/src/snapshots/loader.ts` is **unchanged**.

| Snapshot kind | Loader filter | API alignment |
|---------------|---------------|---------------|
| Sentence | `status = 'confirmed'`, `effective_at <= asOf` DESC | Confirm sets `status=confirmed` |
| Custody | `confirmed_by_user_id IS NOT NULL`, `effective_at <= asOf` DESC | Confirm sets `confirmedByUserId` |

**Note:** Custody loader does not filter `superseded_at`; latest confirmed-by-effectiveAt wins. Superseded rows remain in history but newer confirmed replacements take precedence when effectiveAt is later.

---

## Next steps unlocked

1. **Remove CLI dependency** — deprecate `seed-http-engine-snapshots.ts` and update `smoke-runtime-validation.ts` to use HTTP snapshot routes.
2. **UI snapshot review queue** — consume `sentence.snapshot.proposed` / pending custody rows.
3. **Document layer integration** — link `sourceDocumentIds` when upload/extraction exist (fields already supported).
4. **Engine evaluate without seed** — full HTTP path: case → propose → confirm → evaluate (validated by `validate:http-engine`).
5. **List / GET endpoints** — read models for snapshot history and confirmation queue (not in minimal scope).

---

## Verification commands

```bash
pnpm --filter @execflow/api typecheck
MIGRATION_TEST_DATABASE_URL=postgresql://execflow:execflow@localhost:5432/execflow \
  pnpm --filter @execflow/api test:snapshots

# With API running + db:seed:
DATABASE_URL=... API_BASE=http://localhost:3001 \
  pnpm --filter @execflow/api validate:http-engine
```
