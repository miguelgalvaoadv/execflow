# Deadline Central — Implementation Report

**Date:** 2026-05-27  
**Scope:** Operational Deadline Central at `/deadlines` + `/deadlines/[deadlineId]`  
**Plan reference:** Central de Prazos EXECFLOW — Fases 1–5

---

## Summary

`/deadlines` is now an operational surface for browsing org-wide deadlines, viewing detail and history, and executing lifecycle actions (acknowledge, complete, dismiss) against existing API endpoints. No workers, SLA engine, or deadline lifecycle rules were changed. Case Workspace **Prazos** tab links to deadline detail and uses the same PT operational labels and visual accents.

**Out of scope (as requested):** recurrence UI, due-date edit, priority edit, notifications, dashboard widgets, future integrations.

---

## 1. Files changed

### Backend

| File | Change |
|------|--------|
| `apps/api/src/repositories/deadline.ts` | Added `listDeadlinesForOrg` with filters, cursor pagination (`dueAt ASC`, `id ASC`); cursor uses `{iso}|{uuid}` format with subquery-based tuple comparison to avoid timestamp precision drift |
| `apps/api/src/repositories/deadline-history.ts` | `queryDeadlineHistory` scoped by `organizationId` + `deadlineId` |
| `apps/api/src/services/deadline-read.ts` | **New** — `listDeadlinesForOrg`, `getDeadlineDetail`, `listDeadlineHistory` |
| `apps/api/src/routes/deadlines.ts` | Added `GET /`, `GET /:id/history`, `GET /:id` before existing POST routes |
| `apps/api/src/__tests__/deadline-list.test.ts` | **New** — 8 integration tests |
| `apps/api/src/__tests__/fixtures/deadline-list-fixture.ts` | **New** — 3-deadline fixture |
| `apps/api/package.json` | Added `test:deadline-list` |

### Frontend

| File | Change |
|------|--------|
| `apps/web/src/lib/operational/deadline-display.ts` | **New** — PT labels, filter options, badge/card accent classes |
| `apps/web/src/lib/hooks/use-deadlines.ts` | **New** — infinite query for org list |
| `apps/web/src/lib/hooks/use-deadline.ts` | **New** — detail query |
| `apps/web/src/lib/hooks/use-deadline-history.ts` | **New** — history query |
| `apps/web/src/lib/hooks/use-deadline-mutations.ts` | **New** — acknowledge, complete, dismiss mutations |
| `apps/web/src/lib/query-keys.ts` | Added `deadlines`, `deadline`, `deadlineHistory` keys |
| `apps/web/src/app/(app)/deadlines/page.tsx` | Replaced placeholder with full listing UI |
| `apps/web/src/app/(app)/deadlines/[deadlineId]/page.tsx` | **New** — detail, history, operational actions |
| `apps/web/src/app/(app)/cases/[caseId]/page.tsx` | Prazos tab: PT labels, accents, links to `/deadlines/:id` |
| `apps/web/src/components/dashboard/nav-items.ts` | `deadlines` marked `implemented: true` |

---

## 2. API contract

### `GET /api/v1/deadlines`

**RBAC:** `assistant+`

| Param | Type | Notes |
|-------|------|-------|
| `limit` | int 1–200 | Default 50 |
| `cursor` | string | `{dueAt ISO}|{uuid}` — comparison resolves sort key from DB by id |
| `status` | enum | `open`, `acknowledged`, `overdue`, `completed`, `dismissed` |
| `deadlineClass` | enum | `legal`, `benefit`, `disciplinary`, `calculation`, `internal`, `recurring`, `sla` |
| `priority` | enum | `critical`, `high`, `normal`, `low` |
| `q` | string | ILIKE on `title`, `description`, case `internalRef` |

**Response:** `{ data: [...], nextCursor }`

**Ordering:** `due_at ASC`, `id ASC`

### `GET /api/v1/deadlines/:id`

**RBAC:** `assistant+`

**Response:** Full deadline fields + `caseSummary` (`id`, `internalRef`).

### `GET /api/v1/deadlines/:id/history`

**RBAC:** `assistant+`

**Response:** `{ data: DeadlineHistoryItem[] }` from existing `deadline_history` table (read-only).

### Existing write routes (unchanged)

| Route | RBAC | Notes |
|-------|------|-------|
| `POST /:id/acknowledge` | assistant+ | open/overdue → acknowledged |
| `POST /:id/complete` | assistant+ | non-terminal → completed |
| `POST /:id/dismiss` | lawyer+ | requires `dismissedReason`; overdue also requires `dismissedReasonCode` |

---

## 3. Tests executed

| Command | Result |
|---------|--------|
| `pnpm --filter @execflow/api test:deadline-list` | **8/8 pass** |
| `pnpm --filter @execflow/api test:case-read` | **5/5 pass** |
| `pnpm --filter @execflow/api typecheck` | **pass** |
| `npx tsc --noEmit` (apps/web) | **pass** |
| `pnpm --filter @execflow/web build` | **pass** |

---

## 4. Textual wireframes

### `/deadlines` — Central de Prazos

```
┌─────────────────────────────────────────────────────────────────┐
│ OPERACIONAL · Prazos                                            │
│ Prazos processuais activos e vencidos da organização.           │
├─────────────────────────────────────────────────────────────────┤
│ [ Pesquisar: Título ou ref. do caso… ]                          │
│ [ Status ▼ ] [ Classe ▼ ] [ Prioridade ▼ ]                      │
├─────────────────────────────────────────────────────────────────┤
│ 12 prazos                                                       │
│ ┌─ red accent (Vencido) ─────────────────────────────────────┐ │
│ │ Contestação da pena          25/05/2026 09:00               │ │
│ │ [Vencido] [Crítica] Processual · Caso: EXE-2024-001        │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌─ orange accent (Alta) ──────────────────────────────────────┐ │
│ │ Manifestação inicial         01/06/2026 09:00               │ │
│ │ [Aberto] [Alta] Processual · Caso: EXE-2024-001             │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ [ Carregar mais ]                                               │
└─────────────────────────────────────────────────────────────────┘
```

### `/deadlines/[deadlineId]` — Detalhe + acções

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Voltar à Central de Prazos                                    │
│ PRAZO · Manifestação inicial                                    │
│ Processual · Aberto · Vencimento 01/06/2026 09:00               │
│ [Aberto] [Alta]                                                 │
├─────────────────────────────────────────────────────────────────┤
│ ACÇÕES                                                          │
│ [ Reconhecer ] [ Concluir ] [ Encerrar ]                        │
│   (Encerrar → form motivo + código se vencido; lawyer+ only)    │
├─────────────────────────────────────────────────────────────────┤
│ DETALHES — descrição, classe, status, prioridade, origem        │
│ ASSOCIAÇÕES — Execução → /cases/:id · Responsável               │
│ DATAS — criado, actualizado, reconhecido/concluído/encerrado    │
│ HISTÓRICO — tipo, actor, timestamp, motivo                      │
│   · Reconhecido — user · 27/05/2026 14:22                       │
│   · Marcado como vencido — system · 25/05/2026 00:05            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Operational labels (PT)

| Technical | UI label |
|-----------|----------|
| `open` | Aberto |
| `acknowledged` | Em acompanhamento |
| `overdue` | Vencido |
| `completed` | Concluído |
| `dismissed` | Encerrado |

Visual emphasis: red border/background for **Vencido** and **Crítica**; orange for **Alta** priority.

---

## 6. Residual risks

| Risk | Notes |
|------|-------|
| Cursor timestamp precision | Org list cursor compares via subquery on `id` to avoid ms/µs drift; format remains `{iso}|{uuid}` for API compatibility |
| Overdue sweep scope | Worker only transitions `open` → `overdue` (not `acknowledged`); pre-existing behaviour, not changed |
| Assignee display | Shows raw `assigneeUserId`; no user name resolution yet |
| Dismiss RBAC | Route enforces lawyer+; assistants see no Encerrar button |
| Parallel integration tests | Concurrent test suites against same DB can cause schema reset races; run deadline tests in isolation if flakes appear |
| Org-list cursor in other modules | Documents/Cases/Clients still use `lastIndexOf(':')` on ISO timestamps — latent pagination bug outside this scope |

---

## 7. Recommended next steps

1. **Create deadline in UI** — wire `POST /deadlines` from Case Workspace Prazos tab  
2. **Assignee resolution** — join users for display name on detail and list  
3. **Queue deep-link** — `/queues?type=overdue_deadlines` → pre-filtered Central de Prazos  
4. **Evidence on complete** — optional completion note/evidence when policy requires it  
5. **Real-time refresh** — polling or SSE for overdue transitions while detail page is open  
6. **Fix cursor encoding** — align Documents/Cases/Clients pagination with `|` delimiter + subquery pattern  

---

## 8. Architecture alignment

- Read aggregate in `deadline-read.ts`; writes remain in `deadline.ts` service  
- History is read-only from `deadline_history`; no new write paths  
- Frontend mirrors Documents/Clients patterns: infinite list, detail profile sections, mutation invalidation across org list, detail, history, and case deadlines  
- RBAC respected at route level; UI hides lawyer-only dismiss from assistants  
