# EXECFLOW — Implementation Order

**Status:** Binding sequence for development phases.  
**Rule:** Do not begin a phase before its prerequisites are fully operational. A "mostly working" prior phase is not sufficient.

This order exists to prevent the most common failure mode in this class of system: building impressive UI on top of a broken data model, then discovering that the legal engine cannot be retro-fitted.

---

## Phase 0 — Foundation (current)

**Status:** In progress

### 0.1 · Architecture corpus (complete)
All documents in `/docs` are authored and internally consistent:
- `functional-architecture.md` ✓
- `execution-workflows.md` ✓
- `data-model-v1.md` ✓
- `execution-engine.md` ✓
- `office-operating-system.md` ✓
- `playbook-system.md` ✓
- `ux-flow-architecture.md` ✓
- `project-governance/` ✓ (this file)

### 0.2 · Frontend shell (complete)
The dashboard shell exists and renders without errors. It has no real data. It will be expanded in Phase 3.
- Next.js + App Router running ✓
- TailwindCSS configured ✓
- Dark premium shell rendered ✓
- No business logic in frontend ✓

### 0.3 · Monorepo structure (to do)
Before writing any backend code, the workspace structure must be finalized:
- `apps/web` — Next.js frontend (exists)
- `apps/api` — Backend API (to scaffold)
- `packages/engine` — Execution engine (to scaffold)
- `packages/playbooks` — Playbook runtime (to scaffold)
- `packages/db` — Database schema and client (to scaffold)
- `packages/types` — Shared TypeScript types (to scaffold)
- `infrastructure/` — Docker, CI, deployment config (to scaffold)

**Do not proceed to Phase 1 without the monorepo scaffold.**

---

## Phase 1 — Data layer

**Prerequisite:** Phase 0 complete.

### 1.1 · Database schema (Prisma)
Implement `packages/db` as the full Prisma schema derived from `data-model-v1.md`:
- Core identity: `Organization`, `User`, `UserRole`
- Case entities: `Client`, `ExecutionCase`, `PrisonUnit`
- History entities: `TimelineEvent`, `SentenceSnapshot`, `ExecutionCustodySnapshot`
- Document entities: `Document`, `DocumentExtraction`
- Work entities: `Deadline`, `Opportunity`, `PieceDraft`, `PieceVersion`, `Filing`
- Meta entities: `Task`, `VisitNote`, `Notification`, `AuditLog`, `AIAnalysis`
- Playbook entities: `PlaybookVersion`, `PlaybookRule`, `InterpretationBranch`

**Enforcement on this phase:**
- All immutable fields must have DB-level `NOT NULL` and no default update path
- AuditLog must be append-only (no `UPDATE`, no `DELETE` in schema or application)
- All org-scoped entities must have `organization_id` non-nullable with FK
- Temporal fields follow the split documented in `data-model-v1.md §5`

### 1.2 · Migration and seed tooling
- First migration: clean schema from 1.1
- Seed: org, admin user, sample PrisonUnits, base playbook
- All seeds idempotent

### 1.3 · Database access patterns
- Establish index strategy per `data-model-v1.md §7`
- Validate N+1 prevention strategy for queue views
- Establish RLS or service-layer org scope enforcement (choose and document)

**Do not begin Phase 2 before schema is final and migration passes.**

---

## Phase 2 — Authentication and organization bootstrap

**Prerequisite:** Phase 1 complete.

### 2.1 · Authentication
- User auth (email/password or provider — to decide)
- Session management
- Role enforcement (Admin, Lawyer, Assistant)
- Multi-organization isolation verified by test

### 2.2 · Organization bootstrap API
Routes sufficient to:
- Create organization
- Invite user
- Assign roles
- Fetch current user + org context

### 2.3 · Base playbook seed
- First published `PlaybookVersion` with standard Brazilian execution rules
- Rule set to be validated against known progression cases before activation
- Version pinned — not auto-updated

---

## Phase 3 — Core case management API

**Prerequisite:** Phase 2 complete.

### 3.1 · Client and ExecutionCase CRUD
- Create Client (required fields per `data-model-v1.md §2.2`)
- Create ExecutionCase linked to Client
- State machine for case status (`functional-architecture.md §4.1`)
- AuditLog on every write (Phase 1 schema must already support this)

### 3.2 · Document ingestion pipeline
- Upload endpoint → `Document` record + blob storage key
- Async OCR job trigger → `DocumentExtraction.status=extracting`
- Extraction completion → proposed fields → `status=needs_review`
- Human review route → confirm fields → `status=completed`

No AI agent routing in this phase. Plain ingestion.

### 3.3 · TimelineEvent append API
- Append any event type to an ExecutionCase timeline
- Read timeline for a case (ordered)
- Validate immutability: no UPDATE or DELETE on timeline rows

### 3.4 · SentenceSnapshot API
- Create proposed snapshot (manual or from extraction)
- Confirm snapshot (lawyer only, sets `confirmed_by_user_id`)
- Fetch snapshot history for a case

---

## Phase 4 — Execution engine (core)

**Prerequisite:** Phase 3 complete, first confirmed SentenceSnapshot and ExecutionCustodySnapshot exist.

### 4.1 · PlaybookVersion runtime
- `packages/engine` reads active `PlaybookVersion` for org
- Rule lookup API (internal): given rule ID → returns current parameters
- All engine calls cite `playbook_version_id` and `rule_ids_applied[]`

### 4.2 · Sentence arithmetic engine
- Input: confirmed `SentenceSnapshot` array for a case
- Output: `EngineRun` with `SentenceCalculation` (served, remaining, fractions)
- Each output carries full ExplanationBundle
- Replay: given `as_of` timestamp, reconstruct calculation from snapshots valid at that time
- No legal output without ExplanationBundle — incomplete runs error

### 4.3 · Progression opportunity evaluator
- Input: `EngineRun` result
- Output: `Opportunity.suggested` with confidence, blocking conditions, missing data
- Human qualification gate: route to lawyer queue; lawyer action required before status advances

### 4.4 · Benefit opportunity evaluators
Implement evaluators one at a time, in order of practice frequency:
1. Remição
2. Detração
3. Indulto/Comutação (decree-driven)
4. Prescrição
5. Excesso de execução
6. PAD defense window

Each evaluator has its own test matrix before going to Phase 5.

---

## Phase 5 — Deadline engine

**Prerequisite:** Phase 4 core progression engine passing test matrix.

### 5.1 · Automatic deadline generation
- On confirmed snapshot or opportunity → generate derived deadlines per playbook rules
- `Deadline.origin = rule` for auto-generated deadlines
- `Deadline.playbook_version_id` required

### 5.2 · Manual deadline API
- Create manual deadline attached to ExecutionCase
- Edit open deadline (non-completed only)
- Cancel with reason

### 5.3 · Overdue detection and escalation
- Background job: check overdue deadlines, produce `EngineWarning` for escalation queue
- Lawyer escalation notification for missed critical deadlines
- No silent overdue — every overdue deadline must be visible in a named queue

---

## Phase 6 — Queue engine and operational workflows

**Prerequisite:** Phase 5 complete.

### 6.1 · Queue computation
- Derive queue membership from entity state per `office-operating-system.md §2`
- Implement each queue as a typed API endpoint (not a generic filter)
- Queue item counts per role surfaced in API
- SLA tracking per queue type

### 6.2 · Piece workflow
- `PieceDraft` creation (from template or blank)
- AI draft generation (into `PieceVersion.body` — status `draft`)
- Assistant preparation flow
- Lawyer review → inline comment → approve/reject
- `Filing` record creation on approve-and-file (lawyer only)
- Version history read

### 6.3 · Notification engine
- On qualifying events, dispatch typed notifications to correct roles
- Deduplicate by `dedupe_key`
- Mark read / acknowledge / snooze
- Digest scheduling for non-interrupt events

---

## Phase 7 — Frontend: operational surfaces

**Prerequisite:** Phase 6 complete. API is operational. Queues work. Notifications work.

**Rule:** Do NOT build polished frontend features for workflows that have no working backend. Frontend phase is not "finishing touches" — it is the full frontend implementation, now that the system has real data and real behavior to display.

### 7.1 · Authentication and org bootstrap screens
- Login
- Org setup
- User invite

### 7.2 · Dashboard — queue-first view
- Connect queue API to dashboard shell (Phase 0 shell)
- Queue counts and drill-down lists
- Role-filtered default view

### 7.3 · ExecutionCase workspace
- Case header with snapshot summary
- Timeline view
- Opportunity list with lawyer qualify/dismiss actions
- Deadline list with status and escalation indicators
- Document list with extraction review

### 7.4 · Piece workspace
- Draft editor
- Comment layer
- Approve / file actions with confirmation
- Version history

### 7.5 · Intake flow
- Document upload
- Extraction review
- Case association
- Engine run trigger

### 7.6 · Notification center
- Interrupt layer (bell)
- Digest view
- Acknowledgment and snooze

---

## Phase 8 — AI agent integration

**Prerequisite:** Phase 7 operational. Human workflows work without AI.

**Rule:** AI agents augment working workflows — they do not replace them. If a workflow requires AI to function, the workflow is broken.

### 8.1 · Ingestion agent
- Replace manual OCR trigger with AI-assisted extraction
- All output routes to `DocumentExtraction.proposed_fields` for human review
- No change to review-confirm gate

### 8.2 · Analysis agent
- Opportunity and deadline suggestions from confirmed snapshots
- All output routes to `suggested` status queues for human review
- ExplanationBundle required on every output

### 8.3 · Drafting agent
- Generate piece body from confirmed case facts + template
- All output routes to `PieceVersion.status=draft`
- Lawyer review and approval unchanged

### 8.4 · Notification routing
- AI-assisted prioritization within existing notification framework
- Does not create new notification categories without playbook reference

---

## Phase 9 — Analytics, reporting, and admin tooling

**Prerequisite:** Phase 8 stable.

This phase is deliberately last. Analytics on top of an operational system is reliable. Analytics on top of an incomplete operational system is misleading.

- Case portfolio views (read-only derived views)
- Deadline compliance metrics
- Opportunity detection rates
- AI confidence trend reports
- Playbook version comparison reports
- Office productivity summaries

---

## Rules for this sequence

1. **No phase skipping.** A frontend feature for Phase 7 is not built in Phase 0 because "it's just a placeholder."

2. **No partial parallelism on dependent layers.** Frontend team may stub API responses in Phase 0–6 for design purposes. Stubs are replaced — not promoted to production — once the real API exists.

3. **Test matrices before phase promotion.** Legal engine evaluators (Phase 4) require a passing test matrix of known legal cases before proceeding to dependent phases.

4. **Architecture documents update when reality diverges.** If implementation reveals that a spec is wrong, fix the spec first, then fix the code. Do not silently diverge from the spec.

5. **Playbook changes are not code deploys.** Law changes handled by a new `PlaybookVersion`, not by modifying source code constants and deploying.
