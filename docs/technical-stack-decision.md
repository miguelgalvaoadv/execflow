# EXECFLOW — Technical Stack Decision

**Version:** 0.1 (binding)
**Status:** Pre-implementation architectural decision record.

**Grounded in:**
- `event-state-architecture.md` — event model, outbox pattern, state machines, audit requirements
- `data-model-v1.md` — entity catalog, immutability rules, temporal design, scale assumptions
- `execution-engine.md` — engine principles, snapshot model, ExplanationBundle
- `office-operating-system.md` — queue model, SLA, scale targets (200–2,000 active cases)
- `playbook-system.md` — versioned rule governance
- `project-governance/IMPLEMENTATION_ORDER.md` — phase sequence
- `project-governance/ENGINEERING_PRINCIPLES.md` — append-only, explainability, LGPD
- `project-governance/ARCHITECTURE_RULES.md` — forbidden shortcuts, layer discipline

**Purpose:** Lock the technical stack for EXECFLOW before Phase 1 implementation. Every choice is evaluated against the specific architectural requirements of a temporal legal platform — not against generic SaaS benchmarks.

**Note on IMPLEMENTATION_ORDER.md:** That document references "Prisma" in Phase 1. This document supersedes that reference. The recommended ORM is **Drizzle** — see §3 for the full rationale.

---

## Evaluation criteria

Every recommendation in this document is evaluated against these domain-specific criteria:

| Criterion | Why it matters in EXECFLOW |
|-----------|---------------------------|
| **Transactional audit writes** | AuditLog must be co-committed with every state change — synchronous, same transaction |
| **Append-only compatibility** | No ORM magic that silently issues `UPDATE` on immutable fields |
| **Temporal query support** | Reconstructing state at time X requires range queries over `created_at`, `superseded_at`, `effective_from` |
| **Explicit SQL generation** | Legal system; unexpected queries are dangerous — transparency over convenience |
| **TypeScript-native** | Monorepo shares types across frontend, API, engine, and workers |
| **Long-running worker support** | Engine runs, OCR jobs, and notification workers are not serverless-compatible |
| **Auditability of AI outputs** | AI provenance must be traceable end-to-end with model IDs, playbook versions, input refs |
| **LGPD compliance posture** | Data residency, third-party data processors, access logging |
| **Operational reliability** | Liberty is at stake; platform unavailability has legal consequences |

---

## 1. Frontend architecture

### 1.1 Framework: Next.js App Router

**Recommendation:** Retain and deepen Next.js 15+ App Router (`apps/web`).

**Rationale:**

The frontend shell is already built on Next.js App Router. This is not just path-of-least-resistance — it is the correct choice for this system:

- React Server Components (RSC) allow dashboard queue data to be fetched server-side without a client round-trip. Queue counts and case summaries are rendered at the edge before hydration.
- App Router's nested layouts map cleanly to the case workspace structure (global layout → dashboard layout → case workspace → tab content).
- TypeScript-first, shared via the monorepo `packages/types` package.

**RSC boundary rules:**

| Component | Rendering | Reason |
|-----------|-----------|--------|
| Queue lists, case headers, timeline view | Server component | Data fetched at render; no interactivity needed |
| Queue item actions (approve, qualify, dismiss) | Client component | Event handlers required |
| Interrupt strip | Client component | Real-time updates via WebSocket |
| Piece editor | Client component | Rich text editing |
| ExplanationBundle expand/collapse | Client component | Toggled state |
| Forms (intake, note compose) | Client component | Controlled inputs |

The rule: server components for data display; client components only when user interaction or real-time subscription is required.

**Forbidden RSC patterns:**
- No `"use client"` on layout.tsx or top-level page.tsx — this disables RSC for the entire subtree
- No client-side data fetching with `useEffect` for data that could be server-rendered
- No business logic (permission checks, opportunity evaluation) in any component

### 1.2 Monorepo strategy

**Recommendation:** Turborepo with pnpm workspaces.

```
execflow/
  apps/
    web/          ← Next.js (existing)
    api/          ← Hono API server
  packages/
    db/           ← Drizzle schema + client
    engine/       ← Legal-temporal engine
    playbooks/    ← Playbook runtime
    types/        ← Shared TypeScript types (no runtime)
    workers/      ← Background job definitions
  infrastructure/
```

**Why Turborepo:**
- Task caching across packages (type-check `packages/types` once, cache for all consumers)
- Dependency-aware build order (db before engine before api)
- No additional framework learning curve; Turborepo is configuration, not code

**Why pnpm:**
- Strict node_modules prevents phantom dependency bugs across packages
- Workspace protocol (`workspace:*`) enforces local package resolution
- Faster installs than npm at monorepo scale

### 1.3 State management strategy

**Recommendation:** TanStack Query for server state + Zustand for UI state. No Redux, no Context for data.

| State type | Tool | Examples |
|------------|------|---------|
| Server data (queues, cases, opportunities) | TanStack Query | Queue counts, case workspace data, opportunity lists |
| Form state | React Hook Form | Intake forms, piece editor metadata |
| UI-only state (sidebar open, active panel, modal visibility) | Zustand | Global UI store, deep-work mode, current case anchor |
| Real-time queue updates | TanStack Query + WebSocket invalidation | Queue badge count updates |

**Why not Context + useReducer for server data:** Context re-renders all consumers on update. At queue scale (hundreds of items across tabs), this is a performance problem.

**Why not Redux:** Adds ceremony without adding legal-domain value. The system is not a complex client-side state machine — it is a server-state display surface with local UI state.

**Why TanStack Query:** Stale-while-revalidate is ideal for queue views. Cache invalidation on mutation is the correct pattern for "user approves item → queue re-fetches." Background refetch keeps queue counts accurate without polling loops.

### 1.4 Real-time update approach

**Recommendation:** Server-Sent Events (SSE) for queue count updates and interrupt strip; WebSocket for future real-time collaboration.

**Why SSE before WebSocket:**
- Queue count invalidation and interrupt strip updates are **server-to-client only** — SSE is sufficient
- SSE works over HTTP/2; no separate infrastructure required
- WebSocket requires persistent connection management at deployment level
- SSE can be added incrementally; WebSocket is a larger infrastructure change

**SSE scope for MVP:**
- Queue badge count updates per user role
- Interrupt strip item additions (liberty-critical events)
- "Case updated while you're viewing" notification (presence hint, not full presence)

**Escalation to WebSocket when:** collaborative piece editing is implemented (Phase 7+). At that point, bidirectional real-time is required.

---

## 2. Backend architecture

### 2.1 Modular monolith

**Recommendation:** A single `apps/api` process structured as a **modular monolith** — not microservices.

**Rationale:**

Microservices for a system at this stage would:
- Require distributed transaction management (AuditLog co-commit requirement becomes a network problem)
- Add inter-service latency to every legal state transition
- Require a service mesh before the legal engine is even built
- Spread domain knowledge across services before the domain is fully understood

The modular monolith delivers:
- Same-process transactions (AuditLog + state change in one `BEGIN...COMMIT`)
- Clear module boundaries that can be extracted to services later if needed
- Single deployment unit for early phases

**Module boundaries within the monolith:**

```
api/
  modules/
    auth/           ← Authentication + session
    org/            ← Organization, membership, roles
    intake/         ← Document ingestion, OCR triggering
    cases/          ← ExecutionCase, Client, SentenceSnapshot
    engine/         ← Engine trigger, EngineRun orchestration
    opportunities/  ← Opportunity lifecycle
    deadlines/      ← Deadline lifecycle
    pieces/         ← PieceDraft, PieceVersion, Filing
    notifications/  ← Notification routing
    queue/          ← Queue query layer
    audit/          ← AuditLog queries (read-only exports)
    admin/          ← Org config, playbook publishing
  shared/
    audit.ts        ← Audit write helper (used by all modules)
    events.ts       ← Outbox write helper
    permissions.ts  ← Role enforcement middleware
```

The modular structure enforces the layer discipline from `ARCHITECTURE_RULES.md §layer-separation` at the code level, not just architecturally.

### 2.2 API framework: Hono

**Recommendation:** Hono for `apps/api`.

**Why Hono over Express/Fastify/tRPC:**

| Criterion | Hono | Express | Fastify | tRPC |
|-----------|:----:|:-------:|:-------:|:----:|
| TypeScript-first | ✓ | ∼ | ✓ | ✓ |
| Request validation (Zod) | ✓ | manual | plugin | ✓ |
| Middleware composability | ✓ | ✓ | ✓ | limited |
| Edge + Node.js dual runtime | ✓ | ✗ | ✗ | ✗ |
| RPC types shared to frontend | via client | ✗ | ✗ | ✓ |
| Explicit route definitions | ✓ | ✓ | ✓ | ✓ |
| Worker-process deployment | ✓ | ✓ | ✓ | server only |

**Why not tRPC as the primary API framework:** tRPC couples the frontend too tightly to the API layer. EXECFLOW has separate worker processes and a legal engine that must call API-layer logic without a tRPC client. Hono gives standard HTTP routes that workers can call internally via function invocation, not HTTP.

**Why not Next.js API routes for the backend:** Next.js API routes are serverless by nature. EXECFLOW background workers (engine, ingestion, notification, SLA monitor) require persistent long-running processes. Serverless cold starts are incompatible with the transactional outbox relay worker.

**API style:** REST with structured request/response types shared via `packages/types`. Not GraphQL — GraphQL's flexible query model conflicts with the requirement for explicit, auditable server-side data access control.

### 2.3 Worker architecture

**Recommendation:** Separate worker processes as long-running Node.js daemons within the monorepo.

```
packages/workers/
  engine-worker.ts      ← Listens for snapshot.confirmed events; runs engine
  ingestion-worker.ts   ← Processes OCR jobs; runs AI extraction
  notification-worker.ts ← Dispatches notifications from outbox
  sla-monitor.ts        ← Cron-like; evaluates SLA breaches every 5 minutes
  outbox-relay.ts       ← Reads outbox table; publishes to internal event bus
```

Workers are deployed as separate processes on Fly.io (see §10), not as serverless functions. They share code from `packages/engine`, `packages/db`, and `packages/types`.

**Worker design requirements:**
- Each worker is idempotent (processes same event twice = same outcome)
- Each worker reads from the job queue (pg-boss) and writes output atomically
- Workers do not share mutable in-process state — they are stateless consumers
- Worker failure does not lose events (outbox + retry model from `event-state-architecture.md §9`)

### 2.4 Queue execution model

**Recommendation:** pg-boss (PostgreSQL-native job queue).

pg-boss provides:
- Job creation in the same PostgreSQL transaction as the state change (transactional outbox native)
- Exactly-once delivery semantics via PostgreSQL row locks
- Dead-letter queue as a PostgreSQL table
- Job retry with configurable backoff
- Cron-style scheduling for the SLA monitor
- No external infrastructure (Redis, RabbitMQ) required for Phase 1–6

**Scaling boundary:** pg-boss on PostgreSQL handles thousands of jobs per second per database. At 2,000 active cases with events generating jobs, this is well within range through Phase 8.

**Future migration path:** If job throughput exceeds PostgreSQL capacity (Phase 9+), pg-boss can be replaced by BullMQ on Redis without changing the worker code — the interface is the same.

---

## 3. Database layer

### 3.1 PostgreSQL

**Recommendation:** PostgreSQL 16+ as the sole operational database.

EXECFLOW's architecture requires:

- **ACID transactions** — AuditLog co-commit with state change (`event-state-architecture.md §1.3`)
- **Range queries over timestamps** — temporal replay (`execution-engine.md §7`, `event-state-architecture.md §10.5`)
- **Append-only enforcement** — via constraints and application-layer guards
- **Row-level security** — org-scoped data isolation (`ARCHITECTURE_RULES.md §M-01`)
- **JSON/JSONB columns** — ExplanationBundle payloads, snapshot calculation details
- **Full-text search** — client names, document content (supplemented by Meilisearch, §8)
- **Reliability under operational pressure** — legal deadlines cannot tolerate data loss

No NoSQL database is used. Document databases (MongoDB) offer no transactional audit guarantee. Key-value stores (Redis) are not used for legal state — only for optional caching and future job queue scaling.

**Hosted provider recommendation:** Neon (serverless PostgreSQL).

| Criterion | Neon | Supabase | Railway PG | Self-hosted |
|-----------|:----:|:--------:|:----------:|:-----------:|
| Database branching (dev/staging) | ✓ | ✗ | ✗ | ✗ |
| Autoscaling | ✓ | ✓ | ∼ | ✗ |
| Point-in-time recovery | ✓ | ✓ | ∼ | manual |
| pgvector | ✓ | ✓ | ✓ | manual |
| Direct connection (not pooler) | ✓ | ✓ | ✓ | ✓ |
| LGPD — EU region | ✓ | ✓ | ✓ | ✓ |
| Operational simplicity | high | high | medium | low |

Neon's **database branching** is directly valuable: each feature branch gets a database branch with the exact production schema and anonymized data. This eliminates "works in dev, fails in prod" schema bugs — critical for a legal system.

**Schema design requirements deriving from this decision:**

- All org-scoped tables include `organization_id` as a non-nullable column with a FK and index
- All append-only tables use generated UUIDs as PKs; no auto-increment (prevents enumeration)
- `AuditLog`, `TimelineEvent`, `SentenceSnapshot`, `Filing`, `PieceVersion` have no `deleted_at` column — deletion is architecturally impossible
- Tables with `status` columns use PostgreSQL enums (not varchar) to prevent invalid state strings
- All timestamps are `TIMESTAMPTZ` (UTC), never `TIMESTAMP`

### 3.2 ORM: Drizzle

**Recommendation:** Drizzle ORM, superseding the Prisma reference in `IMPLEMENTATION_ORDER.md`.

**Why Drizzle over Prisma for this specific system:**

| Criterion | Drizzle | Prisma |
|-----------|:-------:|:------:|
| Generated SQL is inspectable and predictable | ✓ | ∼ (can be opaque) |
| Raw SQL escape hatch without ORM friction | ✓ | ✗ (Prisma raw is clunky) |
| TypeScript inference without code generation | ✓ | ✗ (requires `prisma generate`) |
| Temporal range query expressiveness | ✓ | limited |
| Transaction API matches PostgreSQL semantics | ✓ | ∼ |
| Append-only enforcement (no unexpected UPDATEs) | explicit | requires discipline |
| JSON/JSONB query support | ✓ | limited |
| Schema lives in `packages/db` without a separate runtime | ✓ | ✗ (Prisma schema is not TypeScript) |
| Drizzle Kit migrations are plain SQL files | ✓ | ✗ (Prisma migrations are opaque) |

**The decisive argument:** In a legal system where "UPDATE on an immutable row" is an architectural defect, Drizzle's explicit model makes violations visible. Drizzle does not hide what SQL it generates. For temporal queries (§3.3), Drizzle's query builder handles date-range conditions more naturally.

**Migration strategy:**
- Drizzle Kit generates plain SQL migration files checked into version control
- Migrations are **forward-only** — no "down" migrations after Phase 1 production deployment
- Each migration is reviewed for correctness before merge, with the same scrutiny as legal document changes
- Migration files are named with timestamp + description: `0001_create_audit_log.sql`
- No `ALTER TABLE ... DROP COLUMN` on append-only tables after production data exists

### 3.3 Temporal data handling

Temporal queries are frequent and legally critical. The strategy:

**Pattern 1: Point-in-time snapshot query**
```
SELECT * FROM sentence_snapshots
WHERE case_id = $1
  AND created_at <= $as_of
  AND (superseded_at IS NULL OR superseded_at > $as_of)
ORDER BY created_at DESC
LIMIT 1
```

This query requires a **composite index** on `(case_id, created_at, superseded_at)`.

**Pattern 2: Timeline reconstruction**
```
SELECT * FROM timeline_events
WHERE case_id = $1
  AND occurred_at <= $as_of
ORDER BY occurred_at ASC
```

Index required: `(case_id, occurred_at)`.

**Pattern 3: Active deadline query**
```
SELECT * FROM deadlines
WHERE case_id = $1
  AND status NOT IN ('completed', 'dismissed')
  AND due_date <= $target_date
```

Index required: `(case_id, status, due_date)`.

These three patterns define the minimum required indexes. The full indexing strategy is documented in `data-model-v1.md §7`.

### 3.4 Append-only enforcement

Enforcement is at three layers:

1. **Schema layer:** No `ON UPDATE` cascades on append-only tables. Columns that must not change after creation use `DEFAULT` with no application update path.

2. **Application layer:** Drizzle table definitions for append-only entities expose no `.update()` method in the database client wrapper (`packages/db`). Attempts to call `update()` on `TimelineEvent`, `AuditLog`, `SentenceSnapshot`, `Filing`, `PieceVersion` fail at the TypeScript type level.

3. **Review layer:** Database migrations that add `UPDATE` paths to append-only tables are blocked in code review.

### 3.5 Audit storage

The `AuditLog` table design must support:
- High insert throughput (every state change produces a row)
- Append-only enforcement (no update, no delete)
- Fast org-scoped queries for compliance export
- Long-term retention (legal retention = years to decades)

**Storage strategy:**
- `AuditLog` lives in the operational PostgreSQL database for Phase 1–6
- As volume grows (Phase 8+), archive older records to cold storage (Cloudflare R2 as JSONL)
- Archive records remain readable via a separate archive query API
- The operational table holds the last N months (configurable); older records are archived, not deleted

### 3.6 Partitioning assumptions

For Phase 1, no table partitioning. PostgreSQL with proper indexing handles the MVP scale without it.

**When to add partitioning (not before Phase 8):**
- `TimelineEvent` partitioned by `(organization_id, occurred_at)` monthly or quarterly when row count exceeds 10M
- `AuditLog` partitioned similarly
- `Notification` partitioned by `created_at` with aggressive archival for old acknowledged records

Premature partitioning adds maintenance overhead without benefit at Phase 1–6 scale.

---

## 4. Event infrastructure

### 4.1 Transactional outbox

**Recommendation:** Custom `event_outbox` table in PostgreSQL, relayed by `outbox-relay` worker.

This is the pattern defined in `event-state-architecture.md §2.7`. The implementation:

```
event_outbox table:
  id            UUID PK
  event_type    text
  payload       JSONB
  created_at    TIMESTAMPTZ
  published_at  TIMESTAMPTZ nullable
  failed_at     TIMESTAMPTZ nullable
  retry_count   int default 0
  locked_until  TIMESTAMPTZ nullable
```

State change (in DB transaction):
1. Write state change to entity table
2. Write AuditLog record
3. Write outbox row — all three in `BEGIN...COMMIT`

After commit:
4. Outbox relay worker selects unpublished rows (with `SELECT ... FOR UPDATE SKIP LOCKED`)
5. Publishes to internal event bus (pg-boss job per event type)
6. Updates `published_at` on success; increments `retry_count` on failure

**Why not an external message broker (Kafka, RabbitMQ) from the start:**
- Adding a message broker before the system has a single deployed user introduces operational complexity that serves no purpose at Phase 1–6
- PostgreSQL outbox provides at-least-once delivery semantics sufficient for Phase 1–8
- The outbox relay is the migration path — when PostgreSQL outbox becomes a bottleneck, the relay worker switches to publishing to Kafka instead; no other code changes

### 4.2 Internal event bus: pg-boss

**Recommendation:** pg-boss as both the outbox relay target and the worker job queue.

The outbox relay publishes events as pg-boss jobs. Workers subscribe to specific job types. This gives:
- Exactly-once delivery per worker (pg-boss row lock)
- Automatic retry with exponential backoff
- Dead-letter queue as PostgreSQL table
- Job monitoring via SQL

### 4.3 Replay strategy

Replay as defined in `event-state-architecture.md §2.10` is a **database read operation**, not a re-execution of events through the event bus.

Replay uses the append-only entity tables directly — no event sourcing framework is required. EXECFLOW is event-driven in its write path, but replay is a temporal query over stored records, not a projection rebuild.

This distinction matters: full event-sourcing replay frameworks (Axon, EventStoreDB) add complexity that is not warranted here. The legal-state reconstruction is simpler — it is a set of SQL queries with date-range filters.

### 4.4 Idempotency handling

Each worker maintains a `processed_event_ids` check using pg-boss's built-in deduplication by job name + key. For events where deduplication key is the `entity_id + event_type + occurred_at`, pg-boss's `singletonKey` handles it natively.

### 4.5 Dead-letter handling

pg-boss routes failed jobs (after N retries) to a `pgboss.archive` table with failure metadata. Dead-letter items generate a passive notification to admin via the notification worker. Resolution requires human inspection and manual retry or discard — always visible, never silent.

---

## 5. Authentication and authorization

### 5.1 Recommendation: Better Auth

**Better Auth** over Clerk, Auth.js, or custom auth.

**Evaluation:**

| Criterion | Better Auth | Clerk | Auth.js |
|-----------|:-----------:|:-----:|:-------:|
| Self-hosted (data stays in your infra) | ✓ | ✗ | ✓ |
| TypeScript-native | ✓ | ✓ | ✓ |
| RBAC built-in | ✓ | ✓ | ✗ (manual) |
| Organization/tenant model | ✓ | ✓ | ✗ |
| Audit logging of auth events | ✓ | limited | ✗ |
| Impersonation (admin views as user) | ✓ (with audit) | ✓ (no audit) | ✗ |
| Session security | ✓ | ✓ | ✓ |
| LGPD: data in your database | ✓ | ✗ | ✓ |
| Operational simplicity | high | very high | medium |

**Why not Clerk:** Clerk stores user data (email, name, session metadata) on Clerk's servers in the US. For a Brazilian legal SaaS handling sensitive client data under LGPD, using a US-based auth-as-a-service introduces sub-processor complexity and potential data transfer issues. Better Auth stores all user data in your PostgreSQL database (Neon), under your control.

**Why not Auth.js (NextAuth):** Auth.js v5 lacks built-in organizational RBAC. Implementing `admin/lawyer/assistant` role enforcement at the org level requires significant custom code. Better Auth ships this as a first-class feature.

**Why not custom auth:** Cryptographic session management is not a competitive advantage for a legal operations platform. Custom auth introduces security risk without domain value.

**RBAC model:**
- Roles are org-scoped (`admin`, `lawyer`, `assistant`) per Better Auth's organizations plugin
- Roles are read by the API middleware on every request and used for permission enforcement
- The frontend only uses role data for UX rendering (show/hide buttons) — never for permission enforcement
- Role changes produce AuditLog entries (Better Auth's audit plugin)

**Impersonation safety:** Admin impersonation (for support purposes) requires an explicit audit trail. Better Auth's impersonation is surfaced as a distinct session type. Any action taken during an impersonation session is attributed to `actor_type=admin_impersonating`, never misattributed to the impersonated user.

---

## 6. File and document storage

### 6.1 Recommendation: Cloudflare R2

**R2 over S3 and Supabase Storage.**

| Criterion | Cloudflare R2 | AWS S3 | Supabase Storage |
|-----------|:-------------:|:------:|:----------------:|
| Egress cost | Free | Expensive | Moderate |
| S3-compatible API | ✓ | ✓ | ✓ |
| Object versioning | ✓ | ✓ | ✗ |
| Object Lock (immutability) | In progress / via API | ✓ | ✗ |
| Signed URL generation | ✓ | ✓ | ✓ |
| EU data residency | ✓ | ✓ | ✓ |
| CDN integration | ✓ (native Cloudflare CDN) | CloudFront (additional cost) | ✓ |
| LGPD compliance posture | good | good | good |

**Rationale:**
- Legal documents are large (PDFs, scans) and accessed frequently (during case review)
- S3 egress costs at document-heavy legal platform scale are prohibitive
- R2's egress-free model is directly cost-saving for this use case
- R2 is S3-API-compatible — if Object Lock is required for compliance, migration to S3 is a configuration change, not a code change

**Immutability enforcement for legal documents:**
- Each uploaded document generates a `checksum_sha256` stored in PostgreSQL at upload time
- R2 object versioning is enabled — overwriting an object creates a new version, not a deletion
- Application code never calls the `DeleteObject` API on legal document buckets
- Deletion protection via R2 bucket lifecycle policy: no object deletion during legal retention window (configurable, minimum 7 years)

**Signed URL strategy:**
- All document access uses pre-signed URLs with short TTL (15 minutes)
- Signed URL generation is a server-side operation, never client-side
- Signed URL access is logged (AuditLog: `document.accessed`, actor, timestamp, document_id)
- No permanent public URLs for any legal document

---

## 7. OCR and extraction pipeline

### 7.1 Recommendation: Azure Document Intelligence (primary) + Gemini (secondary)

**Evaluation:**

| Criterion | Azure Doc Intelligence | AWS Textract | Gemini Flash/Pro | Tesseract |
|-----------|:---------------------:|:------------:|:---------------:|:---------:|
| Portuguese legal document quality | **excellent** | good | good | poor |
| Form/table recognition | excellent | good | good | poor |
| Confidence scores per field | ✓ | ✓ | manual prompt | ✗ |
| Prison record / hand-typed forms | excellent | moderate | good | poor |
| Low-quality scan handling | good | good | moderate | poor |
| API latency | moderate | moderate | fast | local |
| Cost at legal document scale | moderate | moderate | low | free |
| Explainability | field-level confidence | field-level | requires prompting | ✗ |

**Why Azure Document Intelligence:**
- Best-in-class Portuguese language model quality (trained on Brazilian legal documents in the general model)
- Form recognition handles scanned certidões, guias de execução, and PAD decisions — structured tables that Textract handles poorly
- Per-field confidence scores map directly to EXECFLOW's confidence model (every extracted field needs a confidence level)
- Custom model training available: EXECFLOW can train an `azuredocint` custom model on common legal document types (sentença, certidão de remição) to improve accuracy over time

**Why add Gemini as secondary:**
- Azure Document Intelligence excels at structured extraction (forms, tables, named fields)
- Gemini Flash excels at **semantic extraction** — "extract the sentence date and total pena from this unstructured paragraph"
- Hybrid pipeline: Azure Document Intelligence first → if confidence on critical fields < threshold → Gemini re-extraction of specific spans
- Gemini extraction prompt is deterministic (same template per document class), making its outputs auditable

**Confidence handling (critical):**
- Every extracted field carries `confidence: high | medium | low | failed`
- Fields with `confidence=low` on critical paths block engine computation until human-confirmed
- OCR provider confidence values are normalized to EXECFLOW's four-level model at the extraction worker layer
- Confidence source (`azure_confidence: 0.94`, `gemini_extraction: manual_check`) is stored in `DocumentExtraction` payload

**Cost scaling:**
- Azure Document Intelligence is priced per page, not per document — multi-page PDFs are common
- Gemini re-extraction runs only on low-confidence fields, not full documents — reduces Gemini calls by ~70%
- OCR cost is treated as a variable operational cost, not a fixed infrastructure cost

---

## 8. Search architecture

### 8.1 Recommendation: PostgreSQL full-text (primary) + Meilisearch (document/timeline search)

**Evaluation:**

| Criterion | PostgreSQL FTS | Meilisearch | OpenSearch | pgvector |
|-----------|:-------------:|:-----------:|:----------:|:--------:|
| Process number exact lookup | excellent | good | good | not applicable |
| Client name fuzzy search | good | excellent | excellent | not applicable |
| Timeline event keyword search | good | excellent | excellent | not applicable |
| Document content search | poor | good | excellent | not applicable |
| Semantic/conceptual search | ✗ | ✗ | with plugins | excellent |
| Operational simplicity | very high | high | low | very high |
| Portuguese language support | good | excellent | excellent | not applicable |
| Typo tolerance | poor | excellent | good | not applicable |
| Real-time index updates | synchronous | near real-time | near real-time | synchronous |

**Tiered search strategy:**

**Tier 1 — PostgreSQL full-text (process numbers, CPF, client names):**
- Process number search is a **lookup**, not a search — exact match on indexed `execution_process_number` column
- CPF lookups are exact matches (indexed)
- Client name search uses `tsvector` with Portuguese language configuration
- No external dependency; synchronized with every write

**Tier 2 — Meilisearch (case content, document classes, timeline keywords):**
- Document content search (from confirmed OCR extractions)
- Timeline event keyword search
- Case-level keyword search (notes, arguments)
- Portuguese tokenization and typo tolerance
- Near-real-time index updates via the event outbox (on `document.confirmed`, `timeline_event.created`)

**Why not OpenSearch for MVP:**
- OpenSearch is operationally heavy (JVM, cluster management, separate infrastructure)
- Meilisearch handles the document and timeline search use case with far less operational overhead
- OpenSearch becomes relevant at tens of millions of documents — well beyond Phase 1–8 scale

**Why not pgvector for MVP:**
- Semantic search ("find cases similar to this argument") is a Phase 9+ feature
- pgvector is the right choice when that feature is implemented — as an extension to PostgreSQL, it requires no new infrastructure
- Do not add pgvector indexes before the semantic search use case is specified

**Search data separation:**
- Search indexes contain no sensitive personal data beyond what is already in the PostgreSQL query
- Full-text content (OCR extractions, notes) is indexed only at the `organization_id` level — no cross-org search
- LGPD consideration: Meilisearch runs as a self-hosted instance or in an EU-region managed service; not a third-party US SaaS

---

## 9. AI orchestration

### 9.1 Recommendation: Mastra

**Mastra** for AI agent orchestration over LangGraph, custom orchestration, or raw SDK calls.

**Evaluation:**

| Criterion | Mastra | LangGraph | Raw SDK | Custom |
|-----------|:------:|:---------:|:-------:|:------:|
| TypeScript-native | ✓ | ✗ (Python primary) | ✓ | ✓ |
| Human-in-the-loop primitives | ✓ | ✓ | ✗ | manual |
| Workflow step tracing | ✓ | ✓ | ✗ | manual |
| Deterministic workflow execution | ✓ | ✓ | ✗ | manual |
| Retry and error handling | ✓ | ✓ | ✗ | manual |
| Tool invocation with typed inputs | ✓ | ✓ | ✓ | manual |
| Audit record per step | via middleware | via callbacks | manual | manual |
| Event-driven workflow triggers | ✓ | ✓ | ✗ | manual |
| Monorepo integration | excellent | poor | good | good |
| Operational simplicity | high | medium | high | low |

**Why Mastra over LangGraph:**
LangGraph is the right tool for Python stacks. EXECFLOW is a TypeScript monorepo. A Python-primary AI orchestration layer would:
- Require a separate Python microservice running alongside the Node workers
- Break the type-sharing model (no shared types from `packages/types`)
- Add language boundary latency
- Create a second deployment target with different operational requirements

**Why Mastra over raw SDK calls:**
The `AI_BOUNDARIES.md` human gate model requires **explicit workflow steps with audit events at each step**. Implementing this with raw SDK calls requires building a workflow engine from scratch — retry logic, step tracing, human checkpoint routing, ExplanationBundle generation. Mastra provides these primitives.

**Why Mastra over custom orchestration:**
Custom orchestration is tempting because Mastra is a relatively young framework. The risk of betting on it must be weighed against the cost of building equivalent workflow primitives. Mastra's workflow model maps directly to EXECFLOW's agent model:

```
Mastra Workflow concept → EXECFLOW mapping
  Step                  → Agent action (extract, suggest, draft)
  Human input gate      → Human review checkpoint (AI_BOUNDARIES.md §mandatory-gates)
  Retry                 → Worker retry (event-state-architecture.md §9.3)
  Tracing               → AuditLog per step
  Tools                 → Database reads, playbook lookups, document retrieval
```

**Audit integration:**
Every Mastra workflow step that writes output must produce an `AuditLog` record. This is implemented as a Mastra middleware that wraps every step completion with an AuditLog write in the same transaction.

**Human checkpoint routing:**
Mastra's `suspend` primitive maps to EXECFLOW's human gate model: a workflow suspends after producing `suggested` output, waits for human qualification (a separate API call), then resumes with the confirmation. The suspended state is persisted in PostgreSQL — not in memory.

---

## 10. Infrastructure and deployment

### 10.1 Recommendation: Vercel (web) + Fly.io (API + workers) + Neon (database)

**Evaluation of deployment targets:**

| Target | Frontend | API server | Long-running workers | Managed PG | Operational cost |
|--------|:--------:|:----------:|:--------------------:|:----------:|:----------------:|
| Vercel | excellent | limited | ✗ | ✗ | low |
| Fly.io | ✗ | excellent | **excellent** | ✗ | medium |
| Railway | ✓ | good | good | good | low |
| AWS (ECS + RDS) | ✓ | excellent | excellent | excellent | high |
| Render | ✓ | good | good | good | low |

**Rationale for hybrid:**

**Vercel for `apps/web`:**
- Next.js + Vercel is the lowest-friction deployment for the frontend shell
- Edge caching for RSC pages; instant deploys
- Preview deployments per branch (integrates with Neon branch-per-PR strategy)

**Fly.io for `apps/api` and all workers:**
- Persistent processes — the non-negotiable requirement for `outbox-relay`, `engine-worker`, `sla-monitor`
- Machine-level autoscaling (not serverless cold starts)
- `fly scale count` is sufficient for Phase 1–8; no Kubernetes complexity
- Multi-region if needed for latency (future)
- Workers run as separate Fly apps from the API, sharing the Neon database

**Neon for PostgreSQL:**
- As evaluated in §3.1; database branching for development is the decisive feature
- Neon's autoscaling handles Phase 1–6 scale without manual instance sizing

**Why not Railway for everything:**
Railway is an attractive all-in-one option, but its worker process model is less mature than Fly.io for long-running persistent daemons. The SLA monitor must run continuously — not restart on demand.

**Why not AWS:**
AWS is the correct destination at scale (Phase 9+, multi-org, enterprise). At Phase 1–8 it adds: IAM complexity, VPC configuration, RDS setup, ECS task definitions, ALB configuration, and CloudWatch — all before a single legal case is tracked. The operational overhead delays building the actual legal engine. Migrate to AWS when the platform has paying customers and the operational complexity is justified.

### 10.2 Environment strategy

```
Production:  Vercel (web) + Fly.io (api, workers) + Neon (production branch)
Staging:     Vercel preview + Fly.io staging app + Neon staging branch
Development: local Next.js + local Hono + Neon dev branch per developer
```

Neon branches provide production-equivalent database schemas for every environment without data duplication or manual migration management.

---

## 11. Observability and auditability

### 11.1 Application tracing: OpenTelemetry + Sentry

**Recommendation:** OpenTelemetry for distributed tracing; Sentry for error tracking.

**Why OpenTelemetry:**
- Vendor-neutral — can route to Grafana, Datadog, or Honeycomb without instrumentation changes
- Traces span across API request → worker job → database query → AI agent step
- Trace context propagates through the event outbox (trace ID stored in outbox row)
- Every engine run carries a trace ID linkable back to the triggering API request

**Why Sentry:**
- First-class Next.js and Node.js integration
- Session replay for frontend debugging (access-controlled, LGPD-compliant)
- Performance monitoring without a separate APM tool
- Error grouping by route and worker type

**Trace correlation with legal records:**
Every API request carries a `request_id`. The `request_id` is stored in:
- The AuditLog `metadata` field for the actions in that request
- The pg-boss job `data` for jobs enqueued from that request
- The `EngineRun` record for engine runs triggered by that request

This links the OpenTelemetry trace to the legal audit trail — a support investigation can start from either end.

### 11.2 Structured logging: Pino

**Recommendation:** Pino for all Node.js processes.

Pino is the fastest structured JSON logger for Node.js. Log output is machine-parseable JSON, aggregated by Axiom or Logtail (both support EU data residency).

**Log levels and content:**

| Level | When | Contains |
|-------|------|---------|
| `error` | Unhandled exceptions, DLQ items, failed legal writes | trace_id, actor_id (no PII) |
| `warn` | Retry attempts, degraded-mode activations, SLA near-breach | entity_id, event_type |
| `info` | State transitions, engine run completions, notification dispatches | entity_id, organization_id, duration_ms |
| `debug` | Individual SQL queries, OCR job progress (non-production only) | stripped in production |

**LGPD requirement:** No PII (CPF, client name, prison record content) appears in application logs. Logs reference `entity_id` (UUID), not personal data. Log aggregation services receive only UUIDs.

### 11.3 Audit replay (legal reconstruction)

The legal audit trail lives in PostgreSQL — not in application logs. Reconstruction for legal or malpractice purposes is a **database query**, not a log replay:

```
Legal question: "Did the system notify lawyer X about case Y's overdue deadline on date Z?"

Query path:
  AuditLog where entity_type='notification' AND entity_id IN (
    SELECT id FROM notifications WHERE case_id=$case_id AND notification_type='deadline_overdue'
  ) AND occurred_at::date = $date
```

Application logs supplement this with latency, stack traces, and system health — they do not replace AuditLog as the source of legal truth.

### 11.4 AI provenance tracing

Every AI output is traceable via:

```
AI suggestion (Opportunity ID)
  → AIAnalysis record
    → Mastra workflow run ID (in AIAnalysis.metadata)
      → OpenTelemetry trace (via run ID)
        → Individual step spans (OCR read, playbook lookup, confidence evaluation)
    → EngineRun ID
      → PlaybookVersion ID
      → SentenceSnapshot IDs (inputs)
        → DocumentExtraction IDs
          → Document IDs (with R2 object keys)
```

This chain enables: "What exact model version, rules, and source documents produced this specific suggestion on this date?" — answerable from database records alone, without log inspection.

---

## 12. Explicitly rejected technologies

### 12.1 Prisma ORM

**Rejected.** See §3.2 for full rationale.

Summary: Prisma's code-generation model (`prisma generate`), opaque query generation, and limited temporal query expressiveness make it a poor fit for a system where every generated SQL statement has legal consequences. Drizzle's explicit, inspectable model is required here.

### 12.2 Supabase (as a platform)

**Rejected for backend architecture.** Supabase Storage may be acceptable as a fallback for R2, but Supabase as a platform is rejected.

Reasons:
- Supabase's BaaS model encourages **direct database access from the frontend** — exactly what `ARCHITECTURE_RULES.md §F-04` prohibits
- Supabase's Row Level Security is a partial substitute for proper service-layer permission enforcement, but it creates a dual enforcement model that is harder to audit
- Supabase's realtime model bypasses the event outbox pattern
- The platform abstractions (auth, storage, database, functions) create tight coupling that makes any component replacement difficult

Individual Supabase services (its managed PostgreSQL) could be used, but the Supabase client and BaaS patterns are explicitly excluded.

### 12.3 Serverless functions for workers

**Rejected.** Background workers in EXECFLOW are long-running persistent processes. Serverless functions (AWS Lambda, Vercel Functions, Cloudflare Workers) have:

- Cold start latency incompatible with the outbox relay (must be continuously polling)
- Maximum execution time limits incompatible with long engine runs on complex cases
- Stateless model incompatible with the pg-boss row lock pattern

The SLA monitor cron job could technically run serverless, but the inconsistency with the other workers creates maintenance confusion. All workers run on Fly.io as persistent processes.

### 12.4 GraphQL

**Rejected.** GraphQL's flexible client-driven query model conflicts with EXECFLOW's requirements:

- Arbitrary depth queries make access control auditing difficult (which fields were accessed?)
- N+1 query risk is higher without careful DataLoader implementation
- LGPD sensitive-field logging requires knowing exactly which fields were returned — GraphQL makes this non-trivial
- The API serves a known frontend (not a public API for third-party consumers) — REST with typed contracts is sufficient

### 12.5 Redis for primary state

**Rejected.** Redis is not used for any legal operational state in EXECFLOW. Session data and future job queue scaling may use Redis, but:

- Legal state (case status, snapshots, opportunities) lives in PostgreSQL only
- Redis persistence guarantees are not equivalent to PostgreSQL's ACID guarantees
- "Cache invalidation" for legal state is an unacceptable risk — stale cache of an opportunity or deadline has legal consequences

Redis is permitted for: ephemeral session caching, rate limiting, future BullMQ job queue scaling. Never for: entity state, AuditLog, or any data in the legal domain model.

### 12.6 MongoDB or NoSQL for the operational database

**Rejected.** The AuditLog co-commit requirement (`event-state-architecture.md §1.3`) requires ACID transactions across multiple tables. MongoDB's multi-document transaction support is technically available but historically less reliable under operational pressure than PostgreSQL's native ACID model.

The temporal query patterns (§3.3) require relational range queries with multi-column indexes. NoSQL document stores do not provide equivalent performance for these access patterns.

### 12.7 LangGraph (for AI orchestration)

**Rejected** as the primary AI orchestration layer. See §9 for full rationale.

LangGraph is an excellent tool in Python environments. In a TypeScript monorepo, it introduces a language boundary, a Python microservice, and loses the shared type model between `packages/types` and the AI agent layer.

### 12.8 Hardcoded legal logic in any application layer

**Rejected everywhere.** This is not a technology — it is a pattern. Any implementation that embeds a legal fraction, lookback period, or decree eligibility condition as a literal constant in application code (frontend, API, engine, or migration) violates `ARCHITECTURE_RULES.md §F-02` and `playbook-system.md §9`.

This includes:
- TypeScript constants with legal values
- Default values on database columns that represent legal thresholds
- Conditional branches based on hardcoded offense category strings
- Migration scripts that pre-populate legal rule values as fixed data

Legal rules live in `PlaybookVersion` records. They are loaded at runtime, not hardcoded.

### 12.9 Auto-generated CRUD APIs

**Rejected.** Tools that generate CRUD APIs directly from database schemas (Hasura, PostgREST, Supabase auto-API) expose the database model directly and:

- Bypass the service layer where state machine enforcement lives
- Cannot enforce the AuditLog co-commit requirement
- Cannot enforce role-based permission logic
- Cannot validate state machine transitions

EXECFLOW's API is hand-crafted at the service layer. Every endpoint is explicit, auditable, and enforces the state machine and permission model.

---

## 13. Stack summary

| Layer | Choice | Phase available |
|-------|--------|:--------------:|
| Frontend framework | Next.js 15+ App Router | Phase 0 ✓ |
| Frontend state | TanStack Query + Zustand | Phase 7 |
| Monorepo | Turborepo + pnpm workspaces | Phase 0.3 |
| API framework | Hono | Phase 2 |
| Database | PostgreSQL 16+ via Neon | Phase 1 |
| ORM | Drizzle ORM | Phase 1 |
| Job queue | pg-boss | Phase 3 |
| Event outbox | Custom PostgreSQL table + relay worker | Phase 3 |
| Auth | Better Auth | Phase 2 |
| File storage | Cloudflare R2 | Phase 3 |
| OCR — primary | Azure Document Intelligence | Phase 3 |
| OCR — secondary | Gemini Flash | Phase 3 |
| Search — operational | PostgreSQL FTS | Phase 3 |
| Search — content | Meilisearch | Phase 7 |
| AI orchestration | Mastra | Phase 8 |
| Deployment — web | Vercel | Phase 0 ✓ |
| Deployment — API + workers | Fly.io | Phase 2 |
| Error tracking | Sentry | Phase 2 |
| Tracing | OpenTelemetry | Phase 3 |
| Logging | Pino + Axiom/Logtail | Phase 2 |
| Real-time (MVP) | SSE | Phase 7 |
| Real-time (future) | WebSocket | Phase 7+ |
| Semantic search | pgvector | Phase 9 |
| AI-tier queue scaling | BullMQ on Redis | Phase 9+ |

---

## 14. Document control

| Version | Date | Notes |
|---------|------|-------|
| 0.1 | 2026-05-17 | Initial technical stack decision |

**Supersedes:** The Prisma reference in `IMPLEMENTATION_ORDER.md §1.1`. All other IMPLEMENTATION_ORDER.md phase sequencing remains valid.

**Next step:** Phase 0.3 — monorepo scaffold. Initialize `apps/api`, `packages/db`, `packages/engine`, `packages/playbooks`, `packages/types`, and `packages/workers` with the tooling defined in this document before any schema or business logic is written.
