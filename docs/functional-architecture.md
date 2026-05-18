# EXECFLOW — Functional Architecture

**Version:** 0.1 (draft)  
**Status:** Locked for product behavior — visual and backend implementation follow this spec.  
**Product:** Sistema inteligente de execução penal — operational workspace for penal-execution practice.

---

## Purpose of this document

This specification defines **what EXECFLOW must do** before further UI polish or backend work. It is derived from:

- The stated product scope (*execução penal*).
- The current application modules (sidebar): Dashboard, Execuções, Clientes, Prazos, Oportunidades, Peças, Financeiro, Configurações.
- The dashboard workspace concepts: fila operacional, agenda processual, documentos em curso, notas operacionais.

**Out of scope for this document:** visual design, API schemas, database DDL, and AI model choice.

---

## 1. Core actors / user roles

### 1.1 Human roles (MVP)

| Role | Identifier | Primary responsibility |
|------|------------|----------------------|
| **Admin** | `admin` | Organization setup, users, permissions, integrations, audit, destructive actions. |
| **Lawyer** | `lawyer` | Legal judgment, approvals, strategy, final responsibility on cases and pieces. |
| **Assistant / staff** | `assistant` | Data entry, document intake, scheduling, draft preparation, visit logging. |

### 1.2 Future system agent roles (not human)

| Role | Identifier | Responsibility |
|------|------------|----------------|
| **Ingestion agent** | `agent.ingestion` | Parse imported PDFs, propose metadata, flag low-confidence extractions. |
| **Analysis agent** | `agent.analysis` | Detect deadlines, opportunities, inconsistencies; never commit legal conclusions alone. |
| **Drafting agent** | `agent.drafting` | Generate draft text for pieces from templates + case context; always pending human review. |
| **Notification agent** | `agent.notifications` | Route alerts to the right users based on rules in this document. |

Agents are **actors with constrained permissions** — they never replace `lawyer` approval where human review is required (see §6 and §8).

### 1.3 Role hierarchy (default)

```
admin > lawyer > assistant
```

A user may hold one role per organization (MVP). Multi-role per user is a future extension and must not be assumed in v0.1 rules.

---

## 2. Core data objects

Each object belongs to an **organization** (law firm / legal team). All records are **audited** (who created/changed, when).

### 2.1 Entity summary

| Object | Portuguese UI label | Purpose |
|--------|---------------------|---------|
| **Client** | Cliente | Person under penal execution supervised by the firm. |
| **Execution case** | Execução | A penal-execution matter linked to one client; unit of operational tracking. |
| **Process event** | Evento processual | Court or administrative milestone (decision, dispatch, hearing). |
| **Document** | Documento | Stored file + metadata (imported or uploaded). |
| **Deadline** | Prazo | Time-bound obligation derived from law, court order, or internal policy. |
| **Opportunity** | Oportunidade | Actionable legal advantage window (e.g. regime change, benefit eligibility). |
| **Piece / draft** | Peça | Legal filing or memorandum prepared for submission. |
| **Visit note** | Nota de visita | Record of client contact (especially prison visits). |
| **Task** | Tarefa | Internal work item not necessarily equal to a legal deadline. |
| **Notification** | Notificação | Delivered alert to a user about something requiring attention. |

### 2.2 Relationships (canonical)

```
Organization
  └── Client (1)
        └── Execution case (0..n)     ← primary operational container
              ├── Process event (0..n)
              ├── Document (0..n)     ← may also link at Client level before association
              ├── Deadline (0..n)
              ├── Opportunity (0..n)
              ├── Piece / draft (0..n)
              ├── Visit note (0..n)
              └── Task (0..n)

Notification → references one primary object + optional secondary links
```

**Rules:**

- Every **execution case** must reference exactly one **client**.
- A **client** may exist without an execution case (intake / pre-matter).
- **Documents** may exist unassigned, then be **associated** to client and/or execution case.
- **Deadlines** and **opportunities** must reference an execution case (or client + pending case creation — see workflows).
- **Pieces** must reference an execution case.
- **Visit notes** must reference a client; should reference execution case when one is active.

### 2.3 Key fields (behavioral, not schema)

**Client (required for persistence):** display name, at least one identifier (national ID or internal ref), organization id, responsible lawyer (default assignee).  
**Execution case (required):** client id, case reference (internal), status (§4), responsible lawyer, opened at.  
**Document (required):** file storage ref, source type (`import` | `upload` | `generated`), imported at, checksum.  
**Deadline (required):** execution case id, due at, type, status (§4), origin (`manual` | `extracted` | `rule`).  
**Opportunity (required):** execution case id, type, status (§4), detected at, summary.  
**Piece (required):** execution case id, type, status (§4), current version ref.  
**Visit note (required):** client id, occurred at, author user id, body (manual text).  
**Task (required):** title, status (§4), assignee, due at (optional but recommended).  
**Notification (required):** recipient user id, channel, payload ref, read state.

Optional fields and validation detail: §7.

---

## 3. Main workflows

### 3.1 Adding a new client

| Step | Actor | System behavior |
|------|-------|-----------------|
| 1 | Assistant or lawyer | Opens Clientes → novo cliente. |
| 2 | — | Validates required fields (§7). |
| 3 | — | Creates client; assigns default responsible lawyer. |
| 4 | — | Optional: create execution case in same flow. |
| 5 | Admin/lawyer | May reassign responsible lawyer later. |

**Must always:** record creator and timestamp.  
**Must never:** create duplicate client with same organization + national ID without explicit merge workflow.

### 3.2 Importing documents

| Step | Actor | System behavior |
|------|-------|-----------------|
| 1 | Assistant | Uploads PDF (single or batch). |
| 2 | Ingestion agent (optional) | Proposes title, dates, parties, execution refs; marks confidence per field. |
| 3 | Assistant/lawyer | Reviews extraction; confirms or corrects; associates to client/case. |
| 4 | — | Stores original file immutable; stores extracted fields as **proposed** until confirmed. |
| 5 | Analysis agent (optional) | May trigger deadline/opportunity **suggestions** after confirmation. |

**Must always:** keep original PDF; separate `extracted` vs `confirmed` data (§7).  
**Must never:** auto-associate to wrong case without human confirmation when confidence &lt; threshold (configurable, default: require review).

### 3.3 Associating a client to an execution

| Step | Actor | System behavior |
|------|-------|-----------------|
| 1 | Lawyer/assistant | Selects client + creates or opens execution case. |
| 2 | — | Links documents, events, deadlines to that execution. |
| 3 | Lawyer | Confirms responsible lawyer and case status `active`. |

**Must always:** one active primary execution per client unless explicitly marked `parallel` (future; MVP: one `active` case recommended).  
**Must never:** delete client while execution cases with legal hold exist without admin + audit.

### 3.4 Detecting deadlines

| Step | Actor | System behavior |
|------|-------|-----------------|
| 1 | Analysis agent / rules engine | Scans confirmed document text + process events. |
| 2 | — | Creates deadline candidates with `origin=extracted` or `rule`. |
| 3 | Lawyer/assistant | Accepts, edits, or dismisses each candidate. |
| 4 | — | Accepted → status `open`; triggers notification (§6). |

**Must always:** show source (document id / event id) on extracted deadlines.  
**Must never:** mark deadline as `completed` without user action or linked filing event.

### 3.5 Detecting opportunities

| Step | Actor | System behavior |
|------|-------|-----------------|
| 1 | Analysis agent | Evaluates case timeline, sentence data, regime rules (configured playbooks). |
| 2 | — | Creates opportunity with type, window, rationale (non-binding). |
| 3 | Lawyer | Reviews → `qualified` | `dismissed` | `pursuing`. |

**Must always:** label opportunities as suggestions, not legal advice inside the product.  
**Must never:** auto-file a piece based on opportunity alone.

### 3.6 Generating a draft piece

| Step | Actor | System behavior |
|------|-------|-----------------|
| 1 | Lawyer/assistant | Selects piece type + execution case. |
| 2 | Drafting agent (optional) | Produces draft from template + case facts (confirmed only). |
| 3 | Assistant/lawyer | Edits in `draft` status. |
| 4 | — | Version history preserved per save. |

**Must always:** new version on material edit; attribute author.  
**Must never:** set status `filed` without lawyer approval (§5).

### 3.7 Reviewing and approving a piece

| Step | Actor | System behavior |
|------|-------|-----------------|
| 1 | Assistant | Submits for review → `in_review`. |
| 2 | Lawyer | Approves → `approved` or returns → `draft` with comments. |
| 3 | Assistant/lawyer | Exports/files externally; marks `filed` with filing metadata. |

**Must always:** approval logged with lawyer user id and timestamp.  
**Must never:** allow assistant to approve (§5).

### 3.8 Logging visits and notes

| Step | Actor | System behavior |
|------|-------|-----------------|
| 1 | Assistant/lawyer | Creates visit note on client (and case if applicable). |
| 2 | — | Stores manual body; optional attachments. |
| 3 | — | May spawn tasks (e.g. “prepare progression request”). |

**Must always:** distinguish visit notes from document extraction (§7).  
**Must never:** overwrite visit note after publish; only addendum (new note or amendment record).

### 3.9 Tracking progress across a case

| Step | Actor | System behavior |
|------|-------|-----------------|
| 1 | — | Dashboard aggregates open deadlines, opportunities, tasks, pieces in progress. |
| 2 | Lawyer/assistant | Updates case status, completes tasks, files pieces. |
| 3 | — | Timeline view = ordered process events + key status changes. |

**Must always:** reflect counts from authoritative object statuses, not cached guesses.  
**Must never:** hide overdue deadlines from responsible lawyer’s dashboard.

---

## 4. State model

### 4.1 Execution case statuses

| Status | Meaning | Allowed next |
|--------|---------|--------------|
| `intake` | Client linked; case being opened | `active`, `archived` |
| `active` | Operational work in progress | `suspended`, `closed`, `archived` |
| `suspended` | Paused (client unavailable, strategy hold) | `active`, `closed` |
| `closed` | Substantively complete | `archived` |
| `archived` | Read-only retention | — |

### 4.2 Document statuses

| Status | Meaning |
|--------|---------|
| `pending_association` | Stored; not linked to case |
| `associated` | Linked to client/case |
| `extraction_pending` | Awaiting or running OCR/parse |
| `extraction_review` | Human must confirm fields |
| `confirmed` | Metadata accepted |
| `superseded` | Replaced by newer document version |
| `archived` | Retained read-only |

### 4.3 Task statuses

| Status | Meaning |
|--------|---------|
| `open` | Not started |
| `in_progress` | Being worked |
| `blocked` | Waiting external input |
| `done` | Completed |
| `cancelled` | No longer needed |

### 4.4 Opportunity statuses

| Status | Meaning |
|--------|---------|
| `suggested` | System or user flagged |
| `qualified` | Lawyer validated relevance |
| `pursuing` | Active work planned |
| `dismissed` | Not actionable |
| `realized` | Opportunity acted on |
| `expired` | Window passed |

### 4.5 Piece / draft statuses

| Status | Meaning |
|--------|---------|
| `draft` | Editable |
| `in_review` | Awaiting lawyer |
| `approved` | Lawyer signed off |
| `filed` | Submitted to court/administration |
| `withdrawn` | Pulled before filing |
| `archived` | Historical record |

### 4.6 Deadline statuses

| Status | Meaning |
|--------|---------|
| `open` | Not satisfied |
| `completed` | Fulfilled with evidence |
| `dismissed` | Formally not applicable |
| `overdue` | Past due at (system-derived from `open` + date) |

---

## 5. Permissions and ownership

### 5.1 Ownership

- **Responsible lawyer** on client and execution case: primary owner for approvals and strategy.
- **Assignee** on task: operational owner until `done`.
- **Creator** retains audit attribution; does not imply edit rights after handoff.

### 5.2 Permission matrix (MVP)

| Action | Admin | Lawyer | Assistant |
|--------|:-----:|:------:|:---------:|
| View all cases in org | ✓ | ✓ | ✓ (assigned + team default) |
| Create/edit client | ✓ | ✓ | ✓ |
| Delete client | ✓ | — | — |
| Create/edit execution case | ✓ | ✓ | ✓ |
| Import/upload document | ✓ | ✓ | ✓ |
| Confirm extracted document data | ✓ | ✓ | ✓ |
| Create/edit deadline | ✓ | ✓ | ✓ |
| Dismiss extracted deadline | ✓ | ✓ | — |
| Create/edit opportunity | ✓ | ✓ | ✓ |
| Qualify/dismiss opportunity | ✓ | ✓ | — |
| Create/edit draft piece | ✓ | ✓ | ✓ |
| Submit piece for review | ✓ | ✓ | ✓ |
| **Approve piece** | ✓ | ✓ | — |
| Mark piece filed | ✓ | ✓ | ✓ (after `approved`) |
| Log visit note | ✓ | ✓ | ✓ |
| Manage users/settings | ✓ | — | — |
| View finance module | ✓ | ✓ | configurable |
| Override audit / legal hold | ✓ | — | — |

**View restriction (assistant default):** assistants see clients and cases where they are assignee, creator, or on a team list configured by admin. Lawyers see all cases in org unless restricted by admin policy.

### 5.3 Delete rules

- **Soft-delete** preferred for legal traceability.
- Hard delete only for admin on objects without filings, deadlines completed, or pieces in `filed` state.
- Documents: never hard-delete after `confirmed` without admin + reason code.

---

## 6. Non-visual business rules

### 6.1 Must always happen

| Event | Required system action |
|-------|------------------------|
| Any create/update on legal objects | Write audit log entry |
| Document import | Store immutable original; virus scan (when infra exists) |
| Extraction confirmed | Promote fields to `confirmed`; link provenance to document |
| Deadline accepted | Notify responsible lawyer + assignee |
| Deadline becomes overdue | Escalate notification; show on dashboard fila |
| Piece submitted for review | Notify responsible lawyer |
| Piece approved | Lock content for that version; allow new version only via new draft cycle |
| Case closed | Block new deadlines/opportunities unless reopened by lawyer |
| User removed from org | Revoke access immediately; retain attribution on historical records |

### 6.2 Must never happen

| Prohibited behavior |
|---------------------|
| AI sets piece to `approved` or `filed` without lawyer action |
| AI deletes or overwrites original PDF |
| Extracted data overwrites manual confirmed data without explicit user merge |
| Assistant approves legal pieces |
| Silent change of responsible lawyer without audit |
| Notification sent without link to source object |
| Duplicate active deadline of same type and date for same case without user override |
| Finance entries modify case legal status (finance is orthogonal in MVP) |

### 6.3 Notification triggers

| Trigger | Recipients | Priority |
|---------|------------|----------|
| New deadline within 7 days | Responsible lawyer, assignee | High |
| Deadline overdue | Responsible lawyer, admin optional | Critical |
| Opportunity `suggested` with high confidence | Responsible lawyer | Medium |
| Piece `in_review` | Responsible lawyer | High |
| Document `extraction_review` | Uploader + responsible lawyer | Medium |
| Task assigned | Assignee | Medium |
| Visit note mentions urgent keyword (config) | Responsible lawyer | High |

### 6.4 AI analysis triggers

| Trigger | Allowed output |
|---------|----------------|
| Document reaches `confirmed` | Deadline candidates, opportunity candidates, summary |
| New process event recorded | Re-evaluate deadlines/opportunities |
| Execution case → `active` | Initial playbook scan |
| Lawyer requests “analyze case” | Structured report (suggestions only) |

### 6.5 Automation blocks (human required)

| Situation | Block |
|-----------|--------|
| Low-confidence extraction | Cannot auto-confirm metadata |
| Piece filing | Requires `approved` + human mark `filed` |
| Opportunity → piece generation | Lawyer must initiate or confirm template |
| Client merge/delete | Admin or lawyer confirmation |
| Changing case status from `closed` | Lawyer only |

### 6.6 Always requires human review

- First association of imported document to execution case.
- Acceptance of system-suggested deadlines and opportunities.
- Approval of any piece before filing.
- Any data affecting client liberty/status labels shown to users (wording must be reviewed).
- Dismissal of overdue deadline without completion evidence.

---

## 7. Data entry rules

### 7.1 Required vs optional (MVP)

**Client**

| Field | Required |
|-------|:--------:|
| Full name | ✓ |
| National ID or internal ref | ✓ (one of) |
| Responsible lawyer | ✓ |
| Date of birth | — |
| Contact channels | — |
| Custody / facility | — |
| Notes | — |

**Execution case**

| Field | Required |
|-------|:--------:|
| Client | ✓ |
| Internal reference | ✓ |
| Status | ✓ (default `intake`) |
| Responsible lawyer | ✓ |
| Court / process number | — (recommended) |
| Sentence summary | — |
| Opened date | ✓ (default today) |

**Visit note**

| Field | Required |
|-------|:--------:|
| Client | ✓ |
| Occurred at | ✓ |
| Body (manual) | ✓ |
| Execution case | — (required if client has active case) |
| Location / facility | — |
| Attachments | — |

**Piece**

| Field | Required |
|-------|:--------:|
| Execution case | ✓ |
| Type (enum) | ✓ |
| Title | ✓ |
| Body or template id | ✓ (one of) |

### 7.2 Imported PDF storage model

| Layer | Content | Mutable |
|-------|---------|:-------:|
| **Binary** | Original PDF bytes | No |
| **Extraction run** | Raw OCR/parse output, model version, confidence scores | No (append-only runs) |
| **Proposed fields** | Candidate dates, parties, references | Yes until confirmed |
| **Confirmed fields** | Lawyer/assistant-approved metadata | Yes with audit (corrections) |
| **Display** | UI merges confirmed + pointers to binary | — |

**Must always:** link confirmed fields to `document_id` + `extraction_run_id`.  
**Must never:** treat proposed fields as filing deadlines without acceptance workflow.

### 7.3 Manual notes vs extracted data

| Aspect | Manual note / visit note | Extracted document data |
|--------|--------------------------|-------------------------|
| Source | User typed | Model + PDF |
| Trust level | Authoritative for what user observed | Probabilistic until confirmed |
| Editable | Addendum only after publish | Correct via review UI |
| Used in AI drafting | Yes, explicit | Only after `confirmed` |
| Shown in UI | Distinct badge “Nota manual” | Badge “Extraído” / “Confirmado” |

---

## 8. Future AI responsibilities

### 8.1 AI may suggest

- Deadline candidates with cited source spans.
- Opportunities with type, time window, and plain-language rationale.
- Task list items from visit notes and open deadlines.
- Case summaries and hearing prep outlines.
- Document classification (dispatch, sentence, certificate).

### 8.2 AI may draft

- First versions of pieces from approved templates.
- Internal memos and checklists for assistants.
- Email/message drafts to clients (never auto-send).
- Extraction normalization (dates, process numbers) for human confirmation.

### 8.3 AI may never finalize alone

- Legal approval of a piece.
- Filing with court or public administration.
- Creating binding deadline records without human acceptance (except purely calculational rules explicitly validated by lawyer).
- Changing case status to `closed` or `archived`.
- Deleting or altering original documents.
- Assigning responsible lawyer without human action.
- Sending external communications.
- Financial charges or payments (Financeiro remains human-controlled).

---

## 9. Module map (alignment with current UI)

This locks navigation labels to functional ownership — **no visual change implied**.

| Module | Primary objects | Primary workflows |
|--------|-----------------|-------------------|
| **Dashboard** | Aggregates | Fila operacional, agenda, documentos em curso |
| **Execuções** | Execution case, process event | Open/track case, timeline |
| **Clientes** | Client, visit note | Intake, association |
| **Prazos** | Deadline, task | Detect, complete, escalate |
| **Oportunidades** | Opportunity | Suggest, qualify, pursue |
| **Peças** | Piece/draft, document | Draft, review, approve, file |
| **Financeiro** | Fee/billing (future detail) | Orthogonal to case status in MVP |
| **Configurações** | Users, roles, playbooks, thresholds | Admin |

---

## 10. Implementation order (recommended)

After this document is accepted:

1. **Auth + org + roles** (§1, §5)  
2. **Client + execution case CRUD** (§2, §3.1, §3.3, §4.1)  
3. **Document import + extraction model** (§3.2, §7.2)  
4. **Deadlines + tasks + notifications** (§3.4, §4.3, §4.6, §6.3)  
5. **Opportunities** (§3.5, §4.4)  
6. **Pieces workflow** (§3.6–3.7, §4.5)  
7. **Visit notes** (§3.8, §7.1)  
8. **AI agents** behind feature flags (§8)  
9. **Financeiro** (separate spec)

---

## 11. Glossary

| Term | Definition |
|------|------------|
| **Execução penal** | Legal execution of penal sentence; firm's operational unit is the *execution case*. |
| **Peça** | Procedural writing filed or ready to file. |
| **Prazo** | Calendar or legal deadline. |
| **Oportunidade** | Strategic window for procedural advantage. |

---

## Document control

| Change | Author | Date |
|--------|--------|------|
| Initial functional lock v0.1 | — | 2026-05-16 |

**Next review:** Before backend schema design or any new module beyond placeholder UI.
