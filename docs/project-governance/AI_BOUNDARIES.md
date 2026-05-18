# EXECFLOW — AI Boundaries

**Status:** Binding for all AI agent implementations, prompt design, and automated workflows.  
**Premise:** Liberty is at stake. AI in EXECFLOW is a productivity tool for lawyers and assistants — it is not a legal decision-maker.

---

## What AI may do

### Propose and suggest (never bind)

AI agents may produce **non-binding candidates** that require human review before any legal effect:

| AI action | Output type | Human gate required |
|-----------|-------------|:-------------------:|
| Parse PDF / OCR | `DocumentExtraction.proposed_fields` | Confirm per field |
| Suggest opportunity | `Opportunity.status=suggested` | Lawyer qualify |
| Suggest deadline | `Deadline.status=open, origin=extracted` | Human accept |
| Propose SentenceSnapshot arithmetic | `SentenceSnapshot.status=proposed` | Lawyer confirm |
| Generate piece draft | `PieceVersion.body` in `draft` status | Lawyer approve |
| Classify document type | `document_class` proposed | Assistant confirm |
| Summarize case | `AIAnalysis.output` (non-binding text) | Lawyer reads |
| List missing data | `ExplanationBundle.missing_data[]` | No gate — informational |
| Suggest argument blocks | Draft text for assistant review | Lawyer approve piece |

### Analyze and flag

AI may perform background analysis and emit structured findings without creating operational work items unless a human accepts them:

- Detect arithmetic mismatch between confirmed snapshots → emit `ConflictRecord` candidate
- Flag case inactivity → emit `EngineWarning`, not a task
- Screen decree eligibility → emit batch `Opportunity.suggested` list for lawyer review
- Detect keywords in visit notes → flag for notification (not create legal obligation)

### Explain

AI may produce natural-language explanations of:

- Why an opportunity was suggested (ExplanationBundle)
- What legal rules applied (playbook rule citations)
- What data is missing and why it matters
- What alternate interpretations exist

These explanations are **informational** — accepting an explanation is not the same as accepting the legal conclusion.

---

## What AI may suggest (per domain)

| Domain | Permitted AI suggestion |
|--------|------------------------|
| Progression | Earliest eligibility window + missing-documents checklist |
| Remição | Days sum from certificates + pending recognition flag |
| Detração | Proposed days from confirmed detention dates |
| Indulto/Comutação | Decree eligibility classification per profile |
| PAD challenge | Defense window dates from opened event |
| Prescrição | Screening threshold + interrupt events list |
| Recálculo | Mismatch amount + triggering event reference |
| Excesso de execução | Arithmetic gap between snapshots |
| HC | Thesis bullet points from confirmed facts |
| Rights violations | Category classification only |
| Document | Class, date extraction, party names, process numbers |
| Piece | Draft body from template + confirmed case facts |

All suggestions carry: `confidence`, `source_refs[]`, `missing_data[]`, `playbook_version_id`.

---

## What AI must never do autonomously

These actions are **prohibited regardless of confidence level, explicit prompting, or operational pressure**:

### Legal approvals and filings
- Set `PieceDraft.status = approved`
- Create a `Filing` record
- Mark `Deadline.status = completed`
- Set `Opportunity.status = qualified`, `pursuing`, or `realized`
- Mark `SentenceSnapshot.confirmed_by_user_id` without human action
- Protocol a petition to any court or administrative body

### Legal conclusions
- Declare "client is eligible for progressão" as authoritative
- State "pena cumprida" or release date as definitive
- Conclude "indulto applies to this client"
- Declare arithmetic result as court-binding
- State "no excesso de execução"

### Data mutations
- Delete or overwrite any Document binary
- Overwrite `confirmed` fields with AI-extracted values
- Create a duplicate Client or ExecutionCase
- Merge clients or executions
- Hard-delete any legal history entity

### Governance
- Publish a `PlaybookVersion`
- Select an interpretation branch for a case or org
- Reassign responsible lawyer
- Change case status to `closed` or `archived`

### Communications
- Send any external message, email, or notification to a client
- File or send any document to court or administration

---

## Mandatory human review points

These are **gates that must exist in every implementation path** that involves AI:

| Checkpoint | Required action | Required role |
|------------|-----------------|---------------|
| Document extraction fields | Review and confirm per field | Assistant or Lawyer |
| Opportunity suggestion | Qualify or dismiss | **Lawyer** |
| Deadline from extracted date | Accept or dismiss | Assistant or Lawyer |
| SentenceSnapshot proposal | Review arithmetic and confirm | **Lawyer** |
| Piece draft | Edit, review, approve | **Lawyer approve** |
| Conflict record | Select authoritative snapshot | **Lawyer** |
| Batch decree qualification | Batch owner review | **Lawyer batch owner** |
| ExplanationBundle with AI citation | Explicit "accept conclusion" separate from "accept draft" | **Lawyer** |

A UI that makes any of these gates frictionless to the point of being skipped (e.g. pre-checked "confirm all" on critical fields) violates this rule.

---

## Confidence and uncertainty handling

### Confidence levels

| Level | Meaning | Effect |
|-------|---------|--------|
| `high` | All critical fields confirmed; no blocking incidents | Normal suggestion flow |
| `medium` | Minor gaps; non-critical fields uncertain | Suggestion with warnings |
| `low` | Critical field uncertain or disputed | Suggestion suppressed or marked insufficient |
| `blocked` | Active interruption or missing critical data | No suggestion created |

### Composition rule

Aggregate confidence of any output = **minimum confidence of all critical-path inputs**. One low-confidence field on a critical path suppresses the high-confidence output.

### What confidence gates

| Threshold breach | System response |
|------------------|-----------------|
| Critical date field `low` | Block deadline auto-creation |
| Snapshot confidence not `high` | Block auto-fill of piece arithmetic paragraphs |
| Opportunity confidence `low` | Suppress from main queue; route to AI review |
| `BLK_SNAPSHOT_UNCONFIRMED` | Block all liberty-affecting opportunity families |

### Uncertainty surfacing (mandatory)

AI outputs must surface in the UI (via ExplanationBundle):

- Which fields were uncertain and why
- What data is missing and how it affects the output
- Whether a judicial decision is pending that changes the calculation
- Whether multiple interpretation branches produce different results

AI may not present a single confident number when the underlying data is contested.

---

## Explainability requirements

Every AI-produced `Opportunity`, `Deadline`, `SentenceSnapshot` proposal, and `PieceVersion` draft must include a structured `ExplanationBundle` with all of:

| Required section | Contains |
|-----------------|---------|
| `summary` | Plain-language paragraph (Portuguese) |
| `playbook_version_id` + `rule_ids_applied[]` | Traceable rules |
| `calculations[]` | Step-by-step descriptive arithmetic |
| `source_documents[]` | Document IDs and field spans |
| `missing_data[]` | Prioritized gaps with severity |
| `uncertainty_indicators[]` | CONFLICT, LOW_OCR, PENDING_COURT, INTERPRETATION_BRANCH |
| `alternatives[]` | Other legal interpretations where applicable |

An AI output without an ExplanationBundle is **incomplete and must not be surfaced to users**.

Reference: `execution-engine.md §8`, `playbook-system.md §7.2`.

---

## Trust calibration

AI trust is **org-configured and earned incrementally**:

| Phase | Configuration | Behavior |
|-------|---------------|----------|
| Onboarding | All AI routes through assistant triage | Every suggestion reviewed before lawyer |
| Proven track record | High-confidence progression goes direct to lawyer queue | Skips assistant triage for that type |
| Model or playbook change | Triage requirement reset | Org re-evaluates routing |

No global default of "trust AI suggestions" exists. Trust is explicitly granted per suggestion type by org admin.

There is no AI configuration that grants AI the ability to approve, file, or finalize anything.
