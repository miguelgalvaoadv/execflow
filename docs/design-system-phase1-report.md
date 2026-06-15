# Design System Consolidation Phase 1 — Implementation Report

**Date:** 2026-05-27  
**Scope:** Frontend-only consolidation — no API, backend, or business-rule changes  
**Reference:** EXECFLOW Design System Blueprint (Phase 1)

---

## Summary

Five reusable UI primitives were introduced under `apps/web/src/components/ui/` and wired into existing operational surfaces. Visual appearance, props semantics, and UX behaviour were preserved. Inline duplicates were removed from detail pages, list pages, the dashboard, queue rows, case workspace tabs, and sign-in.

---

## Design System Consolidation Phase 1

### Componentes criados

| Primitive | Ficheiro | Variantes / props |
|-----------|----------|-------------------|
| **ProfileSection** | `components/ui/ProfileSection.tsx` | `title`, `children`, `className?` |
| **FieldRow** | `components/ui/FieldRow.tsx` | `label`, `value`, `debug?`, `labelWidth?: '40' \| '44'` |
| **StatusBadge** | `components/ui/StatusBadge.tsx` | `neutral` (default, children) · `deadline` (`status`) |
| **PriorityBadge** | `components/ui/PriorityBadge.tsx` | `queue` (default, `priority: number`) · `deadline` (`priority: string`) |
| **Button** | `components/ui/Button.tsx` | `primary` · `secondary` · `success` · `ghost`; `size`: `sm` \| `md`; `fullWidth?` |

Barrel export: `components/ui/index.ts`

Mapeamentos semânticos (labels e classes de cor) permanecem em `lib/operational/deadline-display.ts` e `lib/operational/queue-display.ts` — os badges consomem essas funções internamente.

### Componentes removidos

Implementações locais eliminadas (não eram ficheiros separados):

| Duplicado | Ocorrências removidas |
|-----------|----------------------|
| `ProfileSection` inline | 3 — `clients/[clientId]`, `documents/[documentId]`, `deadlines/[deadlineId]` |
| `FieldRow` inline | 3 — mesmas páginas de detalhe |
| `<span>` StatusBadge neutral | 10 — listas + tabs + dashboard + opportunities |
| `<span>` StatusBadge deadline | 5 — deadlines list/detail, dashboard, case Prazos tab |
| `<span>` PriorityBadge queue | 3 — queues, case Trabalho tab, `QueueProjectionRow` |
| `<span>` PriorityBadge deadline | 3 — deadlines list/detail, case Prazos tab |
| `<button>` operacional | 9 — 4× paginação «Carregar mais», 4× acções de prazo, 1× sign-in submit |

**Fora de âmbito (mantidos inline):** badges contextuais únicos (`Bloqueado`, `Desactualizado`, `Motor` indigo), tabs segmentadas, filtros, inputs/textarea/select, botão retry do `OperationalErrorState`.

### Páginas migradas

| Rota / módulo | Primitives aplicadas |
|---------------|---------------------|
| `/clients/[clientId]` | ProfileSection, FieldRow |
| `/documents/[documentId]` | ProfileSection, FieldRow |
| `/deadlines/[deadlineId]` | ProfileSection, FieldRow, StatusBadge, PriorityBadge, Button |
| `/cases` | StatusBadge, Button |
| `/clients` | StatusBadge, Button |
| `/documents` | StatusBadge, Button |
| `/deadlines` | StatusBadge, PriorityBadge, Button |
| `/queues` | PriorityBadge |
| `/dashboard` | StatusBadge |
| `/cases/[caseId]` (tabs Trabalho, Timeline, Oportunidades, Prazos, Motor) | StatusBadge, PriorityBadge |
| `/opportunities` | StatusBadge (neutral) |
| `/sign-in` | Button (primary) |
| `QueueProjectionRow` | PriorityBadge |

### Linhas aproximadas eliminadas

| Categoria | Linhas duplicadas removidas (est.) |
|-----------|-------------------------------------|
| ProfileSection + FieldRow locais | ~85 |
| StatusBadge inline | ~95 |
| PriorityBadge inline | ~40 |
| Button inline | ~65 |
| **Total eliminado** | **~285** |

| Categoria | Linhas adicionadas (est.) |
|-----------|--------------------------|
| Primitives `components/ui/*` | ~240 |
| Imports + JSX compacto nas páginas | ~50 |
| **Total adicionado** | **~290** |

**Saldo líquido:** ~±0 linhas no repositório; **~285 linhas de duplicação** substituídas por **~240 linhas centralizadas** (redução efectiva de ~45 linhas de código repetido).

### Impacto em manutenção

1. **Alteração visual única** — mudar padding, tipografia ou estados disabled de botões/badges passa a ser feita num só sítio (`components/ui/`).
2. **Semântica preservada** — variantes `deadline` vs `queue` vs `neutral` documentam intenção; mapeamentos PT e cores continuam nos módulos `operational/*-display.ts`.
3. **Perfil de entidade consistente** — `ProfileSection` + `FieldRow` garantem alinhamento entre Cliente, Documento e Prazo; `labelWidth="40"` cobre o perfil de cliente sem regressão visual.
4. **Preparação para Fase 2** — FilterBar, ListCard, SegmentedTabs e AppShell podem migrar sobre esta base sem tocar em backend.
5. **Risco reduzido** — typecheck e build Next.js passaram; nenhum contrato API alterado.

---

## Verificação

```
npx tsc --noEmit          # apps/web — OK
pnpm --filter @execflow/web build   # OK
```

---

## Próxima fase (não implementada)

Blueprint Phase 2: FilterBar, ListCard, SegmentedTabs, EntityProfile wrapper, Input/Select/Textarea, Breadcrumb.
