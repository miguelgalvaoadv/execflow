/**
 * Daily sweep covering three independent health domains:
 *
 * 1. Astrea e-mail ingestion pipeline (same as before):
 *    (a) zero successful polls in 24h → IMAP down
 *    (b) no poll rows at all in 24h → worker not running
 *    (c) >50% orphan/parse_failed rate (min 3 emails) → Astrea changed template
 *    (d) zero emails in 48h despite IMAP working → notification disabled in Astrea
 *
 * 2. AASP webhook monitoring:
 *    Zero system_health_checks rows with checkType='aasp_webhook_received' in 48h,
 *    while AASP_WEBHOOK_TOKEN is configured → AASP may have stopped calling us.
 *
 * 3. Stale-case sweep:
 *    Cases stuck in documentFreshnessStatus='stale' for >7 days → alert office.
 *
 * Immediate auth-failure alerts are handled right inside astrea-email-sync.ts —
 * this sweep handles everything that doesn't need to interrupt the office instantly.
 */
import { systemHealthChecks, organizations, executionCases } from '@execflow/db/schema'
import { eq, gte, and, lt, isNotNull } from '@execflow/db/client'
import type { WorkersDb } from '../lib/db.ts'
import { sendAstreaHealthAlert } from '../integrations/astrea-health-alerts.ts'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export async function runSystemHealthSweep(db: WorkersDb): Promise<void> {
  const orgs = await db.select().from(organizations)

  for (const org of orgs) {
    const alerts: string[] = []

    const astreaAlerts = await evaluateAstreaEmailHealth(db, org.id)
    alerts.push(...astreaAlerts)

    const aaspAlerts = await evaluateAaspHealth(db, org.id)
    alerts.push(...aaspAlerts)

    const staleAlerts = await runStaleCaseSweep(db, org.id)
    alerts.push(...staleAlerts)

    if (alerts.length > 0) {
      console.warn(`[System Health Sweep] org=${org.id} alertas:`, alerts)
      await sendAstreaHealthAlert(alerts)
    }
  }

  console.log(`[System Health Sweep] Concluído para ${orgs.length} organização(ões).`)
}

// ─────────────────────────────────────────────────────────────────────────────
// (1) Astrea email pipeline
// ─────────────────────────────────────────────────────────────────────────────

async function evaluateAstreaEmailHealth(db: WorkersDb, organizationId: string): Promise<string[]> {
  const since24h = new Date(Date.now() - DAY_MS)
  const since48h = new Date(Date.now() - 2 * DAY_MS)

  const checks24h = await db
    .select()
    .from(systemHealthChecks)
    .where(
      and(
        eq(systemHealthChecks.organizationId, organizationId),
        eq(systemHealthChecks.checkType, 'astrea_email_poll'),
        gte(systemHealthChecks.createdAt, since24h)
      )
    )

  const alerts: string[] = []

  if (checks24h.length === 0) {
    alerts.push(
      '🛑 O verificador de e-mail do Astrea não rodou NENHUMA VEZ nas últimas 24 horas. Verifique se o processo "worker" está no ar (Render → execflow-workers).'
    )
    return alerts
  }

  const successes = checks24h.filter((c) => c.status === 'success')
  if (successes.length === 0) {
    const lastError = [...checks24h].reverse().find((c) => c.errorDetails)?.errorDetails
    alerts.push(
      `⚠️ Nenhuma verificação de e-mail do Astrea funcionou nas últimas 24 horas. Verifique ASTREA_IMAP_HOST/USER/PASS e se a senha de app do Gmail não expirou.${lastError ? ` Último erro: ${lastError}` : ''}`
    )
  }

  const totalFound = checks24h.reduce((s, c) => s + c.emailsFound, 0)
  const totalBad = checks24h.reduce((s, c) => s + c.emailsOrphan + c.emailsParseFailed, 0)
  if (totalFound >= 3 && totalBad / totalFound > 0.5) {
    alerts.push(
      `⚠️ ${totalBad}/${totalFound} e-mails do Astrea (${Math.round((100 * totalBad) / totalFound)}%) não puderam ser processados automaticamente nas últimas 24 horas. O Astrea pode ter mudado o formato do e-mail — revise a tela "Movimentações não identificadas" no ExecFlow.`
    )
  }

  const checks48hSuccess = await db
    .select()
    .from(systemHealthChecks)
    .where(
      and(
        eq(systemHealthChecks.organizationId, organizationId),
        eq(systemHealthChecks.checkType, 'astrea_email_poll'),
        eq(systemHealthChecks.status, 'success'),
        gte(systemHealthChecks.createdAt, since48h)
      )
    )
  const total48h = checks48hSuccess.reduce((s, c) => s + c.emailsFound, 0)
  if (checks48hSuccess.length > 0 && total48h === 0) {
    alerts.push(
      '🛑 ZERO e-mails recebidos do Astrea nas últimas 48 horas (mas a conexão IMAP está funcionando). Verifique se a notificação "todos os processos públicos do escritório" ainda está ativa dentro do painel do Astrea.'
    )
  }

  return alerts
}

// ─────────────────────────────────────────────────────────────────────────────
// (2) AASP webhook monitoring
// ─────────────────────────────────────────────────────────────────────────────

async function evaluateAaspHealth(db: WorkersDb, organizationId: string): Promise<string[]> {
  if (!process.env['AASP_WEBHOOK_TOKEN']) return []

  const since48h = new Date(Date.now() - 2 * DAY_MS)
  const rows = await db
    .select({ id: systemHealthChecks.id })
    .from(systemHealthChecks)
    .where(
      and(
        eq(systemHealthChecks.organizationId, organizationId),
        eq(systemHealthChecks.checkType, 'aasp_webhook_received'),
        gte(systemHealthChecks.createdAt, since48h)
      )
    )
    .limit(1)

  if (rows.length === 0) {
    return [
      '⚠️ Nenhuma intimação recebida da AASP nas últimas 48 horas (AASP_WEBHOOK_TOKEN está configurado). Verifique se o webhook está registrado corretamente em intimacaoapi-cadastro.aasp.org.br e se a URL da API está acessível.'
    ]
  }

  return []
}

// ─────────────────────────────────────────────────────────────────────────────
// (3) Stale-case sweep
// ─────────────────────────────────────────────────────────────────────────────

async function runStaleCaseSweep(db: WorkersDb, organizationId: string): Promise<string[]> {
  const since7d = new Date(Date.now() - 7 * DAY_MS)

  const staleCases = await db
    .select({
      id: executionCases.id,
      internalRef: executionCases.internalRef,
      executionProcessNumber: executionCases.executionProcessNumber,
      pendingCriticalMovementType: executionCases.pendingCriticalMovementType,
      pendingCriticalMovementSince: executionCases.pendingCriticalMovementSince,
    })
    .from(executionCases)
    .where(
      and(
        eq(executionCases.organizationId, organizationId),
        eq(executionCases.status, 'active'),
        eq(executionCases.documentFreshnessStatus as any, 'stale'),
        isNotNull(executionCases.pendingCriticalMovementSince as any),
        lt(executionCases.pendingCriticalMovementSince as any, since7d)
      )
    )

  if (staleCases.length === 0) return []

  const caseLines = staleCases
    .map((c) => {
      const cnj = c.executionProcessNumber ?? c.internalRef
      const tipo = (c as any).pendingCriticalMovementType ?? 'movimentação crítica'
      const since = (c as any).pendingCriticalMovementSince
        ? new Date((c as any).pendingCriticalMovementSince).toLocaleDateString('pt-BR')
        : '?'
      return `• ${cnj} — ${tipo} (desde ${since})`
    })
    .join('\n')

  return [
    `🛑 ${staleCases.length} caso(s) com autos desatualizados há mais de 7 dias. Nenhuma peça pode ser gerada até que os advogados façam upload dos autos novos:\n${caseLines}`
  ]
}
