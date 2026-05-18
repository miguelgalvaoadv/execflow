# EXECFLOW — Architecture Rules

**These are hard constraints, not guidelines.**  
Violations must be identified in code review and corrected before merge. They are not subject to "we'll fix it later" deferrals in legal-domain systems.

---

## Forbidden shortcuts

### F-01 · No business logic in the frontend

The frontend renders state and collects user decisions. It does not:

- Compute legal fractions or eligibility windows
- Determine whether an opportunity is qualified
- Calculate days remaining
- Enforce role permissions beyond visual rendering
- Decide which playbook branch applies

All of these live in the backend service layer or execution engine. Frontend permission checks are UX-only — the API enforces the real permission.

### F-02 · No hardcoded legal parameters in source code

No legal threshold, fraction, duration, or decree condition appears as a literal in any source file:

```
// FORBIDDEN
const PROGRESSION_FRACTION_GENERAL = 0.1667;
const FALTA_GRAVE_LOOKBACK_DAYS = 365;
const HEDIONDO_FRACTION = 0.4;
```

All such values are read from a published `PlaybookVersion` at engine runtime. References in code use rule IDs, not magic numbers.

Reference: `playbook-system.md §9`.

### F-03 · No silent state mutations

Every write to a legal entity that changes its status, ownership, or key field produces:

1. `AuditLog` row (required, synchronous in the same transaction)
2. `TimelineEvent` row (required for ExecutionCase mutations)
3. Notification dispatch (async, but must be enqueued in same transaction)

There is no "background update" path that skips the audit.

### F-04 · No direct database writes from the frontend

Frontend → API → service → database. No client-side database access, no direct Supabase/Postgres calls from browser code that bypass the service layer.

### F-05 · No unauthenticated access to any API route

Every API route is authenticated. Every route that touches an org-scoped entity validates `organization_id` membership. There is no "public" endpoint for legal data.

---

## Forbidden data operations

### D-01 · No hard delete on legal history entities

The following entities are **never hard-deleted** under any circumstance:

| Entity | Reason |
|--------|--------|
| `AuditLog` | Compliance and dispute resolution |
| `TimelineEvent` | Legal case narrative |
| `Document` (binary) | Evidence immutability |
| `DocumentExtraction` | OCR provenance |
| `Filing` | Court submission proof |
| `PieceVersion` | Filing integrity |
| `SentenceSnapshot` | Arithmetic history |
| `ExecutionCustodySnapshot` | Regime history |
| `AIAnalysis` | Traceability |

No migration script, admin panel, or worker may run `DELETE` on these tables. Soft-delete (`deleted_at`) is the maximum permitted operation, and only for entities that permit it per `data-model-v1.md §9`.

### D-02 · No in-place update on immutable fields

Immutable fields (defined in `data-model-v1.md §2.*`) are never updated after their milestone event. Examples:

- `Document.storage_key` and `checksum_sha256` — immutable after upload
- `PieceVersion.body` — immutable after creation
- `Filing.*` — immutable after creation
- `AuditLog.*` — always immutable

Corrections use new records with `amends_*_id` or `supersedes_*_id` pointers.

### D-03 · No unconfirmed data as engine input

The execution engine must only consume data with `confirmed` status or explicit human-promotion markers. Proposed OCR fields, AI suggestions, and draft snapshots are not valid engine inputs.

Enforce this at the service layer — the engine does not decide what is confirmed; the confirmation workflow determines it.

### D-04 · No duplicate process number without merge workflow

Two active `ExecutionCase` records with the same `execution_process_number` in the same organization cannot be created without an explicit merge workflow that produces an `AuditLog` record.

---

## Forbidden AI operations

### A-01 · AI does not write confirmed state

AI agents produce `AIAnalysis` records with `status=suggested` outputs. They do not:

- Set `SentenceSnapshot.confirmed_by_user_id`
- Set `Opportunity.status = qualified`
- Set `PieceDraft.status = approved`
- Create `Filing` records
- Set `Deadline.status = completed`

All of these require a human action. AI output is an **input to a human decision**, not a decision itself.

Reference: `AI_BOUNDARIES.md`.

### A-02 · AI does not select interpretation branches

When a playbook has multiple interpretation branches, the active branch is set by a lawyer or org admin. AI may present the branches and their implications in an ExplanationBundle — it does not pick one.

### A-03 · AI does not publish playbooks

No automated process publishes a new `PlaybookVersion`. Publication requires dual human review (author ≠ approver, approver must have `lawyer` role), validation suite pass, and AuditLog.

Reference: `playbook-system.md §6`.

---

## State machine discipline

### S-01 · All status transitions are explicit and validated

Every entity with a `status` field has a defined state machine (in `functional-architecture.md §4` and `data-model-v1.md §2.*`). The API enforces that:

- Only valid next-states are accepted for a given current state
- The actor performing the transition has the required role
- An AuditLog entry is written on every transition

There are no "shortcut" transitions — a piece cannot go from `draft` to `filed` without passing through `in_review` and `approved`.

### S-02 · Queue membership is derived from entity state

Queues are computed views, not separate tables with their own data. An item is "in a queue" because its entity state matches the queue's entry condition. There is no separate "add to queue" write — queues reflect the truth of entity state.

Reference: `office-operating-system.md §2`, `data-model-v1.md §7.6`.

---

## Playbook discipline

### P-01 · Every engine run cites playbook version

Every `EngineRun` (and therefore every `Opportunity`, `Deadline` from a rule, and `SentenceSnapshot` proposal) stores:

- `playbook_version_id`
- `rule_ids_applied[]`
- `interpretation_branch_id` (when applicable)

This enables full replay of "why did the system suggest X on date Y?"

### P-02 · New law = new playbook version, not a code change

When Brazilian law changes a fraction, decree publishes, or STJ súmula changes a lookback period, the response is:

1. Draft a new `PlaybookVersion` with updated rule values
2. Pass the validation and review process
3. Publish with a future `effective_from`

Not: edit a constant in source code, open a PR, and deploy.

---

## Multi-tenancy discipline

### M-01 · Every query is organization-scoped

All data queries for business entities include `WHERE organization_id = ?`. No query returns data across organizations. This is validated by integration tests per entity type.

### M-02 · No cross-organization data references

An `ExecutionCase` from org A cannot reference a `Client` from org B. Foreign keys never cross organization boundaries (with the exception of system-global reference data like `PrisonUnit`).

---

## Layer separation enforcement

| Allowed dependency direction | Forbidden direction |
|------------------------------|---------------------|
| Frontend → API | API → Frontend |
| API → Service layer | Service → API routing |
| Service → Execution engine | Engine → API |
| Engine → Playbook system | Playbook → Engine (engine reads playbook) |
| Service → Data layer | Data layer → Service logic |

Circular dependencies between layers are architecture violations, not code smells.
