# EXECFLOW — Engineering Principles

**Binding for:** backend, frontend, data, AI/ML, infrastructure contributors.  
**Not negotiable:** These principles exist because of the legal domain, not despite it.

---

## 1. Architecture before implementation

No module, route, schema, or component is written without a prior specification in `/docs`. When a spec does not exist for what you are about to build, **write the spec first**.

Violated by: starting with UI components before schema; building API routes without workflow spec; hardcoding logic without playbook reference.

Reference: `IMPLEMENTATION_ORDER.md` for the enforced sequence.

---

## 2. Append-only legal history

**All entities that constitute legal facts are append-only after a milestone:**

| Entity | Milestone |
|--------|-----------|
| `TimelineEvent` | Creation |
| `SentenceSnapshot` | Creation |
| `ExecutionCustodySnapshot` | Creation |
| `PieceVersion` | Creation |
| `Filing` | Creation |
| `DocumentExtraction` | `completed` status |
| `AuditLog` | Always |
| `DeadlineHistory` | Each row |

Corrections use **amendment records** that reference the original — never in-place updates to legal history rows. "I need to fix a wrong date" means inserting a corrective record with `amends_*_id`, not running `UPDATE`.

Reference: `data-model-v1.md §9.1`, `execution-engine.md §0`.

---

## 3. Explainability is a first-class output

Every engine conclusion, AI suggestion, and automated deadline must carry a structured **ExplanationBundle**:

- Which playbook version and rule IDs applied
- Which confirmed documents are the source
- Which fields had low confidence
- What data is missing and why it matters
- What alternate interpretations exist

An output without an ExplanationBundle is incomplete, not just unpolished.

Reference: `execution-engine.md §8`, `playbook-system.md §7.2`.

---

## 4. No silent mutations

No system action changes legal state without:

1. An `AuditLog` entry (who, what, when, before/after)
2. A `TimelineEvent` if the change affects an ExecutionCase narrative
3. A notification to the responsible lawyer if the change is material

Silent state changes are the most dangerous class of bug in this system. They make "what did the system believe on date X?" unanswerable.

Reference: `functional-architecture.md §6.1`, `data-model-v1.md §4.5`.

---

## 5. Auditability by default

Every write operation on a business entity produces an audit record. This is not opt-in. The AuditLog schema captures `actor_type`, `actor_id`, `action`, `entity_type`, `entity_id`, `occurred_at`, and `changes` (diff or snapshot).

Sensitive reads (CPF access, document export) are also logged.

Audit records are **immutable and never deleted**. No `DELETE FROM audit_logs` in any migration, script, or worker.

Reference: `data-model-v1.md §2.17`, `ARCHITECTURE_RULES.md`.

---

## 6. Temporal consistency

The system operates with **two clocks** that must never be conflated:

- **Calendar time** — prazos, audiências, SLAs (wall clock)
- **Sentence arithmetic** — dias de pena, remição, detração, frações (legal time)

Rules:

- All timestamps stored in UTC; displayed in org timezone
- Sentence arithmetic is stored as discrete confirmed snapshots, not derived live from mutable fields
- "Current state" is always the latest **confirmed** snapshot, not a computed value from changing fields
- Historical replay requires that the snapshot valid at time X be retrievable without rerunning computation

Reference: `execution-engine.md §1`, `data-model-v1.md §5`.

---

## 7. Confirmed facts only drive legal computation

The execution engine and opportunity evaluator consume **only**:

- Human-confirmed `SentenceSnapshot` records
- Human-confirmed `ExecutionCustodySnapshot` records
- `TimelineEvent` records with `source != ai_suggestion` OR explicitly promoted by a lawyer

Raw OCR output, `proposed` fields, and AI analysis outputs are **inputs to the review workflow**, not inputs to the legal engine.

An AI suggestion based on unconfirmed data must be labeled as such in its ExplanationBundle and must not create binding deadlines or qualify opportunities.

Reference: `execution-engine.md §0`, `data-model-v1.md §6.1`.

---

## 8. Versioned legal rules only

No legal fraction, lookback duration, decree eligibility condition, or interruption effect is hardcoded in application source code. All such parameters live in **PlaybookVersion** records.

This applies to:

- Progression fractions (even "obvious" ones like 1/6)
- Falta grave lookback periods
- Indulto eligibility conditions
- Remição credit ratios
- Prescription periods

If you find yourself writing `const PROGRESSION_FRACTION = 0.1667`, you are violating this principle. Write a playbook rule reference instead.

Reference: `playbook-system.md §9`, `ARCHITECTURE_RULES.md`.

---

## 9. LGPD-conscious engineering

Personal data (CPF, birth date, contact channels, body of visit notes, document binary content) is handled with:

- Encryption at rest for sensitive columns and blobs
- Logged access on sensitive reads
- Soft-delete with legal hold check before any erasure
- Minimal collection — do not persist WhatsApp content beyond case relevance
- Sub-processor data processing agreements for OCR/AI providers
- No CPF or sensitive fields in application logs, error messages, or query strings

Reference: `data-model-v1.md §8.5`, `functional-architecture.md §5.3`.

---

## 10. Operational calm over visual noise

The system is used under **professional pressure** by people managing liberty stakes. Engineering decisions that increase noise — excessive notifications, unfiltered AI output, unbounded list rendering, eager loading of non-actionable data — are design defects, not missing features.

Enforced by:

- Queue-first rendering: show counts + drill-down, not full lists by default
- Role-filtered notifications: assistants do not receive lawyer-only signals
- AI confidence gating: low-confidence suggestions do not push or notify
- Deduplicated notifications with `dedupe_key`

Reference: `office-operating-system.md §7`, `ux-flow-architecture.md §9–10`.

---

## 11. Scale for hundreds to thousands of executions

Design queries, indexes, and data flows for:

- 200–2,000 active ExecutionCases per organization
- 10k–200k Documents per organization
- 100k–1M TimelineEvents per organization
- 500–5,000 open Deadlines per organization

This means:

- No N+1 queries on dashboard or queue views
- Materialized or cached queue flags (`needs_extraction_review`, `has_overdue_deadline`)
- Blob storage for documents — not DB columns
- Partitioned or indexed timeline queries by `(organization_id, occurred_at)`
- Async OCR and engine evaluation — never block HTTP request/response on these

Reference: `data-model-v1.md §7`, `execution-workflows.md §8`.

---

## 12. Separation of concerns (layer discipline)

| Layer | Responsibility | Must not |
|-------|---------------|----------|
| **Frontend** | Display state, route queue actions, surface decisions | Contain business logic, compute legal arithmetic, access DB directly |
| **API layer** | Validate input, enforce permissions, orchestrate writes | Contain legal evaluation logic |
| **Execution engine** | Evaluate snapshots, produce candidates | Write confirmed data without human gate |
| **Playbook system** | Provide versioned parameters | Be embedded in code as constants |
| **Data layer** | Persist, enforce immutability, write audit | Compute opportunities or enforce legal rules |

Blurring these layers is the primary source of unauditability.

Reference: `ARCHITECTURE_RULES.md`.
