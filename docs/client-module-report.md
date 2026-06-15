# Clients Module — Phase 1 & 2 Implementation Report

**Date:** 2026-05-27  
**Scope:** Operational client listing + profile (read-only) + Case Workspace link  
**Plan reference:** Auditoria «Clients Module» — Fase 1 (backend) + Fase 2 (frontend)

---

## Summary

The `/clients` route is now an operational read-only surface equivalent to `/cases`. Backend exposes `GET /api/v1/clients` with cursor pagination, status filter, and text search. Frontend provides list + profile pages with LGPD-respecting display (sensitive fields only when returned by API). Case Workspace links to the client profile when `clientSummary.id` is available.

**Out of scope (as requested):** update, merge, archive, delete, create UI, complex forms.

---

## 1. Files changed

### Backend (created / modified)

| File | Change |
|------|--------|
| `apps/api/src/repositories/client.ts` | Added `listClients`, types, composite cursor encode/decode |
| `apps/api/src/services/client-read.ts` | Added `listClients` service, list DTO mapping |
| `apps/api/src/routes/clients.ts` | Added `GET /` **before** `GET /:id`; query schema with filters |
| `apps/api/src/__tests__/client-list.test.ts` | **New** — 8 integration tests |
| `apps/api/src/__tests__/fixtures/client-list-fixture.ts` | **New** — multi-client test fixture |
| `apps/api/package.json` | Added `test:client-list` script |

### Frontend (created / modified)

| File | Change |
|------|--------|
| `apps/web/src/lib/hooks/use-clients.ts` | **New** — `useInfiniteQuery` for client list |
| `apps/web/src/lib/hooks/use-client.ts` | **New** — single client detail hook |
| `apps/web/src/lib/query-keys.ts` | Added `clients(orgId, filters?)`, `client(orgId, clientId)` |
| `apps/web/src/app/(app)/clients/page.tsx` | Replaced placeholder with full listing UI |
| `apps/web/src/app/(app)/clients/[clientId]/page.tsx` | **New** — read-only client profile |
| `apps/web/src/app/(app)/cases/[caseId]/page.tsx` | Link «Ver perfil do cliente» when `clientSummary.id` present |
| `apps/web/src/components/dashboard/nav-items.ts` | `clients` marked `implemented: true` |

---

## 2. API contract

### `GET /api/v1/clients`

**Auth:** cookie + `X-Organization-Id`  
**RBAC:** `assistant+` (`canViewCases`)

**Query parameters:**

| Param | Type | Notes |
|-------|------|-------|
| `limit` | int 1–200 | Default 50 |
| `cursor` | string | `{updatedAt ISO}:{uuid}` |
| `status` | enum | `active`, `inactive`, `merged`, `archived` |
| `q` | string | ILIKE on `fullName`, `displayName`, `internalRef` (no CPF in list search) |

**Response:**

```json
{
  "data": [
    {
      "id": "uuid",
      "fullName": "Maria Oliveira",
      "displayName": "Maria O.",
      "internalRef": "CLI-002",
      "status": "active",
      "responsibleLawyerUserId": "uuid",
      "updatedAt": "2026-05-27T12:00:00.000Z"
    }
  ],
  "nextCursor": "2026-05-26T10:00:00.000Z:uuid" | null
}
```

**Ordering:** `updated_at DESC`, `id DESC`

### `GET /api/v1/clients/:id` (unchanged)

Existing profile endpoint; LGPD filtering via `canAccessSensitiveData` (lawyer+ sees CPF/RG/birthDate/contactChannels).

---

## 3. Tests executed

| Command | Result |
|---------|--------|
| `pnpm --filter @execflow/api test:client-list` | **8/8 pass** |
| `pnpm --filter @execflow/api test:case-read` | **5/5 pass** (regression — `getClientDetail` LGPD) |
| `pnpm --filter @execflow/api typecheck` | **pass** |
| `npx tsc --noEmit` (apps/web) | **pass** |
| `pnpm --filter @execflow/web build` | **pass** |

---

## 4. Textual wireframes

### `/clients` — Lista de clientes

```
┌─────────────────────────────────────────────────────────────────┐
│ OPERACIONAL                                                     │
│ Clientes                                                        │
│ Cadastro de clientes associados a execuções penais.             │
├─────────────────────────────────────────────────────────────────┤
│ [ Pesquisar: Nome ou ref. interna…        ] [ Status ▼ Todos ]  │
├─────────────────────────────────────────────────────────────────┤
│ 12 clientes                                                     │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Maria O.                          [ACTIVO]  27/05/2026 14:30  │ │
│ │ Ref. CLI-002 · Responsável · a1b2c3d4…                      │ │
│ └─────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ João Pereira                      [ACTIVO]  26/05/2026 09:15  │ │
│ │ Ref. CLI-003 · Responsável · e5f6g7h8…                      │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ [ Carregar mais ]                                               │
└─────────────────────────────────────────────────────────────────┘
```

States: loading («Carregando clientes…»), empty (no filters / with filters), error + retry.

### `/clients/[clientId]` — Perfil de cliente

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Voltar à lista                                                │
│ CLIENTE                                                         │
│ Maria O.                                                        │
│ Ref. CLI-002 · Status: Activo · Actualizado em 27/05/2026…      │
├─────────────────────────────────────────────────────────────────┤
│ IDENTIFICAÇÃO                                                   │
│   Nome completo      Maria Oliveira                             │
│   Nome de exibição   Maria O.                                   │
│   Ref. interna       CLI-002                                    │
│   Aliases            (se houver)                                │
├─────────────────────────────────────────────────────────────────┤
│ NOTAS                                                           │
│   Texto livre…                                                  │
├─────────────────────────────────────────────────────────────────┤
│ ADVOGADO RESPONSÁVEL                                            │
│   {uuid}                                                        │
├─────────────────────────────────────────────────────────────────┤
│ DADOS SENSÍVEIS (LGPD)     ← só visível se API devolver campos  │
│   CPF / RG / Nascimento / Contactos                             │
├─────────────────────────────────────────────────────────────────┤
│ DATAS                                                           │
│   Criado em / Actualizado em                                    │
└─────────────────────────────────────────────────────────────────┘
```

**Assistant:** secção LGPD omitida (API não inclui `cpf`, `rg`, etc.).  
**Lawyer+:** secção LGPD renderizada com dados autorizados.

### Case Workspace — link integrado

```
┌─────────────────────────────────────────────────────────────────┐
│ EXECUÇÃO PENAL                                                  │
│ Maria O.                                                        │
│ Ref. EXE-001 · Processo … · Status: active · …                  │
│ Ver perfil do cliente  ← link para /clients/{clientSummary.id}  │
├─────────────────────────────────────────────────────────────────┤
│ [ Trabalho | Timeline | Documentos | … ]                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Residual risks

| Risk | Severity | Notes |
|------|----------|-------|
| Responsável mostrado como UUID truncado | Low | Sem join a `users.display_name`; UX operacional limitada |
| Pesquisa `q` não inclui CPF | Low | Decisão LGPD deliberada; advogados não podem buscar por CPF na lista |
| `POST /clients` 201 pode expor CPF a assistant | Medium | Pré-existente; fora do escopo desta fase |
| Constraint `NULLS NOT DISTINCT` em CPF | Low | Apenas um cliente sem CPF por org; relevante para criação futura |
| Perfil sem lista de execuções do cliente | Low | Navegação inversa (cliente → casos) ainda ausente |

---

## 6. Next gaps (Clients Module)

1. **Fase 3 — Criação:** UI `POST /clients` + validação de duplicados/merge workflow  
2. **Edição:** `PATCH /clients/:id` (notas, responsável, aliases) com audit log  
3. **Merge / archive:** fluxos de estado `merged`, `archived`  
4. **Resolução de nomes:** join ou lookup de `users.display_name` para advogado responsável na lista e perfil  
5. **Navegação cruzada:** secção «Execuções» no perfil (`GET /cases?clientId=…` — endpoint ainda não existe)  
6. **LGPD hardening:** sanitizar resposta `201 POST /clients` para assistant  
7. **Busca avançada:** aliases, CPF (lawyer-only endpoint ou flag de role no service)

---

## 7. Architecture alignment

- Repository → service → route layering preserved  
- Cursor pagination matches Cases module (`{updatedAt}:{id}`)  
- Frontend reuses `DashboardPageHeader`, `LoadingState`, `EmptyState`, `OperationalErrorState`, card + `Link` pattern from `/cases`  
- Existing `GET /clients/:id` contract unchanged  
- RBAC: list and detail both `assistant+`; sensitive fields lawyer+ at service layer
