/**
 * EXECFLOW API — Node.js server entry point.
 *
 * Starts the Hono application using @hono/node-server.
 * This file is only run in Node.js environments (development, Fly.io).
 * It is NOT imported by the app itself — that's app.ts.
 */

import { setDefaultResultOrder } from 'node:dns'
import { serve } from '@hono/node-server'
import app from './app.ts'

// IPv4-first: mesmo diagnóstico já feito pro cliente DataJud (packages/workers) —
// a rota IPv6 nessa infraestrutura trava/derruba conexões TLS pra alguns hosts
// externos. Lá o fix só cobre o processo do worker; a API roda em processo
// Node separado e nunca tinha essa correção — achado 08/07/2026 investigando
// "Connection error." reportado ao chamar a Anthropic (api.anthropic.com) a
// partir do processo da API em produção.
try {
  setDefaultResultOrder('ipv4first')
} catch {
  // Node < 17 não suporta — segue com o padrão.
}

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
