import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../lib/db.ts'
import { executionCases, timelineEvents, domainEvents } from '@execflow/db/schema'
import { eq } from 'drizzle-orm'
import { NotificationService } from '../services/notifications.ts'
import { detectOpportunitiesFromMovements } from '../services/opportunity-detector.ts'

export const webhooksRouter = new Hono()

const notifications = new NotificationService()

// ─────────────────────────────────────────────────────────────────────
// Webhook do JUSBRASIL (motor único de tribunais)
// ─────────────────────────────────────────────────────────────────────

const JusbrasilMovementSchema = z.object({
  data: z.string().optional(),
  tipo: z.string().optional(),
  descricao: z.string().optional(),
  conteudo: z.string().optional(),
  complemento: z.string().optional(),
})

const JusbrasilCallbackSchema = z.object({
  event: z.string().optional(),
  tipo: z.string().optional(),
  numero_cnj: z.string().optional(),
  processo: z
    .object({
      numero_cnj: z.string().optional(),
      numero: z.string().optional(),
      tribunal: z.string().optional(),
    })
    .optional(),
  movimentacoes: z.array(JusbrasilMovementSchema).optional(),
  andamentos: z.array(JusbrasilMovementSchema).optional(),
})

/**
 * POST /api/v1/webhooks/jusbrasil
 * Recebe callbacks do Jusbrasil quando há nova movimentação processual.
 *
 * Fluxo:
 *   1. Identifica o caso pelo número CNJ.
 *   2. Salva cada nova movimentação na timeline.
 *   3. Emite case.movements.received (pipeline interno) + notifica o advogado.
 *   4. Dispara o detector de oportunidades por IA (Claude) sobre o texto novo.
 *
 * Segurança: valide a origem com o token configurado no painel do Jusbrasil
 * (header `X-Jusbrasil-Token` ou query param `token`, comparado a JUSBRASIL_WEBHOOK_TOKEN).
 */
webhooksRouter.post('/jusbrasil', async (c) => {
  try {
    const expectedToken = process.env['JUSBRASIL_WEBHOOK_TOKEN']
    if (expectedToken) {
      const got =
        c.req.header('X-Jusbrasil-Token') ||
        c.req.header('X-Webhook-Token') ||
        c.req.query('token')
      if (got !== expectedToken) {
        return c.json({ error: 'Invalid webhook token.' }, 401)
      }
    }

    const body = await c.req.json()
    const parsed = JusbrasilCallbackSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid Jusbrasil callback payload.' }, 400)
    }

    return await handleJusbrasilWebhook(c, parsed.data)
  } catch (error: any) {
    console.error('[Webhook Jusbrasil Error]', error)
    return c.json({ error: 'Internal Server Error' }, 500)
  }
})

// ─────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────

async function handleJusbrasilWebhook(
  c: any,
  data: z.infer<typeof JusbrasilCallbackSchema>
) {
  // Tolera campos numero_cnj em diferentes lugares do payload.
  const cnj =
    data.numero_cnj ||
    data.processo?.numero_cnj ||
    data.processo?.numero
  if (!cnj) {
    return c.json({ received: true, ignored: true, reason: 'sem numero_cnj' })
  }

  const cases = await db
    .select()
    .from(executionCases)
    .where(eq(executionCases.executionProcessNumber, cnj))

  const execCase = cases[0]
  if (!execCase) {
    console.log(`[Webhook Jusbrasil] Processo ${cnj} não monitorado. Ignorando.`)
    return c.json({ received: true, ignored: true })
  }

  // Aceita movimentacoes ou andamentos (nome varia entre versões da API).
  const movimentacoes = data.movimentacoes ?? data.andamentos ?? []
  const createdEvents: string[] = []
  const movementTexts: string[] = []

  for (const mov of movimentacoes) {
    const desc = mov.descricao || mov.complemento || mov.conteudo || mov.tipo || 'Atualização'
    const summary = `Movimentação: ${mov.tipo || 'Andamento'} - ${desc}`.substring(0, 255)
    const [newEvent] = await db
      .insert(timelineEvents)
      .values({
        organizationId: execCase.organizationId,
        executionCaseId: execCase.id,
        eventCategory: 'court',
        eventType: 'process_movement',
        occurredAt: mov.data ? new Date(mov.data) : new Date(),
        summary,
        source: 'integration',
        actorType: 'system',
        actorId: 'jusbrasil-webhook',
      })
      .returning()

    if (newEvent) createdEvents.push(newEvent.id)
    movementTexts.push(`${mov.tipo || 'Andamento'}: ${desc}`)
  }

  if (createdEvents.length > 0) {
    await db.insert(domainEvents).values({
      id: crypto.randomUUID(),
      organizationId: execCase.organizationId,
      eventType: 'case.movements.received',
      aggregateId: execCase.id,
      aggregateType: 'execution_case',
      correlationId: crypto.randomUUID(),
      actorType: 'system',
      actorId: 'jusbrasil-webhook',
      occurredAt: new Date(),
      recordedAt: new Date(),
      payload: {
        executionCaseId: execCase.id,
        cnj,
        newEventIds: createdEvents,
        source: 'jusbrasil_webhook',
      },
      metadata: { source: 'jusbrasil_webhook' },
    })
  }

  if (movimentacoes.length > 0) {
    const latest = movimentacoes[movimentacoes.length - 1]!
    await notifications.sendProcessUpdate(
      execCase.organizationId,
      execCase.id,
      cnj,
      latest.tipo || 'Andamento',
      latest.descricao || latest.complemento || latest.conteudo || 'Nova movimentação processual.'
    )
  }

  let oportunidadesCriadas = 0
  if (movementTexts.length > 0) {
    try {
      const result = await detectOpportunitiesFromMovements({
        organizationId: execCase.organizationId,
        executionCaseId: execCase.id,
        movements: movementTexts,
      })
      oportunidadesCriadas = result.oportunidadesCriadas
      if (oportunidadesCriadas > 0) {
        await notifications.sendProcessUpdate(
          execCase.organizationId,
          execCase.id,
          cnj,
          'Oportunidade detectada',
          `${oportunidadesCriadas} nova(s) oportunidade(s) sugerida(s) pela IA: ${result.titulos.join('; ')}`
        )
      }
    } catch (e) {
      console.warn('[Webhook Jusbrasil] Detector de oportunidades falhou:', e)
    }
  }

  console.log(
    `[Webhook Jusbrasil] ✅ ${movimentacoes.length} movimentações para ${cnj} (${oportunidadesCriadas} oportunidade(s) IA)`
  )
  return c.json({
    received: true,
    eventsCreated: createdEvents.length,
    opportunitiesCreated: oportunidadesCriadas,
  })
}
