# Case List — Implementation Report

**Date:** 2026-05-27  
**Scope:** Operational case listing at `/cases` + `GET /api/v1/cases`  
**Plan reference:** Auditoria «Listagem de casos EXECFLOW»

---

## Summary

The `/cases` route is now a functional read-only listing surface. Backend exposes paginated, filterable, searchable case lists with client summary embedded via a single JOIN. Frontend consumes the API with infinite scroll pagination («Carregar mais»), session gate, and navigation to the existing Case Workspace.

---

## 1. Files changed

### Backend (created / modified)

| File | Change |
|------|--------|
| `apps/api/src/repositories/execution-case.ts` | Added `listExecutionCases`, types, composite cursor encode/decode |
| `apps/api/src/services/case-read.ts` | Added `listExecutionCasesForOrg`, response DTO mapping |
| `apps/api/src/routes/cases.ts` | Added `GET /` before `GET /:id`; query schema with filters |
| `apps/api/src/__tests__/case-list.test.ts` | **New** — 9 integration tests |
| `apps/api/src/__tests__/fixtures/case-list-fixture.ts` | **New** — multi-case test fixture |
| `apps/api/package.json` | Added `test:case-list` script |

### Frontend (created / modified)

| File | Change |
|------|--------|
| `apps/web/src/lib/hooks/use-cases.ts` | **New** — `useInfiniteQuery` hook |
| `apps/web/src/lib/query-keys.ts` | Extended `cases(orgId, filters?)` |
| `apps/web/src/app/(app)/cases/page.tsx` | Replaced placeholder with full listing UI |

---

## 2. API contract

### `GET /api/v1/cases`

**Auth:** cookie + `X-Organization-Id`  
**RBAC:** `assistant+` (`canViewCases`)

**Query parameters:**

| Param | Type | Notes |
|-------|------|-------|
| `limit` | int 1–200 | Default 50 |
| `cursor` | string | `{updatedAt ISO}:{uuid}` |
| `status` | enum | `intake`, `active`, `suspended`, `closed`, `archived` |
| `courtJurisdiction` | string | Exact match |
| `q` | string | ILIKE on client name, display name, internal ref, process number, court name |

**Response:**

```json
{
  "data": [
    {
      "id": "uuid",
      "internalRef": "EXE-2024-0042",
      "executionProcessNumber": "1234567-89.2024.8.26.0100",
      "status": "active",
      "courtName": "1ª VEP SP",
      "courtJurisdiction": "São Paulo/SP",
      "updatedAt": "2026-05-27T12:00:00.000Z",
      "clientSummary": {
        "id": "uuid",
        "fullName": "Nome do apenado",
        "displayName": null
      }
    }
  ],
  "nextCursor": "2026-05-26T10:00:00.000Z:uuid" | null
}
```

**Ordering:** `updated_at DESC`, `id DESC`

---

## 3. Tests executed

| Command | Result |
|---------|--------|
| `pnpm --filter @execflow/api test:case-list` | **9/9 pass** |
| `pnpm --filter @execflow/api test:case-read` | **5/5 pass** (regression) |
| `pnpm --filter @execflow/api typecheck` | **pass** |
| `npx tsc --noEmit` (apps/web) | **pass** |
| `pnpm --filter @execflow/web build` | **pass** |

### Case list test coverage

1. Org-scoped list with client summary, `updatedAt` desc order  
2. Filter by `status`  
3. Filter by `courtJurisdiction` (exact)  
4. Search `q` (internal ref + client name)  
5. Cursor pagination without overlap  
6. Soft-deleted cases excluded  
7. Invalid cursor rejected  
8. Assistant role allowed  
9. Unknown org returns empty list  

---

## 4. Textual screenshots — final UX

### `/cases` — lista com dados

```
┌─ Execuções ──────────────────────────────────────────────────┐
│ Operacional                                                   │
│ Casos em execução penal da sua organização.                  │
├───────────────────────────────────────────────────────────────┤
│ PESQUISAR          STATUS              COMARCA / UF           │
│ [Nome, ref. ou…]   [Todos os status ▼] [Ex.: São Paulo/SP  ] │
├───────────────────────────────────────────────────────────────┤
│ 3 execuções                                                   │
│ ┌─────────────────────────────────────────────────────────┐  │
│ │ João da Silva                    [ACTIVO]  27/05/26 14:30│  │
│ │ Ref. EXE-003 · 1234567-89.2024… · 2ª VEP SP              │  │
│ └─────────────────────────────────────────────────────────┘  │
│ ┌─────────────────────────────────────────────────────────┐  │
│ │ João da Silva                    [ACTIVO]  26/05/26 14:30│  │
│ │ Ref. EXE-002 · Processo pendente · VEC Campinas          │  │
│ └─────────────────────────────────────────────────────────┘  │
│ [ Carregar mais ]                                             │
└───────────────────────────────────────────────────────────────┘
```

### Loading

```
[ spinner ] Carregando execuções…
```

### Empty (sem filtros)

```
Nenhuma execução
Os casos de execução penal da organização aparecerão aqui.
```

### Empty (com filtros)

```
Nenhum caso encontrado
Nenhum caso corresponde aos filtros actuais.
```

### Error

```
Não foi possível carregar
{mensagem API}
Tentar novamente
```

### Click item → `/cases/[caseId]`

Existing Case Workspace (6 tabs read-only) opens.

---

## 5. Components reused

| Component | Usage |
|-----------|--------|
| `DashboardPageHeader` | Page title |
| `LoadingState` | Session + list loading |
| `EmptyState` | Zero results |
| `OperationalErrorState` | API errors + retry |
| `surfaces` / `borders` / `text` | Card + form styling |
| Card + `Link` pattern | Same as `/queues` |
| `useSession` | Org scope |
| `apiGet` | Data fetch |

---

## 6. Residual risks

| Risk | Severity | Notes |
|------|----------|-------|
| No index on `(org_id, updated_at)` | Low–Med | Acceptable for MVP; add migration at scale |
| `ILIKE` search without trigram index | Low | Fine for hundreds of cases; slow at thousands |
| `courtJurisdiction` exact match only | Low | By design for MVP; no autocomplete |
| Trigger `set_execution_cases_updated_at` | Info | Any case UPDATE resets sort timestamp — expected behaviour |
| Accumulated pages in memory | Low | «Carregar mais» appends; no «reset» beyond filter change (query key invalidates) |
| Status labels PT inline | Low | Not shared with Case Workspace yet |

---

## 7. Product gaps (next steps)

1. **Create case UI** — `POST /cases` exists; no frontend form  
2. **Review workflows** — queue items still not actionable  
3. **Client panel** — list shows client name; no link to `/clients/:id` (page stub)  
4. **URL-synced filters** — filters lost on refresh  
5. **Sort options** — only `updatedAt desc` exposed  
6. **Finance nav 404** — unrelated but still broken in sidebar  
7. **Case creation from list** — lawyer+ action deferred  

---

## 8. Acceptance criteria

| Criterion | Status |
|-----------|--------|
| `GET /api/v1/cases` with cursor pagination | ✓ |
| Filters status, courtJurisdiction, q | ✓ |
| Order updatedAt DESC, id DESC | ✓ |
| RBAC assistant+ | ✓ |
| `/cases` replaces placeholder | ✓ |
| Loading / empty / error states | ✓ |
| Search + basic pagination | ✓ |
| Navigate to `/cases/[caseId]` | ✓ |
| No edit/delete/analytics/dashboard | ✓ |
| Tests + build + typecheck | ✓ |
