# Dashboard MVP — Implementation Report

**Date:** 2026-05-27  
**Scope:** Frontend-only operational dashboard at `/dashboard`  
**Reference:** Dashboard Product Readiness Report (audit 2026-05-27)

---

## Summary

The EXECFLOW home surface is now `/dashboard` (**Início**). It composes existing org-scoped APIs into six operational sections: summary cards, priority queue, week deadlines, document pipeline, recent engine activity, and quick links. No backend, workers, or pipeline changes.

`/queues` remains the full work-queue surface; `/` redirects to `/dashboard`.

---

## 1. Files changed

| File | Change |
|------|--------|
| `apps/web/src/app/(app)/dashboard/page.tsx` | **New** — Dashboard MVP (6 sections) |
| `apps/web/src/app/(app)/page.tsx` | Redirect `/` → `/dashboard` |
| `apps/web/src/components/dashboard/nav-items.ts` | Início href `/queues` → `/dashboard` |
| `apps/web/src/components/dashboard/SummaryMetricCard.tsx` | **New** — summary card with approximate count |
| `apps/web/src/components/dashboard/QueueProjectionRow.tsx` | **New** — queue item row with entity links |
| `apps/web/src/components/dashboard/index.ts` | Export new components |
| `apps/web/src/lib/dashboard/queue-item-href.ts` | **New** — deep-link resolver for queue items |
| `apps/web/src/lib/hooks/use-engine-runs.ts` | Optional `limit` param (4th arg, default 20) |
| `apps/web/src/lib/query-keys.ts` | `engineRuns` key includes `limit` |

---

## 2. APIs consumed (unchanged backend)

| Section | Endpoint(s) | Hook(s) |
|---------|-------------|---------|
| Resumo — Trabalho pendente | `GET /queue-projections` | `useQueueProjections` |
| Resumo — Reviews | `GET /queue-projections?queueType=intake_review\|extraction_review\|snapshot_review` | 3× `useQueueProjections` |
| Resumo — Prazos vencidos | `GET /deadlines?status=overdue` | `useDeadlines` |
| Resumo — Casos activos | `GET /cases?status=active` | `useCases` |
| Fila prioritária | 5× queue types (see below) | 5× `useQueueProjections` |
| Prazos da semana | `GET /deadlines` | `useDeadlines` + client filter (7 days) |
| Pipeline documental | `GET /documents?status=…` ×4 | 4× `useDocuments` |
| Actividade recente | `GET /engine/runs?limit=5` | `useEngineRuns` |
| Header | `GET /me` | `useSession` |

**Priority queue types merged:** `urgent_liberty_risks`, `overdue_deadlines`, `opportunity_review`, `extraction_review`, `snapshot_review` — sorted by `priority ASC`, then `keyDate` / SLA / `createdAt`.

**Count honesty:** Cards show `N` or `50+` when the page hits the fetch limit (50). Reviews card uses `150+` cap (sum of three lists). No invented totals.

---

## 3. Tests executed

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` (apps/web) | **pass** |
| `pnpm --filter @execflow/web build` | **pass** |

---

## 4. Textual wireframes

### `/dashboard` — Início

```
┌─────────────────────────────────────────────────────────────────────┐
│ INÍCIO · {Organização}                                              │
│ Centro operacional · Advogado                                       │
├─────────────────────────────────────────────────────────────────────┤
│ RESUMO OPERACIONAL                                                  │
│ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐       │
│ │ Trabalho   │ │ Reviews    │ │ Prazos     │ │ Casos      │       │
│ │ pendente   │ │ pendentes  │ │ vencidos   │ │ activos    │       │
│ │    12      │ │     8      │ │     3      │ │    24      │       │
│ └────────────┘ └────────────┘ └────────────┘ └────────────┘       │
├─────────────────────────────────────────────────────────────────────┤
│ FILA PRIORITÁRIA                                                    │
│ [Urgente] Riscos à liberdade · HC urgente …        → /cases/…     │
│ [Alta] Prazos vencidos · Manifestação …            → /deadlines/… │
│ [Média] Revisão de extração · sentenca.pdf         → /documents/… │
│ Ver fila completa → /queues                                         │
├──────────────────────────────┬──────────────────────────────────────┤
│ PRAZOS DA SEMANA             │ PIPELINE DOCUMENTAL                  │
│ [Vencido] Contestação …      │ Aguardando extração (2)              │
│ [Aberto] Manifestação …      │ Extração em curso (1)                │
│ Ver todos → /deadlines       │ Em revisão (3) · Confirmado (5+)     │
├──────────────────────────────┼──────────────────────────────────────┤
│ ACTIVIDADE RECENTE           │ ACESSO RÁPIDO                        │
│ evaluate · completed         │ Execuções · Clientes · Peças …     │
│ Incerteza: low · 2 oport.    │ Prazos · Filas                       │
└──────────────────────────────┴──────────────────────────────────────┘
```

### Navigation

```
Sidebar: Início → /dashboard  (was /queues)
/       → redirect /dashboard
/queues → unchanged full queue UI
```

---

## 5. Widgets implemented

| # | Widget | Status |
|---|--------|--------|
| 1 | Summary card — Trabalho pendente | ✅ |
| 2 | Summary card — Reviews pendentes | ✅ |
| 3 | Summary card — Prazos vencidos | ✅ |
| 4 | Summary card — Casos activos | ✅ |
| 5 | Fila prioritária (top 10) | ✅ |
| 6 | Prazos da semana (top 5) | ✅ |
| 7 | Pipeline documental (4 grupos × 3 peças) | ✅ |
| 8 | Actividade recente motor (5 runs) | ✅ |
| 9 | Acesso rápido (5 links) | ✅ |

**Entity deep-links from queue items:**

| `entityType` | Route |
|--------------|-------|
| `Deadline` | `/deadlines/[id]` |
| `Document` | `/documents/[id]` |
| Other + `executionCaseId` | `/cases/[id]` |

---

## 6. Residual gaps

| Gap | Notes |
|-----|-------|
| Approximate counts | No org totals API; `50+` when limit reached |
| Snapshot review UI | Queue links to case; no `/snapshots/[id]` page |
| Minha fila | `assigneeUserId` filter not exposed on dashboard |
| Role-based defaults | Same layout for lawyer/assistant/admin |
| `/queues` filter tabs | Still 5 of 13 queue types; dashboard uses 5 priority types |
| Engine run detail | Links to case, not run explanation drawer |
| URL deep-links on cards | e.g. `/deadlines?status=overdue` not wired in Central |
| `DashboardWorkspace.tsx` | Legacy scaffold unused (replaced by real page) |
| Parallel requests | Dashboard fires ~15 queries on load — acceptable for MVP |

---

## 7. Recommended next steps

1. **Minha fila toggle** — `assigneeUserId={session.user.id}` on priority strip  
2. **Expand `/queues` tabs** — remaining 8 queue types from catalog  
3. **Snapshot review page** — `GET /snapshots/:id` + confirm/reject UI  
4. **Role-based dashboard** — lawyer vs assistant default filters (`office-operating-system.md` §10.6)  
5. **Reuse `QueueProjectionRow`** in `/queues/page.tsx` for consistent deep-links  
6. **Backend counts (optional)** — `GET /dashboard/counts` when approximate counts insufficient  
7. **Remove or wire `DashboardWorkspace`** — delete dead scaffold or merge panel titles  

---

## 8. Architecture alignment

- Queue-first philosophy preserved: priority work visible above centrals  
- No analytics, charts, or vanity org-wide totals  
- Reuses `DashboardLayout`, `WorkspacePanel`, `DashboardPageHeader`, operational states, PT labels from `queue-display`, `deadline-display`, `document-display`  
- Frontend-only; zero backend diff  
