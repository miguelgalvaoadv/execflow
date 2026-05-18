/**
 * Health check endpoint.
 *
 * GET /health → 200 { status: 'ok', ... }
 *
 * Used by:
 * - Fly.io health checks (determines if the instance receives traffic)
 * - Load balancers
 * - Uptime monitoring
 *
 * Does NOT require authentication — by design.
 * Does NOT expose sensitive environment details in production.
 */

import { Hono } from 'hono'

const healthRouter = new Hono()

healthRouter.get('/', (c) => {
  const isDev = process.env['NODE_ENV'] !== 'production'

  return c.json({
    status: 'ok',
    service: 'execflow-api',
    timestamp: new Date().toISOString(),
    ...(isDev
      ? {
          env: process.env['NODE_ENV'],
          version: process.env['npm_package_version'] ?? 'unknown',
        }
      : {}),
  })
})

export { healthRouter }
