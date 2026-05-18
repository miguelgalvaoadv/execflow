/**
 * EXECFLOW API — Node.js server entry point.
 *
 * Starts the Hono application using @hono/node-server.
 * This file is only run in Node.js environments (development, Fly.io).
 * It is NOT imported by the app itself — that's app.ts.
 */

import { serve } from '@hono/node-server'
import app from './app.ts'

const port = Number(process.env['PORT'] ?? 3001)

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log({
      type: 'api_started',
      port: info.port,
      env: process.env['NODE_ENV'] ?? 'development',
      message: `EXECFLOW API listening on http://localhost:${info.port}`,
    })
  }
)
