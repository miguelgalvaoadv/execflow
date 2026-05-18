# EXECFLOW — Execution Workflows (Criminal Execution Practice)

**Version:** 0.1 (draft)  
**Status:** Domain operational model — backend design must conform to this document.  
**Companion:** [`functional-architecture.md`](./functional-architecture.md) (roles, objects, permissions, global rules).

**Scope:** *Execução penal* and the day-to-day operation of a criminal-execution practice — not generic case management, not civil litigation.

**Jurisdiction note:** Terminology and playbooks assume **Brazilian criminal execution law** (CP, LEP — Lei de Execução Penal, CPP aplicado, súmulas e jurisprudência dos tribunais superiores). Localization for other systems is a future concern; v0.1 rules are written for the Brazilian operational reality.

---

## Purpose

This document models **how work actually flows** in penal-execution practice:

- Sentence progression (*progressão de regime*)
- Prison benefits (*benefícios*, *remição*, *detração*)
- Procedural and administrative deadlines (*prazos*)
- Disciplinary incidents (*PAD*, sanções disciplinares)
- Sentence arithmetic (*cálculo de pena*, *unificação*, *recálculo*)
- Execution petitions (*petições*, *requerimentos*, *incidentes*)
- High-volume operational management

It exists to prevent backend and automation mistakes **before** implementation.

---

## 0. Domain principles (non-negotiable)

| Principle | Implication for EXECFLOW |
|-----------|-------------------------|
| **Liberty is at stake** | No autonomous filing, no autonomous benefit requests, no “auto-win” on opportunities. |
| **The process number is not optional at scale** | Every execution case must eventually bind to court/admin identifiers or explicit “unknown — pending” state. |
| **Prison reality changes facts** | Transfers, discipline, work/study credits alter calculations and opportunities. |
| **Documents are evidence** | Tribunal PDFs, scans, and WhatsApp forwards are first-class intake, not attachments afterthought. |
| **Time is two-dimensional** | Calendar deadlines ≠ pena cumprida / remição / detração arithmetic — never merge without explicit linking. |
| **One office, many executions** | System optimizes **queues and bulk review**, not single-case craftsmanship. |

---

## 1. How a new execution enters the system

An **execution intake** is any path that creates or activates operational tracking for a client’s penal execution. Intake may create **client + execution** together or attach to an existing client.

### 1.1 Intake channels

| Channel | Identifier | Typical content | MVP | Future |
|---------|------------|---------------|:---:|:------:|
| **Manual registration** | `intake.manual` | Lawyer/assistant enters client + sentence summary + court ref | ✓ | — |
| **PDF upload** | `intake.pdf` | Sentença, certidões, despachos, guias | ✓ | — |
| **Scanned documents** | `intake.scan` | Paper digitized in office; often lower OCR quality | ✓ | — |
| **Tribunal export** | `intake.tribunal` | Official bundles from PJe / e-SAJ / SEEU-style exports | — | ✓ |
| **WhatsApp document** | `intake.whatsapp` | Forwarded PDF/image from family or client | ✓ | ✓ (connector) |
| **OCR extraction** | `intake.ocr` | Pipeline step applied to any binary intake | ✓ | — |
| **Email forward** | `intake.email` | Firm inbox ingestion | — | ✓ |
| **API / integration** | `intake.api` | Prison systems, court webhooks, partner CRM | — | ✓ |

**Universal intake record:** every channel produces an **`IntakeBundle`** (logical object, not necessarily UI):

- `source_channel`
- `received_at`
- `original_files[]` (immutable)
- `uploader_user_id`
- `extraction_runs[]`
- `association_state`: `unassigned` | `proposed` | `confirmed`
- `proposed_client_id` / `proposed_execution_id` (nullable)

### 1.2 Intake state machine

```
received → extraction_pending → extraction_review → association_review → execution_active
                  ↓                    ↓
              failed_ocr          rejected_doc
```

| State | Meaning |
|-------|---------|
| `received` | Files stored; no extraction yet |
| `extraction_pending` | OCR/parse running |
| `extraction_review` | Human must confirm fields |
| `association_review` | Human must confirm client/case link |
| `execution_active` | Linked to active execution case |
| `rejected_doc` | Illegible, wrong matter, spam — retained for audit |
| `failed_ocr` | Could not parse; manual entry required |

### 1.3 Intake decision tree (operational)

1. **Identify person** — CPF, nome, data de nascimento, alcunha (if present in doc).
2. **Match or create client** — duplicate detection on CPF + org (see functional-architecture §3.1).
3. **Identify matter type** — execução principal, apenso, incidente, PAD, HC vinculado, certidão avulsa.
4. **Match or create execution case** — by processo de execução nº, or “new execution” if new sentence line.
5. **Classify documents** — sentença, trânsito, guia, despacho, certidão CARcerária, etc.
6. **Promote confirmed facts** — only after human confirmation.
7. **Trigger engines** — deadline rules + opportunity playbooks (§4–§5).

### 1.4 Channel-specific rules

**Manual registration**

- Minimum to open execution: client identity, responsible lawyer, **tipo de execução** (nova / retomada / apenso), internal ref.
- Court process number may be `pending` for max **N days** (org config, default 30) before dashboard warning.

**PDF / scan / WhatsApp**

- Always store original; never rely on OCR-only copy for filing.
- WhatsApp intakes must record `forwarded_from` note (manual or future metadata).
- Image-only WhatsApp → OCR with mandatory review; no auto-association.

**Tribunal export (future)**

- Parse structured metadata when present (process number, classe, vara).
- Map to **linked procedure** records (§2.4).
- Duplicate export hash → skip re-processing, link to existing document versions.

**OCR extraction**

- Outputs **proposed** fields only until confirmation.
- Must capture: process numbers (origem + execução), dates, pena imposta, regime, vara, nomes.
- Low-confidence fields block opportunity engine for fields they affect (§5).

### 1.5 What intake must never do

- Create a second active execution for the same **processo de execução** number without merge workflow.
- Auto-file petitions from extracted text.
- Mark sentence calculations as “verified” without lawyer confirmation.

---

## 2. What an “execution case” represents

### 2.1 Definition

An **execution case** (*execução*) is the firm’s **operational container** for supervising one penal-execution matter before the **Juízo da Execução** (and related organs), including:

- Sentence execution arithmetic and updates
- Regime progression track
- Benefits and remission credits
- Incidents and linked procedures
- Petitions and pieces filed by the firm
- Office tasks, deadlines, and opportunities

It is **not** the same as:

- The **client** (person)
- The **condenação originária** process alone (may spawn execução)
- A single PDF or a single hearing

### 2.2 Canonical identifiers

| Identifier | Scope | Required when |
|------------|-------|---------------|
| **Internal ref** | Firm-only | Always |
| **Processo de execução nº** | Court execution proceeding | Active case (or `pending` with SLA) |
| **Processo de condenação / origem nº** | Sentencing court record | When known |
| **CPF do sentenciado** | Client | Always (on client) |
| **Unidade prisional atual** | Custody location | When client in closed/semi-open regime |
| **Regime atual** | Legal execution phase | Active case |

**Relationship model:**

```
Client (1) ──< Execution case (N)
                 ├── primary_process_number (execução)
                 ├── origin_process_number (condenação) [optional]
                 ├── current_prison_unit_id [nullable, versioned]
                 ├── current_regime [versioned]
                 ├── sentence_snapshot (confirmed arithmetic) [versioned]
                 ├── apensos / incidents (child links)
                 └── linked_procedures (HC, revisão, etc.)
```

### 2.3 Multiple executions per client

| Scenario | System behavior |
|----------|-----------------|
| New sentence after previous closed | New execution case; prior → `archived` |
| Concurrent sentences (unificação pending) | Multiple active with `parallel` flag; unified calculation object |
| Apenso | Child execution or **linked incident** on parent (§2.4) |
| Mistaken duplicate | Merge workflow; preserve audit trail |

**Default MVP:** one **primary active** execution per client; additional actives require lawyer flag `parallel_allowed` + reason.

### 2.4 Apensos, incidents, and linked procedures

| Type | Identifier | Parent link | Examples |
|------|------------|-------------|----------|
| **Apens o** | `incident.apenso` | execution case | Execução apensada à principal |
| **Incidente processual** | `incident.procedural` | execution case | Incidentes LEP (alteração de regime urgente, etc.) |
| **PAD / disciplinar** | `incident.disciplinary` | execution case | Sanção, isolamento, perda de dias |
| **Linked HC** | `linked.hc` | execution case | HC preventivo ou liberatório |
| **Revisão / recurso** | `linked.appellate` | execution case | Recurso que afeta execução |
| **Mandado / carta** | `linked.court_order` | execution case | Ordem externa |

Each linked object has:

- Own process number (if any)
- Own timeline stream (§3) — may merge into parent view
- Own deadlines where applicable
- Does **not** duplicate client record

### 2.5 Prison unit and regime history

**Prison unit** and **regime** are **versioned facts**, not single fields:

| Field event | Triggers |
|-------------|----------|
| `regime_changed` | Court order, progression grant |
| `transfer` | GEP/transferência document |
| `release_to_open` | Alvará, regime aberto |
| `return_to_custody` | Revogação benefício, falta grave |

Opportunity and calculation engines always read **current confirmed snapshot** + history.

### 2.6 Historical tracking

The execution case maintains:

- **Timeline** (§3) — immutable events
- **Sentence snapshots** — confirmed arithmetic at points in time
- **Document lineage** — originals + confirmations
- **Piece lineage** — versions and filings
- **Status history** — case status transitions

Closed executions remain fully readable; no destructive edits.

---

## 3. Operational timeline model

The **timeline** is the authoritative narrative of an execution case. Events are **append-only**; corrections use `amendment` events referencing the original.

### 3.1 Event envelope (all types)

Every timeline event stores:

| Field | Purpose |
|-------|---------|
| `event_id` | Unique |
| `execution_case_id` | Parent |
| `event_type` | Enum (below) |
| `occurred_at` | When it happened (legal/operational date) |
| `recorded_at` | When entered in EXECFLOW |
| `source` | `manual` \| `document` \| `integration` \| `ai_suggestion` \| `system_rule` |
| `source_ref` | document_id, intake_id, etc. |
| `author_user_id` | Nullable for system |
| `summary` | Short human text |
| `payload` | Type-specific structured data |
| `visibility` | `legal` \| `internal` \| `both` |

### 3.2 Event taxonomy

#### Court and process

| `event_type` | Description | Typical source |
|--------------|-------------|----------------|
| `court.movement` | Andamento / movimentação processual | Tribunal export, PDF |
| `court.dispatch` | Despacho/decisão interlocutória | PDF |
| `court.sentence_order` | Decisão que altera execução (regime, pena) | PDF |
| `hearing.scheduled` | Audiência designada | PDF, manual |
| `hearing.held` | Audiência realizada | Manual, visit note |
| `hearing.cancelled` | Audiência cancelada | PDF, manual |
| `petition.filed` | Petição/requerimento protocolado | Piece record |
| `petition.decision` | Resposta judicial à petição | PDF |

#### Custody and prison

| `event_type` | Description |
|--------------|-------------|
| `prison.transfer` | Transferência de unidade |
| `prison.admission` | Ingresso em estabelecimento |
| `prison.release` | Saída (alvará, fuga registrada, etc.) |
| `disciplinary.opened` | Instauração PAD / sindicância |
| `disciplinary.sanction` | Sanção aplicada (perda de dias, etc.) |
| `disciplinary.annulled` | Anulação/reforma de sanção |
| `benefit.granted` | Concessão (regime, saída, etc.) |
| `benefit.revoked` | Revogação |

#### Contacts

| `event_type` | Description |
|--------------|-------------|
| `visit.lawyer` | Visita do advogado |
| `contact.family` | Contato familiar relevante (not visita íntima necessariamente) |
| `contact.client_message` | Mensagem relevante (WhatsApp logged as note) |

#### Sentence arithmetic

| `event_type` | Description |
|--------------|-------------|
| `sentence.snapshot_confirmed` | Lawyer confirmed calculation snapshot |
| `sentence.recalculation_ordered` | Determinação de recálculo |
| `sentence.recalculation_done` | Novo cálculo confirmado |
| `remission.credit` | Remição reconhecida (dias) |
| `detraction.applied` | Detração aplicada no cálculo |
| `unification` | Unificação de penas |

#### Office operations

| `event_type` | Description |
|--------------|-------------|
| `office.note` | Nota interna |
| `task.created` | Tarefa criada (link task_id) |
| `task.completed` | Tarefa concluída |
| `deadline.created` | Prazo gerado (link deadline_id) |
| `deadline.completed` | Prazo cumprido |
| `opportunity.suggested` | Oportunidade sugerida |
| `opportunity.qualified` | Oportunidade validada |
| `opportunity.dismissed` | Oportunidade descartada |
| `opportunity.realized` | Oportunidade concretizada |
| `ai.recommendation` | Recomendação IA (não vinculante) |
| `document.confirmed` | Documento com metadados confirmados |

### 3.3 Timeline rules

| Rule | Detail |
|------|--------|
| **Ordering** | Default `occurred_at` desc; filings also indexed by `recorded_at` |
| **AI events** | Never overwrite court events; appear as `ai.recommendation` with confidence |
| **Discipline → calculation** | `disciplinary.sanction` must trigger recalculation **review** opportunity |
| **Benefit → regime** | `benefit.granted` must update regime snapshot via confirmed workflow |
| **Merges** | Linked incidents may display as nested thread under parent execution |

### 3.4 Dashboard projection

Dashboard **agenda processual** = projection of `hearing.*`, open `deadline.*`, critical `court.*` within window.  
**Fila operacional** = open tasks + overdue deadlines + opportunities `qualified|pursuing` + pieces `in_review`.

---

## 4. Deadline system (*prazos*)

Deadlines are firm-critical. They split into **legal/process deadlines** and **internal SLAs**.

### 4.1 Deadline classes

| Class | `deadline_class` | Origin examples |
|-------|------------------|-----------------|
| **Legal / court** | `legal` | Manifestação, recurso, contrarrazões, cumprimento de despacho |
| **Benefit / progression** | `benefit` | Prazo para requerer progressão após marco |
| **Disciplinary** | `disciplinary` | Defesa PAD, recurso administrativo |
| **Calculation** | `calculation` | Impugnar cálculo do juízo, apresentar planilha |
| **Internal SLA** | `internal` | Revisar documento intake, aprovar peça |
| **Recurring review** | `recurring` | Revisão trimestral do caso, verificar remição |

### 4.2 Creation modes

| Mode | `origin` | Behavior |
|------|----------|----------|
| **Automatic (rules)** | `rule` | Rule engine derives from confirmed event + playbook |
| **Extracted** | `extracted` | OCR/tribunal text proposes date → human accepts |
| **Manual** | `manual` | User creates with justification |
| **Recurring** | `recurring` | Spawns next instance on completion or schedule |

**Automatic deadline examples (non-exhaustive):**

| Trigger event | Typical deadline |
|---------------|------------------|
| `court.dispatch` requiring manifestação | Legal counter / response per dispatch |
| `disciplinary.opened` | PAD defense window (playbook-configured) |
| `sentence.recalculation_ordered` | Planilha / impugnação window |
| `opportunity.qualified` (progression) | Internal: file petition within X days |
| `document` in `extraction_review` > 48h | Internal SLA for firm |

### 4.3 Recurring reviews

| Review type | Default cadence | Purpose |
|-------------|-------------------|---------|
| **Case health** | 90 days | Verify regime, unit, remição, open opportunities |
| **Calculation check** | On sanction or major court order | Confirm arithmetic |
| **Benefit eligibility** | 60 days in semi-aberto | Progression / open regime screen |
| **Document backlog** | Weekly (office-level) | Intake association queue |

Recurring deadlines **spawn a task** + notification; completing review logs `office.note` or checklist event.

### 4.4 Criticality and alerts

| Level | `priority` | Notification |
|-------|------------|--------------|
| **Critical** | `critical` | Immediate; repeat at D-1, D-0, overdue |
| **High** | `high` | D-7, D-3, D-1 |
| **Normal** | `normal` | D-7 |
| **Low** | `low` | Dashboard only |

**Critical by default:** legal deadlines with manifestação, PAD defense, HC deadline linked, recurrence of overdue on same case.

### 4.5 Escalation rules

| Condition | Escalation |
|-----------|------------|
| Overdue 1 day | Notify assignee + responsible lawyer |
| Overdue 3 days | Notify lawyer + office queue “escalation” |
| Overdue 7 days | Notify admin optional; block case `closed` |
| Critical overdue | SMS/email if configured; daily repeat |

### 4.6 Overdue behavior

| State | System behavior |
|-------|-----------------|
| `open` + `due_at` passed | Auto-transition to `overdue` (derived or explicit) |
| `overdue` | Stays visible in fila until `completed` or `dismissed` |
| `dismissed` overdue | Lawyer only; **requires reason code** |
| `completed` | Requires evidence: linked `petition.filed`, `office.note`, or document |

**Must never:** auto-complete legal deadline without linked evidence.

---

## 5. Opportunity detection engine (*oportunidades*)

Opportunities are **hypotheses of procedural advantage**, not outcomes. Each type has data requirements, triggers, AI permissions, and human gates.

### 5.1 Engine inputs (global)

Engines may only use:

- Confirmed sentence snapshots
- Confirmed timeline events
- Confirmed document fields
- Versioned regime / unit / remição credits
- Playbook parameters (org-level, versioned)

Engines may **not** use:

- Unconfirmed OCR fields
- Speculative NLP “facts” without citation to source span

### 5.2 Opportunity catalog

| Type | `opportunity_type` | Data required | Triggers | AI may suggest? | Human confirmation |
|------|-------------------|---------------|----------|:---------------:|:------------------:|
| **Progressão de regime** | `progression` | Pena cumprida %, regime atual, falta grave window, remição, dates | Time served threshold, regime duration, court order | ✓ | **Mandatory** |
| **Remição** | `remission` | Work/study certificates, days credit, pending recognition | New cert document, visit note, manual | ✓ | **Mandatory** |
| **Detração** | `detraction` | Preventive custody dates, sentence start | Confirmed sentencing docs, manual snapshot | ✓ | **Mandatory** |
| **Indulto** | `amnesty` | Sentence type, date, decree parameters | Decree publication, playbook date rules | ✓ | **Mandatory** |
| **Comutação** | `commutation` | Idem indulto + sentence remainder | Decree / court decision | ✓ | **Mandatory** |
| **HC opportunity** | `hc` | Custody state, illegality hypothesis, parallel procedures | Illegal prolongation flags, PAD, excess execution | ✓ (thesis draft only) | **Mandatory** |
| **PAD challenge** | `pad_challenge` | PAD act, sanction type, dates, defense status | `disciplinary.opened`, sanction doc | ✓ | **Mandatory** |
| **Prescrição** | `prescription` | Sentence dates, interruption events | Time elapsed rules | ✓ | **Mandatory** |
| **Recálculo de pena** | `recalculation` | Planilha juízo, remição, detração, sanctions | `sentence.recalculation_ordered`, sanction, new cert | ✓ | **Mandatory** |
| **Excesso de execução** | `excess_execution` | Confirmed arithmetic vs time served | Snapshot comparison, court data | ✓ | **Mandatory** |
| **Violação de direitos** | `rights_violation` | Narrative + category (visita, saúde, etc.) | Visit notes, client messages, reports | ✓ (classify only) | **Mandatory** |

### 5.3 Per-type operational notes

**Progressão (`progression`)**

- Requires **confirmed** percent/time thresholds per regime (fechado → semiaberto → aberto).
- Must check **falta grave** lookback — disciplinary events block or delay suggestions.
- AI output: eligibility window + missing documents checklist — not “approve progression”.
- Human: lawyer `qualified` before piece generation.

**Remição (`remission`)**

- Credits from work/study need **documentary proof** (certidão).
- AI may sum proposed days; lawyer confirms before requesting judicial recognition.

**Detração (`detraction`)**

- Tie to preventive detention dates on confirmed sentença/guia.
- Errors are **critical** (§7) — wrong detração affects liberty timing.

**Indulto / Comutação**

- Driven by **legal calendar** + sentence profile; often batch across office.
- Support **bulk review** (§8) when decree published.

**HC (`hc`)**

- AI may suggest thesis bullets from confirmed facts; never auto-file.
- Link to `linked.hc` procedure when exists.

**PAD challenge (`pad_challenge`)**

- Clock starts at `disciplinary.opened`; deadlines in §4 linked.
- Losing PAD may trigger progression block opportunities to dismiss.

**Prescrição (`prescription`)**

- Separate **executory prescription** from other extinctive tracks — playbook must distinguish.
- Human must confirm interrupting events on timeline.

**Recálculo (`recalculation`)**

- Triggered by sanction, new remição, judicial order, or arithmetic mismatch.
- Always pairs with **calculation deadline** and often a **piece** (planilha, impugnação).

**Excesso de execução (`excess_execution`)**

- Compare confirmed snapshot to served time + benefit credits.
- Critical severity; lawyer review before any filing.

**Violação de direitos (`rights_violation`)**

- AI classifies category only; lawyer decides procedural path (HC, pedido, notícia).

### 5.4 Opportunity lifecycle (execution-specific)

```
suggested → qualified → pursuing → realized
     ↓          ↓
 dismissed   expired
```

| Transition | Who |
|------------|-----|
| `suggested` → `qualified` | Lawyer |
| `qualified` → `pursuing` | Lawyer or assistant under supervision |
| `pursuing` → `realized` | Lawyer (links filed piece + court event) |
| `suggested` → `dismissed` | Lawyer (assistant may propose dismiss reason) |

**Bulk:** `suggested` → `qualified` allowed in batch only for **indulto/comutação** playbook runs with identical decree parameters — still per-case audit.

---

## 6. Piece generation pipeline (*peças*)

Pieces are how the firm acts on opportunities and deadlines. Pipeline is **versioned, review-gated, filing-tracked**.

### 6.1 Piece categories (execution practice)

| Category | `piece_category` | Examples |
|----------|------------------|----------|
| **Progression / regime** | `regime` | Requerimento de progressão, alteração de regime |
| **Benefits** | `benefit` | Remição, detração, indulto, comutação |
| **Calculation** | `calculation` | Planilha de pena, impugnação ao cálculo |
| **Disciplinary** | `disciplinary` | Defesa PAD, recurso |
| **HC / writ** | `writ` | Habeas corpus, pedido de liberdade |
| **Incidents** | `incident` | Incidentes LEP diversos |
| **Petition generic** | `petition` | Manifestação, juntada, requerimentos |
| **Office internal** | `internal` | Memorando interno (not filed) |

### 6.2 Templates

| Concept | Rule |
|---------|------|
| **Template** | Org-maintained; versioned; maps `piece_category` + optional `opportunity_type` |
| **Placeholders** | Pull only **confirmed** fields (name, process nos., regime, days, unit) |
| **Jurisdiction block** | Vara comarca, juízo execução — required before export |
| **Argument blocks** | Reusable snippets (§6.6) inserted into template regions |

### 6.3 AI-assisted drafts

| Step | Actor | Output |
|------|-------|--------|
| Select template + case | Human | — |
| Generate draft | `agent.drafting` | Version 1 in `draft` |
| Edit | Assistant/lawyer | Version n |
| Submit | Assistant/lawyer | `in_review` |
| Approve | Lawyer | `approved` |
| Export PDF | System | Hash stored |
| Mark filed | Human | `filed` + protocol metadata |

**AI constraints:**

- May fill template from confirmed facts + selected argument blocks.
- May not invent case numbers, dates, or judicial quotes without source document citation flagged for review.
- Must output **uncertainty flags** on arithmetic paragraphs.

### 6.4 Review and approval

Aligned with functional-architecture §3.7:

- Assistant never approves.
- Lawyer approval locks version.
- Return to `draft` preserves review comments per version.

### 6.5 Versioning

| Rule | Detail |
|------|--------|
| Version bump | Material change to legal text |
| Minor typo | Same version with amendment log (optional org policy) |
| Branching | New piece record if different piece type; versions within same piece |
| Compare | Store diff metadata for lawyer review (future) |

### 6.6 Filing tracking

On `filed`:

| Field | Required |
|-------|:--------:|
| `filed_at` | ✓ |
| `filed_by_user_id` | ✓ |
| `protocol_number` | — (recommended) |
| `court_confirmation_document_id` | — |
| Links to `petition.filed` timeline event | ✓ |

### 6.7 Reusable argument blocks

| Block type | Use |
|------------|-----|
| `thesis.progression` | Fundamentos LEP / jurisprudência padrão do escritório |
| `thesis.remission` | Remição trabalho/estudo |
| `thesis.detraction` | Detração CPP art. 387 |
| `thesis.excess` | Excesso de execução |
| `thesis.rights` | Violation categories |

Blocks are **curated text** — not AI-generated law at filing time unless lawyer inserts AI draft into block and approves.

---

## 7. Risk and validation system

Validation runs in **layers** before human approval and before filing mark.

### 7.1 Validation layers

| Layer | When | Checks |
|-------|------|--------|
| **L0 — Schema** | On save | Required fields, enum validity |
| **L1 — Association** | On save | Client/case/process number consistency |
| **L2 — Arithmetic** | Snapshot confirm, piece export | Pena, remição, detração, percentuais |
| **L3 — Procedural** | Piece submit | Template completeness, pending `pending` court numbers |
| **L4 — AI citation** | AI draft | Uncited claims, low-confidence extractions |
| **L5 — Lawyer gate** | Approve / file | Human accountability |

### 7.2 Error severity

| Severity | Code prefix | Examples | Blocks filing? |
|----------|-------------|----------|:--------------:|
| **Critical** | `E-CRIT` | Wrong CPF/processo, arithmetic incoherence, wrong client on piece, missed PAD deadline | ✓ |
| **High** | `E-HIGH` | Missing remição doc for remission piece, regime mismatch | ✓ until waived by lawyer |
| **Warning** | `E-WARN` | Optional field missing, old snapshot (>90d) | — |
| **Info** | `E-INFO` | Style, duplicate paragraph | — |

### 7.3 Mandatory lawyer review triggers

- Any `E-CRIT` or `E-HIGH`
- First piece on case
- `excess_execution`, `hc`, `disciplinary` categories
- AI-generated text > 30% of piece body (configurable)
- Opportunity type `prescription`, `amnesty`, `commutation`
- Client regime change in last 7 days

### 7.4 What AI must never autonomously decide

| Domain | Prohibition |
|--------|-------------|
| Eligibility | “Client qualifies for progression” as binding |
| Arithmetic | Final days remaining as authoritative |
| Filing | Protocol, submission, court selection |
| Discipline | Whether PAD defense is sufficient |
| Liberty | Regime labels shown to client without lawyer-approved text |
| Dismissal | Auto-dismiss opportunities or deadlines |
| Bulk qualification | Mass qualify without per-case lawyer action (except configured decree workflows with explicit batch owner) |

### 7.5 Pre-filing checklist (logical)

Before `filed` status:

1. Piece `approved` by lawyer.
2. No unresolved `E-CRIT`.
3. Process number present (not `pending`).
4. Linked opportunity/deadline satisfied or explicitly waived with reason.
5. Export PDF checksum stored.

---

## 8. Scale considerations

Target: **hundreds of active executions** per organization with low manual overhead.

### 8.1 Operational queues (office-level)

| Queue | Contents | Primary user |
|-------|----------|--------------|
| **Intake association** | Unassigned documents | Assistant pool |
| **Extraction review** | OCR pending confirmation | Assistant |
| **Deadline — week** | D-7 legal + benefit | Lawyer + assistant |
| **Deadline — overdue** | Escalated | Lawyer |
| **Opportunities — suggested** | Awaiting qualification | Lawyer |
| **Opportunities — decree batch** | Indulto/comutação sets | Lawyer team |
| **Pieces — in review** | Awaiting approval | Lawyer |
| **Recalculation pending** | Cases with arithmetic flags | Lawyer + specialist |

Queues are **filters**, not separate data — consistent counts with dashboard fila.

### 8.2 Bulk operations

| Operation | Allowed | Guardrails |
|-----------|:-------:|------------|
| Assign responsible lawyer (batch) | ✓ | Audit per case |
| Accept extracted process number (batch) | ✓ | Same document type |
| Qualify indulto opportunity (batch) | ✓ | Same decree_id; lawyer sign-off on batch |
| Dismiss opportunities (batch) | ✓ | Reason code required |
| Generate draft pieces (batch) | — | **Not in MVP** — too risky |
| Mark filed (batch) | — | Never |

### 8.3 Collaboration model

| Pattern | Support |
|---------|---------|
| Primary lawyer per execution | Required |
| Covering lawyer | Temporary delegate with audit |
| Assistant pools | Task assignment by queue |
| Internal notes vs client-facing | `visibility` on timeline |
| Concurrent edit on piece | Lock or version conflict detection (implementer choice; must not lose text) |

### 8.4 Performance and data volume assumptions

| Assumption | Planning figure |
|------------|-----------------|
| Active executions / org | 200–2,000 |
| Documents / execution / year | 20–200 |
| Timeline events / execution / year | 50–500 |
| Open deadlines / org | 500–5,000 |
| Suggested opportunities / week | 50–500 (many auto-dismissed) |

**Indexing priorities:** `due_at`, `responsible_lawyer_id`, `execution status`, `priority`, `queue flags`.

### 8.5 Low manual overhead tactics

| Tactic | Mechanism |
|--------|-----------|
| **Ingestion first** | WhatsApp/PDF → intake queue, not ad-hoc case creation |
| **Playbooks** | Encode LEP thresholds as versioned rules, not lawyer memory |
| **Recurring reviews** | Automate case health, not reactive firefighting |
| **Argument blocks** | Reduce copy-paste in progression/remission pieces |
| **Bulk qualify decrees** | Indulto/comutação across portfolio |
| **Confidence gating** | Low OCR confidence → no opportunity spam |

---

## 9. Cross-reference matrix

| functional-architecture.md | This document |
|----------------------------|---------------|
| §2 Core objects | §2 execution semantics, §3 timeline |
| §3 Workflows | §1 intake, §6 pieces |
| §4 States | §1.2 intake, §4 deadlines, §5 opportunities |
| §6 Business rules | §7 validation, §5 gates |
| §7 Data entry | §1 intake channels, §2 identifiers |
| §8 AI | §5 catalog, §6.3, §7.4 |

**If conflict:** execution-workflows (domain) wins on *execução penal* behavior; functional-architecture wins on roles/permissions unless this doc explicitly overrides.

---

## 10. Document control

| Change | Date |
|--------|------|
| Initial execution workflows v0.1 | 2026-05-16 |

**Next review:** Before database schema, rule engine design, and intake pipeline implementation.
