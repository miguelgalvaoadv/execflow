# EXECFLOW — Antigravity Handoff Package

**Classification:** Visual migration handoff — authoritative for Antigravity agents  
**Version:** 1.0  
**Date:** 2026-05-27  
**Scope:** Frontend visual reconstruction only (`apps/web`)  
**Status:** Approved for Antigravity build  

> This document consolidates everything required to reskin EXECFLOW without reading the full codebase.  
> It describes **what exists today**, **what may change visually**, and **what must never change**.

---

## Table of contents

1. [Resumo do produto](#1-resumo-do-produto)
2. [Objectivos do sistema](#2-objectivos-do-sistema)
3. [Arquitectura de navegação](#3-arquitectura-de-navegação)
4. [Todas as rotas implementadas](#4-todas-as-rotas-implementadas)
5. [Design System actual](#5-design-system-actual)
6. [Primitives existentes](#6-primitives-existentes)
7. [Build Order aprovado](#7-build-order-aprovado)
8. [Componentes globais](#8-componentes-globais)
9. [Estados Loading / Empty / Error](#9-estados-loading--empty--error)
10. [Guidelines de UX](#10-guidelines-de-ux)
11. [Guidelines visuais](#11-guidelines-visuais)
12. [Restrições obrigatórias](#12-restrições-obrigatórias)
13. [O que não pode ser alterado](#13-o-que-não-pode-ser-alterado)
14. [O que deve ser melhorado visualmente](#14-o-que-deve-ser-melhorado-visualmente)
15. [Checklist final de paridade](#15-checklist-final-de-paridade)

**Documentos complementares (ler antes de Case Workspace e dashboard):**

| Documento | Conteúdo |
|-----------|----------|
| [`case-workspace-visual-spec-antigravity.md`](case-workspace-visual-spec-antigravity.md) | Spec visual completa `/cases/[caseId]` (850 linhas) |
| [`design-system-phase1-report.md`](design-system-phase1-report.md) | Consolidação Phase 1 |
| [`design-system-phase2-report.md`](design-system-phase2-report.md) | Consolidação Phase 2 |
| [`EXECFLOW_MASTER_CONTEXT.md`](EXECFLOW_MASTER_CONTEXT.md) | Arquitectura e invariantes do sistema |
| [`ux-flow-architecture.md`](ux-flow-architecture.md) | Filosofia UX operacional |
| [`dashboard-mvp-report.md`](dashboard-mvp-report.md) | Secções e APIs do Início |
| [`local-runtime.md`](local-runtime.md) | Como correr localmente para preview |

---

## 1. Resumo do produto

**EXECFLOW** é uma plataforma de operações jurídicas para **execução penal brasileira**. Serve advogados e equipas de apoio que gerem dezenas a centenas de execuções penais activas, onde erros aritméticos, prazos perdidos ou estado legal incorrecto têm consequências graves.

O frontend actual (`apps/web`) é um **shell operacional read-mostly** construído em **Next.js App Router** com:

- Autenticação via Better Auth (cookie HttpOnly)
- Dados org-scoped via API REST (`apps/api`)
- React Query para fetch/cache
- Tailwind CSS com tokens em `surfaces.ts`
- Design System consolidado em `components/ui/` (Phases 1–2)

**Superfície operacional actual:** dashboard de início, listas org-wide (casos, clientes, peças, prazos), fila de trabalho, oportunidades (via fila), perfis de entidade, Case Workspace com 6 tabs, acções de prazo (reconhecer/concluir/encerrar), sign-in.

**Não é:** um repositório documental genérico, um CRM, nem um sistema que substitui o advogado. O motor de cálculo sugere oportunidades; o humano qualifica.

---

## 2. Objectivos do sistema

### Objectivos de produto (contexto para decisões visuais)

| Objectivo | Implicação visual |
|-----------|-------------------|
| **Queue-first** | Prioridade visual a trabalho pendente, prazos vencidos, riscos de liberdade |
| **Calma operacional** | Densidade informativa alta, ruído baixo; vermelho reservado a estados críticos |
| **Autoridade humana** | Motor/IA como sugestão — badges de confiança, nunca conclusão automática |
| **Integridade temporal** | Estados honestos (empty = vazio real; loading = fetch real; error = falha real) |
| **Auditabilidade** | Timeline, histórico de prazo, labels técnicos disponíveis mas não default |
| **Escala** | Listas com paginação cursor, filtros, contadores aproximados (`50+`) |

### Objectivos desta migração Antigravity

1. Reconstruir **apenas a camada visual** — tokens, tipografia, spacing, cor, micro-interacções
2. Preservar **100% da hierarquia de informação** e fluxos existentes
3. Centralizar estilos nos componentes `ui/` e shell `dashboard/`
4. Não introduzir funcionalidades, rotas, ou contratos API novos

---

## 3. Arquitectura de navegação

### Modelo de sessão

```
/sign-in  →  (cookie session)  →  /dashboard (Início)
                                      ↓
                    Sidebar + deep links entre módulos
```

- **Middleware** (`middleware.ts`): redirecciona rotas protegidas sem cookie para `/sign-in?from=…`
- **Layout autenticado** (`(app)/layout.tsx`): wrap em `DashboardLayout` (sidebar + painel)
- **Sign-in** (`(auth)/`): fora do shell operacional

### Sidebar — estrutura

| Secção | Itens |
|--------|-------|
| **Visão geral** | Início (`/dashboard`) |
| **Operações** | Execuções, Clientes, Prazos, Oportunidades, Peças, Financeiro (stub) |
| **Sistema** | Configurações (stub) |

**Nota:** `/queues` (Fila de trabalho completa) **não está na sidebar** — acedida via links no dashboard.

### Grafo de dependências entre páginas

```
/sign-in
    └──► /dashboard ◄── / (redirect)
              ├──► /queues
              ├──► /cases ──► /cases/[caseId] ──┬──► /documents/[id]
              │                                └──► /deadlines/[id]
              ├──► /clients ──► /clients/[clientId]
              ├──► /documents ──► /documents/[documentId]
              ├──► /deadlines ──► /deadlines/[deadlineId]
              └──► /opportunities

Deep-link fila: queueProjectionHref()
    Deadline  → /deadlines/:id
    Document  → /documents/:id
    default   → /cases/:executionCaseId
```

### Mobile

- Sidebar oculta; header fixo 56px com hamburger
- Drawer sidebar 260px
- Main content com `pt-14` em mobile, `lg:pl-[260px]` em desktop

---

## 4. Todas as rotas implementadas

### Rotas activas (migrar visualmente)

| Rota | Título UI | Tipo | API principal |
|------|-----------|------|---------------|
| `/` | — | redirect → `/dashboard` | — |
| `/sign-in` | Entrar | auth (sem shell) | Better Auth |
| `/dashboard` | Início | dashboard composto | múltiplas (ver §8) |
| `/cases` | Execuções | lista + filtros | `GET /api/v1/cases` |
| `/cases/[caseId]` | Case Workspace | workspace 6 tabs | `GET /api/v1/cases/:id` + tabs |
| `/clients` | Clientes | lista + filtros | `GET /api/v1/clients` |
| `/clients/[clientId]` | Perfil cliente | detalhe read-only | `GET /api/v1/clients/:id` |
| `/documents` | Peças | lista + filtros | `GET /api/v1/documents` |
| `/documents/[documentId]` | Detalhe peça | detalhe read-only | `GET /api/v1/documents/:id` |
| `/deadlines` | Prazos | lista + filtros | `GET /api/v1/deadlines` |
| `/deadlines/[deadlineId]` | Detalhe prazo | detalhe + acções | `GET/POST /api/v1/deadlines/:id` |
| `/queues` | Fila de trabalho | lista filtrada | `GET /api/v1/queue-projections` |
| `/opportunities` | Oportunidades | lista via fila | `GET /api/v1/queue-projections` |

**Sessão (todas as rotas `(app)`):** `GET /api/v1/me`

### Rotas stub — **não migrar como produto**

| Rota | Estado | Acção Antigravity |
|------|--------|-------------------|
| `/settings` | EmptyState «Em desenvolvimento» | Skip ou placeholder mínimo |
| `/finance` | Nav item only; rota inexistente | Não criar página |

### Case Workspace — tabs e APIs (lazy fetch)

| Tab | Label | API | Hook |
|-----|-------|-----|------|
| `trabalho` | Trabalho | `GET /queue-projections?executionCaseId=` | `useQueueProjections` |
| `timeline` | Timeline | `GET /cases/:id/timeline` | `useCaseTimeline` |
| `documentos` | Documentos | `GET /cases/:id/documents` | `useCaseDocuments` |
| `oportunidades` | Oportunidades | `GET /cases/:id/opportunities` | `useCaseOpportunities` |
| `prazos` | Prazos | `GET /cases/:id/deadlines` | `useCaseDeadlines` |
| `motor` | Motor | `GET /engine/runs?executionCaseId=` | `useEngineRuns` |

**Gates Case Workspace:** sessão → ID válido → caso carregado → header + tabs → conteúdo tab.

### Prazo — acções (única superfície com mutações)

| Acção | Método | Endpoint |
|-------|--------|----------|
| Reconhecer | POST | `/api/v1/deadlines/:id/acknowledge` |
| Concluir | POST | `/api/v1/deadlines/:id/complete` |
| Encerrar | POST | `/api/v1/deadlines/:id/dismiss` |

### Headers API (não alterar)

- `credentials: include` (cookie sessão)
- `X-Organization-Id: {orgId}` (endpoints org-scoped)
- Base URL: `NEXT_PUBLIC_API_URL` (default `http://localhost:3001`)

---

## 5. Design System actual

### Localização

```
apps/web/src/
├── components/ui/           ← Design System canonical (17 exports)
├── components/dashboard/    ← Shell + componentes dashboard-specific
├── components/case-workspace/
├── components/operational/  ← Re-exports → ui/ (backward compat)
└── components/dashboard/surfaces.ts  ← Tokens Tailwind
```

### Consolidação concluída

| Fase | Data | Escopo |
|------|------|--------|
| **Phase 1** | 2026-05-27 | Button, FieldRow, ProfileSection, StatusBadge, PriorityBadge |
| **Phase 2** | 2026-05-27 | ListCard, FilterBar, SearchField, EmptyState, LoadingState, ErrorState |

### Tokens actuais (`surfaces.ts`)

| Token | Valor | Uso |
|-------|-------|-----|
| `surfaces.canvas` | `#09090b` | Fundo root |
| `surfaces.sidebar` | `#0c0c0e` | Sidebar |
| `surfaces.main` | `#0a0a0c` | Área main scroll |
| `surfaces.panel` | `#111113` | Cards lista |
| `surfaces.panelMuted` | `#0e0e10` | Wrapper página |
| `surfaces.panelInset` | `#0d0d0f` | Tab bar, empty state |
| `borders.subtle` | `white/6%` | Bordas secundárias |
| `borders.default` | `white/8%` | Inputs, cards |
| `borders.strong` | `white/10%` | Ênfase |
| `text.primary` | `zinc-50` | Títulos |
| `text.secondary` | `zinc-400` | Corpo |
| `text.muted` | `zinc-500` | Labels |
| `text.faint` | `zinc-600` | Metadados |

### Labels operacionais (PT-BR)

| Módulo | Ficheiro |
|--------|----------|
| Prazos (status, prioridade, classe, histórico) | `lib/operational/deadline-display.ts` |
| Fila (tipo, prioridade numérica) | `lib/operational/queue-display.ts` |
| Documentos (status, OCR, extracção) | `lib/operational/document-display.ts` |

**Regra:** badges semânticos consomem estes mapas — não hardcodar labels PT nas páginas.

---

## 6. Primitives existentes

Barrel: `components/ui/index.ts`

### Acções

| Primitive | Variantes | Ficheiro |
|-----------|-----------|----------|
| **Button** | `primary`, `secondary`, `success`, `ghost`; sizes `sm`, `md`; `fullWidth?` | `Button.tsx` |

### Dados / perfil

| Primitive | Props chave | Ficheiro |
|-----------|-------------|----------|
| **FieldRow** | `label`, `value`, `debug?`, `labelWidth?: '40' \| '44'` | `FieldRow.tsx` |
| **ProfileSection** | `title`, `children`, `className?` | `ProfileSection.tsx` |

### Badges

| Primitive | Variantes | Ficheiro |
|-----------|-----------|----------|
| **StatusBadge** | `neutral` (children) · `deadline` (status) | `StatusBadge.tsx` |
| **PriorityBadge** | `queue` (priority: 0–3) · `deadline` (priority: string) | `PriorityBadge.tsx` |

### Listas

| Primitive | Variantes | Ficheiro |
|-----------|-----------|----------|
| **ListCard** | `link`, `row`, `static`; `href?`, `accentClassName?` | `ListCard.tsx` |

### Filtros

| Primitive | Ficheiro |
|-----------|----------|
| **FilterBar** | `FilterBar.tsx` |
| **FilterField** | idem |
| **FilterLabel** | idem |
| **FilterSelect** | idem |
| **FilterTextField** | idem |
| **SearchField** | idem |
| **input-styles** | `filterInputClassName`, `filterLabelClassName` |

### Feedback

| Primitive | Variantes | Ficheiro |
|-----------|-----------|----------|
| **EmptyState** | `default`, `tab` (visual idêntico) | `EmptyState.tsx` |
| **LoadingState** | `inline`, `page` | `LoadingState.tsx` |
| **ErrorState** | `default`, `inline` | `ErrorState.tsx` |

### Aliases deprecated (manter compatibilidade)

- `OperationalErrorState` → `ErrorState`
- `PageLoadingState` → `LoadingState variant="page"`

### Primitives **ainda não existentes** (inline nas páginas)

| Primitive | Onde aparece | Prioridade reskin |
|-----------|--------------|-------------------|
| Input / Select / Textarea | sign-in, dismiss prazo | Alta |
| SegmentedTabs | `/queues`, `CaseTabBar` | Alta |
| Breadcrumb / BackLink | perfis entidade | Média |
| ContextBadge | Motor, Bloqueado, Desactualizado | Média |
| MiniCard | dashboard pipeline, quick links | Baixa |
| PageHeader | `DashboardPageHeader` (fora de ui/) | Média |

---

## 7. Build Order aprovado

Ordem exacta de reconstrução visual. **Não alterar a sequência** — cada fase depende da anterior.

### Fase 1 — Fundação visual + Shell

**Objectivo:** Tokens globais e canvas antes de páginas.

| Incluir | Componentes |
|---------|-------------|
| Design tokens | `surfaces.ts` → theme/CSS variables |
| App shell | `DashboardLayout`, `Sidebar`, `SidebarBrand`, `SidebarNavItem`, `NavIcon`, mobile drawer |
| Page header | `DashboardPageHeader` |
| Auth | `/sign-in` (layout isolado) |

**Páginas:** `/sign-in` apenas.

**Dependências:** nenhuma.

**Entregável:** Canvas, sidebar, tipografia base, header — sem listas.

---

### Fase 2 — Primitives globais (`components/ui/`)

**Objectivo:** Reskin de todos os building blocks.

| Incluir |
|---------|
| Button, FieldRow, ProfileSection |
| StatusBadge, PriorityBadge |
| ListCard (3 variantes) |
| FilterBar, SearchField, FilterSelect, FilterTextField |
| EmptyState, LoadingState, ErrorState |
| input-styles.ts |
| **Recomendado criar visualmente:** Input, Select, Textarea, SegmentedTabs |

**Páginas:** nenhuma completa — página/storybook de referência de componentes.

**Dependências:** Fase 1 (tokens).

---

### Fase 3 — Superfícies de lista e dashboard

**Objectivo:** Browsing operacional org-wide.

| Ordem | Página | Componentes extra |
|-------|--------|-------------------|
| 3.1 | `/dashboard` | `SummaryMetricCard`, `WorkspacePanel`, `QueueProjectionRow`, mini-cards |
| 3.2 | `/deadlines` | FilterBar + ListCard + accent |
| 3.3 | `/documents` | FilterBar + ListCard |
| 3.4 | `/clients` | FilterBar + ListCard |
| 3.5 | `/cases` | FilterBar + ListCard |
| 3.6 | `/queues` | SegmentedTabs + ListCard row |
| 3.7 | `/opportunities` | ListCard static + badge Motor |

**Dependências:** Fases 1–2.

---

### Fase 4 — Detalhe, workspace e acções

**Objectivo:** Profundidade e interacção.

| Ordem | Página | Notas |
|-------|--------|-------|
| 4.1 | `/clients/[clientId]` | ProfileSection, FieldRow, back link |
| 4.2 | `/documents/[documentId]` | idem |
| 4.3 | `/deadlines/[deadlineId]` | acções Button, dismiss form, badges contextuais, histórico |
| 4.4 | `/cases/[caseId]` | **Última** — spec em `case-workspace-visual-spec-antigravity.md` |
| — | `/settings` | Skip |

**Dependências:** Fases 1–3.

---

## 8. Componentes globais

### Design System (`components/ui/`) — 17 exports

Ver [§6 Primitives existentes](#6-primitives-existentes).

### Shell (`components/dashboard/`)

| Componente | Ficheiro | Função |
|------------|----------|--------|
| `DashboardLayout` | `DashboardLayout.tsx` | Canvas + sidebar + painel max-w 1280px |
| `Sidebar` | `Sidebar.tsx` | Nav + mobile drawer |
| `SidebarBrand` | `SidebarBrand.tsx` | Logo EXECFLOW |
| `SidebarNavItem` | `SidebarNavItem.tsx` | Item nav com active state |
| `NavIcon` | `NavIcon.tsx` | Ícones sidebar |
| `DashboardPageHeader` | `DashboardPageHeader.tsx` | eyebrow + title + description |
| `WorkspacePanel` | `WorkspacePanel.tsx` | Secção dashboard com header |
| `SummaryMetricCard` | `SummaryMetricCard.tsx` | Card métrica com link |
| `QueueProjectionRow` | `QueueProjectionRow.tsx` | Row fila no dashboard |

**Tokens partilhados:** `surfaces.ts`, `nav-items.ts`, `nav-sections.ts`

### Case Workspace (`components/case-workspace/`)

| Componente | Função |
|------------|--------|
| `CaseTabBar` | 6 tabs segmentadas |

### Operational (`components/operational/`)

Re-exports de `ui/` + `ErrorBoundary` (class component para render errors).

### Hooks de dados (`lib/hooks/`)

`use-session`, `use-cases`, `use-case`, `use-clients`, `use-client`, `use-documents`, `use-document`, `use-deadlines`, `use-deadline`, `use-deadline-history`, `use-deadline-mutations`, `use-queue-projections`, `use-engine-runs`, `use-case-timeline`, `use-case-documents`, `use-case-opportunities`, `use-case-deadlines`

### Utilitários

| Ficheiro | Função |
|----------|--------|
| `lib/api-client.ts` | Fetch typed + ApiError |
| `lib/dashboard/queue-item-href.ts` | Deep-link fila → entidade |
| `lib/query-keys.ts` | React Query keys |

---

## 9. Estados Loading / Empty / Error

### Padrão de gates (todas as páginas operacionais)

```
1. sessionLoading  →  LoadingState «Carregando sessão…»
2. session === null →  ErrorState (sem retry)
3. [page fetch]    →  LoadingState (label específico)
4. isError         →  ErrorState + onRetry (quando aplicável)
5. items.length=0  →  EmptyState (título + descrição contextual)
6. success         →  conteúdo
```

### Componentes

| Estado | Componente | Visual actual |
|--------|------------|---------------|
| Loading inline | `LoadingState` | Spinner 16px + label 13px muted |
| Loading page | `LoadingState variant="page"` | Centrado min-h 200px |
| Empty lista | `EmptyState` | Ícone caixa + título + descrição centrados em panelInset |
| Empty tab | `EmptyState variant="tab"` | Idêntico visual; semântica secção |
| Error fetch | `ErrorState` | Título vermelho + mensagem mono + «Tentar novamente» |
| Error sessão | `ErrorState` | Sem retry |
| Render crash | `ErrorBoundary` | Fallback ErrorState |

### Labels de loading por página (preservar PT)

| Contexto | Label |
|----------|-------|
| Sessão | Carregando sessão… |
| Casos | Carregando execuções… / Carregando caso… |
| Clientes | Carregando clientes… / Carregando cliente… |
| Peças | Carregando peças… / Carregando peça… |
| Prazos | Carregando prazos… / Carregando prazo… / Carregando histórico… |
| Fila | Carregando fila… / Carregando fila prioritária… |
| Oportunidades | Carregando oportunidades… |
| Tabs caso | Carregando trabalho… / timeline… / peças… / etc. |
| Motor | Carregando avaliações… |
| Paginação | Carregando… (botão Carregar mais) |

### Regras de honestidade

- **Nunca** mostrar skeleton rows que pareçam dados reais
- **Nunca** inventar totais — usar `50+` quando limit atingido
- Empty state distingue «filtro activo» vs «lista vazia org»

---

## 10. Guidelines de UX

Derivadas de `ux-flow-architecture.md` e implementação actual.

### Princípios

1. **Queue-first** — trabalho pendente é o centro de gravidade operacional
2. **Calma operacional** — uma acção primária por contexto; vermelho só para crítico
3. **Densidade antes do clique** — metadados visíveis nos cards antes de abrir detalhe
4. **Progressive disclosure** — detalhe técnico (debug, eventType) em texto faint, não default
5. **Estados honestos** — empty/loading/error reflectem realidade do sistema
6. **Autoridade humana** — motor sugere; advogado decide; badge «Motor» indica origem engine

### Padrões de interacção

| Padrão | Comportamento actual |
|--------|---------------------|
| Listas | Cursor pagination — botão «Carregar mais» |
| Filtros | Debounce 300ms em search; selects instantâneos |
| Tabs caso | Local state; não persiste em URL |
| Acções prazo | Disabled durante mutation; label «A processar…» |
| Sign-in | Redirect para `from` param ou `/queues` (fallback) |
| Back links | Text link «← Voltar à lista» acima do header |

### Idioma

- **UI:** Português (pt-BR labels; grafia «Activo», «Actualizado» consistente com codebase)
- **Dados técnicos:** podem aparecer em mono (IDs, eventType, userId truncado)

### Acessibilidade mínima (preservar)

- `role="status"` + `aria-live="polite"` em LoadingState
- `role="alert"` em ErrorState
- `role="tablist"` / `role="tab"` / `aria-selected` em tabs
- `aria-label` em listas (`<ul aria-label="…">`)

---

## 11. Guidelines visuais

### Estética actual (baseline de paridade)

- **Tema:** dark mode exclusivo
- **Paleta:** zinc scale sobre fundos quase pretos
- **Tipografia:** system sans (`font-sans`); escala 10–32px
- **Radius:** `rounded-xl` (cards), `rounded-lg` (inputs, tabs, mini-cards), `rounded-2xl` (wrapper página)
- **Spacing:** padding cards `px-4 py-3`; page wrapper `p-4 sm:p-5 lg:p-6`
- **Bordas:** white opacity 6–10%; sem sombras pesadas
- **Hover:** `hover:bg-white/[0.02]` em cards interactivos
- **Transições:** `transition-colors` apenas; sem animações decorativas

### Hierarquia tipográfica

| Elemento | Tamanho | Peso |
|----------|---------|------|
| Page title (h1) | 28–32px | semibold |
| Panel title (h2) | 13px | medium |
| Section title (ProfileSection) | 11px uppercase | semibold |
| Card title | 13px | medium |
| Body | 13px | regular |
| Metadata | 11–12px | regular, faint |
| Badges | 10px uppercase | semibold |
| Form labels | 11px uppercase | medium |

### Cores semânticas (badges)

| Semântica | Cores |
|-----------|-------|
| Neutral status | zinc border/bg, text secondary |
| Deadline overdue | red-400 / red-950 |
| Deadline completed | emerald-400 / emerald-950 |
| Deadline acknowledged | blue-400 / blue-950 |
| Priority critical/high | red/orange |
| Queue priority 0–3 | mapa em `queue-display.ts` |
| Motor (engine) | indigo-400 / indigo-950 |
| Bloqueado | amber-400 / amber-950 |
| Desactualizado | zinc-400 |

### Layout

```
┌──────────┬────────────────────────────────────┐
│ SIDEBAR  │  MAIN (max-w 1280px, centered)     │
│ 260px    │  ┌──────────────────────────────┐  │
│ fixed    │  │ panelMuted wrapper           │  │
│          │  │  DashboardPageHeader         │  │
│          │  │  [FilterBar | Tabs | Content]│  │
│          │  └──────────────────────────────┘  │
└──────────┴────────────────────────────────────┘
```

---

## 12. Restrições obrigatórias

1. **Visual-only migration** — sem alterar lógica, hooks, API client, middleware
2. **Preservar props públicas** dos componentes `ui/` (extensão via `className` permitida)
3. **Preservar hierarquia DOM funcional** — ordem de gates, estrutura tab/list
4. **Preservar labels PT** — textos de UI e empty/error messages
5. **Preservar contratos API** — paths, headers, query params
6. **Preservar deep-links** — `queue-item-href.ts`, links entre módulos
7. **Sem dados fictícios** — counts, empty states, badges reflectem API
8. **Sem novas rotas** — excepto se explicitamente pedido fora deste handoff
9. **Sem redesign funcional** — não mover acções, não adicionar tabs, não alterar filtros
10. **Build deve passar** — `tsc --noEmit` + `pnpm --filter @execflow/web build`

---

## 13. O que não pode ser alterado

### Código / arquitectura

| Área | Razão |
|------|-------|
| `lib/hooks/*` | Contratos de dados |
| `lib/api-client.ts` | Transporte API |
| `middleware.ts` | Protecção de rotas |
| `lib/operational/*-display.ts` | Mapeamentos semânticos PT |
| Props required dos primitives | Compatibilidade páginas |
| Sequência de gates loading/error | UX honesta |
| Endpoints consumidos | Backend contract |
| Lazy fetch tabs Case Workspace | Performance |
| Mutations prazo (ack/complete/dismiss) | Regras de negócio |
| Paginação cursor | API contract |
| Org scoping (`X-Organization-Id`) | Multi-tenancy |

### Comportamento UX

| Comportamento | Detalhe |
|---------------|---------|
| Tab default Case Workspace | `trabalho` |
| URL não reflecte tab activa | By design (MVP) |
| `/queues` fora da sidebar | Links desde dashboard |
| Contadores aproximados | `50+` quando limit |
| Sign-in fallback redirect | `/queues` (nota: home é `/dashboard`) |
| LGPD fields | Filtrados server-side; UI mostra o que API devolve |

### Páginas excluídas

- `/settings` — stub
- `/finance` — não implementado

---

## 14. O que deve ser melhorado visualmente

Antigravity **pode e deve** melhorar estes aspectos, desde que paridade funcional seja mantida:

### Alta prioridade (impacto global)

| Área | Oportunidade |
|------|--------------|
| **Tokens** | Migrar hex hardcoded → CSS variables / theme object |
| **Shell** | Refinar sidebar, spacing, active states, mobile drawer |
| **Tipografia** | Hierarquia mais clara; possível fonte institucional |
| **Input system** | Unificar sign-in + filtros + forms em primitives Input/Select/Textarea |
| **SegmentedTabs** | Unificar `/queues` + CaseTabBar num componente |
| **Consistência cards** | Alinhar mini-cards dashboard com ListCard ou variant density |

### Média prioridade

| Área | Oportunidade |
|------|--------------|
| **ContextBadge** | Motor, Bloqueado, Desactualizado como variant de StatusBadge |
| **BackLink / Breadcrumb** | Navegação de retorno mais consistente |
| **PageHeader** | Mover DashboardPageHeader para ui/ com variants |
| **Focus states** | Melhorar acessibilidade keyboard |
| **Deadline accents** | Refinar cores overdue/critical sem perder urgência |

### Baixa prioridade / polish

| Área | Oportunidade |
|------|--------------|
| **Empty state icon** | Substituir SVG genérico por ilustração institucional |
| **Loading spinner** | Brand-aligned loader |
| **Hover/focus micro-interacções** | Subtis, sem distrair |
| **Settings stub** | Placeholder visual mínimo se necessário |

### Não melhorar (risco)

- Adicionar dashboard stats inventados
- Animar listas ou contadores
- Mudar ordem de informação nos cards
- Introduzir light mode sem pedido explícito
- Celebrar «fila limpa» com UI festiva

---

## 15. Checklist final de paridade

Usar esta checklist para validar que a migração Antigravity está completa.

### Fase 1 — Shell

- [ ] Canvas, sidebar, main panel cores equivalentes ou intencionalmente melhoradas
- [ ] Sidebar 260px desktop; drawer mobile funcional
- [ ] Nav active state visível em todas as rotas
- [ ] Itens stub (Financeiro, Configurações) visualmente distintos ou disabled
- [ ] `/sign-in` funcional fora do shell
- [ ] `DashboardPageHeader` — eyebrow, title, description intactos

### Fase 2 — Primitives

- [ ] Button — 4 variantes + disabled states
- [ ] StatusBadge — neutral + deadline variants
- [ ] PriorityBadge — queue + deadline variants
- [ ] ListCard — link, row, static + hover + accent
- [ ] FilterBar — layout responsivo sm+
- [ ] EmptyState, LoadingState, ErrorState — variantes
- [ ] FieldRow + ProfileSection — perfis entidade

### Fase 3 — Listas e dashboard

- [ ] `/dashboard` — 6 secções + summary cards + quick links
- [ ] `/cases` — filtros + lista + paginação
- [ ] `/clients` — idem
- [ ] `/documents` — idem
- [ ] `/deadlines` — idem + accent cards overdue
- [ ] `/queues` — segmented filter + list row
- [ ] `/opportunities` — list + badge Motor

### Fase 4 — Detalhe e workspace

- [ ] `/clients/[clientId]` — secções perfil + LGPD condicional
- [ ] `/documents/[documentId]` — secções + debug técnico
- [ ] `/deadlines/[deadlineId]` — acções + dismiss form + histórico
- [ ] `/cases/[caseId]` — 6 tabs, lazy load, gates correctos
- [ ] Deep-links fila → caso/documento/prazo funcionam

### Estados

- [ ] Todos os loading labels PT preservados
- [ ] Empty states distinguem filtro activo vs vazio org
- [ ] Error retry funciona onde existia
- [ ] Sessão inválida sem retry

### Restrições

- [ ] Zero alterações em hooks/API
- [ ] `tsc --noEmit` passa
- [ ] `pnpm --filter @execflow/web build` passa
- [ ] Nenhuma rota nova criada (excepto stubs já existentes)

### Documentação

- [ ] Case Workspace conforme `case-workspace-visual-spec-antigravity.md`
- [ ] Desvios documentados se intencionais

---

## Apêndice A — Mapa ficheiro → responsabilidade

| Caminho | Responsabilidade Antigravity |
|---------|------------------------------|
| `components/ui/*` | **Reskin prioritário** — tokens aplicados aqui propagam |
| `components/dashboard/surfaces.ts` | **Fonte de tokens** — migrar para theme |
| `components/dashboard/DashboardLayout.tsx` | Shell |
| `components/dashboard/Sidebar*.tsx` | Navegação |
| `components/dashboard/DashboardPageHeader.tsx` | Headers |
| `components/dashboard/WorkspacePanel.tsx` | Dashboard sections |
| `components/dashboard/SummaryMetricCard.tsx` | Dashboard metrics |
| `components/dashboard/QueueProjectionRow.tsx` | Queue rows |
| `components/case-workspace/CaseTabBar.tsx` | Case tabs |
| `app/(app)/**/page.tsx` | Composição — alterar só se necessário para className |
| `app/(auth)/sign-in/page.tsx` | Auth surface |
| `lib/**` | **Não tocar** |

## Apêndice B — Endpoints completos

| Método | Endpoint | Consumidor |
|--------|----------|------------|
| GET | `/api/v1/me` | Todas as páginas |
| GET | `/api/v1/cases` | `/cases`, dashboard |
| GET | `/api/v1/cases/:id` | Case Workspace |
| GET | `/api/v1/cases/:id/timeline` | Tab Timeline |
| GET | `/api/v1/cases/:id/documents` | Tab Documentos |
| GET | `/api/v1/cases/:id/opportunities` | Tab Oportunidades |
| GET | `/api/v1/cases/:id/deadlines` | Tab Prazos |
| GET | `/api/v1/clients` | `/clients` |
| GET | `/api/v1/clients/:id` | Perfil cliente |
| GET | `/api/v1/documents` | `/documents`, dashboard |
| GET | `/api/v1/documents/:id` | Detalhe peça |
| GET | `/api/v1/deadlines` | `/deadlines`, dashboard |
| GET | `/api/v1/deadlines/:id` | Detalhe prazo |
| GET | `/api/v1/deadlines/:id/history` | Histórico prazo |
| POST | `/api/v1/deadlines/:id/acknowledge` | Acção prazo |
| POST | `/api/v1/deadlines/:id/complete` | Acção prazo |
| POST | `/api/v1/deadlines/:id/dismiss` | Acção prazo |
| GET | `/api/v1/queue-projections` | `/queues`, `/opportunities`, dashboard, tab Trabalho |
| GET | `/api/v1/engine/runs` | Tab Motor, dashboard |

---

**Fim do pacote de handoff Antigravity.**

*Gerado: 2026-05-27 · Frontend consolidado Phases 1–2 · Pronto para reconstrução visual condicional.*
