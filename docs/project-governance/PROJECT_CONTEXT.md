# EXECFLOW — Project Context

**Audience:** Every agent, engineer, or contributor working on this codebase.  
**Authority:** This document and all files in `/docs/project-governance/` take precedence over ad-hoc assumptions. Read the full `/docs/` corpus before implementing anything.

---

## What EXECFLOW is

EXECFLOW is an **operational workspace for criminal-execution law practice** (execução penal) in Brazil. It is not a generic case-management tool, not a document storage system, and not a legal research product.

Its domain is the daily operational execution of:

- Sentence progression (progressão de regime)
- Prison benefits (remição, detração, indulto, comutação)
- Procedural deadlines (prazos)
- Disciplinary incidents (PAD, sanções disciplinares)
- Sentence arithmetic (cálculo de pena, unificação, recálculo)
- Execution petitions (petições ao juízo da execução)

The system manages **hundreds to thousands of active execution cases** for law firms whose core practice is this domain. Every design, data, and engineering decision must be evaluated against this operational reality — not against generic SaaS patterns.

---

## Target users

| Role | Who they are | Primary need |
|------|-------------|-------------|
| **Lawyer** (`lawyer`) | Criminal-execution attorney responsible for case strategy and legal authority | Fast triage, clear decisions, approve without friction |
| **Assistant** (`assistant`) | Legal staff who prepare, intake, file, and manage tasks | High-volume processing with minimal errors |
| **Admin** (`admin`) | Office manager or senior partner | Org configuration, user management, overload visibility |

There are no "power users" who bypass the role model. There are no anonymous users. Liberty is at stake for the clients these lawyers represent.

---

## Operational philosophy

The system is a **command center, not a reporting tool**. It answers:

- What needs doing right now?
- What is at risk today?
- What can I clear without a lawyer's input?
- Where does a lawyer's decision unblock the most work?

Work flows through **named queues**. The dashboard surfaces the highest-priority queue items for each role. Browsing full lists of cases, documents, or clients is a secondary mode, not the default.

Source of truth: `office-operating-system.md §0` and `ux-flow-architecture.md §1`.

---

## Legal sensitivity

**Liberty is at stake.** This is not a metaphor. Incorrect arithmetic, missed deadlines, or misfiled petitions can affect a person's time in prison. This has two direct engineering implications:

1. **Human authority is non-negotiable.** No autonomous AI filing, no implicit legal approval, no auto-completion of legal obligations. See `AI_BOUNDARIES.md`.

2. **History must be replayable.** "What did the system believe on date X?" must always be answerable with traceable sources. See `data-model-v1.md §9.1` and `execution-engine.md §7`.

---

## Queue-first operational model

Every piece of work in EXECFLOW enters a **named queue** with defined:

- Entry conditions
- Exit conditions  
- Owner (role or pool)
- SLA
- Escalation rules

Queues defined in `office-operating-system.md §2`. Queue-driven UX flows defined in `ux-flow-architecture.md §4`.

The dashboard is a queue surface — not a feed, not a news stream, not a portfolio view.

---

## Human authority model

```
AI / Rule engine → proposes (candidates, suggestions, drafts)
Assistant        → prepares, triages, confirms extraction, files
Lawyer           → qualifies, approves, decides, dismisses critical
Admin            → governs org config, playbooks, user management
```

No step in this chain can be skipped for liberty-affecting actions. The full authority boundary specification is in `AI_BOUNDARIES.md` and `functional-architecture.md §5–6`.

---

## AI-assisted, never AI-autonomous

AI agents in EXECFLOW are **constrained actors** with specific, bounded outputs:

- `agent.ingestion` — parses documents, proposes metadata
- `agent.analysis` — suggests deadlines and opportunities
- `agent.drafting` — generates draft text for human review
- `agent.notifications` — routes alerts per defined rules

None of them approve, file, confirm arithmetic, or dismiss obligations. The full prohibition list is in `AI_BOUNDARIES.md`.

---

## Architecture corpus

| Document | Governs |
|----------|---------|
| `functional-architecture.md` | Roles, objects, workflows, permissions, business rules |
| `execution-workflows.md` | Domain operational flows, intake, piece pipeline |
| `data-model-v1.md` | Conceptual entity model, immutability, temporal design |
| `execution-engine.md` | Legal-temporal engine, sentence arithmetic, replay |
| `office-operating-system.md` | Queues, daily workflow, notifications, bulk ops |
| `playbook-system.md` | Legal rule versioning, interpretation branches |
| `ux-flow-architecture.md` | Interaction flows, navigation, cognitive load |
| `project-governance/` | **This layer — binding for all implementations** |
