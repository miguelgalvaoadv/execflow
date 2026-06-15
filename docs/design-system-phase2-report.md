# Design System Consolidation Phase 2 — Implementation Report

**Date:** 2026-05-27  
**Scope:** Frontend-only structural consolidation — no API, backend, UX, or behaviour changes  
**Reference:** EXECFLOW Design System Blueprint (Phase 2)

---

## Summary

Six primitive families were added to `apps/web/src/components/ui/` and wired into existing operational surfaces. State components (`EmptyState`, `LoadingState`, `ErrorState`) were canonicalized in the design system; `components/operational/*` now re-export from `@/components/ui` for backward compatibility. List pages, queue rows, dashboard panels, case workspace tabs, and detail pages were migrated without visual or functional changes.

---

## Design System Consolidation Phase 2

### Primitives criadas

| Primitive | Ficheiro(s) | API |
|-----------|-------------|-----|
| **ListCard** | `components/ui/ListCard.tsx` | `variant`: `link` · `row` · `static`; `href?`, `accentClassName?`, `className?` |
| **SearchField** | `components/ui/FilterBar.tsx` | `id`, `value`, `onChange`, `placeholder?`, `label?` (default «Pesquisar») |
| **FilterBar** | `components/ui/FilterBar.tsx` | `FilterBar`, `FilterField`, `FilterLabel`, `FilterSelect`, `FilterTextField` |
| **EmptyState** | `components/ui/EmptyState.tsx` | `variant`: `default` · `tab` (mesmo visual; semântica de secção) |
| **LoadingState** | `components/ui/LoadingState.tsx` | `variant`: `inline` · `page`; `label?` |
| **ErrorState** | `components/ui/ErrorState.tsx` | `variant`: `default` · `inline`; `message`, `onRetry?`, `title?` |

Suporte partilhado: `components/ui/input-styles.ts` (`filterInputClassName`, `filterLabelClassName`).

Barrel export actualizado: `components/ui/index.ts`.

**Compatibilidade:** `OperationalErrorState`, `PageLoadingState` mantidos como aliases deprecated. `components/operational/empty-state.tsx`, `loading-state.tsx`, `error-boundary.tsx` re-exportam de `@/components/ui`.

### Páginas migradas

| Rota / módulo | Primitives aplicadas |
|---------------|---------------------|
| `/cases` | FilterBar, SearchField, FilterSelect, FilterTextField, ListCard, Empty/Loading/Error |
| `/clients` | FilterBar, SearchField, FilterSelect, ListCard, Empty/Loading/Error |
| `/documents` | FilterBar, SearchField, FilterSelect, FilterTextField, ListCard, Empty/Loading/Error |
| `/deadlines` | FilterBar, SearchField, FilterSelect (×3), ListCard (+ accent), Empty/Loading/Error |
| `/queues` | ListCard (`row`), Empty/Loading/Error |
| `/dashboard` | ListCard, Empty/Loading/Error |
| `/cases/[caseId]` (6 tabs) | ListCard (`link`/`row`/`static`), EmptyState `variant="tab"`, Loading/Error |
| `/opportunities` | ListCard (`static`), Empty/Loading/Error |
| `/clients/[clientId]` | Loading/Error |
| `/documents/[documentId]` | Loading/Error |
| `/deadlines/[deadlineId]` | Loading/Error |
| `/settings` | EmptyState |
| `QueueProjectionRow` | ListCard (`row`) |

**Total:** 14 rotas/módulos; **~35** instâncias de `ListCard`; **4** barras de filtro completas.

### Componentes removidos

| Duplicado | Ocorrências |
|-----------|-------------|
| Filter bar inline (container + labels + inputs + selects) | 4 — cases, clients, documents, deadlines |
| List item card class strings (`rounded-xl border … px-4 py-3`) | ~35 — listas, filas, tabs, dashboard, componente partilhado |
| Implementações locais de EmptyState / LoadingState / ErrorState | 3 ficheiros `operational/*` → re-exports (~120 linhas movidas para `ui/`) |

**Fora de âmbito (mantidos inline):** segmented tabs em `/queues`, mini-cards `rounded-lg` no dashboard (pipeline documental, acesso rápido), inputs do sign-in e formulário de dismiss de prazo, badge «Motor» indigo.

### Linhas aproximadas eliminadas

| Categoria | Linhas duplicadas removidas (est.) |
|-----------|-------------------------------------|
| FilterBar + SearchField + selects inline | ~220 |
| ListCard class strings inline | ~105 |
| State component definitions (relocated) | ~120 |
| **Total eliminado / consolidado** | **~445** |

| Categoria | Linhas adicionadas (est.) |
|-----------|--------------------------|
| Primitives `ui/*` (Phase 2) | ~390 |
| JSX compacto + imports | ~80 |
| **Total adicionado** | **~470** |

**Saldo líquido:** ~±25 linhas no repositório; **~445 linhas de padrões repetidos** substituídas por **~390 linhas centralizadas** (redução efectiva de ~55 linhas de duplicação).

### Impacto em manutenção

1. **Listas uniformes** — padding, border, hover e variantes `link`/`row`/`static` num único componente; accents de prazo via `accentClassName`.
2. **Filtros uniformes** — larguras (`search`, `select-sm/md/xs`, `text-sm/xs`) codificadas; alteração de input styling em `input-styles.ts`.
3. **Estados canónicos** — `EmptyState`, `LoadingState`, `ErrorState` importados de `@/components/ui`; variantes documentadas para tabs (`EmptyState tab`) e páginas (`LoadingState page`).
4. **Camada operational preservada** — re-exports evitam quebra de imports externos; migração gradual para `@/components/ui`.
5. **Typecheck + build** — `tsc --noEmit` e `pnpm --filter @execflow/web build` passaram.

### Impacto para migração Antigravity

A consolidação Phase 2 prepara o reskin Antigravity nos pontos de maior densidade visual:

| Primitive | Ponto de aplicação Antigravity |
|-----------|-------------------------------|
| **ListCard** | Superfície principal de listas operacionais — um token swap altera todas as listas + fila + tabs |
| **FilterBar / SearchField** | Barra de filtros das centrais (Casos, Clientes, Peças, Prazos) — input/select skin centralizado |
| **EmptyState / LoadingState / ErrorState** | Feedback de sistema em todas as rotas — ícone, spinner, alerta redizignáveis uma vez |
| **input-styles.ts** | Ponte directa para tokens de formulário Antigravity antes de Input/Select standalone (Phase 3) |

**Risco reduzido para Antigravity:** alterações visuais ficam confinadas a ~10 ficheiros `ui/` em vez de ~20 páginas. Comportamento, props e hierarquia DOM preservados — reskin pode ser CSS/token-only.

**Próximo passo blueprint (Phase 3):** Input, Select, Textarea, FormLabel standalone; SegmentedTabs; EntityProfile wrapper; Breadcrumb.

---

## Verificação

```
npx tsc --noEmit          # apps/web — OK
pnpm --filter @execflow/web build   # OK
```
