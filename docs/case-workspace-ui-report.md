# Case Workspace UI — Implementation Report

**Date:** 2026-05-27  
**Scope:** First read-only Case Workspace at `/cases/[caseId]`. No backend changes, no mutations, no new endpoints.

**Spec reference:** Auditoria «Projeto — Primeiro Case Workspace EXECFLOW» (read-only MVP).

**Validation:** `npx tsc --noEmit` (apps/web) ✓ · `pnpm --filter @execflow/web build` ✓

---

## Summary

The Case Workspace is live at `/cases/[caseId]`. It reuses the existing dashboard shell and operational patterns from `/queues`. Six tabs fetch data lazily from existing GET APIs. Entry from `/queues` is via link when `executionCaseId` is present.

RBAC is enforced server-side (auth + org + assistant+ on case reads). The UI displays only what the API returns; no lawyer-only actions or sensitive client fields are surfaced in this pass.

---

## 1. Files created

| File | Purpose |
|------|---------|
| `apps/web/src/app/(app)/cases/[caseId]/page.tsx` | Case Workspace page — header, tab state, six read-only tab panels |
| `apps/web/src/components/case-workspace/CaseTabBar.tsx` | Tab navigation (Trabalho, Timeline, Documentos, Oportunidades, Prazos, Motor) |
| `apps/web/src/lib/hooks/use-case.ts` | `GET /api/v1/cases/:id` |
| `apps/web/src/lib/hooks/use-case-timeline.ts` | `GET /api/v1/cases/:caseId/timeline` |
| `apps/web/src/lib/hooks/use-case-documents.ts` | `GET /api/v1/cases/:caseId/documents` |
| `apps/web/src/lib/hooks/use-case-opportunities.ts` | `GET /api/v1/cases/:caseId/opportunities` |
| `apps/web/src/lib/hooks/use-case-deadlines.ts` | `GET /api/v1/cases/:caseId/deadlines` |
| `apps/web/src/lib/operational/queue-display.ts` | Shared display labels (queue types, priority, opportunity types, deadline classes) |

---

## 2. Files modified

| File | Change |
|------|--------|
| `apps/web/src/lib/query-keys.ts` | Added `caseTimeline`, `caseDocuments`, `caseOpportunities`, `caseDeadlines` |
| `apps/web/src/lib/hooks/use-queue-projections.ts` | Optional `enabled`; response type aligned with API (`data`, `nextCursor` only) |
| `apps/web/src/lib/hooks/use-engine-runs.ts` | Optional `enabled`; inline JSON types (avoids `@execflow/db` in Next build) |
| `apps/web/src/app/(app)/queues/page.tsx` | Shared labels; link to `/cases/{executionCaseId}`; item count from `data.length` |
| `apps/web/src/app/(auth)/sign-in/page.tsx` | `Suspense` wrapper for `useSearchParams` (build fix, pre-existing) |

**Backend:** unchanged.

---

## 3. Components reused

| Component / hook | Usage |
|------------------|--------|
| `DashboardLayout` + `Sidebar` | Via `(app)/layout.tsx` — unchanged |
| `DashboardPageHeader` | Case header (eyebrow, title, description) |
| `EmptyState` | Empty tab content |
| `LoadingState` | Session, case, and per-tab loading |
| `OperationalErrorState` | Session, case, and per-tab errors with retry |
| `useSession` | Org scope and auth gate |
| `useQueueProjections` | Tab Trabalho |
| `useEngineRuns` | Tab Motor |
| `apiGet` | All data fetching |
| `surfaces` / `borders` / `text` | Card and tab styling (same as `/queues`) |

---

## 4. Components new

| Component | Location | Notes |
|-----------|----------|--------|
| `CaseTabBar` | `components/case-workspace/CaseTabBar.tsx` | Mirrors filter-tab pattern from `/queues` |
| Tab panels (`TrabalhoTab`, `TimelineTab`, …) | Inline in `[caseId]/page.tsx` | Read-only list cards; no separate files to keep scope minimal |

---

## 5. Tab → API mapping

| Tab | Hook | Endpoint |
|-----|------|----------|
| Trabalho (default) | `useQueueProjections` | `GET /api/v1/queue-projections?executionCaseId=` |
| Timeline | `useCaseTimeline` | `GET /api/v1/cases/:caseId/timeline` |
| Documentos | `useCaseDocuments` | `GET /api/v1/cases/:caseId/documents` |
| Oportunidades | `useCaseOpportunities` | `GET /api/v1/cases/:caseId/opportunities` |
| Prazos | `useCaseDeadlines` | `GET /api/v1/cases/:caseId/deadlines` |
| Motor | `useEngineRuns` | `GET /api/v1/engine/runs?caseId=` |

Tab data is fetched only when the tab is active (`enabled` on hooks), except the case header which loads on mount.

---

## 6. Navigation

- **From `/queues`:** Items with `executionCaseId !== null` render as links to `/cases/{executionCaseId}`.
- **Direct URL:** `/cases/[caseId]` works when authenticated (middleware cookie check + API RBAC).
- **`/cases` list:** Still a stub — no `GET /cases` list endpoint exists.

---

## 7. States implemented

| Layer | Loading | Empty | Error |
|-------|---------|-------|-------|
| Session | ✓ | — | ✓ (no session) |
| Case header | ✓ | — | ✓ + retry |
| Each tab | ✓ | ✓ | ✓ + retry |

---

## 8. Visual gaps (remanescentes)

1. **No breadcrumb** — «Fila → Caso» back navigation not implemented; browser back only.
2. **No pagination UI** — Lists capped at 50; `nextCursor` ignored.
3. **Raw enum labels** — Status, visibility, OCR status shown as API strings (no full PT-BR map).
4. **No detail drill-down** — Documents, opportunities, engine runs are list-only (no `/documents/:id`, run explanation view).
5. **Trabalho tab** — Queue items are not clickable to entity detail (review modals out of scope).
6. **Client panel** — `GET /clients/:id` exists but no client sidebar/card in header.
7. **Responsible lawyer** — `responsibleLawyerUserId` not resolved to a display name.
8. **Motor tab** — No explanation bundle, rule trace, or replay indicator beyond raw fields.
9. **Timeline** — `payload` JSON not expanded; category/type labels not localized.
10. **Mobile** — Tab bar scrolls horizontally; no sticky header or tab persistence in URL.

---

## 9. Recommended next steps

1. **URL-synced tabs** — `?tab=timeline` for shareable deep links and refresh persistence.
2. **Pagination** — «Carregar mais» using `nextCursor` on list tabs.
3. **Client summary card** — Read-only block from `GET /clients/:id` (respect LGPD field filtering).
4. **Document row actions** — Link to future document viewer; wire review when mutations are in scope.
5. **Engine run detail** — Panel using `GET /engine/runs/:id` and `/explanation` (read-only).
6. **Cases index** — When `GET /cases` list API exists, replace `/cases` stub and add sidebar entry.
7. **Enum label maps** — Extend `queue-display.ts` or add `case-display.ts` for status/localized labels.
8. **Review workflows** — Claim/confirm/reject from queue and review layers (requires `apiPost` + modals).

---

## 10. Acceptance criteria

| Criterion | Status |
|-----------|--------|
| Build without errors | ✓ |
| Typecheck without errors | ✓ (`tsc --noEmit`) |
| Navigation from `/queues` | ✓ |
| Loading states | ✓ |
| Empty states | ✓ |
| Error states | ✓ |
| RBAC preserved (server-side) | ✓ |
| No backend changes | ✓ |
