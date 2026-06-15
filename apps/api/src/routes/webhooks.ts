import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../lib/db.ts'
import { executionCases, timelineEvents, domainEvents } from '@execflow/db/schema'
import { eq } from 'drizzle-orm'
import { NotificationService } from '../services/notifications.ts'

export const webhooksRouter = new Hono()

const notifications = new NotificationService()

// ─────────────────────────────────────────────────────────────────────
// Schema para o Webhook da JUDIT API (formato real)
// ─────────────────────────────────────────────────────────────────────

const JuditWebhookSchema = z.object({
  response_id: z.string().optional(),
  request_id: z.string().optional(),
  origin_id: z.string().optional(),
  cached_response: z.boolean().optional(),
  lawsuit: z.object({
    cnj: z.string(),
    court: z.string().optional(),
    instance: z.number().optional(),
    jurisdiction: z.string().optional(),
    subject: z.string().optional(),
    status: z.string().optional(),
    steps: z.array(z.object({
      date: z.string(),
      type: z.string(),
      description: z.string(),
      attachments: z.array(z.object({
        id: z.string(),
        name: z.string(),
        url: z.string().optional(),
      })).optional(),
    })).optional(),
    parties: z.array(z.object({
      name: z.string(),
      role: z.string(),
      cpf_cnpj: z.string().optional(),
      lawyers: z.array(z.object({
        name: z.string(),
        oab: z.string().optional(),
      })).optional(),
    })).optional(),
  }).optional(),
})

// Schema legado simplificado para compatibilidade
const LegacyWebhookSchema = z.object({
  cnj: z.string(),
  movementDate: z.string(),
  movementType: z.string(),
  description: z.string(),
  court: z.string().optional(),
})

/**
 * POST /api/v1/webhooks/judit
 * Recebe webhooks da JUDIT API quando há novas movimentações processuais.
 * Suporta tanto o formato real da JUDIT quanto o formato legado simplificado.
 */
webhooksRouter.post('/judit', async (c) => {
  try {
    const body = await c.req.json()

    // Tenta o formato JUDIT real primeiro
    const juditParsed = JuditWebhookSchema.safeParse(body)

    if (juditParsed.success && juditParsed.data.lawsuit) {
      return await handleJuditWebhook(c, juditParsed.data)
    }

    // Fallback para formato legado
    const legacyParsed = LegacyWebhookSchema.safeParse(body)
    if (legacyParsed.success) {
      return await handleLegacyWebhook(c, legacyParsed.data)
    }

    return c.json({ error: 'Invalid webhook payload. Neither JUDIT nor legacy format matched.' }, 400)
  } catch (error: any) {
    console.error('[WebhookError]', error)
    return c.json({ error: 'Internal Server Error' }, 500)
  }
})

/**
 * POST /api/v1/webhooks/whatsapp
 * Webhook para receber mensagens de resposta do WhatsApp (Meta Cloud API).
 * Usado para verificação do webhook e processamento de respostas do advogado.
 */
webhooksRouter.get('/whatsapp', async (c) => {
  // Verificação do webhook pela Meta
  const mode = c.req.query('hub.mode')
  const token = c.req.query('hub.verify_token')
  const challenge = c.req.query('hub.challenge')

  const verifyToken = process.env['WHATSAPP_WEBHOOK_VERIFY_TOKEN'] || 'execflow-webhook-verify'

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[WhatsApp Webhook] Verificação bem-sucedida')
    return c.text(challenge || '', 200)
  }

  return c.text('Forbidden', 403)
})

webhooksRouter.post('/whatsapp', async (c) => {
  try {
    const body = await c.req.json()

    // Processa apenas mensagens recebidas
    const entries = body?.entry || []
    for (const entry of entries) {
      const changes = entry?.changes || []
      for (const change of changes) {
        const messages = change?.value?.messages || []
        for (const msg of messages) {
          console.log(`[WhatsApp Webhook] Mensagem recebida de ${msg.from}: ${msg.text?.body || msg.type}`)

          // Aqui pode processar respostas do advogado
          // Ex: "OK", "Visto", etc. para dar acknowledged em prazos
          if (msg.type === 'interactive') {
            const buttonId = msg.interactive?.button_reply?.id
            console.log(`[WhatsApp Webhook] Botão clicado: ${buttonId}`)
            // Futuro: processar ação do botão (acknowledge prazo, etc.)
          }
        }
      }
    }

    return c.json({ received: true })
  } catch (error: any) {
    console.error('[WhatsApp Webhook Error]', error)
    return c.json({ error: 'Internal Server Error' }, 500)
  }
})

// ─────────────────────────────────────────────────────────────────────
// Handlers internos
// ─────────────────────────────────────────────────────────────────────

async function handleJuditWebhook(c: any, data: z.infer<typeof JuditWebhookSchema>) {
  const lawsuit = data.lawsuit!
  const cnj = lawsuit.cnj

  // 1. Busca o caso interno pelo CNJ
  const cases = await db
    .select()
    .from(executionCases)
    .where(eq(executionCases.executionProcessNumber, cnj))

  if (cases.length === 0) {
    console.log(`[Webhook JUDIT] Processo ${cnj} não monitorado pelo ExecFlow. Ignorando.`)
    return c.json({ received: true, ignored: true })
  }

  const execCase = cases[0]

  // 2. Registra cada nova movimentação na timeline
  const newSteps = lawsuit.steps || []
  const createdEvents: string[] = []

  for (const step of newSteps) {
    const [newEvent] = await db
      .insert(timelineEvents)
      .values({
        organizationId: execCase.organizationId,
        executionCaseId: execCase.id,
        eventCategory: 'court',
        eventType: 'process_movement',
        occurredAt: new Date(step.date),
        summary: `Movimentação: ${step.type} - ${step.description}`,
        source: 'integration',
        actorType: 'system',
        actorId: 'judit-webhook',
      })
      .returning()

    if (newEvent) createdEvents.push(newEvent.id)
  }

  // 3. Emite evento de domínio para acionar avaliações
  if (createdEvents.length > 0) {
    await db.insert(domainEvents).values({
      id: crypto.randomUUID(),
      organizationId: execCase.organizationId,
      eventType: 'case.movements.received',
      aggregateId: execCase.id,
      aggregateType: 'execution_case',
      correlationId: crypto.randomUUID(),
      actorType: 'system',
      actorId: 'judit-webhook',
      occurredAt: new Date(),
      recordedAt: new Date(),
      payload: {
        executionCaseId: execCase.id,
        cnj,
        newEventIds: createdEvents,
        source: 'judit_webhook',
        cachedResponse: data.cached_response,
      },
      metadata: {
        source: 'judit_webhook',
        responseId: data.response_id,
        originId: data.origin_id,
      },
    })
  }

  // 4. Envia notificação WhatsApp
  if (newSteps.length > 0) {
    const latestStep = newSteps[newSteps.length - 1]
    await notifications.sendProcessUpdate(
      execCase.organizationId,
      execCase.id,
      cnj,
      latestStep!.type,
      latestStep!.description
    )
  }

  console.log(
    `[Webhook JUDIT] ✅ Processado ${newSteps.length} movimentações para ${cnj} (cached: ${data.cached_response})`
  )

  return c.json({
    received: true,
    eventsCreated: createdEvents.length,
    cached: data.cached_response,
  })
}

async function handleLegacyWebhook(
  c: any,
  data: z.infer<typeof LegacyWebhookSchema>
) {
  const { cnj, movementDate, movementType, description } = data

  // Busca caso pelo CNJ
  const cases = await db
    .select()
    .from(executionCases)
    .where(eq(executionCases.executionProcessNumber, cnj))

  if (cases.length === 0) {
    return c.json({ received: true, ignored: true })
  }

  const execCase = cases[0]

  // Registra na timeline
  const [newEvent] = await db
    .insert(timelineEvents)
    .values({
      organizationId: execCase.organizationId,
      executionCaseId: execCase.id,
      eventCategory: 'court',
      eventType: 'process_movement',
      occurredAt: new Date(movementDate),
      summary: `Movimentação Pública: ${movementType} - ${description}`,
      source: 'integration',
      actorType: 'system',
      actorId: 'judit-webhook',
    })
    .returning()

  // Notifica via WhatsApp
  await notifications.sendProcessUpdate(
    execCase.organizationId,
    execCase.id,
    cnj,
    movementType,
    description
  )

  return c.json({ received: true, eventId: newEvent.id })
}
