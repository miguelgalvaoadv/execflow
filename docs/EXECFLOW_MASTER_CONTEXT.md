# EXECFLOW — Master Architectural Continuity Dossier

**Classification:** Internal institutional document — principal-engineer continuity  
**Version:** 1.0  
**Date:** 2026-05-20  
**Authored by:** Architectural continuity analysis of full repository state  
**Status:** Authoritative — supersedes any stale section of any other doc  
**Scope:** Complete system — all packages, all migrations, all docs, all runtime evidence  

> This document is the primary handoff artifact for any engineer or AI agent taking over this system.  
> It separates runtime truth from compile-time illusion, architecture from roadmap, and validated behavior from intended behavior.  
> Read it before touching anything.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Identity](#2-system-identity)
3. [Original Vision](#3-original-vision)
4. [Real Operational Problem](#4-real-operational-problem)
5. [Historical Evolution of the Architecture](#5-historical-evolution-of-the-architecture)
6. [Governance Emergence](#6-governance-emergence)
7. [Non-Negotiable Invariants](#7-non-negotiable-invariants)
8. [Complete Architectural Philosophy](#8-complete-architectural-philosophy)
9. [Queue-First Operational Model](#9-queue-first-operational-model)
10. [Event-Driven System Model](#10-event-driven-system-model)
11. [Deterministic Engine Philosophy](#11-deterministic-engine-philosophy)
12. [Replay and Temporal Integrity Model](#12-replay-and-temporal-integrity-model)
13. [Append-Only Strategy](#13-append-only-strategy)
14. [Human Authority and AI Constraints](#14-human-authority-and-ai-constraints)
15. [Explainability Requirements](#15-explainability-requirements)
16. [State Machine Discipline](#16-state-machine-discipline)
17. [Full Technical Stack](#17-full-technical-stack)
18. [Monorepo Structure](#18-monorepo-structure)
19. [Database Architecture](#19-database-architecture)
20. [Migration Strategy](#20-migration-strategy)
21. [Authentication and Tenant Isolation](#21-authentication-and-tenant-isolation)
22. [Audit and Provenance Systems](#22-audit-and-provenance-systems)
23. [Workflow Architecture](#23-workflow-architecture)
24. [Deadline System](#24-deadline-system)
25. [Opportunity System](#25-opportunity-system)
26. [Queue System](#26-queue-system)
27. [Escalation and SLA Systems](#27-escalation-and-sla-systems)
28. [Worker Architecture](#28-worker-architecture)
29. [Outbox and Propagation Architecture](#29-outbox-and-propagation-architecture)
30. [Engine Architecture](#30-engine-architecture)
31. [Evaluator System](#31-evaluator-system)
32. [Playbook System](#32-playbook-system)
33. [Rule Resolution Model](#33-rule-resolution-model)
34. [Snapshot Architecture](#34-snapshot-architecture)
35. [Dependency Tracking](#35-dependency-tracking)
36. [Staleness Propagation](#36-staleness-propagation)
37. [Recalculation Architecture](#37-recalculation-architecture)
38. [Runtime Validation History](#38-runtime-validation-history)
39. [Replay Safety Assessment](#39-replay-safety-assessment)
40. [Deterministic Integrity Assessment](#40-deterministic-integrity-assessment)
41. [Real vs Scaffold Matrix](#41-real-vs-scaffold-matrix)
42. [Runtime-Proven vs Assumed Systems](#42-runtime-proven-vs-assumed-systems)
43. [Operational Maturity Assessment](#43-operational-maturity-assessment)
44. [Technical Debt Assessment](#44-technical-debt-assessment)
45. [Highest-Risk Architectural Areas](#45-highest-risk-architectural-areas)
46. [Dangerous Future Failure Modes](#46-dangerous-future-failure-modes)
47. [Architectural Anti-Patterns Intentionally Avoided](#47-architectural-anti-patterns-intentionally-avoided)
48. [What Still Does NOT Exist](#48-what-still-does-not-exist)
49. [Remaining Major Engineering Work](#49-remaining-major-engineering-work)
50. [Estimated Remaining Project Completion](#50-estimated-remaining-project-completion)
51. [Estimated Remaining Runtime Hardening](#51-estimated-remaining-runtime-hardening)
52. [Estimated Remaining Productization Work](#52-estimated-remaining-productization-work)
53. [Safest Next Engineering Steps](#53-safest-next-engineering-steps)
54. [Unsafe Next Steps That Should Be Avoided](#54-unsafe-next-steps-that-should-be-avoided)
55. [Long-Term Expansion Possibilities](#55-long-term-expansion-possibilities)
56. [Final Strategic Assessment](#56-final-strategic-assessment)

---

## 1. Executive Summary

EXECFLOW is a deterministic legal operations platform for Brazilian criminal execution practice (execução penal). It manages the complete operational lifecycle of execution cases: intake of legal documents, tracking of confirmed facts, engine-driven calculation of procedural opportunities (progressão de regime, remição, detração, HC, etc.), queue-driven human review, and append-only audit provenance for all actions.

**Current operational state as of 2026-05-20:** The foundational architecture is substantially built. The database schema covers all major entities across 6 migrations. The engine pipeline evaluates playbook rules against confirmed case facts and commits results with transactional outbox events. The workers consume domain events, maintain queue projections, and manage SLA escalations. The API handles authentication, org isolation, and domain mutations. A functional frontend operational shell now exists.

**What is runtime-proven:** The full authentication and session chain. Engine evaluation end-to-end (evaluate → persist EngineRun → outbox events). Queue projection upserts for opportunity events. HTTP validation via the `validate:http-engine` script. Smoke runtime validation via the `smoke:runtime` script.

**Critical gaps:** No HTTP list/read endpoints for most entities (cases, clients, deadlines, opportunities). The recalculation execution chain has a broken loop — scheduled recalculations are never triggered to execute. Three confirmed SQL/runtime mismatches that would cause production failures. The frontend reads real queue data but has no action surfaces. Approximately 60–65% of the documented product surface does not yet exist.

**Architectural integrity:** High. The append-only model, outbox propagation, human authority boundaries, deterministic engine, and replay semantics are architecturally sound and consistently enforced in code. Governance documents align with implementation on all critical invariants.

---

## 2. System Identity

EXECFLOW is not a generic legal SaaS application. It is a **legal operations platform** engineered around the specific epistemological and legal constraints of Brazilian criminal execution proceedings. It serves execution lawyers and their support staff, not the courts. It manages hundreds of concurrent active executions where arithmetic errors, missed deadlines, and incorrect legal state can result in prolonged or unlawful incarceration.

The fundamental identity claims:

- **Execution-first, not case-management-first.** The center of gravity is the queue of actionable work items, not a document repository. The system organizes around what must be done today, not what has been accumulated.
- **Deterministic legal reasoning.** The engine never guesses. Every opportunity suggestion carries a complete provenance chain: which rules fired, which snapshots were consumed, what data is missing, and what the confidence level is.
- **Non-binding AI.** The engine is explicitly computational staff, not legal authority. Every suggestion requires human lawyer qualification. This is not a product choice — it is a legal liability constraint.
- **Append-only legal history.** No legal record is ever deleted or overwritten. Every confirmation, every transition, every decision is preserved with its actor, timestamp, and causal chain.
- **Queue-first operations.** Work enters named queues and exits through human review actions. The system does not deliver a wall of data — it surfaces the next action.

These are not design preferences. They are the operational demands of an institution that manages human liberty.

---

## 3. Original Vision

The system was conceived as a command center for execution practice: a tool that would organize the chaos of managing hundreds of cases with heterogeneous facts, multiple legal opportunity types, complex arithmetic (sentence arithmetic, remission calculation, detraction), and high-stakes deadlines under professional pressure.

Early design assumed:
- A relatively standard SaaS CRUD model might work (later explicitly rejected).
- Prisma as ORM (later replaced by Drizzle; `IMPLEMENTATION_ORDER.md` is stale on this point).
- A phased implementation from foundation to advanced features.

What survived from the original vision: the queue-first model, the role separation (lawyer authority over legal actions), and the insight that AI must suggest rather than decide.

What was discarded: the simplistic CRUD model. Queues as derived state (not directly written by API) emerged as an architectural invariant. The append-only constraint hardened from preference to inviolable rule. The event-driven propagation model replaced direct synchronous mutations.

---

## 4. Real Operational Problem

A Brazilian criminal execution practice managing 200–2,000 active cases faces:

1. **Arithmetic complexity.** Sentence calculation involves confirmed dates, recognized remission certificates, detraction periods, interruption events, and regime progression thresholds. Each calculation has an authoritative source document and a legal dispute surface. Errors have real liberty consequences.

2. **Temporal heterogeneity.** Legal facts have occurred-at timestamps that differ from system-recorded-at timestamps by months or years (retroactive confirmations, delayed judicial decisions). The system must maintain two independent clocks and query correctly against both.

3. **Multi-case volume under professional pressure.** A senior lawyer with 400 active cases cannot hold all relevant deadlines and opportunities in working memory. The system must surface the priority-ordered action queue.

4. **Auditability under adversarial conditions.** In disciplinary proceedings or regulatory review, the practice must demonstrate exactly who decided what, when, based on what information. A mutable database provides no such guarantee.

5. **AI reliability risk.** An AI system that autonomously qualifies an opportunity, drafts a petition, or confirms a snapshot can directly cause a client to remain incarcerated beyond their legal entitlement — or to receive a benefit to which they are not entitled. Neither error is acceptable. The human gate is not optional.

6. **Snapshot versioning.** Courts issue amended sentencing decisions. New remission certificates supersede prior ones. The system must handle snapshot supersession without corrupting the historical record.

---

## 5. Historical Evolution of the Architecture

**Phase 0 — Foundation establishment:**  
Monorepo structure (Turborepo), PostgreSQL schema design, Better Auth, multi-tenant isolation via org membership. Drizzle selected over Prisma (Prisma rejected for type complexity under complex temporal queries and migration limitations). Hono selected for API over Express (better typing, no middleware complexity).

**Phase 1 — Core entity model:**  
`organizations`, `users`, `memberships`, `clients`, `execution_cases`, `sentence_snapshots`, `custody_snapshots`, `timeline_events`. Append-only confirmed. Two-clock principle established.

**Phase 2 — Auth layer:**  
Better Auth tables (`ba_user`, `ba_session`, `ba_account`) isolated from domain users. Domain `users` table linked to Better Auth by shared UUID. Organization context resolved from session + explicit `X-Organization-Id` header.

**Phase 3 — Core entities extended:**  
`intake_bundles`, `documents`, `prison_units`. Intake → document association pipeline started.

**Phase 4 — Deadline and Opportunity systems:**  
State machines formalized. `deadline_history`, `opportunity_reviews`, `opportunity_status_history`. Event sourcing for state transitions. Mandatory review records on every opportunity transition.

**Phase 5 — Queue and workflow:**  
`queue_projections` (derived, worker-owned), `workflow_tasks`, `queue_assignments`, `queue_escalations`. Queue-first operational model formalized. Workers established as the only writers of queue state.

**Phase 6 — Engine, playbook, evaluation:**  
`playbook_families`, `playbook_versions`, `org_playbook_configs`, `case_playbook_contexts`, `engine_runs`, `engine_rule_traces`, `explanation_bundles`, `snapshot_dependencies`, `recalculation_runs`. The deterministic engine built as a pure computation package. Commit step separated from evaluation step. Replay semantics introduced.

**Phase 7 — Operational propagation:**  
Engine commit now emits `opportunity.created` and `engine.run.completed` domain events in the same transaction. HTTP routes accept `propagation` context (correlationId). Workers consume engine events. Frontend operational foundation established.

**Trajectory assessment:** Each phase built on the previous without architectural regression. The append-only guarantee and event outbox pattern strengthened consistently. The key architectural evolution was the transition from "direct API writes queue" to "API writes events → workers derive queue state" — this happened at Phase 5 and resolved a critical consistency problem.

---

## 6. Governance Emergence

Five binding governance documents exist under `docs/project-governance/`:

**`AI_BOUNDARIES.md`** — Binding list of what AI may and may not do. Prohibits autonomous qualification, filing, snapshot confirmation, or legal conclusion. Requires ExplanationBundle on every AI output. Confidence composition rule (minimum of critical inputs). Human review gates explicitly enumerated.

**`ARCHITECTURE_RULES.md`** — Technical constraints. F-01 through F-05 (no business logic in frontend, no auth bypass), D-01 through D-04 (append-only legal history, no hard delete), A-01 through A-03 (AI proposal-only, no auto-filing), S-01 through S-02 (state machines in service layer, queues as derived state), P-01 through P-02 (playbook versioning, no hardcoded legal parameters), M-01 through M-02 (org isolation on every query, multi-tenant by design).

**`ENGINEERING_PRINCIPLES.md`** — 12 principles including: spec-first, append-only, explainability, audit on every write, two-clock temporal model, confirmed-only engine inputs, versioned legal rules, LGPD compliance, queue-first UX, scale targets (200–2,000 cases), strict layer separation.

**`IMPLEMENTATION_ORDER.md`** — Phase sequence document. **STALE:** Still references Prisma (replaced by Drizzle), references "Phase 0.3 monorepo setup" as pending (already done). Do not use as current status — use this dossier instead.

**`PROJECT_CONTEXT.md`** — Strategic context: execution penal command center, queue-first, human authority chain, Brazilian legal domain.

**Assessment:** The governance documents align with implementation on all critical invariants. The stale parts of `IMPLEMENTATION_ORDER.md` are documentation drift and not architectural drift — the code correctly implements the intent. Governance is healthy.

---

## 7. Non-Negotiable Invariants

These invariants must never be broken by any future engineer or AI agent. Violating any of them would compromise the legal correctness or safety of the system.

**I-01: Append-only legal history.** `audit_logs`, `domain_events`, `timeline_events`, `sentence_snapshots`, `custody_snapshots`, `deadline_history`, `opportunity_reviews`, `opportunity_status_history`, `engine_rule_traces`, `explanation_bundles`, `snapshot_dependencies`, `recalculation_runs` — none of these may ever be mutated or deleted. Any future change must add new rows, not modify existing ones.

**I-02: Engine outputs are non-binding.** The engine creates opportunities with `status='suggested'` only. A lawyer must explicitly qualify them. No code path may set `Opportunity.status = 'qualified'` without a corresponding `opportunity_reviews` record written by a human actor.

**I-03: Confirmed facts only as engine input.** `loader.ts` only reads `status='confirmed'` snapshots. No proposed, draft, or superseded snapshot may ever inform an engine evaluation.

**I-04: No direct queue writes from API.** `queue_projections` and `workflow_tasks` are owned by workers. API routes read queue projections (GET only) and mutate workflow tasks (claim/release/complete). No API route may insert or update queue projections directly.

**I-05: Transactional outbox.** Every domain mutation that must propagate must write to `domain_events` in the same transaction as the mutation. The relay publishes to pg-boss asynchronously. This two-phase pattern must not be short-circuited by direct `boss.send()` from API routes.

**I-06: Replay determinism.** `isReplay: true` commits must not create opportunities or emit operational domain events. This is enforced in `commit.ts` and `commit-propagation.ts`. Future evaluators must also skip side effects when replay semantics are active.

**I-07: Org isolation.** Every database query in every service must include `organizationId` as a filter. The org middleware enforces membership. No endpoint may return data from a different org than the authenticated session's active org.

**I-08: Human authority at legal transitions.** The VALID_TRANSITIONS map in `opportunity.ts` is the authoritative state machine. No future code may bypass it via a direct DB update. Same applies to deadline transitions in `deadline.ts`.

**I-09: ExplanationBundle mandatory.** Every engine opportunity proposal must produce an `explanation_bundles` row linked to it. No opportunity may be surfaced to users without a traceable rule citation and missing-data inventory.

**I-10: No legal parameters in code.** All legal thresholds, fractions, and calculation parameters must come from a published `playbookVersion`. No hardcoded `1/6`, `2/5`, or legal fraction may appear in application code.

---

## 8. Complete Architectural Philosophy

### Causal chain as first-class citizen

Every system action has a causal chain: `correlationId` (the operation that started the chain) and `causationId` (the specific event that caused this action). This makes the audit trail traversable — given any domain event, you can trace backwards to the original HTTP request or worker trigger.

### Layer separation as enforcement mechanism

- **Engine package:** pure computation, reads DB, never writes DB during evaluation, exposes `runEvaluation` (pure) and `commitEngineRun` (transactional).
- **API:** orchestrates services, never imports from `packages/workers`, never calls pg-boss directly.
- **Workers:** consume events, write derived state, call engine package, never expose HTTP.
- **Frontend:** consumes projections, never derives legal state, never calls engine directly.

### Temporal duality

Every legal fact has two timestamps: `occurredAt` (when it happened in legal reality) and `recordedAt`/`createdAt` (when the system learned about it). These cannot be collapsed. A sentence issued in 2023 but entered into the system in 2026 has `occurredAt: 2023`, `recordedAt: 2026`. Engine evaluations at a point-in-time use `occurredAt` for legal calculations.

### Derived state discipline

Queue projections, workflow tasks, and SLA escalations are all derived from events. They can be reconstructed from the append-only event log. This is the core of operational resilience — if the projection layer is corrupted, it can be rebuilt.

### Confidence as a first-class value

Every engine output carries an uncertainty model. Confidence is `min(critical_inputs)`. Low-confidence outputs are suppressed, not rounded up. The `blocking_codes` array on engine runs encodes exactly why evaluation could not proceed. Missing data is surfaced explicitly, not silently dropped.

---

## 9. Queue-First Operational Model

The queue is the operative interface of EXECFLOW. The system is not a case browser — it is a work-item surface.

**Queue catalog (from `queue.ts` schema):**

| Queue type | Description | Writer(s) |
|---|---|---|
| `intake_review` | New intake bundles pending extraction | `handleIntakeRegistered` |
| `extraction_review` | OCR extractions pending field confirmation | OCR workers (not yet built) |
| `missing_data` | Cases with blocking missing data | engine + workers |
| `progression_opportunities` | Progression opportunities (lawyer-first) | `handleOpportunityCreated` |
| `opportunity_review` | Non-progression opportunities (assistant triage) | `handleOpportunityCreated` |
| `overdue_deadlines` | Deadlines past `due_at` | `runOverdueSweep` |
| `urgent_liberty_risks` | High-priority liberty risk items | escalation engine |
| `recalculation_conflicts` | Engine runs with arithmetic conflicts | not yet wired |
| `pad_defense` | PAD defense window deadlines | deadline consumer |
| `pending_filings` | Piece drafts awaiting protocol | not yet wired |
| `ai_review` | Low-confidence AI suggestions for expert review | not yet wired |
| `workflow_tasks` | Generic task items | `createOpportunityReviewTask` |

**Queue routing for opportunities:** `opportunityType === 'progression'` → `progression_opportunities` (lawyer-first). All others → `opportunity_review` (assistant triage first). This is enforced in `opportunity-events.ts:routeOpportunityToQueue`.

**Queue ownership:** Workers exclusively write queue projections. The API reads them (GET `/api/v1/queue-projections`). The frontend reads them. No other write path exists.

**Queue lifecycle:** `active` → claimed → (completed / snoozed / escalated). `resolveQueueProjection` marks items `resolved`. `upsertQueueProjection` is idempotent by `(organizationId, queueType, entityType, entityId)` natural key.

---

## 10. Event-Driven System Model

### Event taxonomy

All events written to `domain_events` have `eventType` values that mirror pg-boss queue names. The relay's `boss.send(row.event_type, ...)` is the binding coupling point.

**Confirmed event producers:**
- `case.created` — `case.ts`
- `client.created` — `client.ts`
- `intake.registered` — `intake.ts`
- `document.associated`, `document.confirmed` — `document.ts`
- `timeline.event.appended` — `timeline.ts`
- `deadline.created`, `.acknowledged`, `.completed`, `.dismissed`, `.overdue` — `deadline.ts` + overdue sweep
- `opportunity.created` (was: `opportunity.suggested` — corrected 2026-05-20), `.qualified`, `.deferred`, `.dismissed`, `.reviewed` — `opportunity.ts`
- `sentence.snapshot.superseded`, `custody.snapshot.created` — snapshot services (if wired — not confirmed in API layer)
- `engine.evaluation.requested` — producer not built (consumer exists; no writer sends this from any current code path)
- `engine.recalculation.scheduled` — queue name exists; no producer in code
- `engine.run.completed` — `commit-propagation.ts`
- `opportunity.created` (engine-sourced) — `commit-propagation.ts`

**Event consumers registered in `worker-registry.ts` (18 total):**
deadline.created, deadline.acknowledged, deadline.completed, deadline.dismissed, deadline.overdue, opportunity.created, opportunity.qualified, opportunity.reviewed, opportunity.deferred, opportunity.dismissed, intake.registered, document.associated, document.confirmed, timeline.event.appended, sentence.snapshot.superseded, custody.snapshot.created, engine.evaluation.requested, engine.run.completed.

**Consumers with no confirmed producer in current code:**
- `engine.evaluation.requested` — no API route or worker currently emits this. The `handleEngineEvaluationRequested` consumer is dead until a recalculation completion triggers it.
- `engine.recalculation.scheduled` — queue name in `DOMAIN_EVENT_QUEUES` but no `boss.work` registered.
- `sentence.snapshot.superseded` — consumer exists; no API route for snapshot supersession.
- `custody.snapshot.created` — consumer exists; no API route for custody snapshot creation.

**Idempotency mechanism:** Outbox relay uses `singletonKey: event.id` in pg-boss. Consumers do not re-check for duplicate execution except `workflow-task.ts` (idempotent via `sourceCausingEventId`).

---

## 11. Deterministic Engine Philosophy

The engine is the most carefully architected component in the system. Its invariants:

**Separation of evaluation from persistence.** `runEvaluation` reads the DB and produces `EngineRunResult` — a pure data structure. It writes nothing. Only `commitEngineRun` writes. This allows evaluation to be called speculatively for the replay path without side effects.

**Pure evaluators.** All three registered evaluators (`progressionFraction`, `blockingConditionCheck`, `snapshotStalenessCheck`) are registered in `rules/registry.ts` as pure functions taking `RuleEvaluatorInput` and returning `RuleEvaluatorOutput`. They access no external state.

**Determinism contract.** Given the same `CaseFacts` and `ResolvedPlaybook`, the same evaluator must always produce the same output. `outputsHash` on rule traces captures this for replay verification.

**Confidence composition.** `rules/confidence.ts` computes aggregate confidence as `min(critical_path_inputs)`. A high-confidence evaluator cannot produce a high-confidence opportunity if its inputs are uncertain.

**Blocking-first.** `evaluation/blocking.ts` runs before opportunity evaluators. `GlobalBlockingCode` values prevent evaluation from proceeding: `BLK_SNAPSHOT_UNCONFIRMED`, `BLK_MISSING_PROCESS_NUMBER`, etc. A blocked run commits but creates no opportunities.

**Non-binding outputs.** The engine commit creates opportunities with `status='suggested'`. The word "suggested" is load-bearing — it is not a legal conclusion.

**Known gap — `useHistoricalPlaybook`:** `replayAtPointInTime` accepts a `useHistoricalPlaybook: boolean` parameter. The implementation in `point-in-time.ts` calls `resolvePlaybookVersions` with `evaluatedAt: asOfDate` regardless of this flag. The resolver already handles `evaluatedAt` correctly for temporal playbook resolution, so in practice historical playbooks ARE used — but the flag does nothing, and the function signature promises more control than it provides.

---

## 12. Replay and Temporal Integrity Model

**Replay semantics:** `replayAtPointInTime` calls `runEvaluation` with an `asOfDate` parameter. `snapshots/loader.ts` filters confirmed snapshots by `effectiveAt <= asOfDate` and `(supersededAt IS NULL OR supersededAt > asOfDate)`. This correctly reconstructs the legal state at the point in time.

**Replay does not commit.** The replay path calls `runEvaluation` but not `commitEngineRun`. The result is returned to the HTTP caller as a non-binding simulation. No `EngineRun` row, no `Opportunity` rows, no outbox events.

**Consistency check.** After replay evaluation, `point-in-time.ts` runs the same evaluation with current facts and compares `outputsHash` values on rule traces. `consistentWithCurrent` in the replay bundle indicates whether historical and current evaluations agree. This is a true determinism check.

**Temporal invariant.** Because `snapshot.effectiveAt` is `occurred_at` (the legal date), point-in-time replay correctly handles retroactive confirmations. If a snapshot for a date in 2023 was confirmed in 2026, replay at 2024 will include it (because `effectiveAt = 2023 <= 2024`) unless it was superseded before 2024.

**Replay safety assessment:** The replay mechanism is architecturally sound. The primary risk is the `useHistoricalPlaybook` flag being unused — future engineers may rely on it and get unexpected behavior. This is documented in §39.

---

## 13. Append-Only Strategy

**What is truly append-only (no UPDATE on domain-critical columns):**
- `audit_logs` — insert-only; no update hooks
- `domain_events` — `processing_status`, `published_at`, `locked_until`, `retry_count`, `failed_at`, `last_error_message` are mutable (relay lifecycle); `event_type`, `payload`, `occurred_at`, `actor_*`, `aggregate_*`, `correlation_id`, `causation_id` are immutable
- `timeline_events` — fully immutable after insert
- `sentence_snapshots`, `custody_snapshots` — new confirmed version creates new row; superseded row's `superseded_at` is set (one-time mutation for provenance)
- `deadline_history` — append-only; new row per state change
- `opportunity_reviews`, `opportunity_status_history` — append-only; state machine transitions create new rows
- `engine_rule_traces`, `explanation_bundles`, `snapshot_dependencies` — fully immutable after insert
- `recalculation_runs` — status updates allowed (running → completed/failed); append-only at creation
- `queue_assignments`, `queue_escalations` — append-only

**What is mutable (by design):**
- `organizations`, `users`, `memberships` — operational configuration
- `clients`, `execution_cases` — operational status, metadata
- `deadlines`, `opportunities` — current status (history tracked separately)
- `queue_projections`, `workflow_tasks` — derived operational state
- `playbook_versions` — `published_at` set once; `deprecated_at` set once

**Critical distinction:** For `deadlines` and `opportunities`, the current status row is mutable, but the history is append-only. This means you can always reconstruct the full lifecycle but the current row reflects present state. This is correct for operational queries.

---

## 14. Human Authority and AI Constraints

`AI_BOUNDARIES.md` and `ARCHITECTURE_RULES.md` establish the human authority model. Current implementation compliance:

**Implemented and enforced:**
- Opportunities created as `suggested` by engine; require `requireMinRole('lawyer')` to qualify — route-level RBAC on `POST /api/v1/opportunities/:id/review`
- Engine evaluate/recalculate requires `requireMinRole('lawyer')` — enforced in `engine.ts`
- Replay returns explicit non-binding disclaimer in Portuguese
- Every opportunity review creates mandatory `opportunity_reviews` and `opportunity_status_history` rows
- `commitEngineRun` never creates `qualified` or `pursuing` opportunities

**Partially implemented:**
- ExplanationBundle mandatory — implemented for engine-generated opportunities; not enforced for manually-created opportunities (service creates them without explanation bundles)
- Confidence transparency — `uncertaintyLevel` and `blockingCodes` on engine runs; not yet surfaced to frontend

**Not yet implemented:**
- Batch opportunity review with human confirmation
- Mandatory lawyer review gate enforced at UI level (only enforced at API level)
- Piece draft approval workflow
- `AI_BOUNDARIES.md` mentions `document.associated` OCR extraction → field-level confirmation — the OCR pipeline does not exist yet

**Assessment:** The human authority model is architecturally sound and correctly enforced at the API and service layers. Future frontend work must not add "confirm all" shortcuts that would make the required human review frictionless to the point of being nominal.

---

## 15. Explainability Requirements

`AI_BOUNDARIES.md` §5 requires every AI-produced output to have a structured `ExplanationBundle` with: `summary`, `playbook_version_id + rule_ids_applied`, `calculations`, `source_documents`, `missing_data`, `uncertainty_indicators`, `alternatives`.

**Current implementation:**
- `explanations/generator.ts` generates `ExplanationBundlePayload` per opportunity and per run
- `commitEngineRun` inserts `explanation_bundles` rows linked to each opportunity and to the run
- `GET /api/v1/engine/runs/:runId/explanation` returns bundles + rule traces

**Gap:** The `ExplanationBundlePayload` type in `types/index.ts` includes `calculations`, `sourceDocuments`, `missingData`, `uncertaintyIndicators`, and `alternatives`. The generator in `generator.ts` populates these from `EngineRunResult`, but the actual depth depends on evaluator output quality. The three registered evaluators (`progressionFraction`, `blockingConditionCheck`, `snapshotStalenessCheck`) populate basic fields. Real-world quality depends on playbook rule definitions that have not yet been built for all opportunity types.

---

## 16. State Machine Discipline

All domain state machines live in the service layer (`apps/api/src/services/`). The `VALID_TRANSITIONS` maps are the authoritative definitions.

**Opportunity state machine (implemented):**
```
suggested → qualified | dismissed | expired
qualified → pursuing | dismissed | expired
pursuing  → realized | dismissed | expired
realized  → (terminal)
dismissed → (terminal)
expired   → (terminal)
```

**Missing from spec:** `event-state-architecture.md` §3.4 also defines `blocked` and `abandoned`. Neither exists in the service VALID_TRANSITIONS. This is a **medium-severity documentation-code gap**. If `blocked` was intended for opportunities where blocking conditions prevent progression (e.g., active PAD), the system currently routes those to `dismissed` instead, which loses the semantics. Future engineers must decide whether to add these states or update the spec.

**Deadline state machine (implemented):** `open → acknowledged | completed | dismissed | overdue`. `overdue` is derived by the sweep (not a direct mutation). `snoozed` appears in `event-state-architecture.md` §3.5 but has no implementation — no API route, no service method, no schema column. The `queue_projections.snoozed_until` column exists but snooze is never set via any current code path.

**ExecutionCase status discrepancy:** `case.ts` creates cases with `status: 'intake'`. The `event-state-architecture.md` describes a `draft → active → suspended → closed` machine starting at `draft`. The initial status `intake` is not mentioned in the spec. This appears to be an implementation deviation — `intake` was chosen to indicate a case that has been received but not yet fully activated. This is a **medium-severity documentation-code gap** that requires a decision: update the spec to include `intake` as the first state, or rename `intake` to `draft` in the code.

---

## 17. Full Technical Stack

| Layer | Technology | Version | Status |
|-------|------------|---------|--------|
| Frontend | Next.js App Router | 16.2.6 | Operational shell |
| Frontend state | TanStack Query | 5.x | Installed, hooks live |
| Frontend state | Zustand | 5.x | Installed, not yet used |
| Frontend auth | Better Auth client | 1.6.11 | Wired to sign-in |
| Styling | Tailwind CSS v4 | ^4 | PostCSS-only, no config |
| API framework | Hono | ^4.12.19 | Operational |
| API server | @hono/node-server | ^2.0.2 | Operational |
| Auth server | Better Auth | 1.6.11 | Operational |
| ORM | Drizzle ORM | 0.45.2 | Operational |
| Database | PostgreSQL 16+ (Neon/local pg) | — | 6 migrations applied |
| DB client | @neondatabase/serverless + pg | — | Dual client |
| Job queue | pg-boss | 12.18.2 | Operational |
| Monorepo | Turborepo | 2.9.14 | Operational |
| Package manager | pnpm | 9.15.9 | Operational |
| TypeScript | TypeScript | 5.8.3 | Strict mode, zero errors |
| Runtime validation | tsx | 4.19.4 | Scripts operational |
| Workers runtime | tsx | 4.19.4 | Operational |

**Rejected technologies (intentionally):** Prisma (replaced by Drizzle), Supabase BaaS, Redis for legal state, GraphQL, MongoDB, hardcoded legal fractions, LangGraph, serverless workers for stateful jobs.

---

## 18. Monorepo Structure

```
execflow/
├── apps/
│   ├── api/                   # Hono API server
│   │   ├── src/
│   │   │   ├── app.ts         # Hono app setup, CORS, route mounting
│   │   │   ├── index.ts       # Node.js entry, port 3001
│   │   │   ├── routes/        # 11 route files
│   │   │   ├── middleware/    # auth, org, rbac
│   │   │   ├── services/      # 10 service files
│   │   │   ├── repositories/  # DB access (queue-projection.ts)
│   │   │   ├── lib/           # db, write-context, helpers
│   │   │   └── context/       # HonoVariables types
│   │   └── scripts/           # http-engine-flow-validation.ts
│   └── web/                   # Next.js 16 frontend
│       └── src/
│           ├── app/           # App Router routes
│           │   ├── (auth)/    # sign-in
│           │   └── (app)/     # authenticated routes
│           ├── components/    # dashboard shell + operational components
│           ├── lib/           # api-client, query-keys, hooks
│           └── middleware.ts  # route protection
├── packages/
│   ├── auth/                  # Better Auth server configuration
│   ├── db/                    # Drizzle schema, migrations, client, types
│   │   ├── src/schema/        # 37 schema module files
│   │   └── migrations/        # 6 SQL migration files
│   ├── engine/                # Deterministic legal computation engine
│   │   └── src/
│   │       ├── types/         # Contract types
│   │       ├── runtime/       # runner, commit, commit-options, commit-propagation
│   │       ├── replay/        # point-in-time
│   │       ├── snapshots/     # loader, staleness, dependency-tracker
│   │       ├── playbooks/     # resolver, loader
│   │       ├── rules/         # registry, confidence
│   │       ├── evaluation/    # blocking, opportunity-evaluator
│   │       ├── propagation/   # recalculation
│   │       ├── explanations/  # generator
│   │       └── uncertainty/   # model
│   └── workers/               # pg-boss workers
│       └── src/
│           ├── bootstrap/     # pg-boss setup, worker-registry
│           ├── outbox/        # relay
│           ├── queues/        # names, config
│           ├── consumers/     # engine, opportunity, deadline, intake events
│           ├── projections/   # queue-projection, workflow-task
│           └── sla/           # overdue-sweep, escalation-engine
├── docs/                      # Architecture docs + this file
│   └── project-governance/    # Binding governance files
├── infrastructure/            # docker-compose.dev.yml
├── turbo.json                 # Pipeline config
└── pnpm-workspace.yaml
```

---

## 19. Database Architecture

**37 schema modules** across 6 migration phases. Key architectural decisions:

**Organization isolation:** Every domain table includes `organization_id uuid NOT NULL REFERENCES organizations(id)`. Every Drizzle query in services includes `eq(table.organizationId, ctx.organizationId)`.

**Two-clock model:** `occurred_at` (legal reality) vs `created_at`/`recorded_at` (system time). Present on `timeline_events`, `domain_events`, `sentence_snapshots`, `custody_snapshots`.

**Append-only tables:** See §13. Tables that are append-only lack `updated_at` columns.

**Snapshot versioning:** `sentence_snapshots` and `custody_snapshots` have `superseded_at` and `superseded_by_id` columns. A confirmed snapshot may be superseded by a new confirmed snapshot. The `status` column captures `proposed`, `confirmed`, `superseded`.

**pg-boss storage:** pg-boss uses its own schema (`pgboss.*`) in the same database. Migration 0001 does not create pg-boss tables — pg-boss creates them on `boss.start()`.

**Drizzle configuration:** `drizzle.config.ts` in `packages/db` uses the `postgres` driver. Migrations are in `packages/db/migrations/`. The `db:migrate` script runs `drizzle-kit migrate`.

---

## 20. Migration Strategy

| Migration | Purpose | Key tables | Risk flags |
|-----------|---------|------------|------------|
| 0001 | Foundation | organizations, users, memberships, audit_logs, domain_events, `set_updated_at()` trigger | Trigger function name: `set_updated_at` |
| 0002 | Auth layer | ba_user, ba_session, ba_account, ba_verification | — |
| 0003 | Core entities | clients, execution_cases, sentence_snapshots, custody_snapshots, timeline_events, documents, intake_bundles | — |
| 0004 | Deadline/Opportunity | deadlines, opportunities, history tables | **CRITICAL: trigger calls `update_updated_at_column()` but 0001 defined `set_updated_at()`. Will fail on fresh install unless resolved.** |
| 0005 | Queue/Workflow | queue_projections, workflow_tasks, queue_assignments, queue_escalations | Redefines `set_updated_at()` — may resolve 0004 issue if 0005 runs first on some tables, but 0004 still has inconsistency |
| 0006 | Engine/Playbook | playbook_families, playbook_versions, engine_runs, engine_rule_traces, explanation_bundles, snapshot_dependencies, recalculation_runs | `engine_runs.is_replay` defined as `jsonb` in SQL, but Drizzle schema and all code use boolean semantics. **This is a type mismatch.** |

**Critical migration risks requiring immediate resolution before production:**

1. **0004 trigger function name mismatch.** `update_updated_at_column()` vs `set_updated_at()`. If migrations are applied in order on a fresh database, 0004 will fail. This must be verified and corrected in the migration file.

2. **0006 `is_replay` JSONB vs boolean.** Migration SQL uses `JSONB` for this column. Drizzle schema and all application code treat it as boolean. PostgreSQL stores JSON `true`/`false` differently from boolean `TRUE`/`FALSE`. Drizzle's boolean column type sends JavaScript `true`/`false`; PostgreSQL JSONB accepts them but comparison operators differ. This needs to be corrected in the migration to `BOOLEAN NOT NULL DEFAULT FALSE`.

3. **`deadline_history.changed_by_user_id NOT NULL` vs overdue sweep.** Migration 0004 declares `changed_by_user_id uuid NOT NULL`. The `overdue-sweep.ts` inserts deadline history with `changedByUserId: null`. This would violate the constraint at runtime. Either the column should be `NULL`-able or the sweep must supply a system actor UUID.

---

## 21. Authentication and Tenant Isolation

**Authentication flow:**
1. Frontend calls `authClient.signIn.email()` → HTTP to `POST /api/auth/sign-in/email`
2. Better Auth validates against `ba_account` (hashed password) 
3. Sets `ba_session` record + HttpOnly session cookie
4. Subsequent requests carry cookie → `authMiddleware` validates session
5. `orgMiddleware` reads `X-Organization-Id` header (or session active org) → verifies membership → resolves domain `users.id` → attaches to `HonoContext`

**Multi-tenant isolation:** `orgMiddleware` returns 422 if no org context, 403 if membership not found or inactive. All service calls receive `organizationId` from `buildWriteContext`. Every DB query filters by org.

**Domain user separation:** Better Auth manages credential storage (`ba_*` tables). The system's domain `users` table holds EXECFLOW-specific data. They share the same UUID — Better Auth's `ba_user.id` equals `users.id`. This avoids a join but requires careful seeding.

**Tenant isolation assessment:** Strong by architecture. Every query path goes through `orgMiddleware` → `buildWriteContext` → `organizationId` filter. The risk surface is: (1) raw Drizzle queries in new code that forget the filter, (2) engine queries that don't receive org context (currently guarded by passing `organizationId` in all evaluation inputs).

---

## 22. Audit and Provenance Systems

**`audit_logs` table:** Captures every write operation. Fields: `actor_type`, `actor_id`, `organization_id`, `entity_type`, `entity_id`, `action`, `changes` (JSONB diff), `request_id`, `correlation_id`, `occurred_at`.

**`domain_events` table:** The operational event log. Fields: `event_type`, `aggregate_type`, `aggregate_id`, `payload` (JSONB), `actor_type`, `actor_id`, `organization_id`, `occurred_at`, `recorded_at`, `correlation_id`, `causation_id`, plus outbox lifecycle fields (`processing_status`, `published_at`, etc.).

**`writeAuditAndEvent` helper:** Every domain service co-commits `audit_logs` + `domain_events` in the same transaction. This is the canonical write pattern. Services that skip this pattern (future code) must be considered non-compliant.

**Causality chain:** `correlationId` is shared by all events in one HTTP request or worker job. `causationId` links a child event to the specific parent event that triggered it. This enables "what happened as part of operation X" queries.

**Provenance assessment:** Complete for all currently implemented service paths. The risk is future service code that writes DB directly without calling `writeAuditAndEvent`.

---

## 23. Workflow Architecture

**Workflow tasks** are specific assignments within a queue projection. They are distinct from the queue projection itself — a queue item may have multiple workflow tasks over its lifecycle.

**Workflow task lifecycle:** `pending → claimed → (completed | released)`. Claim is exclusive (conditional update; double-claim returns service error). Release returns to claimable pool. Complete is terminal.

**Task creation:** `createOpportunityReviewTask` in `projections/workflow-task.ts` is called from `opportunity-events.ts:handleOpportunityCreated` for non-progression opportunity_review items. Other task creation paths have not been implemented (intake review tasks, PAD defense tasks, etc.).

**URL note (critical):** The route file comment says `/api/v1/workflow-tasks/...` but `app.ts` mounts the queue router at `/api/v1/queue-projections`. Actual URLs are `/api/v1/queue-projections/workflow-tasks/:id/claim|release|complete`. Any external client, documentation, or test expecting the commented path will get 404.

---

## 24. Deadline System

**Routes:** `POST /api/v1/deadlines` (create), `POST /api/v1/deadlines/:id/acknowledge`, `POST /api/v1/deadlines/:id/complete`, `POST /api/v1/deadlines/:id/dismiss`. RBAC: assistant for create/acknowledge/complete; lawyer for dismiss.

**State machine:** `open → acknowledged | completed | dismissed | overdue`. `overdue` is set by the SLA sweep, not by a direct API action.

**Deadline history:** Every transition appends a `deadline_history` row. The `changed_by_user_id NOT NULL` constraint is a runtime risk (see §20).

**Missing:** `snoozed` state exists in spec but has no implementation. No API route for snooze. `queue_projections.snoozed_until` column exists but is never populated via deadlines.

**Overdue sweep:** Runs on cron (configurable interval, default appears to be several minutes from SLA config). Finds `status='open'` deadlines past `due_at`. Sets `status='overdue'`, appends history, creates `deadline.overdue` outbox event. **Known runtime risk:** inserts `changedByUserId: null` against NOT NULL constraint.

---

## 25. Opportunity System

The most complex domain object in the system. Opportunities represent non-binding procedural advantage suggestions.

**Sources of opportunities:**
1. **Engine-generated** (primary): `commitEngineRun` inserts opportunities with `status='suggested'`, writes `opportunity.created` domain event, relay publishes to queue consumer, `handleOpportunityCreated` upserts queue projection.
2. **Manually created** (lawyer): `POST /api/v1/opportunities` with `requireMinRole('lawyer')`.

**State machine implemented (service layer):**
```
suggested → qualified | dismissed | expired
qualified → pursuing  | dismissed | expired
pursuing  → realized  | dismissed | expired
realized  → (terminal)
dismissed → (terminal)
expired   → (terminal)
```

**Mandatory review artifacts:** Every state transition via `reviewOpportunity` creates: `opportunity_reviews` record + `opportunity_status_history` record + audit log + domain event (e.g. `opportunity.qualified`). This is non-negotiable per the append-only invariant.

**Queue routing (implemented):** `progression` type → `progression_opportunities` queue; all others → `opportunity_review`. Priority derived from type + confidence level.

**Missing states from spec:** `blocked`, `abandoned` — see §16. Resolution needed.

**SLA on opportunities:** `slaDeadlineAt` in queue projection set to `windowEndAt` or now+7 days. The SLA escalation engine will escalate overdue items, but the escalation handler for opportunities specifically is not wired.

---

## 26. Queue System

**Architecture:** Queue projections are derived, read-only from API perspective, worker-owned for writes.

**Upsert pattern:** `upsertQueueProjection` uses conflict-on-natural-key insert/update. Natural key: `(organization_id, queue_type, entity_type, entity_id)`. This prevents duplicate queue items for the same entity.

**Projection fields:** `display_title`, `display_label`, `priority`, `assignee_user_id`, `sla_deadline_at`, `key_date`, `snoozed_until`, `metadata` (JSONB, type-specific data), `source_causing_event_id`.

**Read API:** `GET /api/v1/queue-projections` with filters: `queueType`, `assigneeUserId`, `executionCaseId`, `priority`. Returns paginated results with cursor.

**Frontend consumption:** `useQueueProjections` hook in `apps/web/src/lib/hooks/use-queue-projections.ts`. The queue page reads real data and renders items with priority badges and SLA dates.

**Missing:** No API for directly managing queue item assignment (claim happens through workflow tasks, not queue projection). No endpoint to "snooze" a queue item. No bulk assignment. No queue re-ordering.

---

## 27. Escalation and SLA Systems

**SLA sweep jobs (cron-registered):**
- `sla.overdue-sweep` — open deadlines past due_at → overdue
- `sla.snooze-wake` — snoozed projections past snooze_until → re-active
- `sla.defer-wake` — deferred projections past defer_until → re-active
- `sla.escalation-sweep` — queue items past SLA → escalation records
- `sla.stale-task-sweep` — workflow tasks with no activity past stale threshold → stale

**Escalation engine (`sla/escalation-engine.ts`):** When a queue projection breaches SLA, inserts `queue_escalations` record (append-only) and updates queue projection status. Stale task sweep detects inactive tasks.

**Current functional state:** The SLA sweeps are registered via `boss.schedule()`. They will execute at configured intervals when workers are running. The functional correctness is partially validated — overdue sweep has the `changedByUserId: null` risk (§20) and has not been end-to-end tested for deadline lifecycle.

**Snooze infrastructure exists but has no write path.** The `sla.snooze-wake` job checks `snoozed_until` but nothing currently sets it (no API, no service, no worker).

---

## 28. Worker Architecture

**Worker entry point:** `packages/workers/src/index.ts` starts pg-boss, calls `registerAllWorkers`, starts outbox relay, handles shutdown.

**pg-boss configuration (`bootstrap/pg-boss.ts`):** Connects via `DATABASE_URL`. Retention and failure settings configured. On `boss.error`, logs and exits process (critical failure mode).

**Worker registration (`bootstrap/worker-registry.ts`):** Two phases: SLA crons (5 jobs) + event consumers (18 workers). Workers run in batch mode (`batchSize` from `DOMAIN_EVENT_WORKER_OPTIONS`).

**Retry policy (`queues/config.ts`):** 3 retries, 5-second base backoff (exponential). Failed jobs after max retries go to pg-boss `failed` state for manual inspection.

**Critical missing worker:** `engine.recalculation.scheduled` is in `DOMAIN_EVENT_QUEUES` (line 101 of `names.ts`) but no `boss.work()` is registered for it. Scheduled recalculations accumulate in the DB but no worker ever picks them up to emit `engine.evaluation.requested`. The recalculation chain is broken.

**Document association → engine path:** `handleDocumentAssociatedForEngine` is called from `handleDocumentAssociated` in `intake-events.ts`. It is not registered as an independent consumer. This means it only fires when `document.associated` events arrive. The function correctly invalidates dependencies and schedules recalculations — but recalculations don't execute (see broken loop above).

---

## 29. Outbox and Propagation Architecture

**Pattern:** Every domain mutation co-commits to `domain_events` with `processing_status='pending'`. The outbox relay polls every 2 seconds, picks batches of 50 events with `FOR UPDATE SKIP LOCKED`, publishes to pg-boss, marks `processing_status='published'`.

**Relay idempotency:** `singletonKey: event.id` in pg-boss. If the relay crashes after pg-boss publish but before marking published, the next relay cycle picks up the (now locked) event, fails the lock, and eventually processes it — with pg-boss idempotency preventing double execution.

**Failure handling:** Up to `MAX_RETRIES=5` attempts before `processing_status='failed'`. No DLQ notification currently — failed events are visible in the DB but no alert fires. This is a monitoring gap.

**Correlation propagation:** When HTTP routes call engine commit, they pass `propagation: { correlationId, requestId }`. The commit-propagation module uses these to correlate outbox events back to the originating request. Worker-sourced evaluations pass correlationId when available.

**Propagation chain (engine path):**
```
POST /evaluate
  → commitEngineRun (transaction)
    → engine_runs row
    → engine_rule_traces rows
    → explanation_bundles rows
    → opportunities rows (suggested)
    → domain_events: opportunity.created × N + engine.run.completed
  → outbox relay (async, ~2s)
    → pg-boss: opportunity.created × N → handleOpportunityCreated
      → upsertQueueProjection → queue_projections
      → createOpportunityReviewTask → workflow_tasks
    → pg-boss: engine.run.completed → handleEngineRunCompleted (logs only)
```

This chain is **runtime-proven** by the `validate:http-engine` script: the domain_events delta assertion verifies ≥ 1 + opportunitiesCreated new rows after evaluate.

---

## 30. Engine Architecture

**Public API (packages/engine/src/index.ts):**
- `runEvaluation` — pure computation, reads DB
- `commitEngineRun` — transactional persistence + outbox
- `failEngineRun` — marks run as failed when evaluation throws
- `invalidateDependencies`, `hasStaleDependencies` — snapshot staleness
- `scheduleRecalculation`, `startRecalculation`, `completeRecalculation`, `failRecalculation`
- `generateRunExplanation`, `generateOpportunityExplanation`
- `replayAtPointInTime`
- `resolvePlaybookVersions`, `loadPlaybook`
- `registerEvaluator`, `listRegisteredEvaluators`
- Types: `EngineRunResult`, `CommitOptions`, `CommitPropagationContext`, etc.

**Evaluation pipeline in `runner.ts`:**
1. `resolvePlaybookVersions` — find applicable base + overlay + org config at `evaluatedAt`
2. `loadPlaybook` — merge overlay rules, resolve org/case strategy branches
3. Load case facts from DB (sentence facts, custody facts, interruptions, timeline events)
4. `evaluateBlocking` — check for global blockers (unconfirmed snapshots, missing data)
5. If not blocked: `evaluateOpportunities` — run each registered evaluator against each rule group
6. `trackDependencies` — record which snapshot versions were consumed
7. Return `EngineRunResult`

**Dependency tracking:** `dependency-tracker.ts` records `{ dependencyType, dependencyEntityId, dependencyEffectiveAt, dependencyVersion }` for each consumed snapshot. Used by `invalidateDependencies` to find cases affected when a snapshot changes.

---

## 31. Evaluator System

**Registry pattern:** `registerEvaluator(evaluatorId: string, fn: RuleEvaluatorFn)` registers pure functions. `listRegisteredEvaluators()` returns the registry.

**Currently registered evaluators:**

| evaluatorId | Purpose | Status |
|---|---|---|
| `progressionFraction` | Calculates regime progression eligibility fraction | Registered in seed + registry |
| `blockingConditionCheck` | Checks for active blocking conditions on case | Registered |
| `snapshotStalenessCheck` | Detects stale snapshot dependencies | Registered |

**Critical gap:** The seed creates a `playbookVersion` with `RULE_GROUPS` using these three evaluators. The playbook system is functional for these evaluators. However, the evaluators are **minimal stubs**: `progressionFraction` computes a basic fraction but does not handle the full complexity of Brazilian execution arithmetic (multiple sentences, concurrent sentences, detraction from pre-trial custody across different processes, remission certificate accumulation). The system is architecturally correct but legally incomplete.

**Evaluator contract:** `RuleEvaluatorInput` → `RuleEvaluatorOutput`. The output includes `outcome`, `opportunityProposals`, `blockingCodes`, `uncertaintyFactors`, `confidenceLevel`, `missingDataItems`.

---

## 32. Playbook System

**Playbook hierarchy:** `playbookFamilies` (namespaced by jurisdiction, e.g. `execflow-br-fed-base`) → `playbookVersions` (versioned rule sets) → `orgPlaybookConfigs` (org-level strategy branch selection) → `casePlaybookContexts` (case-level override).

**Playbook version structure:** JSONB `ruleGroups` array. Each rule group: `id`, `evaluatorId` (maps to registered evaluator), `legalBasis`, `enabled`, `parameters`, `branchOptions`.

**Branch resolution:** `loader.ts` resolves strategy branches: case-level context overrides org-level config which overrides playbook default. Branch conflicts (org and case select different incompatible branches) produce a `CONFLICT_UNRESOLVED` blocking code.

**Seed playbook:** `seed.ts` creates `playbookFamilies` slug `execflow-br-fed-base` with a `playbookVersion` `v1.0-SEED` status `published`. This is the only playbook that can currently be resolved. No additional playbook versions exist until manually created.

**Overlay system:** `playbookVersions.overlayTargetVersionId` references a base version. Overlay versions add or modify rule groups. The `loadPlaybook` function merges overlay onto base. This mechanism exists but no overlay versions are seeded.

**Org config:** `orgPlaybookConfigs` allows an org to select a specific playbook version and strategy branches. This is read by `resolver.ts` but must be created manually or via an admin API that doesn't exist yet.

**Critical gap:** There is no HTTP API for creating or publishing playbook versions, creating org configs, or managing branch selections. All playbook administration is currently CLI/seed-only. This is an intentional deferral per implementation order.

---

## 33. Rule Resolution Model

`resolver.ts` (`resolvePlaybookVersions`) logic:

1. Find `orgPlaybookConfigs` for the org at `evaluatedAt` (active, not expired)
2. If org config found: use its `playbookVersionId`
3. If not found: find the most recent published `playbookVersion` in `playbookFamilies`
4. If overlay is configured: resolve overlay + base together
5. Return `{ baseVersion, overlayVersion?, orgConfig?, caseContext? }`

**Dead code in loader.ts:** There is a `baseVersion` query that may be redundant — the resolver already returns the base version. This is a minor code quality issue, not a correctness risk.

**Temporal correctness:** `resolver.ts` queries `evaluatedAt` parameter — playbook versions published after `evaluatedAt` are excluded. This correctly supports point-in-time replay with historical playbooks.

---

## 34. Snapshot Architecture

**Sentence snapshots:** Capture the confirmed arithmetic state of a sentence: `totalSentenceYears`, `originalOffenses`, `progressionFraction`, `reductionCertificates`, `recognizedRemissionDays`, `imposedRegime`, `startRegime`, `detentionStartDate`, etc. Confirmed by a lawyer.

**Custody snapshots:** Capture confirmed custody periods: `custodyPeriods[]`, `totalCustodyDays`, confirmation of each period.

**Snapshot lifecycle:**
1. Created with `status='proposed'` (manual creation or future OCR extraction)
2. Lawyer reviews and sets `status='confirmed'`
3. If superseded: new confirmed version created; old has `superseded_at` set

**Engine input rule:** Only `status='confirmed'` and `(superseded_at IS NULL OR superseded_at > evaluatedAt)` snapshots are loaded. The `loader.ts` enforces this.

**Snapshot creation API:** No HTTP routes for creating or confirming snapshots currently exist. The `seed-http-engine-snapshots.ts` script creates them via direct DB seed for testing. This is the primary operational gap for real-world use — without snapshot creation routes, the engine cannot be productively used.

---

## 35. Dependency Tracking

`dependency-tracker.ts` creates `SnapshotDependencyInput` records for each snapshot consumed during an evaluation. These are committed in `commitEngineRun` as `snapshot_dependencies` rows.

**Fields:** `organizationId`, `engineRunId`, `dependencyType` (`sentence_snapshot` | `custody_snapshot` | `timeline_event` | `document`), `dependencyEntityId`, `dependencyEffectiveAt`, `dependencyVersion`.

**Purpose:** When a snapshot is superseded, `invalidateDependencies` queries `snapshot_dependencies` to find all `engineRunId`s that consumed it, then finds the `executionCaseId` for those runs, and returns the affected case IDs so they can be scheduled for recalculation.

**Staleness detection:** `hasStaleDependencies` checks whether any dependency for a given case has been superseded since the last engine run. Used to determine if a recalculation is necessary before scheduling.

---

## 36. Staleness Propagation

**Propagation chain (designed):**
```
Snapshot superseded
  → domain_events: sentence.snapshot.superseded
  → handleSentenceSnapshotSuperseded (worker)
    → invalidateDependencies → affected case IDs
    → scheduleRecalculation × affected cases
      → recalculation_runs rows (status='scheduled')
        → [MISSING] engine.recalculation.scheduled event
          → [MISSING] worker picks up recalculation
            → [MISSING] emits engine.evaluation.requested
              → handleEngineEvaluationRequested
                → runEvaluation + commitEngineRun
```

**Gap:** The chain breaks at `scheduleRecalculation`. This function only writes `recalculation_runs` rows. It does not emit `engine.evaluation.requested` or any other triggering event. The scheduled recalculation never executes without a separate mechanism to pick it up.

**Current state:** Recalculations accumulate as `status='scheduled'` in `recalculation_runs` forever, unless manually triggered via `POST /api/v1/engine/recalculate`. The async recalculation loop is **not operational**.

**Fix required:** Either (a) `scheduleRecalculation` emits a domain event `engine.evaluation.requested` in the same transaction, or (b) a cron worker queries `recalculation_runs WHERE status='scheduled'` and processes them. Option (a) is architecturally cleaner. This is the highest-priority broken loop in the system.

---

## 37. Recalculation Architecture

**`recalculation_runs` table:** Tracks scheduled/running/completed/failed recalculations. Fields include `trigger_entity_type`, `trigger_entity_id`, `trigger_reason`, `parent_recalculation_run_id`, `chain_depth`, `correlation_id`, `produced_engine_run_id`.

**Chain depth protection:** `propagation/recalculation.ts` enforces `MAX_CHAIN_DEPTH = 10`. Prevents runaway cascades.

**Lifecycle management:** `scheduleRecalculation` → `startRecalculation` → (`completeRecalculation` | `failRecalculation`). The start/complete/fail functions are implemented but are never called — the execution path does not exist yet (see §36).

**`runRecalculation` in `runner.ts`:** This function exists and is exported. It calls `runEvaluation` with trigger semantics and returns a `RecalculationOutput`. It is not called by any worker currently.

---

## 38. Runtime Validation History

**Validated by `http-engine-flow-validation.ts`:**
- Unauthenticated request → 401 ✓
- Sign-in → session cookie ✓
- Request without org header → 422 ✓
- Bogus org ID → 403 ✓
- PUT active organization ✓
- POST /api/v1/clients (authenticated + org-scoped) ✓
- POST /api/v1/cases (authenticated + lawyer-role) ✓
- CLI snapshot seed (sentence + custody snapshots via DB) ✓
- POST /api/v1/engine/evaluate → EngineRun committed + traces + bundles ✓
- GET /api/v1/engine/runs/:id/explanation → traces + bundles ✓
- EngineRun.requestedByUserId matches session user ✓
- domain_events delta ≥ 1 + opportunitiesCreated after evaluate ✓

**Validated by `smoke-runtime-validation.ts`:**
- DB connection and seed ✓
- `resolvePlaybookVersions` returns versioned playbook ✓
- `runEvaluation` completes without error ✓
- `commitEngineRun` persists EngineRun + traces + bundles ✓
- Traces count > 0 ✓
- ExplanationBundle count > 0 ✓

**NOT validated at runtime:**
- Outbox relay → pg-boss publish → consumer execution chain
- Queue projection upsert from opportunity.created event
- Workflow task creation from opportunity events
- SLA sweep correctness under real data
- Recalculation execution (broken — never runs)
- Multi-tenant isolation under concurrent load
- Snapshot supersession → staleness → recalculation chain
- Deadline lifecycle from creation through overdue through queue
- Opportunity state machine under full review/qualify/pursue/realize lifecycle
- Frontend session persistence across requests
- Frontend queue data rendering with real organization data

---

## 39. Replay Safety Assessment

**Replay correctness:** The `replayAtPointInTime` function correctly:
- Filters snapshots by `effectiveAt <= asOfDate`
- Excludes superseded snapshots at the point in time
- Does not commit any EngineRun or Opportunity
- Emits no domain events
- Returns a non-binding bundle with `isReplay: true` semantics

**Known issue — `useHistoricalPlaybook` ignored:** The parameter is accepted but the `loadPlaybook` behavior is identical regardless of its value. In practice, `resolvePlaybookVersions` already handles `evaluatedAt` correctly, so historical playbooks ARE used. The flag creates a false promise of additional control. Future engineers must not add conditional logic based on this flag without first verifying the existing behavior is insufficient.

**Replay outbox safety:** `commit-propagation.ts` has explicit guard: `if (opts.isReplay) return`. Engine commits with `isReplay: true` (from `commitEngineRun` in the replay path, if ever called) would not emit outbox events. However, the current replay path does NOT call `commitEngineRun` at all — it only calls `runEvaluation`. The guard is defense-in-depth, not the primary protection.

**Assessment:** Replay is safe in its current implementation. The primary risk is future engineers adding EngineRun persistence to replay for caching purposes — they must preserve the `isReplay` guard.

---

## 40. Deterministic Integrity Assessment

**What is deterministic:**
- Given the same CaseFacts + ResolvedPlaybook, evaluators produce identical output
- `outputsHash` on rule traces captures determinism via content hash
- Snapshot loading is deterministic for a given `evaluatedAt` value
- Playbook resolution is deterministic for a given `evaluatedAt` value

**What is not fully deterministic:**
- The seed playbook's evaluators (`progressionFraction`, etc.) are simplified stubs. A real production playbook would need to handle edge cases in Brazilian execution arithmetic that may have non-deterministic interactions (e.g., how multiple overlapping sentences are merged).
- `evaluatedAt: new Date()` in HTTP evaluate routes introduces a non-deterministic timestamp. Two evaluations of the same case a second apart may differ if a snapshot was confirmed between them. This is correct behavior — it is not an implementation bug.

**Determinism guarantee boundary:** EXECFLOW guarantees determinism for the same inputs at the same point in time, not across time. A recalculation at T+1 may produce different results from an evaluation at T if facts changed between T and T+1. This is expected and correct.

---

## 41. Real vs Scaffold Matrix

| Component | Status | Evidence |
|-----------|--------|---------|
| Authentication flow | **Real** | http-engine-flow-validation passes |
| Multi-tenant org isolation | **Real** | middleware enforced; validated |
| Engine evaluate → persist | **Real** | smoke-runtime + http validation |
| Engine outbox events on commit | **Real** | domain_events delta validated |
| Queue projection upsert (workers) | **Code exists, not runtime-validated** | Worker code correct; not end-to-end tested |
| Opportunity review state machine | **Real (API layer)** | Service code verified |
| SLA overdue sweep | **Code exists, not fully validated** | NULL constraint risk |
| SLA escalation sweep | **Code exists, not validated** | No end-to-end test |
| Recalculation execution loop | **Broken scaffold** | scheduleRecalculation writes rows; nothing executes them |
| Snapshot creation/confirmation API | **Not built** | CLI seed only |
| Replay (HTTP endpoint) | **Real** | route implemented and correct |
| Deadline lifecycle | **Partial** | create/transitions implemented; overdue has bug |
| Playbook admin API | **Not built** | CLI seed only |
| OCR extraction pipeline | **Not built** | Architecture documented |
| Piece drafting system | **Not built** | Architecture documented |
| Filing system | **Not built** | Architecture documented |
| Client communication | **Not built** | Architecture documented |
| Batch operations | **Not built** | Architecture documented |
| Frontend list/detail views | **Not built** | Only queue surface exists |
| Realtime (SSE) | **Not built** | Technical stack decision specifies it |
| Finance module | **Not built** | Architecture documented |
| Search | **Not built** | Technical stack decision specifies PostgreSQL FTS + Meilisearch |

---

## 42. Runtime-Proven vs Assumed Systems

**Runtime-proven (script-validated):**
- HTTP auth chain end-to-end
- Engine evaluate → commit → outbox row creation
- EngineRun attribution to requesting user
- Playbook version resolution
- Rule trace persistence
- ExplanationBundle persistence

**Assumed correct (code review only, not runtime-tested):**
- Queue projection upsert from opportunity events
- Workflow task creation for opportunity review
- Deadline history append on transition
- Domain event correlation chain across workers
- Snapshot supersession → dependency invalidation
- SLA sweeps (correct logic assumed; no test)
- Outbox relay SELECT FOR UPDATE SKIP LOCKED correctness under concurrent workers

**Known broken (runtime would fail):**
- 0004 trigger function name (fresh install fails)
- 0006 is_replay JSONB type (boolean comparison semantics wrong)
- Deadline overdue sweep → deadline_history NULL constraint violation
- Recalculation execution (nothing triggers it)

---

## 43. Operational Maturity Assessment

| Dimension | Maturity Level | Notes |
|-----------|---------------|-------|
| Schema design | 8/10 | Sound temporal design; minor migration bugs |
| Auth + tenant isolation | 8/10 | Correct architecture; not load-tested |
| Engine determinism | 7/10 | Architecture correct; evaluators are stubs |
| Event propagation | 6/10 | Outbox → relay → pg-boss correct; consumer chain not end-to-end proven |
| Queue system | 6/10 | Infrastructure exists; write paths need validation |
| State machines | 7/10 | Service layer correct; some spec-code gaps |
| Recalculation | 3/10 | Scheduled but never executes |
| Snapshot management | 4/10 | No HTTP routes; CLI seed only |
| Frontend | 4/10 | Queue surface real; most surfaces absent |
| Runtime validation coverage | 5/10 | Core engine proven; queue/worker chain unproven |
| Overall | ~6/10 | Solid foundation; substantial production gaps |

---

## 44. Technical Debt Assessment

**High priority (blocks production):**

1. **Migration 0004 trigger name mismatch** — will fail fresh install. Fix: rename trigger calls in 0004 to `set_updated_at()` or ensure the function is created before 0004 runs.

2. **Migration 0006 `is_replay` JSONB** — type mismatch. Fix: change to `BOOLEAN NOT NULL DEFAULT FALSE`.

3. **Deadline overdue sweep NULL constraint** — runtime data corruption risk. Fix: supply system actor UUID or make column nullable.

4. **Recalculation execution broken loop** — scheduled recalculations never run. Fix: add `engine.evaluation.requested` event emission in `scheduleRecalculation`.

5. **No snapshot HTTP routes** — the system cannot be productively used without CLI snapshot seeding for every case.

**Medium priority (functional gaps):**

6. **No HTTP GET list endpoints** for cases, clients, deadlines, opportunities — critical for operational UI.

7. **Workflow task URL mismatch** — commented paths disagree with actual mount point.

8. **`opportunity.blocked` / `opportunity.abandoned`** states exist in spec, not in code.

9. **`ExecutionCase` initial status `intake` vs spec `draft`** — doc-code gap.

10. **`useHistoricalPlaybook` parameter ignored** — false promise in API.

**Low priority (future work):**

11. **Dead code in `playbooks/loader.ts`** (`baseVersion` query redundancy).

12. **`IMPLEMENTATION_ORDER.md` stale references** to Prisma.

13. **No DLQ notification** for permanently failed domain events.

14. **Zustand installed but unused** in frontend.

---

## 45. Highest-Risk Architectural Areas

**1. Recalculation execution chain (broken).** The entire staleness propagation model depends on scheduled recalculations eventually executing. Currently, they accumulate without execution. Any architecture that builds on top of recalculation correctness (e.g., "the engine is always up-to-date after snapshot changes") is false.

**2. Migration correctness (SQL bugs).** If migrations are applied in order on a production database, 0004 trigger name mismatch and 0006 JSONB type error will cause failures. These must be fixed before any production deployment.

**3. Evaluator legal completeness.** The three registered evaluators are architectural stubs. A real production deployment requires complete evaluators for all relevant opportunity types (progression, remission, detraction, etc.) with full Brazilian execution arithmetic. The architecture is correct; the legal content is a placeholder.

**4. Snapshot administration gap.** Without HTTP routes for snapshot creation and confirmation, the system requires manual DB intervention for every new case. This is operationally unusable at any scale.

**5. Worker chain end-to-end proof.** The full event → relay → pg-boss → consumer → queue projection chain has not been end-to-end validated. Code review suggests it is correct, but silent failures in pg-boss job dispatch or consumer exception handling could cause queue items to never appear.

---

## 46. Dangerous Future Failure Modes

**F-01: AI confidence inflation.** Future engineers adding AI-powered evaluators might return `confidenceLevel: 'high'` without proper uncertainty propagation. This would surface high-confidence opportunities for legally complex situations where the underlying data is actually uncertain. The `confidence.ts` module enforces `min()` composition, but only if evaluators correctly report input uncertainty.

**F-02: Frontend legal derivation creep.** As the frontend grows, there will be pressure to move "simple" legal checks into frontend validation (e.g., "client is eligible for progression based on these dates"). Any such calculation — even for display purposes — breaks the architectural invariant that legal reasoning is server-only.

**F-03: Cascade chain depth bypass.** The `MAX_CHAIN_DEPTH = 10` guard in recalculation propagation prevents infinite loops but does not prevent a large but legitimate cascade. A playbook change affecting 1,000 cases would schedule 1,000 recalculations simultaneously. There is no rate limiting or batch processing for recalculation cascades.

**F-04: Org isolation regression.** Any new DB query written without an `organizationId` filter would expose cross-tenant data. There is no automated test that verifies org isolation on every query.

**F-05: Domain event type drift.** The `boss.send(row.event_type, ...)` coupling in the relay means any misspelling of an event type string will result in a consumer that never receives events. This is invisible at compile time. The `DOMAIN_EVENT_QUEUES` constant list provides partial protection but does not cover event producers.

**F-06: Snapshot confirmation bypass.** If a future migration or service call sets `sentence_snapshot.status = 'confirmed'` without going through the confirmation service layer, it would bypass the audit record and potentially feed invalid data into the engine. No DB trigger enforces that confirmation creates an audit record.

---

## 47. Architectural Anti-Patterns Intentionally Avoided

The following were explicitly considered and rejected — future engineers must not reintroduce them:

**No direct queue writes from API.** Considered for simplicity. Rejected: queue state must be derivable from events. If API wrote queues directly, a worker restart could corrupt queue state.

**No soft deletes on legal history.** Considered for UX simplicity. Rejected: immutability is a legal requirement. A deleted opportunity that turns out to have been qualified would leave no audit trail.

**No Redis for legal state.** Considered for session/state caching. Rejected: Redis is not a source of truth and has no guarantee of consistency with the PostgreSQL state. Any legal state in Redis would create a two-source-of-truth problem.

**No hardcoded legal fractions.** `1/6` progression fraction appears in zero lines of application code. All fractions are in playbook `parameters` objects.

**No GraphQL.** Considered for flexible queries. Rejected: complex authorization model + append-only constraints make GraphQL mutation semantics incorrect. REST with explicit action routes is clearer.

**No Supabase BaaS.** Considered for rapid development. Rejected: row-level security in Supabase doesn't provide the application-level org isolation needed, and BaaS event subscriptions don't integrate with the outbox pattern.

**No serverless functions for workers.** Considered for scaling. Rejected: pg-boss requires persistent connections for SKIP LOCKED. Serverless cold starts would cause job contention and missed events.

**No optimistic updates on legal state.** Frontend sends mutation → server processes → query invalidated → re-fetch. No optimistic mutation of legal state is permitted. A lawyer cannot see a "presumed qualified" opportunity.

---

## 48. What Still Does NOT Exist

**API layer:**
- GET list endpoints for: cases, clients, deadlines, opportunities, sentence_snapshots
- Snapshot creation and confirmation HTTP routes
- Snapshot supersession HTTP routes
- Playbook version management (create, publish, deprecate)
- Org playbook config management
- Case playbook context management
- Batch opportunity review
- Opportunity snooze
- Deadline snooze
- Document OCR submission and field confirmation
- Case closure / archival
- User management (invite, deactivate)
- Organization creation and configuration

**Worker/engine:**
- Recalculation execution (emit `engine.evaluation.requested` from recalculation)
- `engine.recalculation.scheduled` consumer
- OCR extraction workers (Mastra + Azure Document Intelligence)
- AI piece draft generation workers
- Notification workers (email/push)
- Search indexing workers (Meilisearch)

**Frontend:**
- Case detail view and workspace
- Opportunity review interface (qualify/defer/dismiss actions)
- Client detail view
- Deadline management interface
- Document management and OCR review
- Piece drafting interface
- Explanation bundle viewer (engine run detail)
- User profile and settings
- Org configuration
- Role management
- Case creation form
- Snapshot confirmation interface
- Realtime updates (SSE)
- Mobile-responsive layout completion
- Session/org switching UI

**Infrastructure:**
- Production deployment configuration (Vercel + Fly.io)
- LGPD compliance tooling (data export, erasure workflow)
- Observability (OpenTelemetry instrumentation, Sentry integration)
- File storage (Cloudflare R2 integration)
- Search (Meilisearch deployment)
- CI/CD pipeline

---

## 49. Remaining Major Engineering Work

Listed in approximate implementation priority order:

**P0 — Fix before any production use:**
1. Fix migration 0004 trigger name mismatch
2. Fix migration 0006 `is_replay` JSONB → boolean
3. Fix deadline overdue sweep NULL constraint
4. Implement recalculation execution loop (emit `engine.evaluation.requested` from `scheduleRecalculation`)

**P1 — Required for operational use:**
5. HTTP routes for sentence snapshot create/confirm/supersede
6. HTTP routes for custody snapshot create/confirm
7. GET list endpoints for cases, clients, opportunities, deadlines
8. Case detail page (frontend)
9. Opportunity review interface (qualify/defer/dismiss)
10. Snapshot confirmation interface

**P2 — Required for scale:**
11. Playbook version management API
12. Batch opportunity review
13. Notification system (deadline alerts, opportunity qualifications)
14. Search integration

**P3 — Full product surface:**
15. OCR pipeline (intake → document extraction → field confirmation)
16. Piece drafting system
17. Filing system
18. Client communication
19. Finance module
20. Realtime (SSE for queue updates)

---

## 50. Estimated Remaining Project Completion

These estimates assume the current architecture is the correct foundation (which it is).

| Dimension | % Complete | Notes |
|-----------|------------|-------|
| Database schema | 85% | Core entities complete; some advanced features pending |
| Backend API (endpoints built) | 35% | Mostly mutation-only; list/detail APIs mostly missing |
| Engine (architecture) | 75% | Architecture complete; evaluator depth incomplete |
| Engine (legal completeness) | 20% | Stub evaluators; full arithmetic not built |
| Workers (infrastructure) | 70% | Infrastructure solid; some consumers unregistered |
| Workers (execution chains) | 45% | Core queue pipeline works; recalculation broken |
| Frontend (surfaces) | 25% | Queue surface real; most UI absent |
| Runtime validation coverage | 40% | Core path validated; worker chain unproven |
| Production readiness | 15% | Migration bugs; no deployment config; no observability |
| **Overall system** | **~40%** | Solid foundation; far from production |

---

## 51. Estimated Remaining Runtime Hardening

| Hardening work | Effort | Priority |
|----------------|--------|---------|
| Fix 3 migration SQL bugs | 2 hours | P0 |
| End-to-end worker chain test (opportunity.created → queue_projections) | 1 day | P0 |
| Recalculation loop repair + validation | 1 day | P0 |
| Overdue sweep fix + validation | 2 hours | P0 |
| Load test org isolation (concurrent tenants) | 1 week | P1 |
| SLA sweep end-to-end validation | 1 day | P1 |
| Outbox relay failure recovery test (crash between publish and mark) | 1 day | P1 |
| Multi-evaluator playbook version test | 2 days | P2 |
| Engine + recalculation + staleness chain integration test | 3 days | P2 |
| **Total for production-grade runtime hardening** | ~3 weeks | — |

---

## 52. Estimated Remaining Productization Work

| Feature area | Effort estimate | Notes |
|---|---|---|
| Snapshot HTTP routes + UI | 1 week | Blocker for real use |
| Entity list/detail APIs + frontend | 2 weeks | Cases, clients, deadlines, opportunities |
| Opportunity review UI (full flow) | 2 weeks | Most critical lawyer workflow |
| Playbook admin API | 1 week | Required for non-seed deployments |
| Notification system (alerts) | 2 weeks | Operational critical |
| OCR pipeline (intake → confirm) | 3–4 weeks | Complex integration |
| Piece drafting + filing | 4 weeks | Large workflow surface |
| Search (Meilisearch) | 1 week | Operational usability |
| Finance module | 3 weeks | Separate product surface |
| Realtime (SSE) | 1 week | Queue freshness |
| Observability (OTel, Sentry) | 1 week | Production readiness |
| Production deployment config | 1 week | Vercel + Fly.io |
| LGPD compliance tooling | 2 weeks | Legal requirement |
| **Total productization estimate** | **~25–28 weeks** | 6–7 months at normal velocity |

---

## 53. Safest Next Engineering Steps

Steps ordered by: (1) correctness risk reduction, (2) foundational value, (3) reversibility.

1. **Fix the three migration SQL bugs.** Zero architectural risk. High correctness gain. Must be done before any non-local deployment.

2. **Fix recalculation execution loop.** Add `engine.evaluation.requested` domain event emission to `scheduleRecalculation` inside the same transaction. This closes the most critical broken propagation chain.

3. **End-to-end worker integration test.** Write a test that: seeds org + case + snapshots → POST evaluate (creates opportunity.created in outbox) → manually trigger relay → verify pg-boss job dispatched → manually call consumer → verify queue_projections row. This proves the worker chain without running all workers.

4. **Add sentence snapshot HTTP routes** (create, confirm, supersede). These are the minimum required for real operational use. Architecture is clear — follow the established service + writeAuditAndEvent pattern.

5. **Add GET list endpoints.** Start with `GET /api/v1/cases` and `GET /api/v1/opportunities`. These unblock the frontend from stub to real data.

6. **Frontend opportunity review interface.** Once list endpoints exist, build the qualification UI. This is the most high-value user-facing feature relative to the backend investment already made.

---

## 54. Unsafe Next Steps That Should Be Avoided

**Do not:**

1. **Add AI evaluators before completing the existing evaluator depth.** The architecture supports arbitrary evaluators but the playbook system, explanation bundle contract, and confidence model must be fully validated with one complete evaluator before AI is introduced.

2. **Build realtime (SSE) before queue data is stable.** SSE will amplify any queue inconsistency. Get the queue write path end-to-end validated first.

3. **Build batch operations before single-item flows are validated.** Batch qualify on unproven state machines will corrupt opportunity history.

4. **Move any legal calculation to the frontend.** Any engineer who proposes "just compute this date comparison in the browser for display" must be redirected to the playbook evaluator architecture.

5. **Use `db:push` instead of `db:migrate` in any non-development environment.** `drizzle-kit push` overwrites migration history and bypasses the controlled migration sequence.

6. **Hardcode any organization ID in worker code.** Workers must receive `organizationId` from event payloads or query it from context. Hardcoded org IDs would break multi-tenancy.

7. **Create a "confirm all snapshots" bulk API.** Individual snapshot confirmation is a required human gate. A bulk-confirm API would allow the gate to be bypassed under operational pressure.

8. **Bypass the outbox pattern with direct `boss.send()` from API routes.** Any such shortcut breaks the transactional consistency guarantee — an API call could succeed while its event fails to publish.

---

## 55. Long-Term Expansion Possibilities

**Within the current architecture (safe extensions):**

- Additional evaluator types for all opportunity categories (remição, detração, indulto, HC, prescrição, excesso de execução, PAD challenge)
- Multi-jurisdiction playbooks (extending beyond `BR-FED` to state-level execution courts)
- AI-assisted piece drafting (with mandatory lawyer approval gate)
- OCR extraction pipeline with field-level confirmation workflow
- Client communication (status reports to defendants/families, with strict content review)
- Statistical reports across anonymized cases (organizational performance analytics — not individual legal metrics)
- Integration with court electronic systems (PJe) for automated deadline tracking

**Architecturally challenging extensions:**

- Real-time collaborative case editing (requires conflict resolution model on top of append-only)
- Public defender organization mode (different authority model for public institutions)
- Multi-language support (all current copy is Portuguese-only)
- Mobile-native app (the web is responsive but not mobile-first; native app would need its own API client)

**Extensions that would violate the current architecture (do not pursue):**

- AI autonomous opportunity qualification
- AI autonomous piece filing
- Removing the human gate from snapshot confirmation
- Shared opportunity pools across organizations (violates tenant isolation)

---

## 56. Final Strategic Assessment

EXECFLOW has built a genuinely sophisticated foundational architecture for a domain that requires it. The separation between deterministic engine, append-only legal history, queue-derived operational state, event-driven propagation, and strict human authority boundaries is not over-engineering — it is a direct response to the actual epistemological and liability requirements of criminal execution practice.

The system is architecturally sound. The governance documents are coherent and largely enforced. The core engine pipeline works and is validated. The database schema models the domain correctly.

The system is not production-ready. The gap between "architecturally correct" and "operationally viable" is approximately 25–30 weeks of focused engineering work. The most critical work items are not architecturally complex — they are feature completion (snapshot routes, list endpoints, opportunity review UI) and correctness fixes (migration bugs, recalculation loop).

**The most important principle for any engineer continuing this work:**

Do not simplify. The complexity in this architecture is not accidental — it encodes legal correctness constraints that cannot be relaxed without creating liability risk. Every time the pressure to simplify arises, consult §7 (Non-Negotiable Invariants), §47 (Anti-Patterns Intentionally Avoided), and this section. The architecture will resist simplification attempts because it was designed to.

The system's value is not in any individual feature — it is in the guarantee that every action is auditable, every calculation is traceable, every legal suggestion carries explicit uncertainty, and no AI action ever substitutes for human judgment. That guarantee is only as strong as the invariants that enforce it.

---

## Appendix A — Known Documentation-Code Discrepancies

| Doc | Claim | Reality | Severity | Action |
|-----|-------|---------|----------|--------|
| `event-state-architecture.md` §3.4 | Opportunity states include `blocked`, `abandoned` | Not in `VALID_TRANSITIONS` | Medium | Add states or update spec |
| `event-state-architecture.md` §3.5 | Deadline has `snoozed` state | Not implemented | Medium | Build snooze or update spec |
| `event-state-architecture.md` §3.1 | ExecutionCase starts at `draft` | Code creates at `intake` | Medium | Align code or spec |
| `execution-engine.md` §5.1 | Engine evaluate async for large cases | HTTP handler is synchronous | Low | Implement async path or update spec |
| `queue.ts` comment | Workflow task URL `/api/v1/workflow-tasks/...` | Actual: `/api/v1/queue-projections/workflow-tasks/...` | High | Fix comment or add route alias |
| `IMPLEMENTATION_ORDER.md` | References Prisma, Phase 0.3 pending | Drizzle implemented; Phase 0 done | Low (stale doc) | Update or archive IMPLEMENTATION_ORDER |
| `point-in-time.ts` | Accepts `useHistoricalPlaybook: boolean` | Parameter unused | Low | Remove or implement |

## Appendix B — Runtime Failure Risks Before Production

| Risk | Location | Failure mode |
|------|----------|-------------|
| Trigger name mismatch | Migration 0004 | `ERROR: function update_updated_at_column() does not exist` on fresh install |
| JSONB boolean type | Migration 0006 `engine_runs.is_replay` | Boolean comparison semantics may fail silently |
| NULL constraint | `deadline_history.changed_by_user_id` | `ERROR: null value in column "changed_by_user_id"` on overdue sweep |
| Broken recalc loop | `scheduleRecalculation` | Recalculations accumulate without execution; engine state stale after snapshot changes |
| Unregistered consumer | `engine.recalculation.scheduled` | pg-boss publishes to queue with no subscriber — jobs silently expire |

---

*Document version 1.0 — 2026-05-20 — Produced from full repository forensic audit.*  
*Next revision should be triggered by: first production deployment, completion of recalculation loop, or any change to Non-Negotiable Invariants (§7).*
