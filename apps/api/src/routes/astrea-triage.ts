/**
 * Astrea Triage Routes — manual resolution for e-mails the ingestion
 * pipeline could not match automatically (orphan: CNJ extracted but no
 * matching case; parse_failed: no CNJ extracted at all).
 *
 * This is the human-in-the-loop safety net referenced throughout the Astrea
 * design: nothing the IMAP poller reads is ever silently dropped — every
 * unmatched e-mail lands here until a lawyer/assistant resolves it.
 *
 * Mounted at /api/v1/astrea
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, or, isNull, desc } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireMinRole } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import { astreaEmailLogs, executionCases, timelineEvents, domainEvents } from '@execflow/db/schema'
import { NotificationService } from '../services/notifications.ts'
import { detectOpportunitiesFromMovements } from '../services/opportunity-detector.ts'
import { unprocessable } from '../lib/respond.ts'
import type { HonoVariables } from '../context/types.ts'

export const astreaTriageRouter = new Hono<{ Variables: HonoVariables }>()

astreaTriageRouter.use('*', authMiddleware, orgMiddleware)

const notifications = new NotificationService()

type ExtractedMovementLike = {
  cnj: string
  data?: string | null
  tipo?: string | null
  descricao?: string | null
}

// ---------------------------------------------------------------------------
// GET /api/v1/astrea/triage — list unresolved orphan/parse_failed e-mails
// ---------------------------------------------------------------------------

astreaTriageRouter.get('/triage', requireMinRole('assistant'), async (c) => {
  const { organization } = c.get('org')

  const rows = await db
    .select()
    .from(astreaEmailLogs)
    .where(
      and(
        eq(astreaEmailLogs.organizationId, organization.id),
        or(eq(astreaEmailLogs.status, 'orphan'), eq(astreaEmailLogs.status, 'parse_failed')),
        isNull(astreaEmailLogs.reviewedAt)
      )
    )
    .orderBy(desc(astreaEmailLogs.createdAt))
    .limit(200)

  return c.json({ data: rows })
})

// ---------------------------------------------------------------------------
// POST /api/v1/astrea/triage/:id/resolve — link to a case or dismiss
// ---------------------------------------------------------------------------

const ResolveSchema = z.union([
  z.object({ action: z.literal('link'), executionCaseId: z.string().uuid() }),
  z.object({ action: z.literal('ignore'), notes: z.string().max(2000).optional() }),
])

astreaTriageRouter.post('/triage/:id/resolve', requireMinRole('lawyer'), async (c) => {
  const logId = c.req.param('id')
  const { organization, domainUserId } = c.get('org')

  const body = await c.req.json().catch(() => null)
  const parsed = ResolveSchema.safeParse(body)
  if (!parsed.success) {
    return unprocessable(c, 'Corpo inválido.', { issues: parsed.error.issues })
  }

  const [log] = await db
    .select()
    .from(astreaEmailLogs)
    .where(and(eq(astreaEmailLogs.id, logId), eq(astreaEmailLogs.organizationId, organization.id)))
    .limit(1)

  if (!log) {
    return unprocessable(c, 'Registro de e-mail não encontrado.')
  }

  if (parsed.data.action === 'ignore') {
    await db
      .update(astreaEmailLogs)
      .set({
        reviewedAt: new Date(),
        reviewedByUserId: domainUserId,
        reviewNotes: parsed.data.notes ?? 'Marcado como não sendo uma movimentação processual.',
      })
      .where(eq(astreaEmailLogs.id, logId))
    return c.json({ data: { resolved: true, action: 'ignore' } })
  }

  // action === 'link'
  const [execCase] = await db
    .select()
    .from(executionCases)
    .where(and(eq(executionCases.id, parsed.data.executionCaseId), eq(executionCases.organizationId, organization.id)))
    .limit(1)

  if (!execCase) {
    return unprocessable(c, 'Caso não encontrado nesta organização.')
  }

  const movements = (Array.isArray(log.extractedData) ? log.extractedData : []) as ExtractedMovementLike[]
  const movementsForCase = movements.length > 0 ? movements : [{ cnj: log.extractedCnj ?? '', data: null, tipo: null, descricao: log.emailSubject }]

  const createdEventIds: string[] = []
  const movementTexts: string[] = []

  for (const m of movementsForCase) {
    const desc = m.descricao || m.tipo || 'Movimentação identificada manualmente a partir de e-mail do Astrea.'
    const summary = `Movimentação: ${m.tipo || 'Andamento'} - ${desc}`.substring(0, 255)

    const dup = await db
      .select({ id: timelineEvents.id })
      .from(timelineEvents)
      .where(
        and(
          eq(timelineEvents.executionCaseId, execCase.id),
          eq(timelineEvents.source, 'integration'),
          eq(timelineEvents.summary, summary)
        )
      )
      .limit(1)
    if (dup.length > 0) continue

    const [newEvent] = await db
      .insert(timelineEvents)
      .values({
        organizationId: execCase.organizationId,
        executionCaseId: execCase.id,
        eventCategory: 'court',
        eventType: 'process_movement',
        occurredAt: m.data ? new Date(m.data) : (log.emailReceivedAt ?? new Date()),
        summary,
        source: 'integration',
        actorType: 'user',
        actorId: domainUserId,
        sourceRefType: 'AstreaEmailLog',
        sourceRefId: log.id,
      })
      .returning()

    if (newEvent) {
      createdEventIds.push(newEvent.id)
      movementTexts.push(summary)
    }
  }

  if (createdEventIds.length > 0) {
    await db
      .update(executionCases)
      .set({
        monitoringStatus: execCase.monitoringStatus === 'sealed' ? 'sealed' : 'monitored',
        lastSyncedAt: new Date(),
      })
      .where(eq(executionCases.id, execCase.id))

    await db.insert(domainEvents).values({
      id: crypto.randomUUID(),
      organizationId: execCase.organizationId,
      eventType: 'case.movements.received',
      aggregateId: execCase.id,
      aggregateType: 'execution_case',
      correlationId: crypto.randomUUID(),
      actorType: 'user',
      actorId: domainUserId,
      occurredAt: new Date(),
      recordedAt: new Date(),
      payload: {
        executionCaseId: execCase.id,
        cnj: execCase.executionProcessNumber,
        newEventsCount: createdEventIds.length,
        source: 'astrea_triage_manual',
      },
      metadata: { source: 'astrea_triage_manual' },
    })

    try {
      const result = await detectOpportunitiesFromMovements({
        organizationId: execCase.organizationId,
        executionCaseId: execCase.id,
        movements: movementTexts,
      })
      if (result.oportunidadesCriadas > 0) {
        await notifications.sendProcessUpdate(
          execCase.organizationId,
          execCase.id,
          execCase.executionProcessNumber ?? '',
          'Oportunidade detectada',
          `${result.oportunidadesCriadas} nova(s) oportunidade(s) sugerida(s) pela IA: ${result.titulos.join('; ')}`
        )
      }
    } catch (e) {
      console.warn('[Astrea Triage] Detector de oportunidades falhou:', e)
    }
  }

  await db
    .update(astreaEmailLogs)
    .set({
      status: 'processed',
      matchedExecutionCaseId: execCase.id,
      timelineEventsCreated: createdEventIds.length,
      reviewedAt: new Date(),
      reviewedByUserId: domainUserId,
      reviewNotes: 'Vinculado manualmente pela tela de triagem.',
    })
    .where(eq(astreaEmailLogs.id, logId))

  return c.json({ data: { resolved: true, action: 'link', eventsCreated: createdEventIds.length } })
})
