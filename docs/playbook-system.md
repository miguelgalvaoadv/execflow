# EXECFLOW — Playbook System (Legal Rule Governance)

**Version:** 0.1 (conceptual)  
**Status:** Rule-governance layer — **not** executable code, **not** Prisma schema, **not** worker implementation.  
**Companions:** [`execution-engine.md`](./execution-engine.md), [`execution-workflows.md`](./execution-workflows.md), [`data-model-v1.md`](./data-model-v1.md), [`office-operating-system.md`](./office-operating-system.md), [`functional-architecture.md`](./functional-architecture.md).

**Purpose:** Define how **all legal parameters and interpretive choices** live outside application code — in **versioned, auditable playbooks** — so fractions, interruptions, decree matching, and opportunity conditions never become hardcoded constants that silently drift or cannot be replayed.

---

## 0. Design mandate

| Mandate | Meaning |
|---------|---------|
| **No hidden law in code** | Application code evaluates rules; it does not **define** legal thresholds. |
| **Version everything** | Every engine run cites `playbook_version_id` + `rule_id[]`. |
| **Publish is immutable** | Published playbook versions are frozen; changes = new version. |
| **Office owns interpretation** | Firm selects branches and policies within legal bounds — system records choice. |
| **AI does not legislate** | AI may propose playbook *test cases* or *draft rule text for human publish* — never auto-publish. |

### Position in the stack

```
┌─────────────────────────────────────────┐
│  Office Operating System                │  ← who works queues when
├─────────────────────────────────────────┤
│  Execution Engine                       │  ← evaluator runtime
├─────────────────────────────────────────┤
│  PLAYBOOK SYSTEM (this document)        │  ← what law/parameters mean
├─────────────────────────────────────────┤
│  Data model + confirmed facts           │  ← snapshots, events, documents
└─────────────────────────────────────────┘
```

---

## 1. What a playbook is

### 1.1 Definition

A **playbook** is a **versioned collection of legal and office-policy rules** that parameterize the execution engine for a defined **scope** (organization, jurisdiction, time period).

A playbook is **not**:

- Application source code with magic numbers
- A single JSON file edited in production without audit
- An AI prompt
- A comment in a lawyer’s head

A playbook **is**:

- A governed artifact with identity, version, publisher, effective dates, and test evidence
- The authoritative source for fractions, lookbacks, decree matrices, interruption effects, and opportunity eligibility **templates**
- Replayable: any historical engine output can answer “which playbook version applied?”

### 1.2 Versioned legal rule collections

| Concept | Description |
|---------|-------------|
| **Playbook family** | Logical product (e.g. `execflow-br-lep-default`) |
| **Playbook version** | Immutable published snapshot (`v2026.03.1`) |
| **Rule** | Atomic parameter or logic block inside a version |
| **Rule group** | Named bundle (e.g. `progression_fractions`, `decree_indulto_2024`) |

### 1.3 Office-specific legal interpretations

Brazilian law permits **reasonable interpretive ranges** (numerator/denominator of remição in progression, lookback after falta grave, etc.). The playbook encodes:

- **Statutory baseline** — conservative default aligned with majority jurisprudence
- **Office branches** — explicit alternates the firm chooses to adopt
- **Strategy profile** — optional mapping: office default = `conservative` \| `standard` \| `aggressive` (within branch bounds)

**Critical:** strategy affects **suggestions and checklists**, not binding court outcomes. Lawyer always qualifies opportunities.

### 1.4 Temporal validity

Each published version has:

| Field | Role |
|-------|------|
| `effective_from` | Inclusive start (instant or date in org TZ) |
| `effective_to` | Exclusive end; null = current until superseded |
| `supersedes_version_id` | Prior version chain |

**Engine selection rule:** for evaluation at instant `T`, use the published version where `effective_from <= T` and (`effective_to` is null or `T < effective_to`) and scope matches case.

**Law change mid-case:** new version applies **forward** from `effective_from`; does not rewrite SentenceSnapshots unless lawyer runs recalculation / what-if and confirms new snapshot.

### 1.5 Replay compatibility

| Question | Answer mechanism |
|----------|------------------|
| What rules applied on date X? | Resolve playbook version valid at X + office branch config valid at X |
| What if office changed branch last month? | Branch selection history stored per org (§5) |
| What if statute changed? | Use version effective at X, not current |

Replay stores on engine outputs:

- `playbook_version_id`
- `rule_ids_applied[]`
- `interpretation_branch_id` (if any)

### 1.6 Legal traceability

Every user-visible legal conclusion from the engine must trace:

```
Opportunity / Warning / Snapshot proposal
  → ExplanationBundle.legal_rules_applied[]
    → { rule_id, playbook_version_id, branch_id?, statute_citation_ref? }
```

Statute citations are **references** (law id + article pointer) — full text maintained in playbook metadata or external law library link, not copied into application code.

---

## 2. Playbook structure

### 2.1 Top-level envelope (conceptual)

| Field | Required | Purpose |
|-------|:--------:|---------|
| `playbook_id` | ✓ | Family identifier |
| `version_id` | ✓ | Immutable publish id |
| `version_label` | ✓ | Human semver or date label |
| `status` | ✓ | `draft` \| `review` \| `published` \| `retired` |
| `organization_id` | — | Null = platform template; set = org override pack |
| `jurisdiction_scope` | ✓ | See §2.3 |
| `effective_from` / `effective_to` | ✓ | Temporal validity |
| `published_at` | ✓ | When frozen |
| `published_by_user_id` | ✓ | Admin / legal lead |
| `parent_version_id` | — | Fork or supersession chain |
| `metadata` | ✓ | Title, description, changelog |
| `rule_groups[]` | ✓ | Container for rules |

### 2.2 Rule groups

Rule groups organize rules for maintenance, testing, and engine loading (partial evaluation).

| Group id (examples) | Contains |
|---------------------|----------|
| `progression_fractions` | Regime transition thresholds |
| `progression_interruptions` | Falta grave, escape, PAD freeze |
| `hediondo_modifiers` | Fraction multipliers, benefit blocks |
| `remission_counting` | Work/study credit rules |
| `detraction_rules` | CPP art. 387 application parameters |
| `decree_indulto` | Decree-specific matrices |
| `decree_comutacao` | Commutation matrices |
| `prescription_executory` | Executory prescription parameters |
| `interruption_effects` | Event → accrual effects |
| `opportunity_thresholds` | Confidence gates, blocking codes linkage |
| `office_sla_overrides` | Non-legal operational thresholds (optional pack) |

Groups are **versioned with the playbook** — not independently mutable after publish.

### 2.3 Rule ids

Each rule has a **stable semantic id** across versions where meaning is continuous:

| Pattern | Example |
|---------|---------|
| `{domain}.{concept}.{variant}` | `progression.closed_to_semi.fraction.general` |
| Decree-specific | `decree.indulto.2024_12_25.eligibility.violent` |

**Version-to-version:** same `rule_id` may change **value** or **parameters**; changelog must document deltas.

### 2.4 Jurisdiction scope

| Scope level | `jurisdiction_scope` value |
|-------------|--------------------------|
| Federal Brazil (default) | `BR-FED` |
| State variations (future) | `BR-SP`, `BR-RJ`, … |
| Court regional (future) | `BR-TJSP-REGION-3` |
| Organization custom | `ORG-{id}-OVERLAY` |

**Resolution order (conceptual):**

1. Platform base playbook for jurisdiction  
2. Org overlay playbook (if published) — overrides by rule_id match  
3. Case-level **lawyer override** (§5.4) — single-case exception with audit  

### 2.5 Offense categories

Rules may key off **offense taxonomy** attached to sentence lines:

| Category flag | Affects |
|---------------|---------|
| `hediondo` | Fractions, indulto eligibility |
| `violencia_domestica` | Playbook modifiers |
| `reincidencia` | Threshold increases |
| `organizado` | Future branches |
| `common` | Default track |

Taxonomy is **data on ExecutionCase/SentenceSnapshot**, not inferred by AI without confirmation.

### 2.6 Interpretation branches

See §5 — structure within rule or group:

| Field | Purpose |
|-------|---------|
| `branch_id` | Stable id |
| `label` | e.g. “STJ majority — remição no numerador” |
| `parameters` | Values for this branch |
| `is_default` | Office default at publish |
| `caution_level` | `standard` \| `elevated` \| `prohibited_without_partner_review` |

### 2.7 Metadata

| Metadata type | Content |
|---------------|---------|
| `changelog` | Human summary of version delta |
| `legal_references[]` | Statute/jurisprudence pointers |
| `author_notes` | Internal firm guidance |
| `test_pack_ids[]` | Golden cases that must pass before publish |
| `confidence_notes` | Known ambiguities |

### 2.8 Confidence / caution flags (per rule)

| Flag | Engine behavior |
|------|-----------------|
| `caution=low` | Normal suggestion |
| `caution=elevated` | Force lawyer review; assistant cannot triage away |
| `caution=informational_only` | Never create opportunity; checklist only |
| `requires_partner_review` | Managing lawyer ack for qualify |

These are **governance**, not OCR confidence (which is separate).

---

## 3. Rule categories (deep catalog)

Each category lists **typical parameters** (not code). Actual values live in published playbook versions.

### 3.1 Progression fractions (`progression_fractions`)

| Rule concept | Parameters |
|--------------|------------|
| Closed → semi-aberto | `fraction`, `denominator_basis`, `min_days_closed`, `remission_in_numerator` (branch) |
| Semi → aberto | `fraction`, `min_days_semi`, `compliance_conditions[]` |
| Livramento | `fraction`, `subjective_requirements_note` (informational) |
| Reincidência multiplier | `multiplier` or `additional_fraction` |
| Hediondo track | Separate fraction table id |

**Interruption interaction:** references `progression_interruptions` group.

### 3.2 Hediondo handling (`hediondo_modifiers`)

| Rule concept | Parameters |
|--------------|------------|
| Progression table selector | `table_id=hediondo` |
| Indulto block | `block_indulto`, `block_comutacao` |
| Livramento restrictions | Flags |
| Lookback extensions | Days |

### 3.3 Falta grave effects (`progression_interruptions` + `interruption_effects`)

| Rule concept | Parameters |
|--------------|------------|
| Lookback period | `days` |
| Progression accrual | `reset` \| `freeze` \| `none` (branch) |
| Day loss | Link to sanction event — may reference calculation rules |
| Livramento block duration | `days` |
| Opportunity suppression | `suppress_types[]` during lookback |

### 3.4 Remição counting (`remission_counting`)

| Rule concept | Parameters |
|--------------|------------|
| Work day credit ratio | e.g. days credited per day worked |
| Study hour ratio | Hours → day credit |
| Caps | Max per year |
| Homologation required | Boolean |
| Progression numerator | branch: include pending vs homologated only |

### 3.5 Indulto decree rules (`decree_indulto`)

| Rule concept | Parameters |
|--------------|------------|
| `decree_id` | Official decree identifier |
| `publication_date` | |
| Eligibility matrix | Offense flags × sentence remainder × sexo (if applicable per decree) × org policy |
| Exclusion list | Offense codes |
| Batch qualification allowed | Boolean + `requires_batch_owner` |
| Window | `eligible_from`, `eligible_to` |

Each decree is a **rule subgroup** — new decree = new subgroup in new playbook version (or overlay).

### 3.6 Comutação rules (`decree_comutacao`)

Same structure as indulto with commutation-specific outcome types (substitute penalty, remainder reduction).

### 3.7 Prescription interpretations (`prescription_executory`)

| Rule concept | Parameters |
|--------------|------------|
| Prescription period by sentence band | Years/days |
| Interrupting events list | Event types that reset clock |
| Branch: disputed interrupt | Conservative vs aggressive lists |
| Opportunity type linkage | `prescription` |

### 3.8 Interruption effects (`interruption_effects`)

Maps **timeline event types** → effects (execution-engine §2):

| Event type | Parameters |
|------------|------------|
| `disciplinary.sanction` | `progression_reset`, `day_loss_formula_ref` |
| `prison.escape` | `block_all_liberty_opportunities`, `freeze_accrual` |
| `benefit.revoked` | `regression_reset` |
| `sentence.unification` | `trigger_full_recalculation` |

### 3.9 Opportunity conditions (`opportunity_thresholds`)

Cross-cutting gates linking to engine blocking codes:

| Rule concept | Parameters |
|--------------|------------|
| Min confidence for suggest | Per `opportunity_type` |
| `insufficient_data` field set | Required fields list |
| `BLK_*` activation | Thresholds |
| PAD / escape / conflict overrides | |

### 3.10 Office policy variations (optional overlay)

Non-statutory operational parameters **must** live in playbook overlay, not scattered config:

| Example | Group |
|---------|-------|
| Progression suggest SLA | `office_sla_overrides` |
| Snapshot staleness days | `office_sla_overrides` |
| Default strategy profile | `office_policy` |

Distinguish **legal** vs **operational** groups in metadata to avoid accidental “legal” claims on SLA rules.

---

## 4. Versioning rules

### 4.1 Immutable published versions

| State | Mutability |
|-------|------------|
| `draft` | Editable |
| `review` | Editable by reviewers; locked for author |
| `published` | **Frozen** — no rule value changes |
| `retired` | Frozen; not selected for new runs |

Publish action:

1. Validation suite passes (§8)
2. Legal sign-off recorded
3. `published_at` set; content hash stored
4. AuditLog entry

### 4.2 Superseding versions

| Mechanism | Behavior |
|-----------|----------|
| New publish | `supersedes_version_id` → prior; prior `effective_to` set |
| Overlapping effective windows | **Forbidden** for same scope |
| Org overlay supersedes base | Overlay wins on rule_id collision only |

### 4.3 Replay using historical versions

| Replay type | Playbook resolution |
|-------------|-------------------|
| Legal state on date X | Version effective at X |
| Engine run record | Stored `playbook_version_id` on run |
| User asks “current vs then” | Diff two versions’ rule parameters |

Never use **current** playbook to re-interpret past confirmed snapshots without explicit lawyer “re-evaluate” action.

### 4.4 Migration behavior

When new version publishes:

| Artifact | Migration |
|----------|-----------|
| Open opportunities `suggested` | Re-evaluate async; mark `superseded_by_playbook` if rules changed |
| Open deadlines from `rule` origin | Re-evaluate; do not auto-dismiss legal deadlines |
| Confirmed snapshots | **Unchanged** |
| Queue items | Refresh labels/priority; no silent delete |

**Migration job** produces report: cases affected, opportunities expired, new suggests added.

### 4.5 “What-if” simulations

| Aspect | Rule |
|--------|------|
| **Purpose** | Lawyer explores alternate branch or hypothetical snapshot without persisting |
| **Playbook** | May use draft version or published + alternate branch |
| **Output** | SimulationBundle — not Opportunity/Deadline with binding status |
| **Storage** | Optional short-lived log; no Filing |
| **Labeling** | Must display **SIMULATION — NOT BINDING** |

What-if never writes `qualified` opportunities or confirms snapshots.

---

## 5. Interpretation branches

### 5.1 Divergent legal understandings

Playbook encodes **2+ branches** for contested questions:

| Topic | Example branches |
|-------|------------------|
| Remição in progression numerator | `include_homologated_only` vs `include_pending_cert` |
| Falta grave lookback start date | `sanction_date` vs `decision_date` |
| Detração scope | Strict CPP art. 387 vs extended office policy |

Each branch has `legal_references[]` and `risk_disclosure_text` for UI.

### 5.2 Office policy choices

At publish or org settings:

| Setting | Effect |
|---------|--------|
| `default_branch_per_rule_id` | Office-wide default |
| `strategy_profile` | Maps profile → branch set |
| `per_case_branch_override` | Lawyer selects with reason (audit) |

### 5.3 Conservative vs aggressive strategy

| Profile | Behavior |
|---------|----------|
| **Conservative** | Prefer branches that delay suggestions; higher `caution` flags |
| **Standard** | Default branches |
| **Aggressive** | Earlier eligibility windows where legally arguable — **elevated** warnings |

Strategy changes **suggestion timing**, not approval gates.

### 5.4 Lawyer overrides

| Override type | Scope | Audit |
|---------------|-------|-------|
| Single-case branch | One ExecutionCase | Required reason |
| Temporary decree qualification | Batch with decree_id | Batch owner |
| Waive missing data | One case | Lawyer only |

Overrides stored as **CasePlaybookContext** (logical object):

- `execution_case_id`
- `branch_overrides{ rule_id: branch_id }`
- `valid_until` optional
- `set_by_user_id`

Engine merges: case override > org overlay > base playbook.

### 5.5 Uncertainty tracking

When active branch has known dispute:

| Mechanism | Detail |
|-----------|--------|
| `interpretation_uncertainty=high` on rule | Forces `confidence` cap on outputs |
| ExplanationBundle | Lists alternate branch outcomes |
| ConflictRecord | If office split between lawyers on same case |

---

## 6. Safety and governance

### 6.1 Who may publish playbooks

| Role | Permissions |
|------|-------------|
| **Admin** | Publish org overlay; schedule migration |
| **Legal lead** (lawyer + flag) | Publish org overlay; approve base adoption |
| **Platform operator** (EXECFLOW) | Publish `BR-FED` base templates |
| **Assistant** | Read-only; propose draft edits via ticket |
| **Regular lawyer** | Case overrides only (§5.4) |

### 6.2 Review requirements before publish

| Gate | Requirement |
|------|-------------|
| **Dual review** | Author ≠ approver |
| **Legal reviewer** | Must be lawyer role |
| **Changelog** | Non-empty |
| **Test pack** | All linked packs pass (§8) |
| **Diff review** | Breaking changes highlighted vs superseded version |
| **Effective date** | Future-dated publish allowed with scheduler |

### 6.3 Audit requirements

| Event | Logged |
|-------|--------|
| Draft created / edited | AuditLog |
| Submitted for review | AuditLog |
| Published | AuditLog + immutable hash |
| Retired | AuditLog |
| Migration run | AuditLog + report id |
| Case branch override | AuditLog on ExecutionCase |

### 6.4 Rollback strategy

**Published versions are never deleted.** Rollback means:

| Action | Effect |
|--------|--------|
| **Publish previous version** as new version with new `effective_from` | Supersedes broken release |
| **Retire** broken version | Stops new selections |
| **Re-evaluate** open suggestions | Migration job |

No git-style rewrite of published content.

### 6.5 Validation before activation

| Validation | Blocks publish if failed |
|------------|-------------------------|
| Schema validation | Rule shape |
| Cross-rule consistency | e.g. fractions monotonic |
| Golden case suite | §8 |
| Referential integrity | All `rule_id` referenced exist |
| Jurisdiction scope clash | Overlapping windows |
| Prohibited aggressive without disclosure | Missing `risk_disclosure_text` |

---

## 7. Engine integration

### 7.1 Engine run playbook reference

Every **EngineRun** (logical) stores:

| Field | Purpose |
|-------|---------|
| `playbook_version_id` | Primary version |
| `overlay_version_id` | Org overlay if any |
| `case_context_id` | Overrides |
| `strategy_profile` | Resolved profile |
| `evaluated_at` | Instant |

Evaluator loads merged rule set **once per run** — deterministic.

### 7.2 Explanations cite rules

ExplanationBundle (execution-engine §8) must include for each calculation step:

```text
rule_id: progression.closed_to_semi.fraction.general
playbook_version: v2026.03.1
branch: remission_numerator_homologated_only
parameters: { fraction: 0.16, denominator_basis: P_total_unified }
```

### 7.3 Opportunities inherit rule provenance

| Opportunity field | Provenance |
|-------------------|------------|
| `playbook_version_id` | ✓ |
| `rule_ids_triggered[]` | ✓ |
| `branch_id` | ✓ |
| `decree_id` | For indulto/comutação |

Dismiss reason enums may include `playbook_ineligible` with cited rule.

### 7.4 Recalculations react to new playbooks

| Scenario | Behavior |
|----------|----------|
| New publish mid-day | Migration job schedules re-eval |
| Lawyer confirms new snapshot | Uses **current** published version at confirm instant |
| Replay historical | Uses version at historical instant |
| Conflict between snapshot and new rules | `recalculation` opportunity; never auto-change snapshot |

**Engine never auto-confirms** snapshot because playbook changed.

---

## 8. Testing philosophy

### 8.1 Golden legal cases

| Property | Requirement |
|----------|-------------|
| **Anonymized** | No real client names in repo |
| **Fixture completeness** | Sentence lines, events, documents as synthetic but realistic |
| **Expected outputs** | Opportunity yes/no, date windows, blocking codes |
| **Version pinned** | Each case declares `playbook_version_id` |

Golden cases are **versioned assets** linked from playbook `test_pack_ids[]`.

### 8.2 Replay tests

| Test | Assert |
|------|--------|
| Legal state on date X | Matches expected snapshot/regime |
| Office belief on date X | Matches expected open items |
| Engine run after publish | `rule_ids_applied` match expected |

### 8.3 Progression test matrices

Matrix dimensions:

| Dimension | Values |
|-----------|--------|
| Regime | fechado, semi, aberto |
| Hediondo | yes/no |
| Falta grave in window | yes/no |
| Remição | none/pending/homologated |
| Reincidência | yes/no |
| Branch | each branch id |

Expected: eligibility date or `blocked` with code.

### 8.4 Decree test packs

Per `decree_id`:

- Eligible / ineligible profiles
- Batch qualification dry-run counts
- Edge: remainder exactly on threshold

### 8.5 Edge-case simulations

| Case | Purpose |
|------|---------|
| Unification mid-progression | Fraction reset |
| Escape + recapture | Block then unblock |
| Overlapping parallel executions | No auto-merge |
| Conflicting planilhas | ConflictRecord |
| Low OCR critical dates | Insufficient data |

Simulations run in CI on **draft** playbooks; publish blocked until green.

---

## 9. Forbidden architecture

The following are **explicitly prohibited** in EXECFLOW implementation:

| Prohibition | Rationale |
|-------------|-----------|
| **Hardcoded legal fractions** in frontend or backend | Cannot replay or audit |
| **Silent rule mutation** in production DB without version bump | Destroys traceability |
| **Non-versioned legal logic** in feature flags | Same as hardcoding |
| **AI-only legal rule generation** without human publish | AI is not legislature |
| **Embedding statute text** only in code comments | Not machine-citable |
| **Auto-publish** playbook on decree detection | Requires legal review |
| **Per-developer “fix” constants** in hotfix deploy | Use emergency publish process |
| **Using current playbook for past Filing replay** | Misstates what office relied on |
| **Branch selection by AI** | Lawyer/org only |
| **Merging legal and SLA rules** without metadata distinction | Confuses liability |

**Allowed:** code contains **evaluator grammar** (if X then Y) where X and Y parameters come from playbook.

---

## 10. Future extensibility

### 10.1 State-specific rules

| Mechanism | Approach |
|-----------|----------|
| `jurisdiction_scope=BR-SP` | State overlay playbook |
| Case stores `jurisdiction_code` | Resolver picks stack |

### 10.2 Federal variations

Base `BR-FED` playbook + amendments; org overlays for firm stance.

### 10.3 Office-custom policies

`ORG-{id}-OVERLAY` version line independent of legal base — can ship SLA-only overlays without touching fractions.

### 10.4 Jurisprudential branches

| Extension | Model |
|-----------|-------|
| New branch per leading case | `branch_id` + `legal_references` |
| Deprecation | Branch marked `deprecated`; migration maps old → new |

### 10.5 Experimental simulation mode

| Feature | Guard |
|---------|-------|
| Draft playbook in sandbox | No notifications to clients |
| Compare branches side-by-side | SimulationBundle only |
| Promote draft to review | Normal governance |

### 10.6 External law library integration (future)

Playbook `legal_references[]` links to versioned statute corpus; playbook stores **parameter binding**, not full law text maintenance in app repo.

---

## 11. Logical entities (for data model phase)

Not Prisma — conceptual records to align with [`data-model-v1.md`](./data-model-v1.md) later:

| Entity | Role |
|--------|------|
| `PlaybookFamily` | `playbook_id` |
| `PlaybookVersion` | Published/draft payload + metadata |
| `RuleGroup` | Embedded or child |
| `Rule` | Embedded or child with `rule_id` |
| `InterpretationBranch` | Embedded in rule |
| `OrgPlaybookConfig` | Default branches, strategy profile |
| `CasePlaybookContext` | Per-case overrides |
| `EngineRun` | Links run to versions |
| `PlaybookMigrationRun` | Post-publish re-eval report |

---

## 12. Cross-reference matrix

| Document | Relationship |
|----------|--------------|
| `execution-engine.md` | Consumes playbooks; cites rules in explanations |
| `execution-workflows.md` | Opportunity types map to rule groups |
| `office-operating-system.md` | Bulk indulto requires `decree_id` in playbook |
| `functional-architecture.md` | Configurações module owns playbook admin |
| `data-model-v1.md` | `playbook_version` on Opportunity; future tables |

**Conflict resolution:** Playbook parameters win over hardcoded app defaults; **functional-architecture** wins on **who may approve/filing**; **execution-engine** wins on **arithmetic semantics** given playbook parameters.

---

## 13. Document control

| Version | Date | Notes |
|---------|------|-------|
| 0.1 | 2026-05-16 | Initial playbook system specification |

**Next steps (ordered):**

1. `playbook-schema-v1` — JSON/schema shape for rule payloads (separate doc)  
2. Golden case repository structure  
3. Prisma mapping for PlaybookVersion + EngineRun provenance  
4. Admin publish UI spec (operational, not visual design system)
