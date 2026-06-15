# Document Central — Implementation Report

**Date:** 2026-05-27  
**Scope:** Operational Document Central at `/documents` + `/documents/[documentId]`  
**Plan reference:** Central Documental EXECFLOW — Fases 1–3 (read-only)

---

## Summary

`/documents` is now an operational read-only surface for browsing org-wide documents. Backend exposes `GET /api/v1/documents` (list) and `GET /api/v1/documents/:id` (detail aggregate). Frontend reuses Cases/Clients patterns with operational PT labels for pipeline states. Case Workspace Documentos tab links to document detail and uses the same labels.

**Out of scope (as requested):** upload UI, OCR UI, extraction review UI, snapshot review UI, download.

---

## 1. Files changed

### Backend

| File | Change |
|------|--------|
| `apps/api/src/repositories/document.ts` | Added `listDocumentsForOrg`, cursor encode/decode, LEFT JOIN cases |
| `apps/api/src/services/document-read.ts` | **New** — `listDocumentsForOrg`, `getDocumentDetail` |
| `apps/api/src/routes/documents.ts` | Added `GET /`, `GET /:id`; reordered routes (`/:id/extraction` before `/:id`) |
| `apps/api/src/__tests__/document-list.test.ts` | **New** — 8 integration tests |
| `apps/api/src/__tests__/fixtures/document-list-fixture.ts` | **New** — multi-document fixture |
| `apps/api/package.json` | Added `test:document-list` |

### Frontend

| File | Change |
|------|--------|
| `apps/web/src/lib/operational/document-display.ts` | **New** — PT labels for document/OCR/extraction/snapshot states |
| `apps/web/src/lib/hooks/use-documents.ts` | **New** — `useInfiniteQuery` for org list |
| `apps/web/src/lib/hooks/use-document.ts` | **New** — document detail hook |
| `apps/web/src/lib/query-keys.ts` | Added `documents(orgId, filters?)`, `document(orgId, documentId)` |
| `apps/web/src/app/(app)/documents/page.tsx` | Replaced placeholder with full listing UI |
| `apps/web/src/app/(app)/documents/[documentId]/page.tsx` | **New** — read-only document profile |
| `apps/web/src/app/(app)/cases/[caseId]/page.tsx` | Documentos tab: labels + links to `/documents/:id` |
| `apps/web/src/components/dashboard/nav-items.ts` | `documents` marked `implemented: true` |

---

## 2. API contract

### `GET /api/v1/documents`

**RBAC:** `assistant+` (`canViewCases`)

| Param | Type | Notes |
|-------|------|-------|
| `limit` | int 1–200 | Default 50 |
| `cursor` | string | `{uploadedAt ISO}:{uuid}` |
| `status` | enum | `document_status` values |
| `documentClass` | string | Exact match |
| `q` | string | ILIKE on `fileName`, `documentClass`, case `internalRef` |

**Response:** `{ data: [...], nextCursor }`

**Ordering:** `uploaded_at DESC`, `id DESC`

### `GET /api/v1/documents/:id`

**RBAC:** `assistant+`

**Response:** Document metadata + optional `clientSummary`, `caseSummary`, `extraction` (latest run + review history), `snapshotPromotion` (latest by source document).

Existing `GET /documents/:id/extraction` unchanged.

---

## 3. Tests executed

| Command | Result |
|---------|--------|
| `pnpm --filter @execflow/api test:document-list` | **8/8 pass** |
| `pnpm --filter @execflow/api test:case-read` | **5/5 pass** |
| `pnpm --filter @execflow/api typecheck` | **pass** |
| `npx tsc --noEmit` (apps/web) | **pass** |
| `pnpm --filter @execflow/web build` | **pass** |

---

## 4. Textual wireframes

### `/documents` — Central Documental

```
┌─────────────────────────────────────────────────────────────────┐
│ OPERACIONAL · Peças                                             │
│ Peças processuais, minutas e documentos protocolados.         │
├─────────────────────────────────────────────────────────────────┤
│ [ Pesquisar: Nome, classe ou ref. do caso… ]                    │
│ [ Status ▼ Todos ] [ Classe: sentenca ]                         │
├─────────────────────────────────────────────────────────────────┤
│ 24 peças                                                        │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ sentenca.pdf              [Confirmado]  27/05/2026 14:30   │ │
│ │ Classe: sentenca · OCR: OCR concluído · Caso: EXE-DOC-001  │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ guia-prisao.pdf           [Em revisão]  26/05/2026 09:15   │ │
│ │ Classe: guia · OCR: OCR concluído                           │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ [ Carregar mais ]                                               │
└─────────────────────────────────────────────────────────────────┘
```

### `/documents/[documentId]` — Detalhe

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Voltar à Central Documental                                   │
│ PEÇA PROCESSUAL · sentenca.pdf                                  │
│ Classe: sentenca · Confirmado · Enviado em 24/05/2026…          │
├─────────────────────────────────────────────────────────────────┤
│ METADADOS — nome, MIME, tamanho, canal, sensibilidade           │
│ ESTADO DOCUMENTAL — Status (Confirmado) [confirmed]             │
│                     OCR (OCR concluído) [completed]             │
│ ASSOCIAÇÕES — Execução → /cases/:id · Cliente → /clients/:id    │
│ EXTRAÇÃO — status, tipo, confiança, histórico de revisão        │
│ PROMOÇÃO DE SNAPSHOT — status, tipo, snapshotId (se existir)    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Residual gaps

| Gap | Notes |
|-----|-------|
| Upload UI | API pronta (`/uploads/*`); sem formulário |
| Download / preview | Sem presigned GET |
| Extraction review actions | `POST /extractions/:id/confirm\|reject` sem UI |
| Snapshot review actions | `POST /snapshots/:id/confirm\|reject` sem UI |
| Filas documentais acionáveis | `/queues` sem filtros `intake_review` / `extraction_review` |
| Cliente → documentos | Sem listagem por cliente |
| Polling pipeline | Status estático até refetch manual |
| `documentClass` filter | Exact match only (não ILIKE) |

---

## 6. Recommended next steps

1. **Upload in-context** — componente reutilizável + botão na tab Documentos do Case Workspace  
2. **Download/preview** — presigned read + viewer PDF  
3. **Extraction review screen** — consumir `GET /documents/:id/extraction` + confirm/reject  
4. **Queue filters** — `extraction_review`, `intake_review`, `snapshot_review` em `/queues` com deep-link  
5. **Pipeline polling** — refetch interval na página de detalhe enquanto OCR/extraction activos  
6. **Client documents tab** — `GET /clients/:id/documents` + UI  

---

## 7. Architecture alignment

- Read-only aggregate in `document-read.ts`; no new business rules or pipeline changes  
- Cursor pagination consistent with Cases/Clients (`{timestamp}:{id}`)  
- Detail reuses existing repos: `findDocumentById`, `findLatestExtractionForDocument`, `listReviewDecisionsForSubject`, `snapshot_promotions` query  
- Operational labels centralised in `document-display.ts` with technical values in debug footnotes on detail page  
