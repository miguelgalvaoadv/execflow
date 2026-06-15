# Case Workspace Read Foundation — Implementation Report

**Date:** 2026-05-27  
**Scope:** Read-only HTTP APIs oriented to the execution case. No frontend, engine, OCR, extraction, or snapshot changes.

---

## Summary

Six GET endpoints now expose the minimum data layer for a Case Workspace UI. All require **auth + org**; read access requires **assistant+** (`canViewCases`). Client LGPD fields require **lawyer+** (`canAccessSensitiveData`).

**Tests:** 5/5 passing — `pnpm --filter @execflow/api test:case-read`

---

## 1. Endpoints created

| Method | Path | RBAC | Service |
|--------|------|------|---------|
| `GET` | `/api/v1/cases/:id` | assistant+ | `getExecutionCaseDetail` |
| `GET` | `/api/v1/clients/:id` | assistant+ | `getClientDetail` |
| `GET` | `/api/v1/cases/:caseId/timeline` | assistant+ | `listCaseTimeline` |
| `GET` | `/api/v1/cases/:caseId/documents` | assistant+ | `listCaseDocuments` |
| `GET` | `/api/v1/cases/:caseId/opportunities` | assistant+ | `listCaseOpportunities` |
| `GET` | `/api/v1/cases/:caseId/deadlines` | assistant+ | `listCaseDeadlines` |

**Query params (list endpoints):** `limit` (1–200, default 50), `cursor` (opaque string)

**List response envelope:**

```json
{
  "data": [ /* items */ ],
  "nextCursor": "2026-05-27T12:00:00.000Z" | null
}
```

**Single-resource envelope:**

```json
{ "data": { /* resource */ } }
```

---

## 2. Payloads returned

### GET `/cases/:id`

Full `execution_cases` row plus embedded client summary (single JOIN — no N+1):

```json
{
  "data": {
    "id": "uuid",
    "organizationId": "uuid",
    "clientId": "uuid",
    "internalRef": "EXE-2024-0042",
    "executionProcessNumber": null,
    "originProcessNumber": null,
    "courtName": null,
    "courtJurisdiction": null,
    "caseKind": "primary",
    "parentExecutionCaseId": null,
    "status": "active",
    "responsibleLawyerUserId": "uuid",
    "sentenceSummary": null,
    "openedAt": "2026-01-15T00:00:00.000Z",
    "closedAt": null,
    "closedReason": null,
    "processNumberPendingSince": null,
    "createdAt": "...",
    "createdByUserId": "uuid",
    "updatedAt": "...",
    "deletedAt": null,
    "clientSummary": {
      "id": "uuid",
      "fullName": "Nome do apenado",
      "displayName": null
    }
  }
}
```

### GET `/clients/:id`

`ClientReadView` — ISO date strings for timestamps:

| Field | assistant | lawyer+ |
|-------|-------------|---------|
| `id`, `fullName`, `displayName`, `aliases`, `internalRef`, `responsibleLawyerUserId`, `notes`, `status`, `createdAt`, `updatedAt` | ✓ | ✓ |
| `cpf`, `rg`, `birthDate`, `contactChannels` | hidden | ✓ |

### GET `/cases/:caseId/timeline`

Array of full `timeline_events` rows. **Visibility filter:**

- **assistant:** `internal`, `both`
- **lawyer/admin:** `legal`, `internal`, `both`

Ordered by `occurredAt` ASC. Cursor: ISO timestamp of last item.

### GET `/cases/:caseId/documents`

Array of `CaseDocumentsListItem` (metadata only — no `storageKey`, no `checksumSha256`):

`id`, `fileName`, `mimeType`, `byteSize`, `status`, `ocrStatus`, `documentClass`, `sensitivityLevel`, `sourceChannel`, `uploadedAt`, `confirmedAt`, association IDs, timestamps.

Ordered by `uploadedAt` DESC. Cursor: `{uploadedAt}|{id}`.

### GET `/cases/:caseId/opportunities`

Full `opportunities` rows for the case. Ordered by `detectedAt` DESC. Cursor: ISO timestamp.

### GET `/cases/:caseId/deadlines`

Full `deadlines` rows for the case. Ordered by `dueAt` ASC (soonest first). Cursor: ISO timestamp.

---

## 3. Architecture

```
Route (Zod validation + RBAC)
    ↓
Read service (permissions, case existence check)
    ↓
Repository (org-scoped query, pagination)
    ↓
PostgreSQL
```

**Files added/updated:**

| Layer | Files |
|-------|-------|
| Repositories | `execution-case.ts` (`findCaseDetailById`), `document.ts` (`listDocumentsByCase`), `timeline-event.ts` (visibility filter), `deadline.ts`, `opportunity.ts` |
| Services | `case-read.ts`, `client-read.ts`, `case-workspace-read.ts` |
| Routes | `cases.ts`, `clients.ts`, `timeline.ts`, `case-workspace-read.ts` |
| Shared | `read-context.ts`, `pagination-schemas.ts` |
| Tests | `case-workspace-read.test.ts`, `case-workspace-read-fixture.ts` |

**Case existence:** List endpoints return `404` if the case ID is missing or belongs to another org (not an empty list).

**Write contracts:** Unchanged — all existing POST routes and response shapes preserved.

---

## 4. Gaps remanescentes para o primeiro Case Workspace

| Gap | Impacto |
|-----|---------|
| `GET /api/v1/cases` (lista org-wide) | Nav `/cases` continua stub |
| `GET /api/v1/documents/:id` | Sem detalhe/peça individual |
| Download URL para blob | Sem visualização de PDF |
| `GET /cases/:id/snapshots` | Facts atuais (sentence/custody) não listados |
| `GET /opportunities/:id` + review history | Sem painel de qualificação in-case |
| `GET /deadlines/:id` + history | Sem detalhe de prazo |
| OCR text na revisão | Side-by-side extraction review |
| Responsible lawyer / user display names | IDs only — sem join em `users` |

---

## 5. APIs ainda ausentes (pós-read foundation)

| Endpoint | Prioridade UI |
|----------|---------------|
| `GET /api/v1/cases` | Alta — lista de execuções |
| `GET /api/v1/documents/:id` | Alta — detalhe de peça |
| `GET /api/v1/cases/:id/snapshots/current` | Alta — header aritmético |
| `GET /api/v1/opportunities/:id` | Média — ações qualify/dismiss |
| `GET /api/v1/deadlines/:id` | Média — acknowledge/complete |
| Presigned download | Alta — visualizar documento |
| `GET /api/v1/users/:id` (minimal) | Baixa — nomes no header |

---

## 6. O que a UI pode construir agora

Com `executionCaseId` (fila ou URL):

1. **Header** — `GET /cases/:id` + `GET /clients/:id`
2. **Timeline tab** — `GET /cases/:id/timeline`
3. **Documents tab** — `GET /cases/:id/documents`
4. **Opportunities tab** — `GET /cases/:id/opportunities`
5. **Deadlines tab** — `GET /cases/:id/deadlines`
6. **Engine tab** — já existente: `GET /engine/runs?caseId=`
7. **Queue panel** — já existente: `GET /queue-projections?executionCaseId=`
8. **Review flows** — já existentes: extraction + snapshot review APIs

---

## 7. Runtime validation

```powershell
$env:MIGRATION_TEST_DATABASE_URL="postgresql://execflow:execflow@localhost:5432/execflow"
pnpm --filter @execflow/api test:case-read
```

**Coverage:**

- Case detail + client summary join
- LGPD field filtering (assistant vs lawyer)
- All four case-scoped lists
- 404 for unknown case
- Timeline cursor pagination

---

## Conclusão

O backend **read foundation** para Case Workspace está disponível. A primeira tela operacional de advogado pode ser construída consumindo estes endpoints + engine runs + queue projections + review APIs — sem depender de agregações ad-hoc ou writes para leitura.

Próximo desbloqueio natural: **`GET /cases` (lista)** e **`GET /cases/:id/snapshots/current`** para completar header e facts processuais.
