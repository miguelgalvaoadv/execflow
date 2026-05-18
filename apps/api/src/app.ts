/**
 * EXECFLOW API — Hono application builder.
 *
 * This module exports the configured Hono app instance.
 * Separating app construction from server startup (index.ts) enables:
 * - Testing without starting a real HTTP server
 * - Integration testing with hono's testClient()
 * - Future: edge deployment with the same app instance
 *
 * ROUTE STRUCTURE:
 *   /health          → Public health check (no auth)
 *   /api/auth/**     → Better Auth protocol handler (no auth middleware)
 *   /api/v1/me/**    → Current user + session management (auth required)
 *   /api/v1/**       → Business routes (auth + org required) — added in Phase 3+
 *
 * GLOBAL MIDDLEWARE:
 * - Request ID injection (for trace correlation with AuditLog.requestId)
 * - Global error handler (catches uncaught errors in route handlers)
 * - No body size limits here — set at the reverse proxy (Vercel/Fly.io) level
 *
 * Architecture ref: technical-stack-decision.md §2.1 (Hono rationale),
 *                   ENGINEERING_PRINCIPLES.md §11 (observability).
 */

import { Hono } from 'hono'
import { healthRouter } from './routes/health.ts'
import { authRouter } from './routes/auth.ts'
import { clientsRouter } from './routes/clients.ts'
import { casesRouter } from './routes/cases.ts'
import { intakeRouter } from './routes/intake.ts'
import { documentsRouter } from './routes/documents.ts'
import { timelineRouter } from './routes/timeline.ts'
import { deadlinesRouter } from './routes/deadlines.ts'
import { opportunitiesRouter } from './routes/opportunities.ts'
import { queueRouter } from './routes/queue.ts'
import { engineRouter } from './routes/engine.ts'
import type { HonoVariables } from './context/types.ts'
import { internalError } from './lib/respond.ts'

const app = new Hono<{ Variables: HonoVariables }>()

// -------------------------------------------------------------------------
// Global: request ID injection
// -------------------------------------------------------------------------

/**
 * Inject a request ID for OpenTelemetry trace correlation.
 * Route handlers read this via c.req.header('X-Request-Id').
 * AuditLog.requestId and DomainEvent.metadata.requestId should use this value.
 *
 * Uses the incoming X-Request-Id header from reverse proxy if present,
 * otherwise generates a random one. This enables end-to-end trace correlation
 * through Vercel edge → Fly.io API → PostgreSQL.
 */
app.use('*', async (c, next) => {
  const existingId = c.req.header('X-Request-Id')
  const requestId = existingId ?? crypto.randomUUID()
  c.res.headers.set('X-Request-Id', requestId)
  await next()
})

// -------------------------------------------------------------------------
// Global: error handler
// -------------------------------------------------------------------------

/**
 * Catches any unhandled errors thrown inside route handlers.
 * Logs the error with context; returns a safe error response.
 * Never exposes stack traces in production.
 */
app.onError((err, c) => {
  const requestId = c.res.headers.get('X-Request-Id') ?? 'unknown'

  console.error({
    type: 'unhandled_route_error',
    requestId,
    error: err instanceof Error ? err.message : String(err),
    stack: process.env['NODE_ENV'] === 'development' && err instanceof Error
      ? err.stack
      : undefined,
    path: c.req.path,
    method: c.req.method,
  })

  return internalError(c, err)
})

// -------------------------------------------------------------------------
// Routes
// -------------------------------------------------------------------------

app.route('/health', healthRouter)
app.route('/api', authRouter)

// -------------------------------------------------------------------------
// Domain routes (Phase 4) — all require auth + org middleware (applied per router)
// -------------------------------------------------------------------------

app.route('/api/v1/clients', clientsRouter)
app.route('/api/v1/cases', casesRouter)
app.route('/api/v1/intake', intakeRouter)
app.route('/api/v1/documents', documentsRouter)
app.route('/api/v1/cases', timelineRouter) // timeline: /api/v1/cases/:caseId/timeline

// -------------------------------------------------------------------------
// Domain routes (Phase 5) — deadline and opportunity foundation
// -------------------------------------------------------------------------

app.route('/api/v1/deadlines', deadlinesRouter)
app.route('/api/v1/opportunities', opportunitiesRouter)

// -------------------------------------------------------------------------
// Domain routes (Phase 6) — queue engine and workflow orchestration
// -------------------------------------------------------------------------

app.route('/api/v1/queue-projections', queueRouter)
// workflow-tasks/:id/claim|release|complete are sub-routes on the queue router

// -------------------------------------------------------------------------
// Domain routes (Phase 7) — legal computation engine
// -------------------------------------------------------------------------

app.route('/api/v1/engine', engineRouter)

// -------------------------------------------------------------------------
// 404 handler — catches unmatched routes
// -------------------------------------------------------------------------

app.notFound((c) => {
  return c.json(
    { error: { code: 'NOT_FOUND', message: 'The requested endpoint does not exist.' } },
    404
  )
})

export default app
