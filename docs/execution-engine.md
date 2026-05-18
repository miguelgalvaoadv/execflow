# EXECFLOW — Execution Engine (Legal-Temporal Specification)

**Version:** 0.1 (conceptual)  
**Status:** Core intelligence layer — **not** code, **not** formulas in executable form, **not** database DDL.  
**Companions:** [`execution-workflows.md`](./execution-workflows.md), [`data-model-v1.md`](./data-model-v1.md), [`functional-architecture.md`](./functional-architecture.md).

**Purpose:** Define how EXECFLOW **understands time, sentence arithmetic, and procedural consequence** in Brazilian *execução penal* — the legal-temporal engine that powers deadlines, opportunities, validation, and explainability.

**Jurisdiction:** Brazilian law (CP, LEP, CPP where applicable, súmulas STF/STJ, binding playbook versions per organization). The engine applies **versioned legal playbooks**; it does not embed statute text as ad-hoc code strings in application logic without traceable playbook ids.

---

## 0. Engine principles

| Principle | Meaning |
|-----------|---------|
| **Two clocks** | **Calendar time** (prazos, audiências) ≠ **sentence arithmetic** (dias de pena, remição, detração). Never merge without explicit bridge events. |
| **Confirmed facts only** | Computations consume **SentenceSnapshot**, **ExecutionCustodySnapshot**, and **TimelineEvent** rows that are human-confirmed or court-confirmed — not raw OCR. |
| **Hypothesis ≠ conclusion** | Engine outputs are **candidates** with confidence, rationale, and missing-data lists until a lawyer qualifies them. |
| **Append-only legal history** | Any change to arithmetic or regime produces a **new snapshot** + timeline event; prior states remain replayable. |
| **Playbook versioning** | Legal rule changes are modeled as `playbook_version` on every engine run; recomputation does not rewrite history. |
| **Explainability is mandatory** | Every output carries structured explanation objects (§8). |

### Engine placement in the system

```
┌─────────────────────────────────────────────────────────────┐
│  Intake / Documents / Timeline (facts)                        │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  EXECUTION ENGINE (this document)                           │
│  • Sentence time model                                      │
│  • Event effect processor                                   │
│  • Progression & opportunity evaluators                       │
│  • Uncertainty & confidence layer                           │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Outputs (non-binding until human gates)                    │
│  SentenceSnapshot candidates · Opportunity · Deadline       │
│  Warnings · Validation flags · Explanation bundles            │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Sentence time model

The sentence time model is the **canonical arithmetic representation** of penal debt for an `ExecutionCase`. It is stored as a sequence of **SentenceSnapshot** records (data-model-v1 §3.2) — never as a single mutable row.

### 1.1 Core quantities (conceptual)

| Quantity | Symbol (doc only) | Definition |
|----------|-------------------|------------|
| **Total sentence** | `P_total` | Penal debt imposed after sentencing/unification, in **days** (or convertible unit per playbook). |
| **Served sentence** | `P_served` | Time considered **cumprida** under LEP rules up to snapshot date. |
| **Remitted time** | `P_remicao` | Days credited via **remição** (work/study), judicially recognized. |
| **Detracted time** | `P_detração` | Days credited for **detração** of preventive detention (and other CPP/LEP categories per playbook). |
| **Remaining sentence** | `P_remaining` | Debt still to be executed after credits and served time. |
| **Fraction served** | `F_served` | `P_served / P_total` (or playbook-specific numerator/denominator for progression). |

**Conceptual identity (non-executable):**

> Remaining penal debt is derived from total sentence minus recognized credits and served time, subject to playbook rules on **what counts as served**, **what interrupts**, and **what caps apply**. The engine never assumes a single global formula without citing `playbook_version`.

### 1.2 Components and provenance

Each quantity in a SentenceSnapshot must declare:

| Field role | Purpose |
|------------|---------|
| `value` | Numeric result |
| `unit` | Typically `days` |
| `confidence` | `high` \| `medium` \| `low` \| `unknown` |
| `source_refs[]` | Document ids, event ids, manual confirmation ids |
| `derivation_note` | Human-readable chain |

**Sub-components (optional breakdown in snapshot payload):**

| Sub-field | Tracks |
|-----------|--------|
| `served_in_closed` | Days in closed regime |
| `served_in_semiopen` | Days in semi-open |
| `served_in_open` | Days in open / alternative |
| `remission_pending` | Recognized in office but not yet judicially homologated |
| `remission_homologated` | Court-recognized remição |
| `detraction_candidates` | Proposed from sentencing docs |
| `detraction_confirmed` | Lawyer-confirmed detração |

### 1.3 Fractions (progression and benefits)

Fractions are **legal thresholds**, not display percentages only.

| Fraction use | Typical legal meaning (playbook-driven) |
|--------------|----------------------------------------|
| `F_progression_closed_to_semi` | Fraction of `P_total` required before semi-aberto |
| `F_progression_semi_to_open` | Fraction required before aberto |
| `F_livramento` | Fraction for parole eligibility |
| `F_comutacao_indulto` | Profile-specific for decree matching |

The engine stores:

- **Which denominator** applies (`P_total` post-unification vs per-offense pre-unification) — playbook rule.
- **Whether remição/detração** enter numerator, denominator, or neither — playbook rule with citation id.
- **Interrupt flags** that reset or freeze fraction accrual (§2).

### 1.4 Concurrent sentences (*concurso*)

| Mode | Engine behavior |
|------|-----------------|
| **Material cumulation** | Multiple `P_total` components; unification pending → snapshot marks `unification_status=pending`. |
| **Continued execution** | Single running total; new conviction may **merge** via unification event. |
| **Concurrent active executions** | `ExecutionCase.parallel_allowed=true`; engine computes **per-case** snapshots; office dashboard may show aggregate client view but **must not** auto-merge arithmetic. |

**Required data:** list of `sentence_line` objects in snapshot payload — each with `process_ref`, `P_total`, `offense_class`, `hediondo_flag`, `dates`.

### 1.5 Unified sentences (*unificação*)

| Stage | Snapshot flag | Meaning |
|-------|---------------|---------|
| Pre-unification | `unification_status=none\|pending` | Multiple lines active |
| Post-unification | `unification_status=unified` | Single `P_total` authoritative |
| Judicial amendment | new snapshot | Prior snapshots retained |

**Unification event** (`sentence.unification` timeline) triggers full **recalculation** (§1.7).

### 1.6 Recalculation events

A **recalculation** is any judicial or office-initiated revision of arithmetic that supersedes the prior snapshot for forward-looking purposes (not erasing history).

| Trigger class | Examples |
|---------------|----------|
| **Judicial** | Despacho determinando recálculo; retificação de planilha do juízo |
| **Disciplinary** | Perda de dias por falta grave |
| **Benefit recognition** | Homologação de remição não contabilizada |
| **Detração amendment** | New sentencing docs with detention dates |
| **Error correction** | Office detects mismatch with certidão |

**Engine rules:**

1. Insert new `SentenceSnapshot` with `supersedes_snapshot_id`.
2. Emit `sentence.recalculation_done` TimelineEvent linking old/new snapshot ids.
3. Re-run progression and opportunity evaluators **only on new snapshot**.
4. Flag `recalculation` opportunity if mismatch was material.
5. Open `calculation` class Deadline if court-ordered.

### 1.7 Interruptions (*interrupção*)

Interruptions **pause or reset** accrual of served time or progression fractions per playbook — distinct from merely adding/removing days.

| Interruption type | Effect (conceptual) |
|-------------------|---------------------|
| **Full reset of progression clock** | Falta grave (during lookback), certain escapes |
| **Pause only** | Pending PAD without sanction yet |
| **No interruption** | Ordinary prison transfer |

Interruption state is stored in snapshot payload:

- `interruption_active: boolean`
- `interruption_reason_codes[]`
- `interruption_since` (date)
- `affected_accruals[]` (e.g. `progression_fraction`, `livramento`)

---

## 2. Temporal events that affect execution

Each event type below maps to **TimelineEvent** types (execution-workflows §3.2) and triggers an **Event Effect Record** (logical output of the engine — may persist as snapshot diff + warnings).

For **every** event, the engine must record:

| Trace requirement | Content |
|-------------------|---------|
| **Legal effect summary** | What changed in plain language |
| **Snapshot delta** | Which quantities changed (or “none until confirmed”) |
| **Timeline reset flags** | What accruals reset/pause |
| **Benefit impact** | remição / progressão / livramento / indulto eligibility |
| **Interruption flag** | Yes/no + type |
| **Historical permanence** | Prior snapshots unchanged; new snapshot if arithmetic changes |

### 2.1 Event catalog

#### Falta grave (`disciplinary.sanction` + classification)

| Aspect | Specification |
|--------|---------------|
| **Legal change** | May cause **loss of days**, regression of regime, block progression for lookback period |
| **Timeline reset** | Progression fraction accrual often **reset** or frozen for LEP lookback (playbook) |
| **Benefits affected** | Progressão, livramento — blocked or delayed; remição may be impacted if days lost |
| **Interruption** | **Yes** — `interruption_progression` typical |
| **Historical trace** | Sanction document + PAD timeline + snapshot showing day loss |

#### Fuga (`prison.escape` or custody breach)

| Aspect | Specification |
|--------|---------------|
| **Legal change** | Regime regression risk; time rules special |
| **Timeline reset** | Progression clocks **reset** or case frozen pending recapture |
| **Benefits affected** | All progression/benefit opportunities **blocked** while at large |
| **Interruption** | **Yes** — severe |
| **Historical trace** | Event + court orders post-recapture |

#### Recaptura (`prison.recapture`)

| Aspect | Specification |
|--------|---------------|
| **Legal change** | Resumes execution; court may rule on lost time / regime |
| **Timeline reset** | Resets may **persist** until judicial decision |
| **Benefits affected** | Unblock only after confirmed court position |
| **Interruption** | May **end** escape interruption; PAD/regression may remain |
| **Historical trace** | Link to escape event |

#### Remição (`remission.credit`)

| Aspect | Specification |
|--------|---------------|
| **Legal change** | Increases credit toward `P_remaining` when homologated |
| **Timeline reset** | Does not reset progression unless tied to disciplinary loss |
| **Benefits affected** | Accelerates fraction `F_served`; may enable progression earlier |
| **Interruption** | No |
| **Historical trace** | Certificate document + homologation event |

#### Progressão (`benefit.granted` + `regime_changed`)

| Aspect | Specification |
|--------|---------------|
| **Legal change** | Regime step (fechado → semi → aberto) |
| **Timeline reset** | **New regime clock** starts for next progression threshold |
| **Benefits affected** | Next progression target changes |
| **Interruption** | No (grant is forward-moving) |
| **Historical trace** | Court decision + ExecutionCustodySnapshot |

#### Regressão (`benefit.revoked` / `regime_changed` down)

| Aspect | Specification |
|--------|---------------|
| **Legal change** | Harsher regime restored |
| **Timeline reset** | Progression clocks **reset** for new regime track |
| **Benefits affected** | Revoke open opportunities tied to prior regime |
| **Interruption** | Treat as regression interruption on progression accrual |
| **Historical trace** | Revocation decision |

#### Livramento condicional (`benefit.granted` subtype)

| Aspect | Specification |
|--------|---------------|
| **Legal change** | Supervised release regime |
| **Timeline reset** | Distinct livramento eligibility clock |
| **Benefits affected** | May supersede ordinary progression track |
| **Interruption** | Revocation = major regression event |
| **Historical trace** | Grant + conditions |

#### Indulto (`benefit.granted` + `opportunity_type=amnesty`)

| Aspect | Specification |
|--------|---------------|
| **Legal change** | Extinction or reduction of penal debt per decree |
| **Timeline reset** | May zero `P_remaining` |
| **Benefits affected** | All progression opportunities **close** as realized or expired |
| **Interruption** | N/A — terminal for debt |
| **Historical trace** | Decree publication + court homologation |

#### Comutação (`benefit.granted` + `commutation`)

| Aspect | Specification |
|--------|---------------|
| **Legal change** | Substitutes penalty form or reduces debt |
| **Timeline reset** | Recalculation required |
| **Benefits affected** | Recalculate all fractions |
| **Interruption** | No |
| **Historical trace** | Decision + new snapshot |

#### Prisão provisória / detração (`detraction.applied`)

| Aspect | Specification |
|--------|---------------|
| **Legal change** | Reduces `P_remaining` via CPP art. 387 (playbook) |
| **Timeline reset** | No reset; may affect start date of execution |
| **Benefits affected** | Earlier `F_served` |
| **Interruption** | No |
| **Historical trace** | Sentencing docs confirming detention dates |

#### Unificação (`sentence.unification`)

| Aspect | Specification |
|--------|---------------|
| **Legal change** | Single `P_total` authoritative |
| **Timeline reset** | **Full recalculation** — all fractions recomputed |
| **Benefits affected** | All opportunity types re-evaluated |
| **Interruption** | Clears per-line pending only after confirm |
| **Historical trace** | Pre/post snapshots |

#### Novo processo (new conviction / new execution line)

| Aspect | Specification |
|--------|---------------|
| **Legal change** | New `sentence_line` or new ExecutionCase |
| **Timeline reset** | May trigger unification or parallel tracks |
| **Benefits affected** | Hediondo/reincidência flags may change thresholds |
| **Interruption** | Pending unification may **block** progression suggestions |
| **Historical trace** | New case link + documents |

#### Prescrição (executory or related)

| Aspect | Specification |
|--------|---------------|
| **Legal change** | Extinction of executability |
| **Timeline reset** | Stops accrual |
| **Benefits affected** | Close progression opportunities |
| **Interruption** | Terminal |
| **Historical trace** | Decision or playbook-declared prescription event |

### 2.2 Event processing order

When multiple events occur on the same date:

1. **Court orders** prevail over office assumptions.
2. **Disciplinary sanctions** processed before progression grants on same day unless court order says otherwise.
3. **Unification** processed before progression re-evaluation.
4. Conflicts → **Legal uncertainty** state (§5).

---

## 3. Progression engine

The progression engine evaluates **regime advancement** (fechado → semiaberto → aberto) and related **livramento** tracks. Output: `Opportunity` candidates type `progression` + structured explanation — never a binding grant.

### 3.1 Legal fractions (playbook-driven)

| Transition | Typical inputs (Brazilian LEP context — playbook encodes specifics) |
|------------|----------------------------------------------------------------------|
| Fechado → semiaberto | Fraction of `P_total` + time in closed + absence of blocking sanctions |
| Semiaberto → aberto | Fraction + time in semi + compliance conditions |
| Livramento | Separate fraction + subjective requirements (not fully automatable) |

Engine outputs:

- `target_regime`
- `eligible_from_date` (earliest date assuming confirmed facts)
- `blocking_reasons[]`
- `missing_documents[]`

### 3.2 Reincidência

| Data | Effect |
|------|--------|
| `reincidencia_flag` on sentence line | May increase required fractions or block benefits |
| Confirmed certidão de antecedentes | Required for high-confidence suggestion |
| Dispute on reincidência | **Uncertainty** — block auto-suggest or mark `low` confidence |

### 3.3 Crimes hediondos

| Data | Effect |
|------|--------|
| `hediondo_flag` | Higher fractions, longer tracks, restricted indulto/comutação |
| Subclassification (violência, etc.) | Playbook modifiers |
| Missing hediondo determination | **Insufficient data** — no progression suggest |

### 3.4 Interruptions (progression-specific)

Progression accrual **freezes or resets** when:

- Active `interruption_progression` from falta grave (lookback not expired)
- Escape interruption active
- Pending PAD with playbook “freeze” rule
- Open `regression` without new grant

Engine exposes `progression_accrual_state`: `running` \| `frozen` \| `reset`.

### 3.5 Data-base logic (*marco temporal*)

The engine maintains explicit **anchors**:

| Anchor | Use |
|--------|-----|
| `execution_start_date` | Start of penal execution |
| `regime_entry_date` | Current regime start |
| `last_grant_date` | Last progressão/livramento |
| `sanction_date` | Last falta grave affecting lookback |
| `unification_date` | Post-unification anchor |

**Data-base rule:** fractions accrue from the applicable anchor per playbook — engine must cite which anchor in explanation.

### 3.6 Pending incidents

Incidents block or qualify progression when **not finalized**:

| Incident | Typical block |
|----------|---------------|
| PAD open | Freeze progression suggestion |
| HC pending liberation | Context only — not auto-progress |
| Recálculo judicial pendente | Freeze arithmetic-dependent opportunities |
| Apenso without unified snapshot | Block until unification |

### 3.7 Confidence levels (progression)

| Level | Criteria |
|-------|----------|
| **high** | Confirmed snapshot + confirmed custody + no blocking incidents + complete sentence lines |
| **medium** | Minor missing optional docs; single low-confidence extraction on non-critical field |
| **low** | Disputed dates, partial OCR on critical dates |
| **blocked** | Missing critical data or active interruption |

### 3.8 Uncertainty cases (progression)

| Case | Engine behavior |
|------|-----------------|
| Office vs court planilha disagree | Two snapshot hypotheses — lawyer must confirm |
| Unknown time in semi-aberto | Do not compute semi→open date |
| Conflicting falta grave dates | Freeze progression; flag PAD opportunity |
| Client has parallel executions | Evaluate per case; show cross-case warning only |

---

## 4. Opportunity computation logic

Global evaluator pipeline:

```
1. Load latest CONFIRMED SentenceSnapshot + ExecutionCustodySnapshot
2. Load active interruptions + pending incidents
3. For each opportunity_type in playbook:
     assess data sufficiency → blocking conditions → compute window → assign risk + confidence
4. Emit Opportunity candidates (status=suggested) + ExplanationBundle
5. Never transition to qualified without lawyer (functional-architecture)
```

### 4.1 Opportunity matrix

| Type | Minimum required data | Blocking conditions | Insufficient data | Human review | Risk |
|------|----------------------|---------------------|-------------------|--------------|------|
| **progression** | `P_total`, `P_served` or components, current `regime`, anchors, no active progression interruption | Escape active; PAD freeze; open recálculo court-ordered | Missing regime dates; unconfirmed snapshot | **Always** lawyer qualify | High |
| **remission** | Work/study cert pending or homologated days | — | No cert document | Confirm homologation | Medium |
| **detraction** | Preventive detention dates on confirmed sentença/guia | — | Dates only in unconfirmed OCR | **Always** confirm dates | **Critical** |
| **amnesty** | Sentence profile + decree parameters | Decree not in playbook catalog | No decree match fields | Batch qualify by lawyer | High |
| **commutation** | Profile + decree/court decision | — | Incomplete profile | Lawyer qualify | High |
| **hc** | Custody + hypothesis category + confirmed arithmetic | — | Speculative illegality only | Lawyer strategy | **Critical** |
| **pad_challenge** | PAD opened event + defense window dates | — | No PAD document | Defense deadline tracking | High |
| **prescription** | Execution start + interrupt events | Active debt not near threshold | Unknown interrupt list | Lawyer confirm interrupts | High |
| **recalculation** | Mismatch flags or court order | — | Only AI-detected mismatch | Lawyer confirm snapshot | **Critical** |
| **excess_execution** | Confirmed snapshots + served time | — | Incomplete served log | **Always** lawyer | **Critical** |
| **rights_violation** | Visit note or doc describing violation | — | Hearsay only | Lawyer path selection | Medium |

### 4.2 Blocking conditions (global)

These **suppress all liberty-affecting opportunity suggestions** unless lawyer overrides with documented reason:

| Code | Condition |
|------|-----------|
| `BLK_ESCAPE` | Escape interruption active |
| `BLK_SNAPSHOT_UNCONFIRMED` | No confirmed SentenceSnapshot in 180 days (configurable) |
| `BLK_PROCESS_PENDING` | `execution_process_number` pending past SLA |
| `BLK_LEGAL_HOLD` | Case under legal hold |
| `BLK_UNIFICATION_PENDING` | Multiple lines without unified snapshot |
| `BLK_CRITICAL_VALIDATION` | Open `E-CRIT` validation on arithmetic |

### 4.3 Insufficient-data handling

| State | Behavior |
|-------|----------|
| `insufficient` | No opportunity created; emit `EngineWarning` with missing field list |
| `partial` | Opportunity created with `confidence=low` + explicit gaps |
| `sufficient` | Normal evaluation |

### 4.4 Human-review requirements

| Output | Review |
|--------|--------|
| Any `progression`, `detraction`, `excess_execution`, `hc` | Lawyer qualify before piece |
| `amnesty` / `commutation` batch | Lawyer batch owner |
| `remission` before judicial request | Lawyer or supervised assistant per org policy |
| Auto-created **deadlines** from extracted dates | Human accept (execution-workflows §4) |

### 4.5 Risk levels (downstream effects)

| Risk | Deadlines | Notifications | Filing validation |
|------|-----------|---------------|-------------------|
| **critical** | Auto-priority `critical` | Immediate | Block pre-filing |
| **high** | High priority | D-7 | Warning |
| **medium** | Normal | Standard | — |
| **low** | Dashboard only | — | — |

---

## 5. Legal uncertainty model

The engine must **not collapse** ambiguity into a single number. Uncertainty is first-class state.

### 5.1 Uncertainty sources

| Source | Example |
|--------|---------|
| **Conflicting calculations** | Office planilha ≠ certidão do juízo |
| **Disputed dates** | Start of semi-aberto unclear |
| **Incomplete records** | Missing guia de recolhimento |
| **Uncertain OCR** | Date field confidence &lt; threshold |
| **Divergent legal interpretations** | Remição in numerator vs denominator |
| **Pending judicial decisions** | Recálculo deferido, HC pendente |

### 5.2 Confidence handling

| Layer | Mechanism |
|-------|-----------|
| **Field-level** | DocumentExtraction confidence per field |
| **Snapshot-level** | `confidence` on SentenceSnapshot aggregate |
| **Opportunity-level** | `confidence` + `insufficient_reasons[]` |
| **Engine-run-level** | `EngineRunReport.confidence_summary` |

**Composition rule:** aggregate confidence = **minimum** of critical-path fields (weakest link).

### 5.3 Blocked automations

When uncertainty exceeds thresholds:

| Automation | Blocked when |
|------------|--------------|
| Auto-accept extracted deadline | Critical date fields low confidence |
| Auto-suggest progression | Any blocking condition or `insufficient` |
| Auto-fill piece arithmetic paragraphs | Snapshot confidence not `high` |
| Auto-dismiss opportunity | Never — human only |
| Batch indulto qualify | Any case in `partial` confidence |

### 5.4 Warning systems

| Artifact | Purpose |
|----------|---------|
| `EngineWarning` | Non-blocking issues (missing optional doc) |
| `EngineBlock` | Blocking issue code (§4.2) |
| `ConflictRecord` | Links two incompatible snapshots or interpretations |
| `PendingJudicialDecision` | Freezes specific opportunity families |

Warnings surface on Dashboard fila, ExecutionCase header, and ExplanationBundle — not as silent logs only.

### 5.5 Conflicting calculations resolution workflow

1. Engine detects mismatch &gt; tolerance (playbook tolerance in days or percent).
2. Create `ConflictRecord` with both snapshot ids.
3. Set arithmetic opportunities to `recalculation` + `excess_execution` with `confidence=low`.
4. **No automatic winner** — lawyer selects confirming snapshot or requests new judicial planilha.
5. Upon confirmation, supersede losing snapshot for forward compute only.

---

## 6. Human authority boundaries

### 6.1 Engine MAY calculate automatically (non-binding)

| Computation | Binding? |
|-------------|:--------:|
| Proposed days served / remaining from confirmed inputs | No |
| Proposed remição sum from certificates (pre-homologation) | No |
| Proposed detração from confirmed detention dates | No |
| Progression **earliest eligibility date** hypothesis | No |
| Prescription **screening** hypothesis | No |
| Mismatch detection between snapshots | No |
| Deadline **candidates** from rules | No |
| Internal SLA deadlines | Yes (office-only, not court) |

### 6.2 MUST be confirmed by lawyer (or explicit supervised policy)

| Item | Gate |
|------|------|
| SentenceSnapshot promotion to “office authoritative” | `confirmed_by_user_id` role lawyer |
| Progression opportunity `qualified` | Lawyer |
| Detração days applied to snapshot | Lawyer |
| Excess execution pursued | Lawyer |
| HC thesis adopted | Lawyer |
| Piece approval and filing | Lawyer approve; filing human mark |
| Dismiss overdue legal deadline | Lawyer |
| ConflictRecord resolution | Lawyer |
| Playbook parameter changes affecting fractions | Admin + lawyer review (org policy) |

### 6.3 System MUST NEVER autonomously conclude

| Prohibited conclusion |
|------------------------|
| “Client is eligible for progressão” as fact |
| “Pena cumprida” / liberty release |
| “Indulto applies” without decree + lawyer qualify |
| “Detração = X days” as court-binding |
| “No excesso de execução” as definitive |
| “PAD defense is sufficient” |
| Court filing or protocol |
| Selection between conflicting legal interpretations |
| Override of confirmed snapshot with AI-only reasoning |

---

## 7. Historical replay

Replay answers legal-state questions from **immutable history** — SentenceSnapshot chain, ExecutionCustodySnapshot chain, TimelineEvent log, and confirmed Document pointers.

### 7.1 “What was the legal state on date X?”

**Algorithm (conceptual):**

1. Select `ExecutionCase` as of org timezone date X end-of-day unless event timestamps specify instant.
2. `SentenceSnapshot` = latest where `effective_at <= X` and `confirmed_at <= X` (if confirmation retroactive, use confirmation policy flag).
3. `ExecutionCustodySnapshot` = latest regime/unit where `effective_at <= X`.
4. `Interruption flags` = union of interruptions active on X from event history.
5. Return **ReplayBundle(legal_state_X)** — not the current snapshot.

### 7.2 “What did the office believe on date X?”

Office belief = **last confirmed snapshot before X** plus opportunities/deadlines **open on X** (from status history tables).

Includes:

- Opportunities in `qualified` or `pursuing` on X
- Pieces `approved` not yet `filed` on X
- Warnings active on X

Does **not** include unconfirmed OCR or AI suggestions never qualified.

### 7.3 “What changed after recalculation Y?”

Given `recalculation_event_id` or `new_snapshot_id`:

1. Load `supersedes_snapshot_id` chain.
2. Compute **delta** on `P_total`, `P_served`, `P_remicao`, `P_detração`, `P_remaining`, `F_served`.
3. List **canceled opportunities** (expired/dismissed by system rule) vs **new opportunities**.
4. List **deadline changes** spawned by recalculation.
5. Attach **ExplanationBundle** citing triggering event and documents.

### 7.4 Replay APIs (future implementation shape)

| Query | Output |
|-------|--------|
| `replayLegalState(case, date)` | ReplayBundle |
| `replayOfficeBelief(case, date)` | OfficeBeliefBundle |
| `diffSnapshots(old, new)` | SnapshotDelta |

All replay reads are **read-only**; logged in AuditLog for sensitive cases.

---

## 8. Explainability

Every rule-generated or AI-assisted engine conclusion MUST attach an **ExplanationBundle** (logical object; persisted as JSON on `AIAnalysis` and/or `Opportunity` / `EngineRun`).

### 8.1 ExplanationBundle structure (conceptual)

| Section | Content |
|---------|---------|
| `summary` | One paragraph plain language |
| `conclusion_type` | `opportunity` \| `deadline` \| `warning` \| `snapshot_proposal` |
| `playbook_version` | Id + effective date |
| `legal_rules_applied[]` | `{ rule_id, title, citation_ref }` |
| `calculations[]` | `{ name, inputs, output, confidence }` — **descriptive**, not code |
| `source_documents[]` | `{ document_id, field_paths, spans }` |
| `source_events[]` | `{ timeline_event_id, event_type }` |
| `missing_data[]` | `{ field, why_needed, severity }` |
| `uncertainty_indicators[]` | `{ code, message, affected_outputs }` |
| `blocking_codes[]` | If suppressed |
| `alternatives[]` | Other plausible interpretations when conflict exists |

### 8.2 Source documents

- Every date and quantity in calculations must link `document_id` + optional text span.
- OCR-derived fields marked `provenance=extraction` until confirmed.
- Confirmed fields marked `provenance=confirmed`.

### 8.3 Calculations (descriptive)

Present as human-readable steps, e.g.:

> “Pena total confirmada: 3.650 dias (Sentença, doc. 12). Dias remidos homologados: 120 (Certidão, doc. 45). Dias cumpridos em regime fechado: 890 (snapshot 2025-11-02). Fração para semiaberto (não hediondo, sem falta grave na janela): 16% — limiar playbook 16%.”

No executable code in stored explanations.

### 8.4 Legal rules applied

Rules reference **playbook rule ids** — versioned tables maintained by org/admin:

- `LEP_PROGRESSION_CLOSED_SEMI_V3`
- `LEP_FALTA_GRAVE_LOOKBACK_V2`
- `DECREE_INDULTO_2024_XMAS`

When statute interpretation diverges inside firm, playbook stores **branch** with lawyer-selected default — engine never picks branch silently.

### 8.5 Missing data

Explicit list drives UI checklist and assistant tasks:

| Severity | UX |
|----------|-----|
| `critical` | Blocks opportunity families |
| `recommended` | Allows `low` confidence suggest |
| `optional` | Informational only |

### 8.6 Uncertainty indicators

Map to §5 — surfaced as badges: `CONFLICT`, `LOW_OCR`, `PENDING_COURT`, `INTERPRETATION_BRANCH`.

### 8.7 AI-specific explainability

When `analysis_type` includes AI:

- `model_id`, `prompt_version` on AIAnalysis
- Citations required for each non-trivial claim
- `ai_generated: true` flag on any sentence in ExplanationBundle
- Lawyer “accept explanation” does **not** mean accept legal conclusion — separate actions

---

## 9. Engine outputs catalog

| Output | Persisted as | Binding |
|--------|--------------|:-------:|
| SentenceSnapshot proposal | New snapshot row `status=proposed` until confirmed | No |
| ExecutionCustodySnapshot proposal | Same | No |
| Opportunity candidate | Opportunity `suggested` | No |
| Deadline candidate | Deadline + origin | No until accepted |
| EngineWarning / EngineBlock | Case flags or child records | No |
| ConflictRecord | Case child | No |
| ExplanationBundle | Linked to all above | N/A |
| ReplayBundle | Computed on read | N/A |

---

## 10. Playbook governance

| Concern | Rule |
|---------|------|
| **Versioning** | Playbooks immutable once published; new version id for law changes |
| **Effective dates** | `effective_from` / `effective_to` on playbook version |
| **Recompute policy** | Changing playbook does not rewrite old snapshots; optional “what-if” mode for lawyers |
| **Audit** | Playbook publish → AuditLog |
| **Testing** | Golden cases (anonymized) per playbook version — out of scope for this doc but required before prod |

---

## 11. Integration with data model

| data-model-v1 entity | Engine usage |
|----------------------|--------------|
| SentenceSnapshot | Arithmetic state |
| ExecutionCustodySnapshot | Regime/unit |
| TimelineEvent | Event processor input |
| Document / DocumentExtraction | Provenance + confidence |
| Opportunity / Deadline | Outputs |
| AIAnalysis | Stores ExplanationBundle + AI metadata |
| AuditLog | Replay access, confirmations |

---

## 12. Document control

| Version | Date | Notes |
|---------|------|-------|
| 0.1 | 2026-05-16 | Initial legal-temporal engine specification |

**Conflict resolution:**

| Topic | Winning doc |
|-------|-------------|
| Domain events & opportunity types | `execution-workflows.md` |
| Storage & immutability | `data-model-v1.md` |
| Roles & permissions | `functional-architecture.md` |
| Arithmetic semantics & replay | **this document** |

**Next step:** Define playbook rule catalog schema (separate doc) → then implementation design for rule evaluator workers — not before golden test cases exist.
