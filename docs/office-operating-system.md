# EXECFLOW — Office Operating System

**Version:** 0.1 (conceptual)  
**Status:** Human operational layer — how a criminal-execution practice **works inside EXECFLOW at scale**.  
**Not in scope:** Legal arithmetic, playbook fractions, or opportunity legal tests (see [`execution-engine.md`](./execution-engine.md)).

**Companions:** [`functional-architecture.md`](./functional-architecture.md), [`execution-workflows.md`](./execution-workflows.md), [`data-model-v1.md`](./data-model-v1.md).

**Purpose:** Prevent building a system that is legally sophisticated but **operationally unusable** — define queues, roles, review, bulk work, risk, notifications, and dashboard philosophy for offices managing **hundreds of active executions**.

---

## 0. Operating principles

| Principle | Meaning |
|-----------|---------|
| **Queue-first** | Work enters named queues; the dashboard surfaces **what to do next**, not everything that exists. |
| **Lawyer time is scarce** | Lawyers review and decide; assistants prepare and triage. |
| **No silent risk** | Missed deadlines and liberty risks escalate loudly; low-value noise stays passive. |
| **One owner per item** | Every queue item has an assignee or role pool; no orphaned work. |
| **Throughput with gates** | High volume via bulk **safe** actions; liberty-affecting steps stay single-case and lawyer-gated. |
| **AI is staff, not partner** | AI prepares; humans authorize anything that leaves the office or affects strategy. |

### Layering

```
┌──────────────────────────────────────────────┐
│  Office Operating System (this document)      │  ← human workflows, queues, review
├──────────────────────────────────────────────┤
│  Execution Engine (execution-engine.md)     │  ← legal-temporal intelligence
├──────────────────────────────────────────────┤
│  Data + workflows (data-model, workflows)     │  ← persistence & domain events
└──────────────────────────────────────────────┘
```

---

## 1. Daily operational workflow

A modeled workday for a mid-size office (~300–800 active executions, 3–15 lawyers, 5–25 assistants).

### 1.1 Morning — lawyers (responsible / managing)

| Step | What they see first | Action |
|------|---------------------|--------|
| 1 | **Critical strip** — overdue legal deadlines, liberty-risk flags, pieces `in_review` | Triage in &lt; 5 min |
| 2 | **Today agenda** — hearings, court-ordered prazos D-0/D-1, PAD defenses due | Confirm assignees or self-handle |
| 3 | **Qualified opportunities** awaiting strategy (progression, excess, HC) | Qualify / dismiss / assign pursuit |
| 4 | **Recalculation conflicts** | Resolve or delegate planilha work |
| 5 | **Team load** (optional) — overload signals for direct reports | Reassign or defer non-critical |

**Lawyers do not start with:** full client list, all suggested AI opportunities, or document inbox unless they choose deep work mode.

### 1.2 Morning — assistants

| Step | What they see first | Action |
|------|---------------------|--------|
| 1 | **Intake & extraction review** queues | Associate docs, confirm OCR fields |
| 2 | **Missing data** queue | Request docs, update client/case fields |
| 3 | **Tasks assigned overnight** (system + lawyer) | Complete triage, prep pieces |
| 4 | **Pending filings prep** — pieces `approved` awaiting protocol | Export, file, mark filed with evidence |
| 5 | **AI review** (low priority) — suggested items with checklist | Triage to lawyer queue or dismiss with reason |

### 1.3 Midday — work movement

| Pattern | Flow |
|---------|------|
| **Document arrives** (WhatsApp/PDF) | → intake review → extraction review → association → engine runs (async) → opportunities/deadlines appear in lawyer queues |
| **Lawyer qualifies opportunity** | → assistant receives task + piece template → draft → submit review |
| **Court movement confirmed** | → timeline event → deadline candidates → assistant accepts/dismisses extracted prazos |
| **Visit completed** | → visit note published → optional tasks spawned |

### 1.4 Afternoon — review block

Lawyers reserve time for **review queues**: pieces `in_review`, batch indulto qualification, conflict resolutions. Assistants focus on **deadline completion evidence** and **filing confirmation**.

### 1.5 End of day — office hygiene

| Role | Activity |
|------|----------|
| Assistant lead | Zero intake older than SLA in `intake_review`; escalate stuck extraction |
| Lawyer on duty | Clear critical/overdue or document deferral with reason |
| System | Digest notification for non-critical items; snapshot queue metrics |

### 1.6 How priorities escalate

```
Priority 0 (interrupt): liberty risk, overdue critical legal deadline
Priority 1 (today):     D-0/D-1 legal, piece in_review, PAD defense due
Priority 2 (week):      qualified opportunities, extraction backlog
Priority 3 (background): AI suggested, case health reviews, low confidence
```

Escalation is **time-based + severity-based** (§6, §7) — not manual “star” flags alone.

### 1.7 How deadlines surface

| Surface | Audience | Content |
|---------|----------|---------|
| **Agenda processual** | All | Calendar view: hearings + legal `due_at` |
| **Overdue deadlines queue** | Lawyer + assignee | Past due, not completed |
| **Week horizon** | Lawyer | D-7 legal high/critical |
| **Assistant task link** | Assistant | Task mirroring deadline with checklist |

Deadlines never disappear from lawyer view when overdue until `completed` or lawyer `dismissed` with reason.

### 1.8 How review happens

See §4 — summary: assistant prepares → lawyer approves → assistant files with confirmation → timeline + audit.

---

## 2. Queue architecture

Queues are **views over work items** (documents, deadlines, opportunities, pieces, conflicts, AI analyses) — not separate databases per queue. Each item has `queue_membership[]` computed from rules below.

### 2.1 Queue catalog

#### Intake review (`queue.intake_review`)

| Aspect | Definition |
|--------|------------|
| **Purpose** | New files not yet linked to client/execution |
| **Entry** | Document `status=pending_association` OR IntakeBundle `association_state=unassigned` |
| **Exit** | Client/case association confirmed OR `rejected_doc` |
| **Owner** | Assistant pool (round-robin or shift) |
| **SLA** | 24h business hours from `uploaded_at` |
| **Escalation** | 48h → notify assistant lead; 72h → responsible lawyer if client known |

#### Extraction review (`queue.extraction_review`)

| Aspect | Definition |
|--------|------------|
| **Purpose** | OCR/parse awaiting human confirmation |
| **Entry** | Document `status=extraction_review` |
| **Exit** | Metadata `confirmed` OR failed → manual entry path |
| **Owner** | Assistant who uploaded OR pool |
| **SLA** | 48h from extraction complete |
| **Escalation** | Blocks opportunity engine for affected case until exit |

#### Missing data (`queue.missing_data`)

| Aspect | Definition |
|--------|------------|
| **Purpose** | Engine or workflow flagged required fields absent |
| **Entry** | `EngineWarning` severity `critical`/`recommended` OR case `process_number_pending` past SLA |
| **Exit** | Fields confirmed OR lawyer waiver with reason |
| **Owner** | Assistant on case; lawyer if waiver |
| **SLA** | 7 days recommended; critical blocks progression queue |
| **Escalation** | 14 days → lawyer dashboard flag `stale_data` |

#### Progression opportunities (`queue.progression_opportunities`)

| Aspect | Definition |
|--------|------------|
| **Purpose** | Progression (and related regime) suggestions needing lawyer strategy |
| **Entry** | Opportunity `type=progression`, `status=suggested`, confidence ≥ medium |
| **Exit** | `qualified` \| `dismissed` \| superseded by new snapshot |
| **Owner** | Responsible lawyer |
| **SLA** | Lawyer review within 5 business days of high-confidence suggest |
| **Escalation** | 10 days → managing lawyer notification |

#### PAD defense (`queue.pad_defense`)

| Aspect | Definition |
|--------|------------|
| **Purpose** | Disciplinary matters with open defense windows |
| **Entry** | Timeline `disciplinary.opened` + linked deadline `deadline_class=disciplinary` open |
| **Exit** | Defense filed + deadline completed OR sanction finalized + opportunity dismissed |
| **Owner** | Responsible lawyer (defense); assistant prepares |
| **SLA** | Per deadline `due_at` — critical |
| **Escalation** | D-1 automatic critical notification |

#### Overdue deadlines (`queue.overdue_deadlines`)

| Aspect | Definition |
|--------|------------|
| **Purpose** | All overdue obligations |
| **Entry** | Deadline `status=overdue` |
| **Exit** | `completed` with evidence OR lawyer `dismissed` |
| **Owner** | Assignee + responsible lawyer (dual visibility) |
| **SLA** | Clear within 1 business day of overdue (office policy) |
| **Escalation** | +3 days → admin/managing partner optional; repeat daily for critical |

#### Pending filings (`queue.pending_filings`)

| Aspect | Definition |
|--------|------------|
| **Purpose** | Approved pieces not yet marked filed |
| **Entry** | Piece `status=approved`, no Filing record |
| **Exit** | Filing created + `petition.filed` event |
| **Owner** | Assistant |
| **SLA** | 48h from approval (configurable) |
| **Escalation** | 72h → lawyer reminder |

#### Recalculation conflicts (`queue.recalculation_conflicts`)

| Aspect | Definition |
|--------|------------|
| **Purpose** | Conflicting snapshots or planilhas |
| **Entry** | `ConflictRecord` open OR dual snapshot mismatch flag |
| **Exit** | Lawyer confirms winning snapshot + conflict resolved |
| **Owner** | Responsible lawyer |
| **SLA** | 3 business days |
| **Escalation** | Blocks progression/excess auto-suggest until exit |

#### AI review (`queue.ai_review`)

| Aspect | Definition |
|--------|------------|
| **Purpose** | AI outputs needing triage before lawyer sees |
| **Entry** | AIAnalysis completed + `triage_required=true` (low confidence or high volume) |
| **Exit** | Promoted to lawyer queue OR dismissed with reason OR merged into confirmed data |
| **Owner** | Assistant |
| **SLA** | 72h — non-blocking unless liberty-related |
| **Escalation** | Liberty-tagged → skip assistant triage, go direct to lawyer |

#### Urgent liberty risks (`queue.urgent_liberty_risks`)

| Aspect | Definition |
|--------|------------|
| **Purpose** | Situations where wrong inaction may affect liberty |
| **Entry** | Composite: `excess_execution` high confidence, escape active, critical PAD, overdue progression court order, HC window, `BLK_*` override with risk tag |
| **Owner** | Responsible lawyer immediately |
| **SLA** | Same day acknowledgment |
| **Escalation** | Unacknowledged 4h → backup lawyer + admin |

### 2.2 Queue interaction rules

| Rule | Detail |
|------|--------|
| **One primary queue per item** | Item may appear in secondary “watch” lists but one owner queue |
| **Snooze** | Lawyer may snooze non-critical items 24–72h with reason; never snooze liberty queue |
| **Defer** | Assign future `review_after` date — item hidden until then |
| **Done ≠ delete** | Exiting queue updates entity state; history retained |

### 2.3 Queue metrics (office health)

| Metric | Target (indicative) |
|--------|---------------------|
| Intake &gt; 48h | &lt; 5% of weekly intake |
| Overdue legal deadlines | 0 critical overnight |
| Pieces approved not filed &gt; 72h | &lt; 10 items |
| Suggested opportunities unreviewed &gt; 14d | &lt; 20% of open suggests |

---

## 3. Ownership and assignment

### 3.1 Responsible lawyer

| Aspect | Rule |
|--------|------|
| **Scope** | Accountable for strategy, approvals, overdue dismissals, conflict resolution |
| **Cardinality** | One per Client and per ExecutionCase (may be same person) |
| **Visibility** | Sees all queues filtered to their cases + team if managing partner |
| **Cannot delegate** | Approve piece, qualify opportunity, dismiss critical overdue — must be lawyer role |

### 3.2 Assistant ownership

| Aspect | Rule |
|--------|------|
| **Scope** | Prepare, triage, file, confirm extraction, complete tasks |
| **Assignment** | Per-task `assignee_user_id` OR per-queue shift |
| **Case affinity** | Optional “preferred assistant” on ExecutionCase for continuity |
| **Limits** | Cannot approve pieces or qualify opportunities |

### 3.3 Queue ownership

| Queue type | Default owner |
|------------|---------------|
| Intake, extraction, AI triage, pending filings | Assistant pool |
| Progression, conflicts, liberty, overdue (legal) | Responsible lawyer |
| PAD defense | Lawyer + assistant preparer |
| Missing data | Assistant, lawyer on waiver |

**Pool model:** Organization defines `WorkPool` (logical) — members rotate daily; unassigned items auto-assign round-robin.

### 3.4 Reassignment

| Trigger | Who may reassign | Audit |
|---------|----------------|-------|
| Lawyer leave | Admin or managing lawyer | Required reason |
| Load balancing | Managing lawyer | Notification to both lawyers |
| Assistant unavailable | Assistant lead | Task-level only |
| Client request | Responsible lawyer | Logged |

**Never:** silent reassignment of responsible lawyer without AuditLog.

### 3.5 Vacation / coverage

| Mechanism | Behavior |
|-----------|----------|
| **Covering lawyer** | `covering_lawyer_user_id` + `cover_from` / `cover_to` on ExecutionCase |
| **Inbox routing** | Notifications and queues duplicate to covering lawyer |
| **Approval authority** | Covering lawyer may approve if explicitly granted |
| **Post-vacation** | Covering period ends; queues revert; handoff note required if items open |

### 3.6 Collaboration patterns

| Pattern | Use |
|---------|-----|
| **Preparer / reviewer** | Assistant drafts, lawyer reviews (pieces, planilhas) |
| **Comment threads** | On piece versions and opportunities (internal) |
| **@mention** (future) | Pull lawyer into specific item |
| **Shared timeline** | All see events; internal vs legal visibility |
| **Case conference** | `office.note` with checklist — not a queue |

---

## 4. Review system

Operational mirror of functional-architecture §3.6–3.7 and execution-workflows §6.

### 4.1 States and roles

| Stage | Actor | System state |
|-------|-------|--------------|
| **Prepare** | Assistant | Piece `draft`, opportunity research, document confirm |
| **Submit for review** | Assistant | Piece → `in_review`; notify lawyer |
| **Review** | Lawyer | Read version, comments, explanation bundle |
| **Approve** | Lawyer | Piece → `approved`; version locked |
| **Reject / revision** | Lawyer | Piece → `draft` + review_comment on version |
| **File** | Assistant | Create Filing after `approved` |
| **Confirm filing** | Assistant + lawyer optional | Piece → `filed`; timeline `petition.filed` |

### 4.2 Rejection flows

| Lawyer action | Assistant sees |
|---------------|----------------|
| Return for revision | Comments + highlighted sections |
| Withdraw piece | `withdrawn` — new piece if needed |
| Reassign preparer | New assignee on task |

**SLA:** Assistant resubmits within office policy (e.g. 48h) or lawyer reassigns.

### 4.3 Revision requests (non-piece)

| Object | Flow |
|--------|------|
| Extraction | Lawyer flags fields → assistant re-OCR or manual correct |
| Snapshot | Lawyer requests new calculation → assistant gathers docs |
| Opportunity | Lawyer dismisses with reason → closes loop |

### 4.4 Auditability

Every transition logs:

- Actor, timestamp, from/to state
- For approve/file: version ids, checksums
- For dismiss overdue: reason code (enum + free text)

Review history exportable per ExecutionCase for malpractice defense.

---

## 5. Bulk operations

Designed for **hundreds of executions** and repetitive review (indulto decrees, extraction batches, reassignment).

### 5.1 Safe bulk operations

| Operation | Max batch | Preconditions | Audit |
|-----------|-----------|---------------|-------|
| Assign responsible lawyer | 50 | Same org; lawyer active | Per-case log |
| Assign assistant task | 100 | — | Per-task |
| Accept extraction field pattern | 30 | Same `document_class` + same field keys | Per-document |
| Associate documents to case | 20 | Same proposed client confidence high | Per-document confirm |
| Qualify opportunity (indulto/comutação) | 200 | Same `decree_id` + playbook version; **lawyer batch owner** | Batch id + per-case |
| Dismiss opportunities (low confidence) | 50 | Reason code required | Per-case |
| Tag documents | 100 | Non-destructive labels | Per-document |
| Snooze non-critical warnings | 50 | Not liberty queue | Per-item |
| Mark internal tasks done | 100 | Task type internal only | Per-task |

**Batch owner:** One lawyer initiates bulk qualify; system records `batch_operation_id` for rollback audit (logical undo = new corrective actions, not delete).

### 5.2 Forbidden bulk actions

| Operation | Why forbidden |
|-----------|---------------|
| Approve pieces | Liberty/strategy — single case |
| Mark filed | Protocol evidence per case |
| Confirm SentenceSnapshot | Arithmetic too sensitive |
| Qualify progression / excess / HC | High risk |
| Dismiss overdue legal deadlines | Lawyer accountability |
| Delete clients or documents | Legal hold |
| Auto-associate low-confidence docs to cases | Wrong-case risk |

### 5.3 Risk controls

| Control | Mechanism |
|---------|-----------|
| **Preview pane** | Show sample 5 cases + impact summary before commit |
| **Threshold halt** | Batch &gt; N requires admin co-sign |
| **Dry run** | Count affected items without write |
| **Rollback audit** | List all case ids in batch for manual reversal |
| **No AI bulk approve** | AI cannot initiate bulk qualify |

---

## 6. Operational risk management

### 6.1 Missed deadline prevention

| Layer | Mechanism |
|-------|-----------|
| **Horizon alerts** | D-7, D-3, D-1, D-0 |
| **Overdue queue** | Persistent until resolved |
| **Critical class** | Cannot snooze |
| **Weekly lawyer report** | Digest of next 14 days legal deadlines |
| **Assistant mirror tasks** | Every critical legal deadline spawns linked task |

### 6.2 Stale case detection

| Signal | Definition |
|--------|------------|
| **No confirmed snapshot** | &gt; 180 days (configurable) |
| **No timeline event** | &gt; 90 days active case |
| **No lawyer touch** | No audit activity &gt; 60 days |
| **Process number pending** | &gt; 30 days |

→ `queue.missing_data` + lawyer `case_health` review task.

### 6.3 Inactive case alerts

Cases `suspended` or client unreachable — monthly review task; do not auto-close.

### 6.4 Lawyer overload signals

| Indicator | Threshold (indicative) |
|-----------|------------------------|
| Open critical items | &gt; 25 per lawyer |
| Overdue count | &gt; 5 |
| In_review pieces | &gt; 10 |
| Suggested opportunities unreviewed | &gt; 40 |

→ Notify managing partner; **no auto-reassign** without human decision.

### 6.5 Unresolved conflict escalation

`ConflictRecord` open &gt; 3 days → daily reminder; &gt; 7 days → managing partner + block case `closed`.

### 6.6 Critical liberty-risk escalation

Items in `queue.urgent_liberty_risks`:

- Acknowledge button (lawyer) stops 4h escalation timer
- Unacknowledged → backup lawyer notification
- Never bundled into daily digest only — must push real-time channel

---

## 7. Notification philosophy

### 7.1 What deserves interruption (real-time)

| Event | Channel |
|-------|---------|
| Liberty risk queue entry | Push + in-app |
| Critical deadline D-0 / overdue | Push + in-app |
| Piece submitted for review (to responsible lawyer) | In-app; push if &gt; 4h unopened |
| PAD defense D-1 | Push |
| Escape / recapture events | Push to responsible lawyer |

### 7.2 What should stay passive

| Event | Channel |
|-------|---------|
| Low-confidence AI suggestion | In-app queue only |
| New suggested opportunity (medium) | Digest + badge count |
| Internal task assigned | In-app |
| Document intake for unrelated pool | Pool queue only |
| Case health review due | Digest |

### 7.3 Anti-fatigue rules

| Rule | Detail |
|------|--------|
| **Dedupe** | Same `dedupe_key` within 24h suppresses repeat |
| **Bundle** | Multiple D-7 deadlines → one digest entry per lawyer |
| **Quiet hours** | Org config 20:00–08:00 — critical only |
| **Role filter** | Assistants do not receive lawyer-only progression pushes |
| **Confidence gate** | No push for AI `confidence=low` |

### 7.4 Escalation timing

See execution-workflows §4.5 + §2.1 per queue — escalation **adds recipients**, does not change owner silently.

### 7.5 Digest behavior

| Digest | Frequency | Content |
|--------|-----------|---------|
| **Lawyer morning** | Weekdays 07:00 | Today agenda, overdue, in_review count, top 5 progression suggests |
| **Assistant morning** | Weekdays 07:30 | Intake backlog, extraction backlog, assigned tasks |
| **Managing weekly** | Monday | Office metrics, overload signals, stale cases |

Digests are **opt-in configurable** but on by default; never include full client lists.

---

## 8. Productivity model

### 8.1 What “good operational flow” means

| Indicator | Good flow |
|-----------|-----------|
| Intake → associated | &lt; 24h median |
| Extraction → confirmed | &lt; 48h median |
| Suggest → qualified (high-value opp) | &lt; 7 days median |
| Approve → filed | &lt; 48h median |
| Critical overdue overnight | Zero |
| Lawyer morning triage | &lt; 15 minutes to clear interrupt layer |

### 8.2 Throughput expectations (office size bands)

| Active executions | Assistants | Suggested weekly throughput |
|-------------------|------------|----------------------------|
| 100–300 | 3–8 | 40–80 intake docs, 15–30 filings |
| 300–800 | 8–20 | 80–200 intake docs, 30–70 filings |
| 800–2000 | 20+ | Requires pool specialization by queue |

Throughput is **office-dependent** — system provides metrics, not quotas.

### 8.3 Low-friction principles

| Principle | Implementation concept |
|-----------|------------------------|
| **Default the next action** | Queue item opens to guided checklist |
| **One-click confirm** | High-confidence extraction fields batch-confirm |
| **Remember case context** | Last visited case pinned for assistant |
| **Template-first pieces** | Pre-filled from confirmed snapshot only |
| **Keyboard / bulk where safe** | §5.1 operations |
| **No empty states without action** | Placeholder tells what to do next |

### 8.4 Cognitive load reduction

| Technique | Detail |
|-----------|--------|
| **Suppress noise** | Dashboard never shows all 500 suggests |
| **Group by case** | Queue items cluster under ExecutionCase in drill-down |
| **Consistent severity colors** | Critical / high / normal — semantic only in spec |
| **Explain once** | ExplanationBundle collapsed by default |
| **WIP limits** | Optional per-user “max open reviews” warning |

### 8.5 AI assists without overwhelm

| Mode | Behavior |
|------|----------|
| **Triage layer** | Assistant filters AI before lawyer |
| **Confidence routing** | High → lawyer queue; low → AI review or hide |
| **Checklist not essay** | AI outputs bullets + missing docs, not long prose default |
| **No auto-tasks spam** | Max N AI-spawned tasks per case per day |

---

## 9. Human / AI collaboration model

Aligned with execution-engine §6–§8 and functional-architecture §8.

### 9.1 How AI suggestions appear

| Surface | Content |
|---------|---------|
| **Case panel** | Opportunities `suggested` + explanation collapsed |
| **Document review** | Proposed fields highlighted |
| **AI review queue** | Assistant triage list |
| **Timeline** | `ai.recommendation` events — distinct styling conceptually |

**Never:** modal popups for each suggestion; never auto-open piece drafts.

### 9.2 How lawyers validate

| Action | Effect |
|--------|--------|
| **Qualify** | Opportunity → `qualified`; enables pursuit |
| **Dismiss** | Requires reason enum |
| **Confirm snapshot** | Promotes arithmetic to authoritative |
| **Approve piece** | Accepts legal text responsibility |
| **Resolve conflict** | Picks authoritative snapshot |

Validation is **explicit click** with audit — no “implied accept by viewing.”

### 9.3 How assistants triage

| Step | Action |
|------|--------|
| 1 | Review AI review queue daily |
| 2 | Promote well-cited, high-confidence items to lawyer |
| 3 | Fix missing data where AI listed gaps |
| 4 | Dismiss spam with `dismissed_by_assistant` reason (lawyer can override) |

Assistants **cannot** qualify liberty-affecting opportunities.

### 9.4 How uncertainty is surfaced

| UI concept (spec only) | Meaning |
|------------------------|---------|
| **Confidence badge** | high / medium / low |
| **Missing data checklist** | Blocks qualify button until waived |
| **Conflict banner** | Links two snapshots |
| **Do not compute** | Engine blocked state explained |

### 9.5 How trust is earned over time

| Phase | System behavior |
|-------|-----------------|
| **Onboarding** | All AI routes through assistant triage |
| **Proven accuracy** | Org may enable high-confidence progression directly to lawyer queue |
| **Regression** | Playbook or model change resets triage requirement |
| **Feedback loop** | Lawyer dismiss reasons train “do not suggest” patterns (future analytics) |

Trust is **org-configured**, never global default to full automation.

---

## 10. Dashboard philosophy

### 10.1 What the dashboard is FOR

The dashboard is the **command center for the next actions**, not a report of the entire practice.

| Primary jobs |
|--------------|
| Answer: “What will burn today?” |
| Answer: “What is stuck?” |
| Answer: “Where is my team overloaded?” |
| Route humans into **queues** with context |

Maps to current workspace concepts:

| Panel (conceptual) | Operational job |
|--------------------|-----------------|
| **Fila operacional** | Priority-ordered work items across queues |
| **Agenda processual** | Time-based legal events |
| **Documentos em curso** | Pieces + docs in flight |
| **Espaço de trabalho** | Deep work on selected case |
| **Notas operacionais** | Internal coordination |

### 10.2 What should NEVER appear on the dashboard

| Excluded | Why |
|----------|-----|
| Full client registry browse | Use Clientes module |
| All raw AI suggestions unfiltered | Queue triage first |
| Historical timeline dumps | Case detail view |
| Financial ledgers | Financeiro module |
| Every open task in firm | Filter to role + ownership |
| Marketing / onboarding content | Noise |
| Legal advice text walls | Explanation on drill-down only |

### 10.3 Operational focus

**Morning default view:** interrupt layer + today agenda + top 10 fila items for role.

**No infinite scroll of cases** — paginated queues with counts.

### 10.4 Calmness vs noise

| Calm | Noise |
|------|-------|
| Counts with drill-down | Flashing badges everywhere |
| Neutral dark surfaces (existing UI direction) | Multi-color priority rainbow |
| One critical strip | Ten red banners |
| Digest for medium priority | Push per medium item |

### 10.5 Queue-first design philosophy

```
User opens EXECFLOW
  → sees queue counts (role-filtered)
  → clicks queue
  → works items in priority order
  → item exit updates entity + may spawn next queue
  → dashboard counts refresh
```

**Case-first navigation** is secondary path for research and visits — not the default Monday morning entry.

### 10.6 Role-based dashboard defaults

| Role | Default landing focus |
|------|----------------------|
| Lawyer | Critical strip + overdue + in_review + qualified opportunities |
| Assistant | Intake + extraction + my tasks + pending filings |
| Admin | Office metrics + overload + SLA breaches (optional module) |

---

## 11. Cross-reference matrix

| Topic | Authoritative doc |
|-------|-------------------|
| Legal opportunity tests | `execution-engine.md` |
| Intake channels & piece pipeline | `execution-workflows.md` |
| Permissions & roles | `functional-architecture.md` |
| Entity storage & queues as filters | `data-model-v1.md` |
| **Daily work, queues, review, notifications** | **this document** |

**Conflict resolution:** If operational flow conflicts with legal engine outputs (e.g. bulk qualify progression), **legal-engine and functional-architecture prohibit** — this doc cannot override.

---

## 12. Document control

| Version | Date | Notes |
|---------|------|-------|
| 0.1 | 2026-05-16 | Initial office operating system specification |

**Next step:** Derive `queue-rules` implementation spec (computed flags, SLA timers) after playbook and data model sign-off — then UX flows (separate from visual design system).
