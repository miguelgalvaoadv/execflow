# Local runtime boot — EXECFLOW

Use this checklist to run API + workers against a real PostgreSQL instance (Docker or Neon).

## 1. Database

**Docker (recommended for smoke tests):**

```bash
docker compose -f infrastructure/docker-compose.dev.yml up -d
```

**Connection string** (aligns with `apps/api/.env.example` and `packages/db/.env.example`):

```text
postgresql://execflow:execflow@localhost:5432/execflow
```

## 2. Environment files

| Package / app | File | Purpose |
|---------------|------|---------|
| `packages/db` | `.env.local` (copy from `.env.example`) | `db:migrate`, `db:seed` |
| `apps/api` | `.env.local` | API + Better Auth |
| `packages/workers` | `.env.local` (copy from `.env.example`) or export `DATABASE_URL` | Worker process + `pnpm smoke:runtime` |

Minimum for API: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`.

Workers only need `DATABASE_URL` (same DB as API).

## 3. Migrations

From repo root:

```bash
pnpm --filter @execflow/db db:migrate
```

Run once per empty database (or after new migrations land).

## 4. Seed (minimal org + admin + playbook)

```bash
pnpm --filter @execflow/db db:seed
```

Requires `DATABASE_URL` (e.g. `pnpm --filter @execflow/db exec env -- node -v` after setting `.env.local`). The script uses `tsx` via `pnpm`’s package script.

Seed also provisions **Better Auth** rows (`ba_user`, `ba_account`) for `admin@execflow.local` so HTTP sign-in works. Password:

- Set `EXECFLOW_SEED_AUTH_PASSWORD` (recommended), **or**
- Use the documented dev default referenced below / in `pnpm validate:http-engine` script comments (**do not use in shared environments**).

## 5. Start API

```bash
pnpm --filter @execflow/api dev
```

Default port **3001** (see `.env.example`).

## 6. Start workers (pg-boss + outbox relay)

In a second terminal:

```bash
pnpm --filter @execflow/workers dev
```

Uses the same `DATABASE_URL`. Ensure migrations have been applied (pg-boss creates its own tables on first run).

## 7. Smoke test (manual)

After seed + API up:

- Health: `GET http://localhost:3001/health`
- Authenticated routes require a real session (Better Auth); engine routes require org context.

For engine evaluation you still need domain data (e.g. `ExecutionCase`, confirmed snapshots) beyond the minimal seed; the seed supplies **playbook resolution** and **identity** only.

**Automated persistence smoke** (workers DB pool + engine commit path):

```bash
export DATABASE_URL=postgresql://execflow:execflow@localhost:5432/execflow
pnpm --filter @execflow/workers smoke:runtime
```

Creates/reuses smoke rows (`SMOKE-E2E-*`), runs `resolvePlaybookVersions` + `runEvaluation` + `commitEngineRun`, then asserts `engine_runs`, `engine_rule_traces`, and `explanation_bundles`.

## 8. HTTP auth → domain writes → engine evaluate (automated)

Uses **real** Better Auth cookies, org middleware (`X-Organization-Id`), and RBAC (`requireMinRole('lawyer')` on evaluate). Snapshot rows still require the bootstrap CLI (`db:snapshot:http-engine`) because there are **no** HTTP routes yet that insert confirmed sentence/custody snapshots.

Terminal A — API running (`pnpm --filter @execflow/api dev`). Terminal B:

```bash
export DATABASE_URL=postgresql://execflow:execflow@localhost:5432/execflow
export API_BASE=http://localhost:3001
export EXECFLOW_VALIDATE_ORIGIN=http://localhost:3000   # must match BETTER_AUTH_TRUSTED_ORIGINS
pnpm --filter @execflow/api validate:http-engine
```

Optional: `EXECFLOW_ORG_ID`, `EXECFLOW_AUTH_EMAIL`, `EXECFLOW_AUTH_PASSWORD` / `EXECFLOW_SEED_AUTH_PASSWORD`.

## Troubleshooting

- **Docker not running**: `docker compose ... up -d` fails until Docker Desktop (or the Docker daemon) is running; migrations and DB-backed smoke tests will fail with connection errors.
- **`db:seed` fails on unique constraint**: Seed targets a fresh DB or adjust slugs / labels.
- **Neon vs local**: Same `DATABASE_URL` pattern; workers use the same pool factory as the engine (`@execflow/db/client` — localhost uses native `pg`, remote Neon URLs use the Neon pool driver).

Architecture refs: `technical-stack-decision.md` §2–3, `event-state-architecture.md` §2.7.
