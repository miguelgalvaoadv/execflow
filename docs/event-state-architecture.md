# EXECFLOW — Event and State Architecture

**Version:** 0.1 (binding)
**Status:** Systems architecture layer — not implementation code, not Prisma schema, not worker code.

**Grounded in:**
- `functional-architecture.md` — roles, state machines, permissions
- `execution-workflows.md` — intake channels, operational flow, timeline events
- `data-model-v1.md` — entity definitions, append-only rules, immutability
- `execution-engine.md` — engine principles, snapshot model, confidence
- `office-operating-system.md` — queue catalog, SLA model, escalation
- `playbook-system.md` — versioned rule governance, engine integration
- `ux-flow-architecture.md` — queue interaction model, notification philosophy
- `project-governance/ARCHITECTURE_RULES.md` — hard constraints, forbidden patterns
- `project-governance/ENGINEERING_PRINCIPLES.md` — append-only history, explainability
- `project-governance/AI_BOUNDARIES.md` — AI permission model, mandatory human gates

**Purpose:** Define the internal event-driven and state-transition architecture of EXECFLOW as a **temporal legal platform** before any backend implementation. This document ensures that recalculations, state changes, queue reactions, audit trails, and AI interactions are architecturally correct before a single service is written.

---

## 1. Architectural philosophy

### 1.1 Event-driven legal operations

EXECFLOW is an **event-sourced operational platform** at its core. Legal facts and operational decisions are not stored as mutable rows updated in place — they are expressed as a sequence of **immutable events** that describe what happened, who acted, and when.

This philosophy is non-optional. It is derived from the legal domain itself:

- Courts, lawyers, and prisons operate on dated records and documented decisions.
- A "correction" in law is not an erasure — it is a new record that supersedes or amends a prior one.
- Auditability of "what the system knew at time X" is a legal requirement, not a nice-to-have.

Event-driven architecture in EXECFLOW means:

- Entity state is the result of applying events to an initial state — it is derived, not primary.
- The canonical source of truth for any case is its event history, not any current-state row.
- All system behavior (queue entries, notifications, engine runs) is triggered by events — not by polling or by direct state writes.

### 1.2 Append-only historical behavior

No legal fact in EXECFLOW is deleted or overwritten. The append-only constraint applies to:

| Entity type | Constraint |
|-------------|------------|
| `TimelineEvent` | Immutable from creation; corrections via new event with `amends_event_id` |
| `SentenceSnapshot` | Immutable from creation; superseded via new snapshot with `supersedes_snapshot_id` |
| `ExecutionCustodySnapshot` | Immutable from creation; corrections via new snapshot |
| `DocumentExtraction` | Immutable after `completed` status |
| `PieceVersion` | Immutable from creation |
| `Filing` | Immutable from creation |
| `AuditLog` | Always immutable; no `UPDATE` or `DELETE` path exists |

"Append-only" is not a performance suggestion — it is the architecture. Any implementation that overwrites these records is wrong, regardless of operational convenience.

### 1.3 Immutable audit trails

Every state change in the system produces an `AuditLog` record in the same transaction. There is no "background update" path that skips the audit. This is not eventually consistent — it is synchronous and transactional.

AuditLog records capture:

- `actor_type` and `actor_id` (human user or AI agent)
- `action` (verb: created, confirmed, approved, dismissed, etc.)
- `entity_type` and `entity_id`
- `occurred_at` (UTC)
- `changes` (before/after diff or full snapshot where applicable)
- `organization_id`

AuditLog records are **written in the same database transaction** as the state change they record. An AuditLog that is not co-committed with its subject action is an architecture defect.

### 1.4 Deterministic state transitions

Every entity with a `status` field has an explicit state machine. Transitions:

- Are defined in advance (not open-ended string fields)
- Are validated by the service layer — the API rejects invalid transitions
- Carry a required `actor` and optional `reason`
- Are idempotent — transitioning to the current state is a no-op, not an error

Determinism means: given the same inputs and history, the system always reaches the same state. There are no hidden state changes triggered by side effects without explicit event records.

### 1.5 Temporal replayability

The system must be able to answer: **"What was the state of this case on date X?"**

This requires:

- All state-bearing records carry `created_at` and, where applicable, `effective_from` / `effective_until`
- Snapshot records (SentenceSnapshot, ExecutionCustodySnapshot) carry an `as_of_date` representing the legal effective date of the arithmetic — not just the ingestion date
- Events are ordered by `occurred_at` (legal time), not by insertion sequence
- Replay queries filter events to `occurred_at ≤ X` and reconstruct state from that filtered set

No live mutable fields are used as the basis for historical answers. The answer to "what was the regime on 2023-01-01?" comes from the custody snapshot history, not from a current `regime` column.

### 1.6 Explicit causality chains

Every automated output carries a reference to its cause:

| Automated output | Caused by |
|-----------------|----------|
| `Deadline` from rule | `engine_run_id` + `playbook_rule_id` |
| `Opportunity.suggested` | `engine_run_id` + `snapshot_id[]` |
| `SentenceSnapshot.proposed` | `trigger_event_id` + `engine_run_id` |
| `Notification` | `trigger_event_id` + `notification_rule_id` |
| `TimelineEvent` (system) | `source_event_id` + `source_worker` |

No output exists without a traceable cause. This causality chain is stored in the data model, not just in logs.

### 1.7 Operational explainability

Every computation that influences a legal outcome must produce a structured ExplanationBundle. This bundle is:

- Produced at computation time and stored immutably
- Accessible from the UX via "Why?" controls (defined in `ux-flow-architecture.md §6`)
- Included in audit exports
- Never reconstructed retroactively — if the bundle was not captured at computation time, the output is marked `explanation_missing` and enters the AI review queue

Explainability is a **system output**, not a display feature.

---

## 2. Event system model

### 2.1 Event taxonomy

Events in EXECFLOW are classified by origin and purpose:

| Class | Description | Examples |
|-------|-------------|---------|
| **Domain events** | Legal or operational facts recorded in the case timeline | `sentence.confirmed`, `regime.changed`, `falta_grave.registered` |
| **Workflow events** | Internal system state transitions | `document.extraction_completed`, `opportunity.qualified`, `piece.approved` |
| **AI events** | Outputs from AI agents | `ai.extraction_proposed`, `ai.opportunity_suggested`, `ai.draft_generated` |
| **System events** | Infrastructure and job lifecycle | `engine_run.completed`, `engine_run.failed`, `ocr_job.completed` |
| **Audit events** | Actor attributions | `user.login`, `snapshot.confirmed`, `playbook.published` |
| **Notification events** | Alert dispatch | `notification.sent`, `notification.acknowledged`, `escalation.triggered` |
| **Escalation events** | SLA breach and override | `deadline.overdue`, `item.sla_breach`, `escalation.acknowledged` |
| **Recalculation events** | Arithmetic invalidation | `snapshot.superseded`, `recalculation.triggered`, `conflict.detected` |

### 2.2 Domain events (legal timeline)

Domain events are the **primary legal narrative** of an ExecutionCase. They are stored as `TimelineEvent` records and are append-only from creation.

Domain event categories:

| Category | Prefix | Examples |
|----------|--------|---------|
| Court movements | `court.*` | `court.sentence_issued`, `court.decision`, `court.hearing`, `court.dispatch` |
| Custody | `custody.*` | `custody.arrest`, `custody.transfer`, `custody.regime_change`, `custody.release` |
| Legal benefits | `benefit.*` | `benefit.remicao_credited`, `benefit.detracao_applied`, `benefit.indulto_granted` |
| Discipline | `discipline.*` | `discipline.pad_opened`, `discipline.falta_grave`, `discipline.sanction_applied` |
| Arithmetic | `arithmetic.*` | `arithmetic.sentence_recalculated`, `arithmetic.unification`, `arithmetic.correction` |
| Petitions | `petition.*` | `petition.filed`, `petition.granted`, `petition.denied` |
| Office | `office.*` | `office.note`, `office.visit`, `office.task_created`, `office.contact_attempt` |

Domain events carry:

- `type` — namespaced string (e.g. `custody.transfer`)
- `occurred_at` — the **legal** timestamp (when it happened in the world), not ingestion time
- `recorded_at` — when the system received this information (may differ from `occurred_at`)
- `author_type` — `user`, `agent.*`, `system`
- `author_id`
- `payload` — structured data specific to event type
- `source_documents[]` — document IDs that evidence this event
- `amends_event_id` — nullable; if set, this event corrects a prior one

### 2.3 Workflow events

Workflow events record **state transitions** in operational entities. They are produced by the service layer on every state change and stored in the AuditLog plus, where relevant, the case TimelineEvent stream.

Examples:

| Event | Produced by | Consumers |
|-------|------------|-----------|
| `document.status_changed` | Document service | Intake queue, notification service |
| `opportunity.status_changed` | Opportunity service | Queue service, notification service |
| `piece_draft.status_changed` | Piece service | Review queue, notification service |
| `deadline.status_changed` | Deadline service | Overdue queue, notification service |
| `snapshot.confirmed` | Snapshot service | Engine trigger, timeline event write |
| `conflict.created` | Engine worker | Conflict queue, notification service |

### 2.4 AI events

AI events record the **output of AI agent actions** without implying any legal effect. They enter the workflow only after human review.

| Event | Agent | Output destination |
|-------|-------|--------------------|
| `ai.extraction_proposed` | `agent.ingestion` | `DocumentExtraction.status=extraction_review` |
| `ai.opportunity_suggested` | `agent.analysis` | `Opportunity.status=suggested` |
| `ai.deadline_suggested` | `agent.analysis` | `Deadline.status=open` (requires human accept) |
| `ai.snapshot_proposed` | `agent.analysis` | `SentenceSnapshot.status=proposed` |
| `ai.draft_generated` | `agent.drafting` | `PieceVersion.body` in `draft` status |
| `ai.analysis_completed` | `agent.analysis` | `AIAnalysis` record |
| `ai.missing_data_flagged` | `agent.ingestion` | Missing-data queue entry |

AI events carry:

- `agent_id` — which agent instance produced the output
- `model_id` — which model version was used
- `confidence` — at the aggregate and per-field level
- `explanation_bundle_id` — reference to the associated ExplanationBundle
- `input_refs[]` — which confirmed entities were consumed
- `unconfirmed_input_refs[]` — which unconfirmed entities also influenced output (warning flag)

### 2.5 Event producers

| Producer | Event classes |
|----------|--------------|
| **Human via API** | Domain events, workflow events, audit events |
| **Engine worker** | Recalculation events, system events, AI events (via agent) |
| **Ingestion worker** | System events, AI events |
| **Deadline evaluator** | Escalation events, recalculation events |
| **Notification worker** | Notification events |
| **SLA monitor** | Escalation events |
| **Admin actions** | Audit events, workflow events, escalation events |

### 2.6 Event consumers

| Consumer | Events consumed |
|----------|----------------|
| **Queue service** | All workflow events, escalation events |
| **Engine worker** | Snapshot confirmed, domain events affecting arithmetic |
| **Notification worker** | Notification-trigger events, escalation events |
| **Audit service** | All events (full stream subscriber) |
| **Timeline writer** | Domain events, select workflow events |
| **Deadline evaluator** | Snapshot confirmed, domain events, SLA breach events |
| **AI agent** | Document confirmed, case state events (read-only trigger) |
| **Analytics pipeline** (future) | Full event stream, read-only |

### 2.7 Event propagation

EXECFLOW uses a **transactional outbox pattern** for event propagation:

1. Domain action occurs → state change + AuditLog written in the same DB transaction
2. An event record is written to an **outbox table** in the same transaction
3. A background relay worker reads the outbox and publishes to the internal event bus
4. Downstream consumers (queue service, notification worker, engine trigger) subscribe to relevant event types

This ensures:
- The state change and its event notification are atomic
- The event is never lost (outbox survives crashes)
- Downstream services process events asynchronously without blocking the HTTP response
- No HTTP request waits for engine runs or notification dispatch

### 2.8 Event persistence

All events are persisted:

| Event class | Persistence store |
|-------------|------------------|
| Domain events | `TimelineEvent` table (append-only, legal record) |
| Audit events | `AuditLog` table (append-only, compliance record) |
| AI events | `AIAnalysis` table + AuditLog |
| System events | `EventLog` or structured application logs (retention configurable) |
| Notification events | `Notification` table (retained per notification lifecycle) |
| Outbox events | `EventOutbox` table (cleared after relay, but relay log retained) |

Domain events and audit events are **permanent records**. System and outbox events have configurable retention. Notification events are retained for the lifecycle of the notification (until acknowledged + configurable archive period).

### 2.9 Idempotency expectations

All event consumers must be idempotent — processing the same event twice must produce the same result as processing it once:

- Downstream consumers check for existing records before creating new ones (by `event_id` or natural key)
- Queue entry: if item already in queue, no duplicate is created
- Notification dispatch: deduplicated by `dedupe_key` (same event type + same entity within 24h)
- Engine triggers: if engine run already exists for the triggering event, skip (or compare output)

Idempotency is enforced at the consumer level, not by suppressing duplicate events at the bus level.

### 2.10 Replay behavior

Replay in EXECFLOW means: **re-apply a filtered event history to reconstruct state at a point in time**. It is a read operation, not a re-execution of side effects.

Rules:
- Replay does not re-trigger notifications, queue entries, or engine runs
- Replay does not modify any persistent state
- Replay outputs are labeled `simulation_mode=true` in all derived results
- The replay boundary (`as_of` timestamp) is always explicit — no implicit "latest minus N" replay

### 2.11 Failure tolerance

If an event consumer fails after the event is published:

- The event remains in the bus until acknowledged
- The consumer retries with exponential backoff
- After N retries, the event is moved to a dead-letter queue (DLQ)
- DLQ items generate an alert to admin (passive notification)
- Human intervention may be required for DLQ items — this is expected, not exceptional, for legal systems

No automatic "drop and continue" behavior for failed processing of domain or audit events.

---

## 3. State transition architecture

### 3.1 State machine principles

Every entity with a `status` field has a defined state machine. Implementation rules:

- State machines are defined in the service layer, not in the database
- Invalid transitions are rejected with a typed error before any write occurs
- Every accepted transition produces an AuditLog record (in the same transaction)
- Transitions that affect an ExecutionCase also produce a `TimelineEvent`
- Transitions are validated against the actor's role — some transitions are role-gated

### 3.2 ExecutionCase state machine

```
draft
  ↓ (associate_client + process number confirmed OR explicit activation)
active
  ↓ (all open obligations complete, lawyer archives)     ← reversible
suspended ←→ active (court suspension + restoration)
  ↓ (case fully completed + lawyer closes)
closed
  ↓ (admin marks stale, no activity)                    ← audit only
archived
```

| Transition | Actor required | Conditions |
|-----------|:-------------:|------------|
| `draft → active` | assistant or lawyer | Client associated |
| `active → suspended` | lawyer | Court suspension event recorded |
| `suspended → active` | lawyer | Restoration event recorded |
| `active → closed` | **lawyer** | No open overdue deadlines; no open liberty risks |
| `closed → active` | **lawyer** | New event or document re-activates |
| `* → archived` | admin | SLA inactivity threshold crossed |

`archived` is not a terminal state for liberty-affecting cases — a new event re-activates to `active`.

### 3.3 Document state machine

```
pending_association
  ↓ (OCR job triggered)
extraction_pending
  ↓ (OCR completes)              ↓ (OCR failed, unrecoverable)
extraction_review             failed_ocr
  ↓ (assistant reviews fields)
association_review
  ↓ (case linked)                ↓ (document rejected)
confirmed                     rejected_doc
  ↓ (case closed or archival policy)
archived
```

| Transition | Actor | Notes |
|-----------|-------|-------|
| `pending_association → extraction_pending` | System / ingestion worker | Automatic on upload |
| `extraction_pending → extraction_review` | System | OCR completion event |
| `extraction_pending → failed_ocr` | System | Unrecoverable OCR failure; manual note required |
| `extraction_review → association_review` | assistant / lawyer | All required fields confirmed |
| `extraction_review → rejected_doc` | assistant / lawyer | Reason required |
| `association_review → confirmed` | assistant / lawyer | Case association complete |
| `confirmed → archived` | System (policy) | Case archival cascade |

Immutable after `confirmed`: `storage_key`, `checksum_sha256`, `document_class`, confirmed field values.

### 3.4 Opportunity state machine

```
suggested (ai or rule)
  ↓ (lawyer qualifies)          ↓ (lawyer dismisses)
qualified                      dismissed
  ↓ (pursuit workflow)          (terminal)
pursuing
  ↓ (benefit granted / petition accepted)  ↓ (pursuit abandoned)
realized                                   abandoned
  (terminal)                              (terminal)

Special:
  suggested → blocked (missing data prevents qualification)
  blocked → suggested (missing data recovered → engine re-evaluates)
```

| Transition | Actor | Notes |
|-----------|-------|-------|
| `suggested → qualified` | **lawyer** | ExplanationBundle reviewed; waiver required if uncertainty indicators present |
| `suggested → dismissed` | **lawyer** | Dismissal reason enum required |
| `suggested → blocked` | System | Missing critical data detected by engine |
| `blocked → suggested` | System | Data recovered, engine re-run clears block |
| `qualified → pursuing` | **lawyer** | Piece creation triggered; preparer assigned |
| `pursuing → realized` | **lawyer** | Petition granted or benefit confirmed |
| `pursuing → abandoned` | **lawyer** | Strategic withdrawal; reason required |

No bulk state changes across multiple opportunities except admin-level dismissal of an expired decree batch, which requires explicit confirmation and audit record per item.

### 3.5 Deadline state machine

```
open
  ↓ (due_date < today)
overdue ←→ (if due_date extended)→ open
  ↓ (completion evidence provided)  ↓ (lawyer dismisses with legal basis)
completed                          dismissed
  (terminal)                        (terminal)

open → snoozed (if snooze-eligible class; not for critical)
snoozed → open (snooze expiry)
```

| Transition | Actor | Notes |
|-----------|-------|-------|
| `open → overdue` | System (SLA monitor) | Automatic on `due_date < now`; triggers escalation |
| `overdue → open` | **lawyer** | Due date extended with documented legal justification |
| `open/overdue → completed` | assistant / lawyer | Evidence attachment required |
| `open/overdue → dismissed` | **lawyer** | Reason code required; double confirmation for liberty-class |
| `open → snoozed` | user (if role-permitted) | Snooze not allowed on critical class |
| `snoozed → open` | System | Snooze expiry event |

Overdue deadlines trigger queue entry and interrupt strip behavior per `ux-flow-architecture.md §7.1`.

### 3.6 SentenceSnapshot state machine

```
proposed
  ↓ (lawyer reviews arithmetic + source docs)   ↓ (lawyer rejects)
confirmed                                        rejected
  ↓ (superseded by newer confirmed snapshot)
superseded
  (all states are terminal — no backward transitions)
```

| Transition | Actor | Notes |
|-----------|-------|-------|
| `proposed → confirmed` | **lawyer** | Sets `confirmed_by_user_id`; triggers engine re-run |
| `proposed → rejected` | **lawyer** | Reason required; record retained |
| `confirmed → superseded` | System | When a newer snapshot is confirmed; this record immutable |

A `confirmed` snapshot is **never deleted or overwritten**. It may be superseded — but the original record remains permanently with `superseded_by_snapshot_id`.

### 3.7 Intake bundle state machine

Defined in `execution-workflows.md §1.2`. Summary:

```
received → extraction_pending → extraction_review → association_review → execution_active
                ↓                     ↓
           failed_ocr            rejected_doc
```

### 3.8 PieceDraft and PieceVersion state machines

**PieceDraft (container):**

```
draft → in_review → approved → filed
         ↑     ↓ (reject)
         └──── draft (with rejection comment)
```

**PieceVersion (immutable body):**

```
editing → submitted → (on parent approval) locked
```

Each `in_review → draft` rejection creates a new `PieceVersion` for the revision. The rejected version is retained permanently.

### 3.9 Filing state machine

```
pending → filed
```

`filed` is the only non-initial state. Filing is **irreversible**. No `cancelled` or `error` state — if a filing was made in error, a new corrective filing is required; the erroneous filing remains in the record.

### 3.10 AI suggestion states

```
pending_review
  ↓ (human confirms)       ↓ (human dismisses)       ↓ (data changes invalidate)
accepted                  dismissed                   invalidated
  ↓ (flows into entity status)
(entity-level state takes over)
```

AI suggestions that are `invalidated` by a data change (e.g., a snapshot is superseded) are marked as such with `invalidated_by_event_id`. They are not deleted.

### 3.11 Reversible vs irreversible transitions

| Transition | Reversible |
|-----------|:----------:|
| Any status → `snoozed` | Yes |
| `draft → in_review` | Yes (reject returns to draft) |
| `active ↔ suspended` (case) | Yes |
| `closed → active` (case) | Yes |
| `proposed → confirmed` (snapshot) | No |
| `confirmed → superseded` (snapshot) | No |
| `opportunity → dismissed` | No (new opportunity required) |
| `piece_draft → filed` | No |
| `filing → filed` | No |
| `TimelineEvent` creation | No (amendment only) |
| `AuditLog` row | No |

### 3.12 Soft-failure states

Soft-failure states represent conditions where work cannot proceed but the record is not abandoned:

| State | Entity | Condition | Exit |
|-------|--------|-----------|------|
| `blocked` | Opportunity | Missing critical data | Data recovered; engine re-run |
| `failed_ocr` | Document | OCR unrecoverable | Manual review entry |
| `conflict` | ExecutionCase (flag) | Two confirmed snapshots conflict | Lawyer resolves via ConflictRecord |
| `missing_data` | ExecutionCase (flag) | Required field unconfirmed | Field confirmed or marked unavailable |
| `sla_breach` | Queue item | Age exceeds SLA | Item completed or explicitly escalated |

Soft-failure states do not prevent other work on the entity. They block only the specific computation that depends on the missing/conflicting data.

---

## 4. Queue-event integration

### 4.1 Queue architecture as derived state

Queues are **not separate tables with their own lifecycle**. A queue is a **named query over entity state** — an item is "in a queue" because its entity state matches that queue's entry condition.

This means:
- There is no "enqueue" write — state transitions cause items to appear in queues
- There is no "dequeue" write — state transitions cause items to leave queues
- Queue counts are live aggregates over entity state tables
- No orphaned queue items exist — if the entity state changes, the queue reflects it

### 4.2 Queue entry events

| Queue | Entry condition (entity state) | Triggering event |
|-------|-------------------------------|-----------------|
| `intake_review` | `document.status = pending_association` | `document.created` |
| `extraction_review` | `document.status = extraction_review` | `ai.extraction_proposed` |
| `missing_data` | `case.missing_required_field` | `extraction_review.completed_with_gaps` |
| `overdue_deadlines` | `deadline.status = overdue` | `sla_monitor.deadline_overdue` |
| `progression_opportunities` | `opportunity.type=progression AND status=suggested` | `engine_run.completed` |
| `pending_filings` | `piece_draft.status=approved AND filing=null` | `piece_draft.approved` |
| `recalculation_conflicts` | `case.has_open_conflict_record` | `conflict.created` |
| `urgent_liberty_risks` | `opportunity.family=liberty_risk AND status=suggested` | `engine_run.completed` |
| `pieces_in_review` | `piece_draft.status=in_review` | `piece_draft.submitted_for_review` |
| `pad_defense` | `deadline.type=pad_defense AND status=open` | `discipline.pad_opened` |

### 4.3 Queue exit events

| Queue | Exit condition | Triggering event |
|-------|---------------|-----------------|
| `intake_review` | `document.status ≠ pending_association` | `document.extracted` / `document.rejected` |
| `extraction_review` | `document.status = confirmed OR rejected_doc` | `extraction.confirmed` / `document.rejected` |
| `missing_data` | All required fields confirmed or marked unavailable | `field.confirmed` |
| `overdue_deadlines` | `deadline.status = completed OR dismissed` | `deadline.completed` / `deadline.dismissed` |
| `progression_opportunities` | `opportunity.status ≠ suggested` | `opportunity.qualified` / `opportunity.dismissed` |
| `pending_filings` | `filing.status = filed` | `filing.confirmed` |
| `recalculation_conflicts` | `conflict_record.resolved=true` | `conflict.resolved` |
| `pieces_in_review` | `piece_draft.status = approved OR draft` | `piece.approved` / `piece.rejected` |

### 4.4 Escalation triggers

SLA breach events are generated by the SLA monitor job, which runs on a configurable schedule (minimum: every 5 minutes):

| Condition | Event generated | Escalation target |
|-----------|----------------|------------------|
| `deadline.overdue` unacknowledged > 4h | `escalation.liberty_critical` | Backup lawyer + admin |
| `pieces_in_review` age > 48h | `escalation.high` | Admin |
| `intake_review` age > 48h | `escalation.normal` | Senior assistant |
| `missing_data` age > 7d without update | `escalation.high` | Responsible lawyer |
| `recalculation_conflicts` age > 72h | `escalation.high` | Responsible lawyer |
| `urgent_liberty_risks` unacknowledged > 4h | `escalation.liberty_critical` | Admin + all org lawyers |

Escalation events are stored in `EscalationLog` (append-only) and trigger notification dispatch without modifying the underlying entity state.

### 4.5 SLA breach behavior

When an SLA breach event fires:

1. `EscalationLog` record created
2. Escalation notification sent to target (per ladder in `notification.md §9.3`)
3. Queue item gains `escalated` flag (computed from EscalationLog, not a stored field)
4. Admin org-health panel reflects the breach

Resolving the underlying item automatically clears the escalation state — no separate "close escalation" action.

### 4.6 Ownership reassignment events

Ownership reassignment is an explicit event:

```
Event: queue_item.reassigned
  from_user_id: ...
  to_user_id: ...
  reason: (optional text)
  actor: user who performed the reassignment
  context: case_id, entity_type, entity_id
```

Bulk reassignment (vacation coverage) produces individual reassignment events per item — not a single aggregate event. This preserves per-item audit traceability.

### 4.7 Stale queue behavior

Staleness is a **computed state** derived from item age, not a stored status. Items become visually stale when age exceeds thresholds defined in `office-operating-system.md §2`. The `stale` flag on queue items is computed at query time, not stored.

Stale items:
- Appear with an "Aged [N] days" badge
- Trigger the SLA monitor's escalation logic
- Do not block other operations on the entity

### 4.8 Overload signaling

Overload is computed at the **user level**, not the queue level:

- Overload condition: user's total assigned queue depth > `org.overload_threshold` (configurable)
- Overload signal is an `EngineWarning` record, not a queue item
- Visible in admin org-health panel
- Does not auto-redirect new assignments — human judgment governs reallocation

### 4.9 Queue prioritization

Within a queue, items are sorted by:

1. Liberty-risk flag (highest priority — always top)
2. Escalation flag (second)
3. Overdue status
4. Age (oldest first within same priority tier)
5. Responsible lawyer affinity (within same tier — items assigned to the current user's cases surface first)

Priority is computed at query time, not stored. Re-sorting happens on every page load.

---

## 5. Legal recalculation model

### 5.1 Recalculation triggers

A recalculation is triggered when any confirmed input to the execution engine changes:

| Trigger event | Recalculation type |
|---------------|--------------------|
| `snapshot.confirmed` (new or superseding) | Full sentence arithmetic re-evaluation |
| `benefit.remicao_credited` | Remição balance update |
| `discipline.falta_grave` | Data-base reset; progression re-evaluation |
| `custody.transfer` + custody snapshot confirmed | Regime context update |
| `custody.release` or `custody.regime_change` | Progression reset |
| `playbook.version_published` (new active version) | Full re-evaluation for affected orgs |
| `case.sentence_unification` | Total P_total recalculation |
| `document.confirmed` (new arithmetic evidence) | Proposed snapshot trigger if fields conflict |

Recalculation is **asynchronous**. It does not block the API response that triggered it.

### 5.2 Snapshot invalidation

A confirmed `SentenceSnapshot` is never directly invalidated — it is **superseded**:

```
Trigger → engine runs → new SentenceSnapshot.proposed created
  → if proposed conflicts with confirmed: ConflictRecord created
  → if proposed is consistent with confirmed: proposed waits for lawyer review
  → on lawyer confirmation of proposed: confirmed snapshot marked superseded
```

Superseded snapshots remain permanently in the record with:
- `superseded_by_snapshot_id` (immutable pointer)
- `superseded_at` (timestamp)
- All original fields intact

Historical replay can reconstruct the confirmed state at any date by selecting snapshots where `superseded_at IS NULL OR superseded_at > target_date`.

### 5.3 Derived-state regeneration

After a snapshot is confirmed, derived states must be regenerated:

1. **Opportunities** — engine re-evaluates all opportunity families; new candidates proposed; prior `suggested` opportunities with stale arithmetic are marked `invalidated`
2. **Deadlines** — rule-based deadlines are regenerated from new arithmetic; prior derived deadlines are superseded (not deleted) with `superseded_by_deadline_id`
3. **ExplanationBundles** — regenerated for each new opportunity and deadline candidate; prior bundles retained for historical access
4. **ConflictRecords** — if the new snapshot resolves an existing conflict, the record is resolved; if it creates a new conflict, a new ConflictRecord is created

Derived-state regeneration does not modify human-created deadlines or manually qualified opportunities.

### 5.4 Confidence degradation

Aggregate confidence of engine outputs degrades when:

| Condition | Effect on confidence |
|-----------|---------------------|
| Input snapshot confirmed with `confidence=medium` | Output cannot exceed `medium` |
| Missing field on critical path | Output confidence drops to `low` or `blocked` |
| Pending judicial decision affecting arithmetic | Confidence degraded; `PENDING_COURT` uncertainty indicator |
| Active ConflictRecord on the case | All arithmetic outputs degraded to `blocked` |
| Unconfirmed OCR field used in proposed snapshot | Proposed snapshot marked `confidence=low` |

Confidence degradation is **monotonic downward through the causality chain**. A high-confidence output cannot be derived from a low-confidence input.

### 5.5 Pending-review states after recalculation

After a recalculation trigger:

- New `SentenceSnapshot.proposed` enters lawyer queue for confirmation
- Existing `Opportunity.suggested` items derived from the old snapshot are marked `stale_arithmetic=true` (a flag, not a status change)
- Items marked `stale_arithmetic` remain visible but with a "Arithmetic updated — please re-review" banner
- After lawyer confirms new snapshot: stale items are regenerated; old items marked `invalidated`

Lawyers are never silently shown opportunities based on stale arithmetic without a visible indicator.

### 5.6 Dependency chains

Recalculation propagates through a dependency chain:

```
New confirmed SentenceSnapshot
  → Engine re-run (async)
    → New Opportunity candidates (suggested)
    → New Deadline candidates (rule-derived)
    → ExplanationBundles generated
    → Conflict detection (compare with existing confirmed)
      → If conflict: ConflictRecord created → conflict queue entry
      → If no conflict: lawyer review queue for new proposed items
```

Each step in this chain is traceable via `engine_run_id` and `trigger_event_id`.

### 5.7 Legal-effect propagation

A single legal event can propagate to multiple dependent legal states:

Example: `discipline.falta_grave` confirmed on Case A:

```
Event: discipline.falta_grave (2024-06-15)
  → data-base resets to 2024-06-15
  → progression fraction re-computes from new data-base
  → previous progression eligibility date is now incorrect
  → existing Opportunity (progression) marked stale_arithmetic=true
  → new SentenceSnapshot.proposed created with new data-base
  → ConflictRecord candidate if new snapshot conflicts with confirmed
  → PAD defense deadline created (if applicable rule in active playbook)
  → Notification to lawyer: "Falta grave affects progression window"
```

This entire propagation chain must be traceable from the originating `discipline.falta_grave` event through every output record.

---

## 6. AI event behavior

### 6.1 AI suggestion generation

AI suggestions are produced by `agent.analysis` or `agent.ingestion` workers triggered by domain events. Generation follows this sequence:

```
Trigger event arrives (e.g., snapshot.confirmed)
  → Agent reads confirmed inputs only
  → Agent evaluates against active PlaybookVersion
  → Produces AIAnalysis record with:
      - output type (opportunity / deadline / extraction / draft)
      - output data (fields, body, candidates)
      - confidence (aggregate + per-field)
      - ExplanationBundle
      - model_id
      - playbook_version_id
      - input_refs[] (confirmed entities consumed)
      - unconfirmed_input_refs[] (warning: unconfirmed inputs that also influenced output)
  → Output entity created in `suggested` / `proposed` / `draft` status
  → AI event written to AuditLog
  → Queue entry derives from entity state
```

AI agents read confirmed state only. If the agent consumes unconfirmed data, `unconfirmed_input_refs[]` is populated and the output confidence is degraded to `low` or `blocked` per the confidence degradation rules (§5.4).

### 6.2 AI rejection events

When a human dismisses an AI suggestion:

```
Event: ai_suggestion.dismissed
  suggestion_id: ...
  dismissed_by: user_id
  reason: (enum: wrong_facts / not_applicable / already_handled / strategic_choice / error)
  occurred_at: ...
```

This event:
- Marks the `AIAnalysis` output with `dismissed_reason`
- Creates an AuditLog entry
- If `reason=error`: creates an `AIQualityFlag` record for investigation
- Prevents the same suggestion type from recurring until a material state change

`AIQualityFlag` records are reviewed by admin or AI governance process. They are **not silent** — they generate a passive notification to admin.

### 6.3 AI approval checkpoints

Per `AI_BOUNDARIES.md §mandatory-review-points`, every AI output passes through an explicit human gate before acquiring legal effect:

| AI output | Gate | Human action |
|-----------|------|-------------|
| `DocumentExtraction.proposed_fields` | Extraction review | Field-by-field confirm |
| `Opportunity.suggested` | Opportunity qualification | Lawyer qualifies |
| `SentenceSnapshot.proposed` | Snapshot confirmation | Lawyer confirms |
| `PieceVersion.draft` (AI-generated) | Piece approval | Lawyer approves |
| `Deadline.suggested` | Deadline accept/dismiss | User accepts |

These gates are enforced at the **service layer**. The API will reject any transition that skips a gate, regardless of the actor. There is no service method that converts `suggested → qualified` without setting `qualified_by_user_id`.

### 6.4 Confidence downgrade events

When new information arrives that reduces confidence in a prior AI output:

```
Event: ai_output.confidence_downgraded
  output_id: ...
  previous_confidence: high
  new_confidence: medium
  reason: (CONFLICT / NEW_DOCUMENT / PENDING_COURT / DATA_CORRECTION)
  trigger_event_id: ...
```

This event:
- Updates the confidence on the `AIAnalysis` record (this is a permitted update — not legal history)
- If output is `suggested` and now `blocked`: adds `stale_arithmetic` flag
- Triggers re-display of uncertainty indicators in the UX

### 6.5 Uncertainty propagation

Uncertainty propagates through the causality chain in the same direction as confidence degradation:

```
Document D has OCR field F with confidence=low
  → SentenceSnapshot S proposed using field F
    → S.confidence = low (from F)
      → Opportunity O suggested using S
        → O.confidence = low (from S)
          → O.uncertainty_indicators includes LOW_OCR(field=F, document=D)
```

Every item in the chain carries a reference to the root uncertainty source so that resolving the root (confirming field F to HIGH) can cascade improvements upward.

### 6.6 Explanation generation

ExplanationBundles are generated synchronously with the AI output — not retroactively reconstructed:

```
ExplanationBundle {
  summary: "Plain-language paragraph (PT-BR)"
  playbook_version_id: "..."
  rule_ids_applied: ["PROG-001", "PROG-003"]
  calculations: [
    { step: 1, description: "Total sentence: 8 anos = 2920 dias (confirmed)" },
    { step: 2, description: "1/6 fraction from rule PROG-001: 487 dias" },
    ...
  ]
  source_documents: [
    { document_id: "...", field: "P_total", span_hint: "page 2, line 14" }
  ]
  missing_data: [
    { field: "remicao_total", severity: "non_blocking", effect: "does not affect this calculation" }
  ]
  uncertainty_indicators: []
  alternatives: [
    { branch: "conservative", result: "...", difference: "..." }
  ]
}
```

A bundle cannot be generated after the fact from a different model version or playbook version — the bundle reflects the exact computation at the moment it was generated.

### 6.7 Provenance linkage

All AI outputs link back to their full provenance chain:

```
Opportunity.suggested
  → AIAnalysis (output record)
    → ExplanationBundle
    → EngineRun
      → PlaybookVersion
      → SentenceSnapshot[] (inputs)
        → DocumentExtraction[] (confirmed source)
          → Document[] (original file + checksum)
```

This chain enables: "What was the model, the rules, the arithmetic, and the source documents behind this specific suggestion on this specific date?" — answerable at any future time from stored records.

### 6.8 Human override behavior

When a lawyer overrides an AI conclusion (e.g., dismisses an AI-suggested opportunity or rejects an AI-proposed snapshot):

```
Event: ai_output.human_overridden
  output_id: ...
  override_action: (dismissed / rejected / corrected)
  actor_id: ...
  reason: ...
  corrected_value: (if applicable)
  occurred_at: ...
```

The AI output is not deleted. The override is recorded with full attribution. Both the AI output and the human override remain in the audit trail permanently. This preserves the ability to answer: "Was the AI's suggestion correct in retrospect?"

---

## 7. Notification event architecture

### 7.1 Notification event flow

```
Domain/workflow event triggers notification rule evaluation
  → NotificationRule matched (by event type + actor context)
  → Notification record created (status=pending)
  → Delivery worker dispatches (in-app, push, email per user preference)
  → Notification record updated: status=sent / failed
  → On user acknowledgment: status=acknowledged
  → On snooze: status=snoozed, snooze_until set
```

### 7.2 Passive notifications

Passive notifications are accumulated as counts — they do not interrupt the user's flow:

- Created as `Notification` records in the database
- Increment a badge count visible in the UI
- Delivered to the daily digest
- No push dispatch

Passive notification triggers include: task assigned, AI suggestion batch ready, piece status changed (non-urgent), document confirmed.

### 7.3 Interruptive alerts

Interrupt-class notifications are dispatched immediately and persist in the interrupt strip:

- Created as `Notification` records with `interrupt=true`
- Dispatched to push channel (if enabled) regardless of quiet hours (liberty-critical only)
- Added to interrupt strip on next page load (or WebSocket push if real-time enabled)
- Remain in strip until `acknowledged_at` is set

Interrupt class triggers include: deadline overdue (D-0), liberty-risk opportunity suggested, PAD defense window D-1, piece in review past threshold.

### 7.4 Escalation ladders

Escalation is a **secondary notification** triggered by non-acknowledgment:

```
Interrupt notification sent → acknowledgment_window starts
  → 4h elapsed, no acknowledgment
    → EscalationLog entry created
    → Escalation notification sent to next target in ladder
      → Additional 4h window
        → If still unacknowledged: admin + all org lawyers notified
```

Escalation notifications are stored separately from the original notification. They reference `original_notification_id`.

### 7.5 Suppression logic

A notification is suppressed (not created) when:

| Condition | Suppression scope |
|-----------|------------------|
| Item already acknowledged by the target user | That user; other users still receive |
| Duplicate within `dedupe_window` for the same `dedupe_key` | Global |
| User's quiet hours are active | Non-interrupt class only |
| User has snoozed the related item | That user; resumes at snooze expiry |
| Case is `archived` | All passive notifications for that case |

Suppression never applies to liberty-critical class.

### 7.6 Deduplication

Notifications are deduplicated by `dedupe_key`:

```
dedupe_key = hash(organization_id + notification_rule_id + entity_id + floor(created_at / dedupe_window))
```

If a `Notification` record with the same `dedupe_key` exists and was created within `dedupe_window` (default 24h for most rules; configurable per rule), the new notification is suppressed.

Deduplication applies to passive and high-priority notifications. Liberty-critical notifications are not deduplicated — each overdue state is a distinct notification.

### 7.7 Legal-critical overrides

Liberty-critical notifications override:

- Quiet hours
- Snooze settings
- Digest-only preference
- Deduplication window (reset on each 4-hour cycle)

They cannot be programmatically suppressed by any user setting. Resolving the underlying item is the only suppression path.

### 7.8 Digest generation

The daily digest is a **scheduled composition**, not a collection of individual unsent notifications:

```
Digest trigger (org timezone 08:00):
  → Query: all open queue items for the user
  → Group by: critical, today, this_week
  → Exclude: snoozed items, acknowledged items
  → Render digest structure per ux-flow-architecture.md §9.2
  → Deliver via email / in-app digest
  → AuditLog: digest.sent (recipient, item count, digest_id)
```

The digest is not a list of pending `Notification` records — it is a fresh query over current queue state. This ensures it reflects items that arrived after yesterday's digest.

### 7.9 Notification expiry

| Notification class | Expiry |
|-------------------|--------|
| Liberty-critical | Never auto-expired; persists until acknowledged |
| Critical | 30 days after acknowledgment |
| High | 14 days after acknowledgment |
| Normal/passive | 7 days after acknowledgment |
| Digest record | 90 days |

Expired notifications are soft-deleted (`deleted_at`), not hard-deleted. They remain in the audit archive.

---

## 8. Audit architecture

### 8.1 Append-only audit history

The `AuditLog` table is the only table in the system with **no update and no delete path** — not even soft-delete. Every audit record is created once and never modified.

Write rules:
- AuditLog writes occur in the same database transaction as the action they record
- No service method that changes legal state may commit without a co-committed AuditLog entry
- Background workers that produce legal outputs (engine, ingestion) write AuditLog entries for their outputs

Read rules:
- AuditLog is readable by lawyers and admins for their organization
- Sensitive-field audit reads (CPF access, document export) are themselves logged in AuditLog
- AuditLog export is a dedicated action, separately logged

### 8.2 Actor attribution

Every audit record carries full actor attribution:

| Field | Possible values |
|-------|----------------|
| `actor_type` | `user`, `agent.ingestion`, `agent.analysis`, `agent.drafting`, `system` |
| `actor_id` | UUID of the actor (user_id or agent instance identifier) |
| `actor_role` | Role at the time of the action (for human actors) |
| `ip_address` | For human web API calls |
| `model_id` | For AI agent actions |
| `session_id` | For human actors (for session-level correlation) |

Actions attributed to `system` (e.g., automatic SLA state changes) must still record the `trigger_event_id` that caused the system action.

### 8.3 AI attribution

AI-generated outputs carry dual attribution:

1. The AI agent that produced the output (`agent.analysis`, `agent.ingestion`, etc.)
2. The human who accepted, dismissed, or confirmed the output (in a subsequent AuditLog entry)

The two records are linked via the shared `entity_id`. This enables the audit query: "Show me all AI outputs that were accepted without modification" or "Show me all AI suggestions that the lawyer overrode."

### 8.4 Provenance tracking

AuditLog entries for legal outputs include:

| Field | Contents |
|-------|---------|
| `trigger_event_id` | The event that caused this action |
| `engine_run_id` | For engine-derived outputs |
| `playbook_version_id` | For rule-governed outputs |
| `parent_entity_id` | For outputs derived from another entity |

This allows traversal of the provenance graph: "This Opportunity was suggested by this EngineRun, which was triggered by this SentenceSnapshot confirmation, which was confirmed by this lawyer, who received this extraction from this document, which was uploaded by this assistant."

### 8.5 Before/after snapshots

For state transitions on key entities, AuditLog records store structured change data:

| Entity | Change data |
|--------|------------|
| `SentenceSnapshot.confirmed` | Full snapshot payload at confirmation |
| `Opportunity.status_changed` | Previous and new status + reason |
| `Deadline.dismissed` | Previous status + reason code + actor |
| `PieceDraft.approved` | Piece version ID + body checksum |
| `ExecutionCase.status_changed` | Previous and new status |
| `PlaybookVersion.published` | Full playbook diff from prior version |

For entities that carry full history (TimelineEvent, SentenceSnapshot), the audit record points to the entity itself rather than duplicating its payload.

### 8.6 Legal replay support

The AuditLog, combined with append-only entity records, enables full legal replay:

```
Query: "Reconstruct the legal state of Case ABC as of 2024-01-01"

1. Fetch all SentenceSnapshot records where created_at ≤ 2024-01-01 AND (superseded_at IS NULL OR superseded_at > 2024-01-01)
2. Fetch all TimelineEvent records where occurred_at ≤ 2024-01-01
3. Fetch all confirmed Deadline records active on that date
4. Fetch all Opportunity records with qualifying status on that date
5. Return ReplayBundle: the reconstructed legal state with confidence notes

The AuditLog provides the "what did the office believe on 2024-01-01" answer:
  → AuditLog records with occurred_at ≤ 2024-01-01 show every action the office took
  → Including what they knew (documents confirmed), what they decided (opportunities qualified), and what they filed (filings recorded)
```

Replay does not re-execute computations — it reads stored records.

### 8.7 Historical reconstruction for malpractice or judicial review

EXECFLOW audit records are designed to support professional liability defense:

- **What did the office know and when?** → AuditLog + confirmed document timeline
- **Did the office file on time?** → Filing record with `filed_at` + protocol number
- **Did the office follow legal rules?** → PlaybookVersion + engine ExplanationBundle
- **Did a lawyer actually review and approve?** → `confirmed_by_user_id` + AuditLog entry for confirmation
- **Was AI involved and how?** → AIAnalysis + `ai_generated_ratio` on PieceVersion

This reconstruction requires only database reads — no re-execution of business logic.

### 8.8 Immutable chains

The following chains are immutable end-to-end:

```
Document upload
  → DocumentExtraction (immutable after confirmed)
    → SentenceSnapshot (immutable from creation)
      → EngineRun (immutable from creation)
        → Opportunity (immutable after terminal state)
          → PieceDraft/PieceVersion (immutable from creation)
            → Filing (immutable from creation)

AuditLog (every step above has corresponding immutable audit entries)
```

No step in this chain can be modified retroactively. The chain is a provenance trail that holds for legal accountability.

---

## 9. Failure and recovery model

### 9.1 Worker failure behavior

EXECFLOW background workers (engine, ingestion, notification, SLA monitor) are stateless and idempotent:

- Workers read their trigger from the event outbox or job queue
- Workers write their output atomically (output record + AuditLog in same transaction)
- If a worker crashes mid-execution, the trigger event remains unacknowledged in the outbox
- On restart, the worker re-processes the unacknowledged event
- Idempotency guards (§2.9) prevent duplicate output records

### 9.2 Partial processing

For multi-step processes (e.g., engine run that evaluates multiple opportunity families):

- Each evaluation unit is written individually before the next begins
- If the worker fails mid-run, the completed evaluations are retained
- On restart, the worker checks existing outputs for the `engine_run_id` and skips already-evaluated families
- A partial `EngineRun` is marked `status=partial` and triggers a passive alert for admin

### 9.3 Retry safety

All workers implement retry safety:

- Each retry attempt checks for existing output records keyed by `(trigger_event_id, output_type)`
- If output already exists: log the duplicate attempt and acknowledge the event (skip)
- If output does not exist: produce output normally
- Maximum retry count per event: configurable per worker type; default 5
- After max retries: move to DLQ with `failure_reason` and alert admin

### 9.4 Duplicate event protection

Duplicate event protection at the consumer layer:

- Consumer maintains a `processed_events` table (keyed by `event_id`)
- On event received: check if `event_id` already in `processed_events`
- If yes: acknowledge without processing (idempotent)
- If no: process → write output → insert `event_id` into `processed_events` → acknowledge

The `processed_events` table is scoped per consumer — the same event may be legitimately processed by multiple consumers.

### 9.5 Eventual consistency expectations

EXECFLOW is **eventually consistent** in these specific areas:

| Area | Consistency model | Implication |
|------|-----------------|-------------|
| Queue counts in UI | Eventually consistent (30s max) | Badge shows "approximately N items" |
| Notification delivery | Eventually consistent (seconds to minutes) | Push may arrive after in-app |
| Derived opportunities after recalculation | Eventually consistent (engine runs async) | "Calculating..." state visible |
| Digest generation | Eventually consistent (scheduled) | Digest reflects state at generation time |

EXECFLOW is **strongly consistent** in these areas:

| Area | Consistency model | Implication |
|------|-----------------|-------------|
| AuditLog writes | Synchronous, same transaction | Audit never lags legal state |
| Snapshot confirmation | Synchronous | `confirmed_by` set atomically with state change |
| Filing creation | Synchronous | Filing immutable from creation; no eventual creation |
| Status transitions | Synchronous | State machine enforced in same request |

### 9.6 Degraded-mode behavior

When an external dependency (OCR provider, AI model endpoint) is unavailable:

| Degraded service | System behavior |
|-----------------|----------------|
| OCR unavailable | Intake proceeds to `extraction_pending`; retried on recovery; manual entry available as fallback |
| AI agent unavailable | Queue items remain in state; no AI suggestions generated; human manual entry unaffected |
| Notification service down | Notifications queued in outbox; delivered on recovery; digest generated from current state |
| Engine unavailable | Snapshot confirmations succeed; engine output deferred; `engine_run_status=pending` visible in UI |

No legal state change is blocked by external service unavailability. The system degrades gracefully — human workflows continue; AI and engine outputs are deferred.

### 9.7 Replay recovery

When a replay recovery is needed (e.g., a worker produced incorrect output due to a bug):

1. Incorrect output records are identified and marked `invalidated=true` (not deleted)
2. The triggering events are re-queued for the corrected worker
3. The corrected worker produces new output records
4. An `AuditLog` record describes the replay recovery with reason and actor
5. Users see: "Results updated — [reason]" on affected items

No silent overwriting of prior output. The recovery is itself an audit-trail event.

### 9.8 Human intervention points

The system surfaces DLQ items and failure states to humans in these ways:

| Failure | Visible to | Surface |
|---------|------------|---------|
| DLQ item | Admin | Org-health panel |
| Partial engine run | Admin + responsible lawyer | Passive notification |
| Failed OCR (unrecoverable) | Assistant | Queue item: `failed_ocr` state |
| Missing ExplanationBundle | Admin | AI review queue item |
| Replay recovery completed | Responsible lawyer | Notification per affected case |

Human intervention for system failures is a **designed expectation**, not an edge case. In a legal platform, silent automated recovery is less acceptable than visible human acknowledgment.

---

## 10. Time and temporal consistency

### 10.1 Two independent clocks

EXECFLOW maintains two distinct time systems that must never be implicitly merged:

| Clock | Used for | Stored as |
|-------|----------|----------|
| **Calendar time** | Deadlines, hearings, SLAs, notification windows | UTC timestamps, display in org timezone |
| **Sentence arithmetic time** | Days-of-sentence, remição, detração, fractions | Integer days in snapshot payload, linked to legal reference dates |

The bridge between the two clocks is explicit: a `TimelineEvent` or `SentenceSnapshot` carries both a `occurred_at` (calendar) and arithmetic quantities (sentence time). No computation conflates them without an explicit bridge.

### 10.2 Authoritative timestamps

| Timestamp | Authority | Notes |
|-----------|-----------|-------|
| `TimelineEvent.occurred_at` | Human-entered or document-extracted; human confirms | The **legal fact date** — what happened in the world |
| `TimelineEvent.recorded_at` | System-generated on write | When the system received the information |
| `SentenceSnapshot.as_of_date` | Human-confirmed | The legal reference date for the arithmetic |
| `Filing.filed_at` | Human-entered (assistant) | The court submission date |
| `AuditLog.occurred_at` | System-generated | The system action date; always UTC; never overrideable |
| `Deadline.due_date` | Rule-derived or human-entered | Calendar date for SLA enforcement |

`occurred_at` and `recorded_at` are always different fields — they are never conflated.

### 10.3 Legal effective dates

Some legal effects apply from a date in the past (retroactive events):

- Detração credited from a past arrest date
- Remição recognized for past work/study certificates
- Falta grave affecting the data-base from incident date (not registration date)

For retroactive events:
- `occurred_at` records the legal event date (the past date)
- `recorded_at` records when the office registered it
- Engine re-evaluates from the `occurred_at` date forward
- Any previously computed state based on the pre-event arithmetic is marked `stale_arithmetic=true`

### 10.4 Ingestion dates vs event dates

An important distinction for all document-derived data:

| Date type | Meaning |
|-----------|---------|
| `document.uploaded_at` | When the file arrived in the system |
| `document_extraction.completed_at` | When OCR finished |
| `timeline_event.occurred_at` | When the legal fact happened (extracted from document or entered manually) |
| `timeline_event.recorded_at` | When the office registered the fact in the system |

Search and filtering in the UX must allow all four types of date as filter criteria. Queue SLA timers use `recorded_at`, not `occurred_at`, for calculating queue age.

### 10.5 Replay dates

When replaying system state as of date X:

- Use `occurred_at ≤ X` for timeline events (legal narrative up to X)
- Use `created_at ≤ X AND (superseded_at IS NULL OR superseded_at > X)` for snapshots (the confirmed state on X)
- Use `confirmed_at ≤ X` for document extractions (what was known on X)
- Use `playbook_version.effective_from ≤ X AND (effective_until IS NULL OR effective_until > X)` for playbook version selection

Replay is always explicit — the caller specifies the `as_of` date. There is no implicit "latest" for replay queries.

### 10.6 Chronology conflicts

A chronology conflict occurs when a newly confirmed event has an `occurred_at` that falls **before** already-confirmed events:

Example: Office confirms a 2022 court decision in 2025. The 2022 date is before many already-confirmed 2023–2025 events.

Handling:
- The new event is inserted with its correct `occurred_at=2022-...`
- The timeline re-sorts by `occurred_at` — no chronological gaps are patched over
- Engine is triggered to re-evaluate from `occurred_at` forward
- Derived deadlines and opportunities based on now-incorrect prior state are marked `stale_arithmetic=true`
- A `TimelineEvent: retrospective_data_entry` system event is written with `retrospective=true` flag

### 10.7 Timezone handling

- All database timestamps are stored in **UTC**
- All SLA calculations are performed in **UTC**
- Deadline display and digest generation use **org timezone** (configurable per organization)
- `due_date` is stored as a **date** (not timestamp) — it becomes midnight UTC on the due date for SLA purposes
- Org timezone changes are handled by recomputing display values; stored UTC values do not change

### 10.8 Late-arriving information

Late-arriving information (documents that describe past events arriving now) is common in criminal execution practice:

- Office receives a 2021 sentence correction document in 2025
- Document is registered with `received_at=2025-...`, events extracted with `occurred_at=2021-...`
- Engine re-evaluates from 2021 forward
- All derived state changes are marked `retrospective=true`
- Users see "Retrospective update" banner on affected cases

Late-arriving information is not an exceptional case — it is a routine event in this domain. The system is designed to handle it without architectural stress.

### 10.9 Historical corrections

A historical correction amends a prior confirmed event:

```
Original: TimelineEvent(type=court.sentence_issued, occurred_at=2022-03-15, P_total=2920)
Correction: TimelineEvent(type=court.sentence_correction, occurred_at=2022-03-15,
                          amends_event_id=<original>, P_total=2555, correction_reason="typo in original entry")
```

Both events remain permanently visible in the timeline. The correction does not overwrite the original. The engine uses the most recent correction for arithmetic. Historical replay at `as_of < correction.recorded_at` uses the original.

---

## 11. Forbidden event/state patterns

These patterns are prohibited and must be detected in code review:

| Forbidden pattern | Why it is prohibited |
|-------------------|---------------------|
| **Silent state mutation** | Any state change without an AuditLog record cannot be traced; violates `ENGINEERING_PRINCIPLES.md §4` |
| **Hidden recalculation** | Arithmetic updates that don't produce a new `SentenceSnapshot.proposed` and notify the lawyer are legally dangerous |
| **Destructive replay** | Replay of events must be read-only; re-executing side effects (notifications, new records) from replay is prohibited |
| **Mutable legal history** | `UPDATE` statements on `TimelineEvent`, `SentenceSnapshot`, `Filing`, `PieceVersion`, `AuditLog` are architecture violations |
| **AI-triggered irreversible actions** | AI agents may not write `confirmed_by`, `approved_by`, `filed_at` fields or transition entities past human-gate states |
| **Orphaned audit events** | An AuditLog record that references an `entity_id` that doesn't exist (e.g., record was hard-deleted) is an architectural defect |
| **Implicit approvals** | Any transition that sets `approved_by`, `confirmed_by`, or `qualified_by` without an explicit human API call is prohibited |
| **State changes without provenance** | A state change that carries no `trigger_event_id` or `actor_id` cannot be audited; required on every write |
| **Frontend-owned state logic** | The frontend may not transition entities or evaluate legal state; it reads state from the API and submits human decisions |
| **Confidence bypass** | An engine output that omits confidence or uses default "high" without actual computation is an architectural defect |
| **Hardcoded escalation targets** | Escalation ladders are configuration, not hardcoded; must be org-configurable |
| **Cross-organization event consumption** | No consumer processes events from a different organization's entity stream |
| **Non-transactional audit writes** | AuditLog written outside the transaction of the action it records is unreliable |
| **Duplicate confirmed snapshots** | Two `SentenceSnapshot.status=confirmed` records for the same case without a `ConflictRecord` is a data integrity defect |
| **Queue items without exit condition** | Every queue must have a defined exit condition; items that can only be deleted (not completed) are a queue design defect |
| **Expiring legal history** | No retention policy may delete `TimelineEvent`, `AuditLog`, `SentenceSnapshot`, `Filing`, or `PieceVersion` records |
| **Notification as state truth** | Notification delivery (sent/acknowledged) is not authoritative for legal state; the underlying entity state is |
| **Bulk confirmation of AI suggestions** | Bulk-accept on AI-suggested opportunities, snapshots, or legal conclusions is prohibited — each requires individual review |

---

## 12. Future extensibility

### 12.1 Distributed workers

When the system scales beyond single-worker capacity:

- The event outbox model scales naturally — multiple worker instances can consume from the same queue with idempotency guards
- Engine runs are partitioned by `case_id` — each case's recalculation is processed sequentially per case; cross-case parallelism is safe
- Notification workers are stateless and scale horizontally
- No distributed locking is required if the outbox pattern and idempotency guards are properly implemented

Forbidden in distributed scaling: distributing partial engine runs across workers (single case = single worker run), cross-worker state sharing without passing through the database.

### 12.2 Multi-office deployments

For organizations with multiple offices (branches):

- Each branch is a separate `office_id` within the same organization
- Event streams are org-scoped; branch filtering is applied at the query layer
- Escalation ladders are configurable per office (not org-wide)
- Shared resources (PrisonUnit catalog, global PlaybookVersion) remain org-scoped or system-global per current design
- Cross-office event visibility is governed by `Membership` role and explicit sharing records

The event model does not change — filtering scope changes.

### 12.3 Tribunal integrations

Tribunal webhooks or API pulls (e.g., PJe/e-SAJ movement feeds) produce events via:

- A dedicated `agent.tribunal` actor in the event system
- All tribunal events enter as `intake.tribunal` channel records — same intake state machine as manual uploads
- Tribunal-sourced domain events carry `source_type=tribunal_api` and `source_run_id`
- All tribunal data passes through the extraction review gate before affecting engine inputs
- Tribunal integrations are **event producers** only; they do not bypass confirmation gates

### 12.4 Future AI agents

New AI agent types (e.g., a monitoring agent that watches for new judicial decisions) enter the event system as:

- New entries in the actor registry with `actor_type=agent.new_type`
- Defined output event types in the event taxonomy
- Explicit permission definitions in `AI_BOUNDARIES.md` before any implementation
- Trust calibration starts at "all through human review queue" per `AI_BOUNDARIES.md §trust-calibration`

The event system does not require structural changes to accommodate new agents — only new actor types and event types.

### 12.5 Advanced automation

Future automation (auto-trigger engine re-evaluation at scheduled intervals, batch decree processing):

- All automation acts as an `actor_type=system` with `trigger_type=scheduled`
- Outputs follow the same `proposed/suggested` state model — no automation writes `confirmed`
- Automation results appear in existing queues for human review
- Automation volume is rate-limited to prevent queue flooding

The human review architecture does not change with automation expansion — automation feeds queues; humans drain queues.

### 12.6 External event ingestion

For future integrations where external systems push events (court webhooks, prison system APIs):

- All external events enter through a dedicated ingestion API with authentication and rate limiting
- External events are normalized to EXECFLOW event format on ingestion
- Normalization failures route to a `failed_ingestion` queue for human review
- No external system can directly write confirmed state — external events always produce `proposed` outputs requiring human confirmation
- External event sources are tracked via `source_integration_id` for provenance

### 12.7 Analytics pipelines

When analytics are added (Phase 9 per `IMPLEMENTATION_ORDER.md`):

- Analytics pipeline consumes the **full read-only event stream** via an event bus subscription or CDC (change data capture)
- Analytics writes go to a separate analytics store — they never write back to the operational database
- Analytics data is always derived from confirmed state only — no analytics on proposed or AI-suggested state
- Analytics pipeline failures do not affect operational system behavior
- The operational event model does not change for analytics — analytics adapts to the event stream

### 12.8 Real-time collaboration

For real-time multi-user presence in the case workspace (future):

- Presence signals are ephemeral — they are not stored in the operational database
- Soft-locks on queue items (§5.3) are implemented as short-TTL records, not as permanent state
- Collaborative piece editing would require an operational transform or CRDT layer — this is a separate architecture concern that does not affect the immutable event model
- The core event model (append-only, audit-first) is compatible with real-time collaboration; the UI layer handles conflict prevention

---

## 13. Cross-reference matrix

| Document | Dependency in this document |
|----------|-----------------------------|
| `functional-architecture.md` | State machines for cases, pieces, opportunities |
| `execution-workflows.md` | Intake state machine, recalculation triggers, timeline events |
| `data-model-v1.md` | Entity immutability rules, append-only constraints, entity catalog |
| `execution-engine.md` | Engine principles, snapshot model, ExplanationBundle structure |
| `office-operating-system.md` | Queue catalog, SLA thresholds, escalation targets |
| `playbook-system.md` | Playbook versioning, rule-derived events |
| `ux-flow-architecture.md` | Queue interaction UX, notification interaction model |
| `project-governance/ARCHITECTURE_RULES.md` | Forbidden patterns, state machine enforcement |
| `project-governance/ENGINEERING_PRINCIPLES.md` | Append-only, explainability, no silent mutations |
| `project-governance/AI_BOUNDARIES.md` | AI event behavior, mandatory human gates, confidence model |

---

## 14. Document control

| Version | Date | Notes |
|---------|------|-------|
| 0.1 | 2026-05-17 | Initial event and state architecture |

**Next step:** Implement `packages/db` schema (Phase 1 per `IMPLEMENTATION_ORDER.md`) with this document as the behavioral specification for immutability, state machines, and audit requirements. Every table with a `status` column must have its state machine documented here before the schema is written.
