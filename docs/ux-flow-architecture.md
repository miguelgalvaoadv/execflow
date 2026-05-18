# EXECFLOW — UX Flow Architecture

**Version:** 0.2 (binding)
**Status:** Human interaction layer — **not** visual design, **not** component implementation, **not** CSS.
**Supersedes:** v0.1

**Grounded in:**
- `functional-architecture.md` — roles, objects, workflows, permissions, state machines
- `execution-workflows.md` — intake channels, piece pipeline, queue entry conditions
- `data-model-v1.md` — entity states driving UI chips, actions, immutability
- `execution-engine.md` — ExplanationBundle content, snapshot replay, confidence
- `office-operating-system.md` — queue catalog, daily workflow, notification rules
- `playbook-system.md` — branch conflict display, rule citation format
- `project-governance/PROJECT_CONTEXT.md` — queue-first model, human authority chain
- `project-governance/AI_BOUNDARIES.md` — AI permission model, mandatory human gates
- `project-governance/ENGINEERING_PRINCIPLES.md` — operational calm, explainability

**Purpose:** Define the operational interaction flows of EXECFLOW so that frontend implementation produces a system that is legally correct, auditable, and **usable at scale** by real criminal-execution practices managing hundreds of active cases under professional pressure.

---

## 0. Foundational axioms

These axioms are not design preferences — they are derived from the legal domain and the human authority model defined in `AI_BOUNDARIES.md` and `PROJECT_CONTEXT.md`.

| Axiom | Meaning |
|-------|---------|
| **Queue-first default** | Every session starts with "what needs doing", not "what exists". |
| **No hidden critical state** | Overdue deadlines and liberty risks are always visible at the top level without drilling. |
| **Lawyer time is the scarcest resource** | Minimize clicks to approve; maximize information density before the decision point. |
| **Assistants clear volume; lawyers clear judgment** | Flows route preparation to assistants, authority to lawyers — never conflate. |
| **AI is a suggestion layer, never a conclusion layer** | Confidence badges, source citations, and missing-data checklists always accompany AI outputs. |
| **Reversibility where possible** | Most actions have an undo path; irreversible actions (filing, confirmation) are clearly distinguished. |
| **Liberty is the highest priority** | Any UX decision that reduces visibility of liberty-risk states is a defect, not a design tradeoff. |
| **Explainability on demand, not by default** | Legal detail is always reachable but never the default display level. |

---

## 1. Core UX philosophy

### 1.1 Queue-first operation

The **default landing state** for every session is the user's queue view, filtered to their role and assignments. No user enters the system on a "home dashboard" displaying general statistics.

```
Session start
  → Role = lawyer   → Critical strip + Today agenda + Priority queues
  → Role = assistant → Intake + Extraction review + Tasks + Pending filings
  → Role = admin     → Org health summary + Overload signals + Config tasks
```

Queue-first means:
- The sidebar module links (Execuções, Clientes, Prazos, etc.) are **deep-work entry points**, not the primary work surface.
- A lawyer who needs to act on a case **arrives from a queue item**, not from browsing the case list.
- Counts on sidebar items reflect **actionable items**, not total records.
- "Nothing to do" is the ideal and desirable state — not a failure condition.

### 1.2 Operational calm

The system is used under professional pressure, with liberty consequences for errors. Visual noise, competing calls to action, and unprompted AI popups are operational defects:

- One primary action per context; secondary actions in overflow.
- **Red is reserved for liberty-risk and critical overdue states.** Everything else is neutral.
- Counts over lists by default — "7 overdue" surfaced before the list of 7.
- Completed items disappear cleanly; "queue clear" state is calm, not celebratory.
- No animations, transitions, or sounds that interrupt focus.

### 1.3 Low cognitive overload

Progressive disclosure governs every information layer:

| Layer | Shows |
|-------|-------|
| Queue item (collapsed) | Title, case ref, due/age, status chip, one-line summary |
| Queue item (expanded) | Full detail, actions, links, explanation access |
| Case header | Regime, status, overdue count, responsible lawyer |
| Case workspace | Active tab content only |
| Explanation bundle | Collapsed → summary → full detail |

Each layer answers the question at that level. Users drill only when they need to.

### 1.4 High-volume execution practice

The system is designed for offices managing 200–2,000 active cases. This means:

- No interface degrades when a queue has 300 items.
- Bulk-safe operations exist for all high-volume assistant tasks (see §5.7).
- Lawyer-gated actions are never bulk — single-case focus is enforced for liberty-affecting decisions.
- Queue item counts are real-time accurate; stale counts are a defect (maximum 30s drift).

### 1.5 Interruption management

Interruptions are tiered by legal consequence, not by notification volume:

| Tier | Examples | Delivery |
|------|----------|----------|
| Liberty-critical | PAD D-0, overdue progression, HC deadline | Persistent interrupt strip + push |
| High | D-1 deadline, piece review overdue threshold | Interrupt strip |
| Normal | New AI suggestion, document arrives | Passive notification count |
| Low | Task assigned, digest summary | Daily digest only |

Interrupts do not stack infinitely in the strip. Liberty-critical items are separated from high-priority items. Maximum visible interrupt strip depth: 3 items before collapse with count.

### 1.6 Urgency visibility

Critical states are always visible from the queue root without drilling:

- Overdue deadline badge on queue row
- Liberty-risk flag on case anywhere it appears
- Conflict banner on case header (non-dismissable until resolved)
- Escalation chip on any item that has been escalated

No critical state is buried inside a detail panel as the only place it appears.

### 1.7 Progressive disclosure

The system defaults to the minimum information needed for a decision at each interaction point. More is always reachable, never forced:

- ExplanationBundle collapsed until "Why?" is opened
- Historical snapshots hidden until "View history" is selected
- Dismissed/archived items excluded from default views
- Low-confidence AI suggestions collapsed below high/medium-confidence suggestions

### 1.8 Explainability surfaces

Every AI-produced output and every engine conclusion carries a structured ExplanationBundle (defined in `execution-engine.md §8`). The UX rule is:

- The **summary** is always visible (collapsed, 1–2 lines).
- The **full bundle** is available on demand via a single "Why?" control.
- A confidence badge is always co-located with the conclusion — never shown without a link to its explanation.
- An AI output without an accessible ExplanationBundle is **incomplete and must not be surfaced**.

---

## 2. User operational journeys

### 2.1 Lawyer — daily operational journey

```
[Session start]
  ↓
[1] CRITICAL STRIP review (~5 min)
    → Overdue deadlines → acknowledge + assign or self-handle
    → Liberty-risk items → open + triage
    → Pieces in review overdue threshold → open + decide

[2] TODAY AGENDA scan (~5 min)
    → Hearings, D-0/D-1 prazos → confirm coverage
    → PAD defenses due today → confirm piece is approved or in-flight

[3] QUALIFIED OPPORTUNITIES review (~15–30 min)
    → Open opportunity → read ExplanationBundle
    → Qualify (open pursuit) / Dismiss (enter reason) / Snooze
    → Qualify triggers template selection + preparer assignment

[4] RECALCULATION CONFLICTS (~5–15 min)
    → Open conflict → compare snapshots
    → Confirm authoritative or request new planilha

[5] PIECES IN REVIEW queue (~20–45 min)
    → Open piece → read body + context panel
    → Inline comments → approve or reject with note

[6] DEEP WORK (case-specific, triggered by complexity)
    → Enter case workspace for strategy review
    → Historical replay if needed
    → Note creation

[7] TEAM LOAD CHECK (lawyers with oversight)
    → Overload signals for team members
    → Reassign if needed
```

The lawyer should not need to touch any intake, extraction, or OCR review flow under normal operation. Those are assistant-owned.

### 2.2 Assistant — daily operational journey

```
[Session start]
  ↓
[1] INTAKE REVIEW queue
    → Open intake items → review extraction → confirm fields
    → Associate to client and case
    → Flag escalations (court orders, urgent keywords)

[2] EXTRACTION REVIEW queue
    → Field-by-field review with confidence badges
    → Correct low-confidence fields
    → Resolve conflicting OCR values
    → Accept or reject document

[3] MISSING DATA queue
    → Identify what is missing per case
    → Request document from client/family/other source
    → Log contact attempt in timeline
    → Update when received

[4] TASK queue (assigned by lawyers or system)
    → Piece preparation tasks → draft and submit for review
    → Research tasks → note + close
    → Scheduling tasks → calendar sync + timeline event

[5] PENDING FILINGS queue
    → Open approved pieces
    → Export PDF → record protocol → confirm filing

[6] AI REVIEW queue (low priority)
    → Review low-confidence suggestions from ingestion agent
    → Triage: promote to lawyer queue or dismiss with reason

[7] END OF DAY
    → Confirm no intake item older than SLA is in queue
    → Check missing-data queue age — escalate if stale
```

### 2.3 Reviewer (senior assistant or senior lawyer designated reviewer)

```
[Session start]
  ↓
[1] PIECES IN REVIEW queue
    → Open piece → review body for completeness and argument quality
    → Inline comments on issues
    → Forward to lawyer for final approval or return to preparer

[2] EXTRACTION REVIEW escalations
    → Complex OCR review items flagged by assistant
    → Conflicting values requiring legal judgment
    → Determine authoritative value

[3] CONFLICT QUEUE
    → Snapshot conflicts requiring legal analysis
    → Confirm which is authoritative or create planilha task
```

### 2.4 Admin — operational journey

```
[Session start]
  ↓
[1] ORG HEALTH summary
    → Unassigned cases (no responsible lawyer)
    → Overloaded users (queue depth > threshold)
    → Stale cases (no activity > SLA)
    → Failed ingestion jobs

[2] CONFIG TASKS
    → New user setup
    → Case reassignment (vacation coverage)
    → Playbook version review and publish approval
    → Template management

[3] AUDIT REVIEW (periodic)
    → Audit log export for compliance
    → Access log for sensitive data
    → Filing confirmation completeness check
```

### 2.5 Future AI-assisted operator (conceptual)

As AI agent confidence matures (see `AI_BOUNDARIES.md §trust-calibration`), a configured org may enable high-volume assistant workflows where AI pre-triages:

```
[AI-assisted intake]
  → Ingestion agent pre-fills all fields
  → High-confidence items pre-grouped for batch confirmation
  → Low-confidence items routed individually
  → Operator reviews batch confirmation surface:
      "12 items with all HIGH confidence. Confirm all?" [Y/N/Review individually]
  → Each confirmation still requires operator action (no implicit accept)
```

The operator role never gains filing authority. Batch confirmation applies only to extraction-field acceptance, not to legal conclusions or approvals.

---

## 3. Intake flows

### 3.1 Channels and entry points

| Channel | Entry mechanism | Initial state |
|---------|-----------------|---------------|
| PDF upload (web) | Drag-drop / file picker | `pending_association` |
| PDF upload (email integration) | Auto-import via monitored inbox | `pending_association` |
| Scanned document (mobile) | Camera capture → upload | `pending_association`, flag `scan_source` |
| WhatsApp-originated | Forwarded media / integration | `pending_association`, flag `whatsapp_source` |
| Tribunal export | Structured feed / CSV import | `pending_association`, pre-filled fields from structure |
| Manual registration | Form entry, no document | `no_document`, fields entered directly |

All channels create an intake bundle that enters `queue.intake_review`.

### 3.2 Manual intake flow

```
User opens intake form:
  [1] Client: [search existing / create new]
  [2] Case: [search existing / create new]
  [3] Document type: [enum selection]
  [4] Key fields: date, regime, sentence total (required per document type)
  [5] Notes (optional)
  → [Submit]
  → DocumentExtraction created with manually_entered=true
  → SentenceSnapshot proposed (if sentence data entered)
  → Engine run triggered (async)
```

Manual entry bypasses OCR but the confirmation gate remains — a manually entered SentenceSnapshot is still `proposed` until a lawyer confirms it.

### 3.3 PDF import flow

```
[1] File drop → document record created → blob stored → checksum captured
[2] OCR job triggered async
    → Status: extraction_pending
    → User sees: "Extracting..." on document card
[3] OCR completes → DocumentExtraction created with proposed_fields
    → Status: extraction_review
    → Item enters queue.extraction_review
[4] Assistant opens extraction review (see §3.5)
[5] Fields confirmed → document status: confirmed
    → Association workflow triggered (see §3.7)
```

### 3.4 Scanned document flow

Same as PDF import. Additional conditions:

- `scan_source=true` flag on DocumentExtraction
- Lower default OCR confidence threshold — scanner quality varies
- Page-by-page OCR quality visible per page in review UI
- Multi-page scans: each page shows confidence; user may accept pages individually
- Illegible pages: `rejected_page` flag; retain in record; manual note required

### 3.5 OCR review flow (extraction_review)

```
Assistant opens extraction review item:

[Left panel — file preview, scrollable, full-resolution]
[Right panel — extracted fields]

  Field row layout:
    Label | Extracted value | Confidence badge | [Confirm] [Edit] [Skip]
    ─────────────────────────────────────────────────────────────────────
    Nome do apenado  │ João da Silva         │ ███████ HIGH │ [✓] [✎] [-]
    CPF              │ 123.456.789-00        │ █████░░ MED  │ [✓] [✎] [-]
    Processo         │ [not found]           │ ░░░░░░░ NONE │ [-] [✎] [-]
    Data sentença    │ 2022-03-15            │ ██████░ MED  │ [✓] [✎] [-]
    Pena total       │ 8 anos 4 meses        │ ████░░░ LOW  │ [-] [✎] [-]
    Regime inicial   │ fechado               │ ███████ HIGH │ [✓] [✎] [-]

  [Confirm all HIGH] → confirms all HIGH-badge fields in one action
  [Review low confidence] → expands alternative values for LOW fields
  [Enter manually] → free-form input, marks field as manually_confirmed

  Conflict surface (two values for same field from different pages):
    Data sentença
      Page 2: 2022-03-15  ████████ HIGH  [Use this]
      Page 7: 2022-03-25  █████░░░ MED   [Use this]
    [Enter different value]
    → User must pick or enter; no auto-resolution
```

Low-confidence fields cannot be submitted as confirmed without explicit action. "Confirm all HIGH" does not touch LOW or NONE fields.

### 3.6 WhatsApp-originated material

WhatsApp documents arrive with distinct handling requirements:

- Content is flagged `source=whatsapp` permanently
- File integrity: WhatsApp compression may degrade document quality; OCR quality flag shown
- Message content (text accompanying media) stored as `intake_note`, not as legal data
- No client personal data from WhatsApp message text is auto-extracted without assistant review
- LGPD consideration: message thread content is not retained beyond the case-associated document

### 3.7 Incomplete intake bundles

An intake bundle is incomplete when any required field for the document type is unconfirmed after extraction review:

```
Assistant completes extraction review with gaps →
  → System surfaces: "3 required fields missing for case association"
  → Options:
      [Associate anyway — flag missing_data] → case association proceeds;
          item enters queue.missing_data with field list
      [Defer — wait for missing document] → document stays in extraction_review;
          task created: "Obtain missing fields from client/source"
      [Reject document] → document marked rejected_doc; retain file; note required
```

A case can exist with `missing_data` queue items indefinitely. The execution engine will block opportunity families that depend on the missing fields but will compute what it can from confirmed data.

### 3.8 Missing-data recovery flow

```
queue.missing_data item opened:

  Case: João da Silva — Case 001
  Missing fields:
    [!] CPF — required for client deduplication
    [!] Pena total — blocks all progression calculations
    [ ] Regime inicial — blocks engine; assumed fechado pending confirmation

  Recovery actions:
    → [Request document from client] — spawns contact task, logs attempt
    → [Request from tribunal] — spawns task with tribunal contact info
    → [Enter manually from reference] — opens manual entry modal; requires source note
    → [Mark as permanently unavailable] — requires lawyer confirmation; marks field `unavailable`

  When field recovered:
    → Field confirmed → engine re-evaluates → opportunities surface if newly qualifying
    → missing_data item exits queue automatically
```

`Mark as permanently unavailable` on a critical field (pena total, data sentença) requires explicit lawyer confirmation and stores the reason. It does not delete the field — it flags it so the engine can compute best-effort with documented uncertainty.

---

## 4. Execution case workspace behavior

### 4.1 Primary workspace structure

```
┌─────────────────────────────────────────────────────────────────────┐
│ Case header bar                                                      │
│  Client name | Regime atual | Case status badge | Responsible lawyer │
│  [CONFLICT banner if active] [MISSING DATA banner if critical]       │
├──────────────────┬──────────────────────────────────────────────────┤
│ Left nav tabs    │ Active content area (center)                     │
│                  │                              ┌───────────────────┤
│  Timeline ←      │  [Tab content]               │ Action panel      │
│  Prazos          │                              │ (right, collapsible)│
│  Oportunidades   │                              │ Snapshot summary  │
│  Peças           │                              │ Quick tasks       │
│  Documentos      │                              │ Recent notes      │
│  Notas           │                              │ Responsible / SLA │
└──────────────────┴──────────────────────────────┴───────────────────┘
```

This structure is conceptual — not a CSS specification.

### 4.2 Contextual panels

The right action panel is context-sensitive:

| Active tab | Right panel shows |
|------------|-----------------|
| Timeline | Snapshot summary card + recalculation button |
| Prazos | Deadline completion evidence uploader |
| Oportunidades | Quick qualification / dismiss actions |
| Peças | Piece status + assign preparer button |
| Documentos | Document class filter + upload button |
| Notas | Quick note compose |

Panel collapses on mobile/tablet to maximize content area. Core actions are mirrored into the content area when panel is collapsed.

### 4.3 Timeline behavior

Timeline is the **authoritative case narrative** (`data-model-v1.md §4.3`).

| Interaction | Behavior |
|-------------|----------|
| Default view | Reverse-chronological, last 30 events |
| Scroll | Loads earlier events on scroll |
| Filter by type | Court / Custody / Office / AI / All |
| Filter by date range | Date picker; URL-persistent |
| Click event | Expand inline: payload, source doc link, author, timestamp |
| Amend event | Opens append form; new event references `amends_event_id`; both stay visible |
| Add note | Quick-compose `office.note` inline at timeline top |
| Source document | Click → document viewer sidebar; does not leave timeline |

Timeline enforces **append-only** — no edit or delete icons appear on past events. Amendment creates a new record, never overwrites.

### 4.4 Active risks surface

At the top of every case view, active risks persist until resolved:

| Risk type | Condition | Dismissable? |
|-----------|-----------|:------------:|
| CONFLICT | Open ConflictRecord | No — lawyer resolves |
| OVERDUE | Past-due deadline | No — complete or dismiss |
| LIBERTY_RISK | Excess execution, HC candidate | No — lawyer qualifies |
| MISSING_DATA (critical) | Field blocking engine on liberty-affecting opportunity | No — recover or mark unavailable |
| PENDING_COURT | Open judicial decision | No — auto-clears on outcome |

Non-critical states (LOW_OCR on non-blocking field, INTERPRETATION_BRANCH) appear as informational banners, dismissable with reason.

### 4.5 Pending reviews surface

Within the case workspace, pending reviews are visible in context:

- Pieces in `in_review` status are listed in the Peças tab with elapsed time since submission
- Documents in `extraction_review` appear in Documentos tab with "Review needed" badge
- Opportunities in `suggested` status appear in Oportunidades tab under "Pending qualification"
- Tasks assigned to the viewing user are surfaced in the action panel

No "pending reviews" requires navigating away from the case to find the relevant queue item — the case workspace links directly.

### 4.6 Opportunity visibility

In the Oportunidades tab:

```
Qualified opportunities (status=pursuing, realized)
  → sorted by urgency (window closing soonest)
  → each shows: type, window dates, assigned piece (if any)

Open opportunities (status=suggested, qualified)
  → grouped by confidence: HIGH, MEDIUM, LOW
  → LOW group collapsed by default
  → each shows: type, confidence badge, "Why?" link, window dates

Dismissed opportunities
  → collapsed under "Show dismissed" toggle
  → each shows: type, dismissal reason, dismissal date

Missing-data-blocked opportunities
  → listed with: which fields are missing, link to missing_data queue
```

### 4.7 Deadline visibility

In the Prazos tab:

```
Critical overdue (D-OVERDUE)
  → Full red badge, sorted first
  → Completion evidence required

Approaching (D-0, D-1)
  → Amber badge, sorted by date
  → Completion or dismissal actions

Upcoming (D-2 through D-30)
  → Default state, sorted by date

Completed / dismissed
  → Collapsed under "Show history"

Auto-generated deadlines
  → Label: "From rule [rule_id] — PlaybookVersion v2.1"

Manual deadlines
  → Label: "Manual — created by [user]"
```

### 4.8 Office notes behavior

Office notes (`VisitNote`, `TimelineEvent.type=office.note`) are:

- Always attributed to author
- Timestamped and immutable after creation
- Linked to the case timeline (visible there and in Notas tab)
- Searchable by keyword
- Never used as engine input — purely human record

Composing a note: inline compose box at top of Notas tab or from timeline. Submission creates an immutable `TimelineEvent`. No editing of submitted notes — if correction needed, append a new note referencing the original.

### 4.9 AI suggestions behavior in case workspace

AI suggestions in the case workspace follow `AI_BOUNDARIES.md` strictly:

- Appear in the relevant tab (Oportunidades, Prazos) under a clearly labeled "AI Suggested" section
- Always show confidence badge co-located with the suggestion
- Never auto-expand without user interaction
- Never appear as a banner or popup that interrupts the current view
- Each suggestion links to its ExplanationBundle via a "Why?" control
- Accepting a suggestion is an explicit action — it is never implied by navigating away

### 4.10 Audit visibility

From case workspace → "Audit" tab (visible to lawyers and admins):

- Full status transition log for all entities in the case
- AI involvement flags on each item
- ExplanationBundle access for historical engine runs
- Filing records with checksum proof
- Exportable as a structured PDF for malpractice or judicial review

---

## 5. Queue interaction model

### 5.1 Entering a queue

Items enter queues **automatically** based on entity state transitions. There is no "add to queue" UI action. Queues are derived views of entity state (`ARCHITECTURE_RULES.md §S-02`).

Entry conditions per queue are defined in `office-operating-system.md §2`. Examples:

| Queue | Entry condition |
|-------|----------------|
| `intake_review` | Document uploaded with `status=pending_association` |
| `extraction_review` | Document with `status=extraction_review` |
| `missing_data` | Case with one or more required fields unconfirmed > SLA |
| `overdue_deadlines` | Deadline with `due_date < today AND status=open` |
| `progression_opportunities` | Opportunity with `type=progression AND status=suggested` |
| `pending_filings` | PieceDraft with `status=approved AND filing=null` |
| `recalculation_conflicts` | Case with open ConflictRecord |
| `urgent_liberty_risks` | Opportunity with `family=liberty_risk AND status=suggested` |

### 5.2 Leaving a queue

Items exit queues automatically when their entity state changes to a non-qualifying state:

- `extraction_review` item exits when `document.status = confirmed OR rejected_doc`
- `overdue_deadlines` item exits when `deadline.status = completed OR dismissed`
- `pending_filings` item exits when `filing.status = filed`

Items never need to be "manually removed" from queues. Removing them from their state removes them from the queue.

### 5.3 Claiming work

Items are either **pool-owned** (any eligible role may claim) or **assigned** (to a specific user).

```
Pool-owned item:
  → User opens item
  → System marks item as "being reviewed by [user]" (soft lock, ~30 min)
  → Other users see "In review by [user]" and cannot claim simultaneously
  → If user closes without completing: soft lock releases after timeout
  → If user completes: item exits queue

Assigned item:
  → Only assigned user sees item in their default queue view
  → Other users with the role can see it under "All items" view
  → Lawyer may override assignment from any item detail
```

The soft-lock prevents two assistants from working the same extraction review simultaneously.

### 5.4 Escalation

Escalation is triggered when:

- Item age exceeds SLA for its queue class
- Item is manually escalated by current owner (with note)
- Liberty-risk condition detected on an unacknowledged item

Escalation behavior:

```
Item enters escalation state:
  → Escalation chip appears on item row
  → Notification sent to escalation target (role or specific user)
  → Escalation log entry (who, when, reason)
  → Item remains in original owner's queue
  → Admin sees item in org-health summary
```

Escalation does not transfer ownership automatically — it alerts. Transfer is a separate explicit action.

### 5.5 Reassignment

Any queue item can be reassigned by:

- The current assignee (I can't do this)
- The responsible lawyer for the case
- An admin

Reassignment requires:
- Target user selection
- Optional reason note
- TimelineEvent written on the related case

Bulk reassignment (e.g., vacation coverage) is an admin operation: select user → select date range → transfer all open items to backup user. This action creates an audit record per item, not one aggregate record.

### 5.6 Blocked states

Items enter `blocked` state when a dependency prevents completion:

| Cause | Behavior |
|-------|----------|
| Missing data field blocking engine | Item shows "Blocked: [field list]" chip |
| Pending court decision | Item shows "Pending court: [event reference]" |
| Conflict unresolved | Item shows "Blocked: conflict on snapshot" |
| External review pending | Item shows "Waiting for [role/user]" |

Blocked items are visible in their queue but deprioritized below unblocked items. They do not trigger SLA escalation timers while blocked — unless the block itself is overdue.

### 5.7 Stale states

Stale detection runs as a background job:

| Queue | Stale threshold | Action |
|-------|-----------------|--------|
| `intake_review` | 48h in queue | Escalate to senior assistant |
| `extraction_review` | 72h in queue | Escalate to senior assistant |
| `missing_data` | 7 days without update | Escalate to responsible lawyer |
| `overdue_deadlines` | 0h (all overdue items are already stale by definition) | Escalate immediately |
| `pending_filings` | 48h after approval | Escalate to assistant manager |
| `recalculation_conflicts` | 72h | Escalate to responsible lawyer |

Stale items receive an "Aged [N] days" badge. The badge is not dismissable.

### 5.8 Overload behavior

When a user's queue depth exceeds the configured overload threshold:

- Admin org-health panel shows user as `overloaded`
- Responsible lawyer is notified (passive, not interrupt)
- New item assignments to that user are soft-blocked with a warning
- Admin can force reassign or let the lawyer override the block

The system does not auto-redirect incoming work. Human judgment governs reallocation.

### 5.9 Multi-user coordination

When two users are working in the same case simultaneously:

- Case header shows "X also viewing" indicator (real-time presence, future feature)
- Same-item conflict prevention: soft-lock on active queue items (§5.3)
- Piece editing: only one user may have a `PieceVersion` in `editing` state; others see read-only
- Notes and timeline events: both users may write simultaneously; no lock needed (append-only)
- Conflict resolution: only the responsible lawyer may confirm authoritative snapshot; others may view

---

## 6. AI collaboration UX

### 6.1 Suggestion surfaces

AI suggestions surface in exactly three places — they are never unsolicited popups:

1. **Queue items** — AI-suggested opportunities and deadlines enter the relevant queue with `source=ai` label. They look identical to human-generated items except for the source badge. They must still be qualified or accepted by a human before any legal effect.

2. **Case workspace tabs** — Within Oportunidades and Prazos tabs, AI suggestions appear in a labeled section below confirmed/qualified items. They are collapsed by default when the list is long.

3. **Extraction review** — During OCR review, AI-proposed field values are displayed in the review panel with confidence badges. They are not pre-confirmed; each field requires user action.

AI suggestions **do not appear** as:
- Floating tooltips
- Auto-expanding banners
- Pop-overs on unrelated views
- Pre-filled confirmed fields

### 6.2 Confidence indicators

Every AI output displays a confidence level co-located with the output:

| Badge | Meaning | Visual |
|-------|---------|--------|
| HIGH | All critical fields confirmed; no blocking conditions | Solid badge |
| MEDIUM | Minor gaps; non-critical field uncertain | Partial badge |
| LOW | Critical field uncertain or disputed | Warning badge |
| BLOCKED | Missing critical data; computation not possible | Error badge |

Composite confidence: if any critical-path field is LOW, the output's aggregate confidence is LOW regardless of other fields. This composition rule is enforced by the engine and reflected in the badge.

Confidence badge is **never shown without a "Why?" link**. The link opens the ExplanationBundle. A badge without an explanation is a rendering defect.

### 6.3 Uncertainty communication

When the engine or AI agent cannot produce a high-confidence output:

```
Opportunity card with uncertainty:
  ─────────────────────────────────────────────
  Progressão de Regime — MEDIUM CONFIDENCE
  Window: June 2025 – estimated  ⚠
  ─────────────────────────────────────────────
  ⚠ Uncertainty indicators:
    • LOW_OCR: Pena total extracted with medium confidence (page 4)
    • PENDING_COURT: Habeas corpus petition pending — may affect base date
    • INTERPRETATION_BRANCH: Two active interpretations produce different dates
      → Conservative branch: June 2025
      → Progressive branch: March 2025

  [Why?] [Qualify anyway (waiver required)] [Dismiss] [Snooze]
```

Qualifying an item with active uncertainty indicators requires a waiver — a deliberate checkbox: "I understand this qualification is based on uncertain data." The waiver is stored in the audit log.

### 6.4 Mandatory review checkpoints

These checkpoints are enforced by the system — they cannot be bypassed by UI design, pre-checking, or batch operation:

| Checkpoint | What is reviewed | Who reviews | What blocks proceeding |
|------------|-----------------|-------------|----------------------|
| OCR field confirmation | Each proposed field | Assistant or Lawyer | Unconfirmed required fields |
| Opportunity qualification | Legal window + ExplanationBundle | **Lawyer** | Not yet qualified |
| Snapshot confirmation | Arithmetic + source documents | **Lawyer** | Not yet confirmed |
| Piece approval | Full body + case context | **Lawyer** | Not yet approved |
| Filing confirmation | Approved piece + protocol data | Assistant | Piece not approved |
| Conflict resolution | Both conflicting snapshots | **Lawyer** | Conflict unresolved |

A UI that makes any of these look like a single checkbox in a bulk form is a design defect.

### 6.5 Approval UX

Approval is a **deliberate, singular action** — never implied or passive:

```
Lawyer on piece review:
  → Reads body (system records scroll depth, but does not gate on it)
  → Adds inline comments if needed
  → Explicitly clicks [Approve this piece]
  → Confirmation: "Approve version v2 — João da Silva — HC Petition?" [Confirm] [Cancel]
  → On confirm: version locked, status=approved, assistant notified, TimelineEvent written

There is no "approve by closing the panel".
There is no "bulk approve all reviewed pieces".
Each approval is case-specific, version-specific.
```

### 6.6 Rejected suggestions

When a lawyer dismisses an AI suggestion:

- Dismissal reason is required (enum: wrong_facts / not_applicable / already_handled / strategic_choice / error)
- Dismissal is recorded with `dismissed_by`, `dismissed_at`, `reason`
- Dismissed item is hidden from default view; visible under "Show dismissed"
- Same suggestion type will not recur for this case until a material state change triggers re-evaluation
- Feedback signal available to AI trust calibration model (non-binding on next suggestion)

Dismissal with reason `error` is flagged in the AI review queue for investigation — this should not be silent.

### 6.7 Explainability access

ExplanationBundle is always accessible from:

1. The "Why?" control on any AI-generated item
2. The qualification modal (shown before lawyer confirms an opportunity)
3. The piece approval panel (AI-generated piece shows AI involvement disclosure)
4. The audit tab (for all historical engine runs)

Bundle sections displayed progressively:

```
[Summary] — always visible
  "System suggests João may be eligible for progressão to semi-aberto
   from June 2025, based on 1/6 fraction applied to confirmed total sentence."

[Why?] expanded:
  Rules applied: PROG-001 (1/6 fraction), PROG-003 (general offenses)
  Playbook: v2.1 — published 2025-01-01
  Calculation:
    Total sentence: 8 years = 2,920 days (confirmed)
    1/6 fraction: 486 days
    Date of arrest (detração): 2022-03-12 (confirmed)
    Eligibility: 2022-03-12 + 486 = 2023-07-11 → past
    Window opens: already open as of today
  Sources:
    → Sentença 2022-03-15 [Document #143]
    → Certidão de prisão 2022-03-12 [Document #144]
  Missing data: none for this calculation
  Uncertainty: none
```

If missing data or uncertainty is present, those sections are prominently displayed before the calculation.

### 6.8 Provenance visibility

Every AI-generated or engine-generated item carries provenance metadata accessible from the item:

- `playbook_version_id` — which version of legal rules applied
- `engine_run_id` — traceable to the specific computation
- `model_id` (for AI agent outputs) — which model produced the draft or extraction
- `created_at` of the analysis — relevant if law changed since
- `confirmed_inputs[]` — list of confirmed entity IDs that fed the computation
- `unconfirmed_inputs[]` — list of proposed or unconfirmed fields that also influenced output (warning)

This provenance is stored permanently in `AIAnalysis` and `EngineRun` records and cannot be deleted.

---

## 7. Critical operational states

### 7.1 Overdue deadlines

A deadline transitions to `overdue` when `due_date < today AND status=open`.

UX behavior:

- Immediately enters `queue.overdue_deadlines`
- Appears in the interrupt strip for the responsible lawyer
- Case header shows overdue badge (non-dismissable)
- Escalation timer starts: 4 hours before backup lawyer is notified
- The deadline card inside the case shows elapsed overdue time in amber/red

Completion of an overdue deadline:
```
  → Assistant clicks [Complete deadline]
  → Evidence required: document upload or "Link to timeline event"
  → Completion date recorded (may differ from due_date)
  → Filing confirmation option if completion involved a petition
  → TimelineEvent: deadline.completed written
  → Overdue badge clears from case header
```

Dismissal of an overdue deadline:
- Only a `lawyer` may dismiss
- Reason code required (legal_basis, case_closed, corrected_date, error)
- AuditLog written
- If liberty-class deadline: double confirmation required

### 7.2 Liberty-risk alerts

Liberty-risk states include:

- Excess execution (pena cumprida não cumprida — `opportunity.type=excess_execution`)
- HC candidate with window closing soon
- Missed liberty-class deadline
- Regime already exceeding legal maximum stay

UX behavior:

- Liberty-risk badge on case — permanent until resolved, visible from search results, client list, and all case views
- Enters `queue.urgent_liberty_risks` — highest queue priority
- Interrupt strip item with `⚡ LIBERTY RISK` label
- Escalation: 4-hour acknowledgment window → backup + admin notified
- Case cannot be marked `archived` or `inactive` while liberty-risk is open

Resolution:
- Requires lawyer explicit acknowledgment with resolution action (qualify + pursue, or dismiss with legal basis)
- Dismissal requires a written legal justification (free text, required length minimum)
- AuditLog record with dismissing lawyer ID + reason

### 7.3 Missing legal data

When a required field is absent and blocks engine calculation:

- `queue.missing_data` entry created with field list and severity
- Case header shows `MISSING DATA` banner if any field is critical-class
- Opportunity families that require the missing field are marked `BLOCKED`
- Blocked opportunities are still visible in the Oportunidades tab with clear explanation

The missing-data state does not prevent other work on the case. Non-blocked opportunities, piece drafting, visit notes, and timeline events continue normally.

### 7.4 Conflicting calculations

A `ConflictRecord` is created when two confirmed `SentenceSnapshot` records for the same case produce materially different arithmetic results.

UX behavior:

- `CONFLICT` banner on case header — non-dismissable until resolved
- Case enters `queue.recalculation_conflicts`
- All opportunities derived from the conflicting snapshots are marked `CONFLICT` and blocked from qualification
- The conflict does not block non-arithmetic work (piece drafting, visit notes, document review)

Conflict resolution flow:
```
Lawyer opens conflict panel:
  → Side-by-side comparison of two snapshots
  → Source document links on each side
  → [Confirm A as authoritative] [Confirm B as authoritative] [Request new planilha]

[Confirm A/B]:
  → Conflicting snapshot marked superseded
  → New authoritative SentenceSnapshot created with `confirmed_by`
  → ConflictRecord resolved
  → Engine re-evaluates all blocked opportunities
  → Case header banner clears

[Request new planilha]:
  → Task created for assistant: "Prepare updated sentencing calculation"
  → ConflictRecord remains open until new snapshot confirmed
```

### 7.5 Recalculation events

When a recalculation is triggered (new document confirms different pena total, new falta grave resets data-base, etc.):

- Engine run produces new `SentenceSnapshot.status=proposed`
- Proposed snapshot enters lawyer review before it replaces anything
- If proposed snapshot conflicts with confirmed snapshot → ConflictRecord created
- Opportunities derived from old snapshot are suspended pending recalculation resolution
- TimelineEvent: `recalculation.triggered` written with trigger reason

The user sees:
```
On case header: [RECALCULATION PENDING]
  → "New arithmetic proposed — review required"
  → [Review proposed snapshot] → opens comparison with current confirmed
  → [Confirm new snapshot] (lawyer) → supersedes old; engine re-evaluates
  → [Reject new snapshot] (lawyer) → proposed snapshot dismissed; reason required
```

### 7.6 Pending filings

Cases with pieces in `approved` status but no `Filing` record after 48 hours:

- Enter `queue.pending_filings` for assistant
- Case shows "Piece awaiting filing" badge
- Responsible lawyer receives passive notification (not interrupt)
- After 72 hours with no filing: escalates to lawyer and admin

Filing is always confirmed by assistant (export + protocol record). The system does not auto-file anything.

### 7.7 Prison transfer events

When a prison transfer `TimelineEvent` is recorded:

- `ExecutionCustodySnapshot` with new prison unit proposed
- Lawyer review required to confirm new regime context
- Existing deadline calendar reviewed: some deadlines may shift based on new unit's schedule
- Any regime-based opportunity recalculates against new unit context
- Notification to responsible lawyer: "Transfer recorded — review required"

The transfer itself does not trigger automatic recalculations. It triggers a **proposed** update that waits for confirmation.

### 7.8 Disciplinary incidents (falta grave / PAD)

When a disciplinary incident `TimelineEvent` is recorded:

- Engine evaluates falta grave impact on current progression calculation (interrupts data-base, affects benefit timeline)
- Proposed new `SentenceSnapshot` with reset data-base (if applicable) enters lawyer review
- PAD defense window deadline is created automatically if incident is `PAD-class`
- PAD defense enters `queue.pad_defense` with SLA countdown

```
Case header shows:
  [!] DISCIPLINARY INCIDENT — PAD defense window: 10 days remaining
  → [View PAD queue item]
```

The system does not determine guilt or legal outcome of the PAD — it manages the procedural defense window.

---

## 8. Piece drafting flow

### 8.1 Draft lifecycle

```
[no_piece]
    ↓ (lawyer qualifies opportunity → selects type + template)
[draft]
    ↓ (assistant writes + submits)
[in_review]
    ↓ (lawyer approves) OR ← (lawyer rejects → back to draft with comments)
[approved]
    ↓ (assistant exports + files)
[filed]
```

Transitions are state-machine enforced. No skipping from `draft` to `filed`.

### 8.2 Review lifecycle

```
[in_review] entered when:
  → Preparer clicks [Submit for review]
  → Notification sent to responsible lawyer

Lawyer receives item in queue.pieces_in_review:
  → Opens piece detail
  → Reads body (center panel) + case context (right panel)
  → May add inline comments at any point
  → Decision required: [Approve] or [Reject with note]

[Approve]:
  → PieceVersion locked (immutable)
  → status → approved
  → AuditLog + TimelineEvent written
  → Assistant notified: "Piece approved — ready to file"

[Reject]:
  → Rejection comment required (minimum 20 characters)
  → status → draft
  → Preparer notified with comment
  → New PieceVersion created on next edit
  → Version count increments
```

### 8.3 Filing confirmation

```
Assistant opens approved piece from pending_filings queue:
  → Reads final body (read-only)
  → Exports PDF: system generates final PDF, captures SHA-256 checksum
  → Filing metadata form:
      Filed at:      [datetime picker — required]
      Protocol #:    [text — optional; note if not yet issued]
      Channel:       [electronic / physical / in-person — required]
      Confirm doc:   [file upload — optional, e.g. receipt scan]
  → [Confirm filing] — single clear statement: "This records a court submission. Cannot be undone."
  → [Confirm]
  → Filing record created
  → PieceDraft.status = filed
  → TimelineEvent: petition.filed written
  → Linked Opportunity/Deadline completion workflow triggered
```

No second confirmation dialog beyond the one stated above. The "cannot be undone" text is sufficient.

### 8.4 Template usage

Template selection occurs at piece creation:

- Templates filtered by `piece_category` and `opportunity_type`
- Template description shows: purpose, typical length, required confirmable fields
- Template body pre-fills with confirmed case facts; empty fields marked `[REQUIRED: field_name]`
- Using a template creates an initial `PieceVersion` body; preparer edits from there

Template content itself is an admin-managed resource — outside the scope of this UX document but subject to the same versioning rules as playbooks.

### 8.5 AI-generated drafts

When AI drafting is enabled and a lawyer selects it during piece creation:

```
→ AI drafting agent receives: template structure + confirmed case facts + relevant documents
→ Generates draft body
→ PieceVersion.body populated
→ Status remains [draft] — AI draft is not pre-approved
→ Piece shows "AI-assisted draft" badge permanently, even after human editing
→ AI involvement ratio stored: `ai_generated_ratio` (for audit transparency)
```

Preparer reviews, edits, and submits as normal. Lawyer approval is unchanged — AI assistance does not reduce the review requirement.

### 8.6 Version comparisons

From piece detail → "Version history":

```
Version list: v1 (Draft, 2026-05-01), v2 (Revised, 2026-05-03), v3 (Approved, 2026-05-05)
  → Click any two versions → side-by-side diff
  → Added text: highlighted green
  → Removed text: highlighted red (strikethrough)
  → Metadata: author, timestamp, reviewer comments on that version
  → [Restore as new draft] — creates v4 from selected version's body; does not overwrite
```

Version history is read-only by default. Restore creates a new draft cycle — no silent rollbacks.

### 8.7 Argument reuse

Approved argument blocks (firm-standard paragraphs) are available during drafting:

```
In piece editor → [Insert argument block]
  → Browse by category: jurisprudência / fundamentação / pedido / preâmbulo
  → Search by keyword
  → Preview block content
  → Insert at cursor position

Argument blocks are org-managed, admin-published resources.
Each block carries: version, last updated, applicable piece types.
Inserting a block does not lock it — preparer may edit after insertion.
```

### 8.8 Approval authority

Only users with `role=lawyer` may approve a piece. This is enforced by the API, not just the UI.

The `[Approve]` button is rendered only for lawyers. Assistants never see an approve action on a piece. This is not a visual preference — it is a hard permission boundary defined in `functional-architecture.md §5` and `ARCHITECTURE_RULES.md §A-01`.

---

## 9. Notification UX philosophy

### 9.1 Interruptive vs passive alerts

| Category | Delivery method | Examples |
|----------|----------------|---------|
| Liberty-critical interrupt | Interrupt strip + push | PAD D-0, overdue liberty-class deadline, excess execution detected |
| High-priority interrupt | Interrupt strip | D-1 deadline, piece review > threshold, unresolved conflict > 72h |
| Passive — actionable | Notification count badge | New AI suggestion, document arrived, task assigned |
| Passive — informational | Daily digest | Piece approved, deadline completed by another user, snapshot confirmed |

No sound, vibration, or animation for passive notifications.
No push notifications for AI suggestions of any confidence level.

### 9.2 Digest behavior

Daily digest (morning, time configurable per user, default 08:00 org timezone):

```
EXECFLOW — Morning brief — Segunda, 18 mai 2026

CRÍTICO (2)
  → PAD: Case ABC — 1 dia restante
  → Excesso de execução: Case XYZ — sem reconhecimento há 6 horas

HOJE (4)
  → Audiência 14h — Cliente João (Case 001)
  → Peça in_review — HC — Case 003 — 2 dias sem resposta
  → Prazo D-0 — Agravo — Case 007
  → Oportunidade aberta: Progressão — Case 012

ESTA SEMANA (7 itens)
  → [lista resumida — cada item é link direto]
```

Each line is a **direct link** to the relevant item. Digest excludes items the user already acknowledged or snoozed.

### 9.3 Escalation ladders

| Priority | Acknowledgment window | First escalation | Second escalation |
|----------|-----------------------|-----------------|-------------------|
| Liberty-critical | 4 hours | Backup lawyer | Admin + all org lawyers |
| Critical deadline | 8 hours | Admin | Partner / senior lawyer |
| High | 24 hours | Admin | — |
| Normal | No escalation | — | — |

Escalation sends a digest-format message (not a full interrupt) to escalation targets. Targets see an "Escalated item" chip on the item when they receive it.

### 9.4 Notification fatigue prevention

Enforced rules:

- Maximum 3 items in interrupt strip simultaneously; beyond 3 collapses with count badge
- Deduplicated by `dedupe_key` — same item does not notify twice within 24 hours
- Passive notifications for the same case are batched: "3 new events on Case ABC" not 3 separate alerts
- AI suggestion sets are delivered as one "N new suggestions" notification, not N individual alerts
- Snooze clears an item from interrupt strip — it will not resurface until snooze expires

### 9.5 Quiet-hour behavior

Configurable per user:

- Quiet hours: default 22:00–07:00 org timezone
- During quiet hours: passive notifications are queued for digest; no interrupt strip updates
- Exception: liberty-critical items override quiet hours with push notification
- Emergency override: admin can manually broadcast a system-wide interrupt for genuine emergencies

Quiet hours apply to delivery, not to queue state — the item is still waiting in the queue, just not notifying.

### 9.6 Legal-critical override logic

Liberty-critical items cannot be silenced by quiet hours, snooze, or notification settings. They will always:

- Appear in the interrupt strip when the app is open
- Send a push notification (if push is enabled) regardless of quiet hours
- Appear in the digest even if the user has disabled digest
- Persist in the interrupt strip until acknowledged

This override cannot be disabled by users, only by resolving the underlying item.

---

## 10. Mobile and field usage

### 10.1 Prison visit usage

During prison visits, lawyers and assistants need to:

- Record visit notes in real time
- Check active opportunities and pending items for the case
- Log timeline events (lawyer visit, client statement confirmation)
- Access the case snapshot summary (regime, dates, prazos)
- View documents (read-only)

Mobile visit mode (defined behavior, not implementation):

- Quick-access to recent cases from home screen
- Visit note compose: minimal form — date, duration, attendees, notes
- Offline composition: note queued locally; submitted when connectivity restored
- No approval, filing, or qualification actions from visit mode — those require desktop confirmation

### 10.2 Courthouse usage

During hearings and court attendances:

- Access case summary and snapshot
- Log real-time court events (court movement, despacho, decision)
- Start a timeline event with `source=courthouse`
- Upload photos of documents received in court (feeds into intake queue)
- Check related deadlines created by today's hearing

Quick court-event logging:

```
[+] Court event
  Type: [despacho / decisão / audiência / juntada / outro]
  Date: [auto-filled: today]
  Summary: [text]
  Document: [camera capture — optional]
  → [Submit]
  → TimelineEvent created; if document: enters intake queue
```

### 10.3 Quick capture mode

For fast mobile input without entering full case context:

- Process number or client CPF lookup → direct to case
- Camera: capture document → auto-queues for intake (source=mobile_capture)
- Voice memo: transcribed and saved as draft visit note (requires manual review before submission)
- Emergency flag: one-tap "Flag this case as liberty risk" → enters liberty_risks queue immediately

Quick capture mode is optimized for 30-second interactions — full case management stays on desktop.

### 10.4 Offline tolerance assumptions

The system assumes mobile connectivity is unreliable during field use:

- Visit notes composed offline are queued locally and submitted on reconnect
- Case data (snapshot, recent timeline, open deadlines) cached locally at case open
- No legal confirmation, approval, or filing actions are permitted offline
- When reconnecting, the system confirms whether offline actions created any conflicts

Offline data is clearly labeled "Pending sync" until confirmed submitted.

### 10.5 Mobile-first emergency actions

For genuine urgency on mobile, the following actions must be available in no more than 3 taps:

1. Acknowledge a liberty-risk interrupt
2. Flag a case for emergency escalation
3. Log an urgent court event
4. Upload a document photo to intake

All other actions (qualification, approval, conflict resolution) remain desktop-priority.

---

## 11. Forbidden UX patterns

These must not appear in EXECFLOW regardless of implementation pressure, design trend, or user request:

| Forbidden pattern | Why it is prohibited |
|-------------------|---------------------|
| **Dashboard vanity metrics** | "Total cases: 847" and "Total documents: 12,439" are not operational. They create false productivity signal and waste lawyer attention. |
| **Noisy legal dashboards** | Showing everything that exists (all cases, all deadlines, all AI suggestions) at once is not a dashboard — it is a dump. The dashboard is a queue surface. |
| **Hidden AI decisions** | Any AI influence on a displayed item must be visible. No "AI pre-filtered" lists where the user doesn't know AI removed items from their view. |
| **Irreversible destructive actions without single clear disclosure** | One confirmation, clearly worded. Not a buried checkbox or a triple-confirm dialog. |
| **Silent recalculations** | No arithmetic change occurs without a proposed snapshot entering lawyer review. No "background update" to legal state. |
| **Unexplained confidence** | A confidence badge without a "Why?" link is forbidden. The badge must always provide an access path to its ExplanationBundle. |
| **Cognitive overload layouts** | More than one primary action per context. Competing call-to-action buttons. Multiple interrupt banners stacked without priority order. |
| **Fake productivity signals** | "You've reviewed 12 items today!" congratulations. Gamification of legal work. Streak counters on case management. |
| **Implicit AI acceptance** | Scrolling past an AI suggestion, closing a panel, or viewing an item does not confirm it. Confirmation is always an explicit action. |
| **Modal spam** | Confirmation modals for non-destructive actions. Information modals that could be tooltips. Stacked modals. |
| **Infinite dashboard scrolling** | The queue surface is paginated and action-gated. It is not a social feed. |
| **Noisy AI popups** | AI suggestions never pop up unsolicited. They surface in queues or labeled sections. |
| **Pre-checked "confirm all" for critical fields** | Batch confirmation is safe only for HIGH-confidence, non-liberty-affecting extractions. Critical fields require individual review. |
| **Forcing lawyers through assistant workflows** | A lawyer can always reach and complete any action directly without following an assistant preparation path. |
| **Hidden critical state** | Overdue deadlines and liberty risks never live only inside sub-panels. They are always visible at the top of the relevant view. |
| **Stale badge counts** | Queue badge counts must reflect real state with maximum 30-second drift. Displaying counts from a stale cache is a defect. |
| **Role-leaked actions** | Assistants never see approve buttons. Lawyers never see technical admin controls. Role filtering is API-enforced and UI-reflected. |
| **Bulk-approve on liberty-affecting items** | Opportunities, piece approvals, snapshot confirmations, and conflict resolutions are always single-case actions. No "Approve all". |
| **Empty states without guidance** | Every empty state tells the user exactly what to do or why the state is empty. "No deadlines" shows whether it's because none exist or because they're all complete. |

---

## 12. Future extensibility

### 12.1 Multi-office environments

EXECFLOW will eventually support organizations with multiple offices (branches):

UX assumptions:
- Cases are org-scoped, but users may have visibility across offices within the org (configurable)
- Queues remain office-filtered by default; cross-office views require explicit scope switch
- Notification routing respects office assignment — a Recife lawyer does not receive São Paulo office escalations unless configured
- The navigation model (queue-first, case workspace) does not change — only the scope filter changes

What must not break in this transition:
- Existing role model and permission chain
- Queue-first design — cross-office does not mean "everything in one giant queue"
- Human authority model — approval authority stays with the assigned responsible lawyer, not any lawyer in the org

### 12.2 External collaborators

Future: correspondent lawyers, tribunal-appointed advisors, client-facing limited access.

UX assumptions:
- External collaborators have a constrained role with no access to internal queues, notes, or AI outputs
- They see only: the documents and pieces shared explicitly with them
- A "shared" state on documents and pieces controls external visibility
- No AI-generated content is visible to external roles without explicit sharing by an internal lawyer
- External comments on shared pieces are isolated from internal review workflow

The internal UI gains a "Share with external" action on documents and pieces — not an automatic transparency mode.

### 12.3 Tribunal integrations

Future: direct import from tribunal APIs (e.g., eProc, PJe, SEEU).

UX assumptions:
- Tribunal-imported documents and events enter the same intake queue — they are not auto-confirmed
- Auto-import must show `source=tribunal_api` and `source_run_id` on every item
- Tribunal-triggered deadlines enter `queue.overdue_deadlines` or `queue.pending_review` at `source=tribunal` — still require lawyer acknowledgment
- Tribunal-imported data never bypasses the human review checkpoint in the extraction review
- The "tribunal says X" vs "office calculated Y" conflict model maps to the existing ConflictRecord architecture

### 12.4 AI agents (expanded automation)

As AI agent capabilities grow:

- New agent types enter the system as additional `agent.*` role actors — they do not acquire existing human roles
- Agent outputs always route to named queues — no new ambient AI display surfaces
- Each new agent type requires its own explicit permission definition in `AI_BOUNDARIES.md` before UX surfaces can be built
- Trust calibration for new agent types begins at "all through assistant triage" — per `AI_BOUNDARIES.md §trust-calibration`
- The interrupt and queue model does not change — agents feed queues, humans drain queues

### 12.5 Automation expansion

Future automation (recurring review triggers, automated SLA enforcement, batch decree processing):

UX assumptions:
- Every automated action must appear in the AuditLog and in the relevant case timeline
- No automation creates confirmed legal state — only `proposed` or `suggested` states
- Automation that affects a case the lawyer has open creates a visible notification: "System updated this case while you were viewing it"
- All automated actions are reversible by a human via the existing queue and review workflow

"The system did this automatically" is never invisible. Every automated action has a traceable, human-readable audit entry.

### 12.6 Future analytics layers

Analytics will eventually be available (Phase 9 per `IMPLEMENTATION_ORDER.md`). When built:

- Analytics is a **separate navigation mode** — not embedded in operational queues
- Operational views never gain embedded charts or metrics that compete with the queue surface
- Analytics data is derived from confirmed state only — not from proposed or AI-suggested data
- No "AI-generated insight" appears in the operational dashboard without an explicit "Analytics" navigation intent

Analytics surfaces answer questions like "how are we performing as an office?" — not "what should I do right now?" The latter is the queue's job.

---

## 13. Cross-reference matrix

| Document | UX dependency |
|----------|---------------|
| `functional-architecture.md` | Roles, permissions, state machines, object definitions |
| `execution-workflows.md` | Intake channels, piece pipeline, queue entry conditions |
| `office-operating-system.md` | Queue catalog, daily workflow, notification rules, bulk operations |
| `execution-engine.md` | ExplanationBundle content, snapshot replay, confidence model |
| `data-model-v1.md` | Entity states driving UI chips and actions, immutability rules |
| `playbook-system.md` | Branch conflict display, rule citation format, versioning |
| `project-governance/AI_BOUNDARIES.md` | AI permission model, confidence gating, mandatory human gates |
| `project-governance/ARCHITECTURE_RULES.md` | Forbidden patterns, state machine enforcement, role leakage |
| `project-governance/ENGINEERING_PRINCIPLES.md` | Operational calm, append-only history, explainability |

---

## 14. Document control

| Version | Date | Notes |
|---------|------|-------|
| 0.1 | 2026-05-17 | Initial UX flow architecture (10 sections) |
| 0.2 | 2026-05-17 | Expanded: user journeys, AI collaboration UX, critical states, mobile/field usage, future extensibility; grounded in governance corpus |

**Next step:** Module-level UX flow specs (Execuções, Clientes, Prazos, Oportunidades, Peças) — **after backend schema (Phase 1) and queue engine (Phase 6) are operational**, not before. Reference `IMPLEMENTATION_ORDER.md`.
