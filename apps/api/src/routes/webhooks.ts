import { Hono } from 'hono'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { db } from '../lib/db.ts'
import {
  executionCases,
  timelineEvents,
  domainEvents,
  systemHealthChecks,
  organizations,
  courtCommunications,
  inventoryItems,
} from '@execflow/db/schema'
import { eq, and } from 'drizzle-orm'
import { NotificationService } from '../services/notifications.ts'
import { detectOpportunitiesFromMovements } from '../services/opportunity-detector.ts'
import { classifyInventoryItem } from '@execflow/engine'

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

// ─────────────────────────────────────────────────────────────────────
// Webhook da AASP — API de Intimações (push webhook)
// ─────────────────────────────────────────────────────────────────────
//
// Todos os campos do payload são marcados como opcionais porque o schema
// real da AASP só é confirmado com o primeiro payload real recebido.
// Assim que chegar a primeira intimação, ajustar os campos baseado no JSON.
// Os nomes aqui são SUPOSIÇÕES TOLERANTES — não remover variantes sem testar.
//
// Registro: intimacaoapi-cadastro.aasp.org.br
// Swagger:  apj.aasp.org.br

const AaspIntimacaoSchema = z.object({
  // CNJ — múltiplos nomes possíveis [VERIFICAR payload real]
  numeroProcesso: z.string().optional(),
  cnj: z.string().optional(),
  numero_processo: z.string().optional(),
  numProcesso: z.string().optional(),
  processo: z
    .object({
      cnj: z.string().optional(),
      numero: z.string().optional(),
      numeroProcesso: z.string().optional(),
    })
    .optional(),

  // Tipo e conteúdo da intimação [VERIFICAR payload real]
  tipoIntimacao: z.string().optional(),
  tipo: z.string().optional(),
  tipo_intimacao: z.string().optional(),
  conteudo: z.string().optional(),
  textoIntimacao: z.string().optional(),
  texto: z.string().optional(),
  intimacao: z
    .object({
      tipo: z.string().optional(),
      conteudo: z.string().optional(),
    })
    .optional(),

  // Data [VERIFICAR payload real]
  dataPublicacao: z.string().optional(),
  data_publicacao: z.string().optional(),
  dataIntimacao: z.string().optional(),
  data: z.string().optional(),
})

/**
 * POST /api/v1/webhooks/aasp
 * Recebe intimações da API de Intimações da AASP (push webhook).
 *
 * Fluxo:
 *   1. Guard: AASP_WEBHOOK_ENABLED=false → ignora sem erro (kill-switch operacional).
 *   2. Valida token de autenticação da AASP.
 *   3. Extrai CNJ (aceita múltiplos formatos enquanto schema real não é confirmado).
 *   4. Chama detectOpportunitiesFromMovements PRIMEIRO para obter criticalityTier.
 *   5. Insere timelineEvent WITH criticalityTier já setado (append-only — não pode atualizar).
 *   6. Se tier 1 ou 2: marca caso como 'stale' (trava geração de peças).
 *   7. Emite domainEvent + notificações + health_check row.
 *
 * Header de autenticação: X-AASP-Token [VERIFICAR após registro]
 */
webhooksRouter.post('/aasp', async (c) => {
  const startedAt = Date.now()
  let organizationId: string | null = null

  try {
    if (process.env['AASP_WEBHOOK_ENABLED'] === 'false') {
      return c.json({ received: true, ignored: true, reason: 'kill-switch' })
    }

    const expectedToken = process.env['AASP_WEBHOOK_TOKEN']
    if (expectedToken) {
      const got =
        c.req.header('X-AASP-Token') ||
        c.req.header('X-Webhook-Token') ||
        c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ||
        c.req.query('token')
      if (got !== expectedToken) {
        return c.json({ error: 'Invalid webhook token.' }, 401)
      }
    }

    const body = await c.req.json()
    const parsed = AaspIntimacaoSchema.safeParse(body)
    if (!parsed.success) {
      console.warn('[Webhook AASP] Payload inválido:', parsed.error.issues)
      return c.json({ error: 'Invalid AASP payload.', details: parsed.error.issues }, 400)
    }

    const d = parsed.data

    // Extract CNJ from any of the known field locations [VERIFICAR payload real]
    const cnj =
      d.numeroProcesso ||
      d.cnj ||
      d.numero_processo ||
      d.numProcesso ||
      d.processo?.cnj ||
      d.processo?.numero ||
      d.processo?.numeroProcesso

    if (!cnj) {
      console.log('[Webhook AASP] Payload sem CNJ identificável. Ignorando.')
      return c.json({ received: true, ignored: true, reason: 'sem CNJ identificável' })
    }

    const cases = await db
      .select()
      .from(executionCases)
      .where(eq(executionCases.executionProcessNumber, cnj.trim()))

    const execCase = cases[0] ?? null

    const tipo =
      d.tipoIntimacao || d.tipo || d.tipo_intimacao || d.intimacao?.tipo || 'Intimação'
    const conteudo =
      d.conteudo || d.textoIntimacao || d.texto || d.intimacao?.conteudo || ''
    const dataRaw = d.dataPublicacao || d.data_publicacao || d.dataIntimacao || d.data
    const occurredAt = dataRaw ? new Date(dataRaw) : new Date()

    // ── ANTI-PERDA: TODA intimação recebida vira uma court_communication —
    // processada (caso encontrado), vinculada ao inventário, ou ÓRFÃ para
    // triagem manual. Nada é descartado silenciosamente.
    if (!execCase) {
      const orphanResult = await recordOrphanCommunication({
        cnj: cnj.trim(),
        tipo,
        conteudo,
        occurredAt,
        dataRaw: dataRaw ?? '',
        rawPayload: body,
      })
      await insertAaspHealthCheck(orphanResult.organizationId, 'success', Date.now() - startedAt)
      console.log(
        `[Webhook AASP] Processo ${cnj} sem caso — intimação registrada como ${orphanResult.status} para triagem.`
      )
      return c.json({ received: true, orphan: true, communicationStatus: orphanResult.status })
    }
    organizationId = execCase.organizationId

    const movimentacaoTexto = `${tipo}: ${conteudo}`.substring(0, 1000)
    const summary = `Intimação AASP: ${tipo} - ${conteudo}`.substring(0, 255)

    // ── Detect opportunities FIRST (we need criticalityTier before inserting timeline event)
    let criticalityTier: '1' | '2' | '3' | null = null
    let oportunidadesCriadas = 0
    let oppTitulos: string[] = []
    try {
      const oppResult = await detectOpportunitiesFromMovements({
        organizationId: execCase.organizationId,
        executionCaseId: execCase.id,
        movements: [movimentacaoTexto],
      })
      criticalityTier = oppResult.criticalityTier
      oportunidadesCriadas = oppResult.oportunidadesCriadas
      oppTitulos = oppResult.titulos
    } catch (e) {
      console.warn('[Webhook AASP] Detector de oportunidades falhou:', e)
    }

    // ── Insert timeline event WITH criticalityTier already set (append-only table)
    const [newEvent] = await db
      .insert(timelineEvents)
      .values({
        organizationId: execCase.organizationId,
        executionCaseId: execCase.id,
        eventCategory: 'court',
        eventType: 'process_movement',
        occurredAt,
        summary,
        source: 'integration',
        actorType: 'system',
        actorId: 'aasp-webhook',
        criticalityTier,
      })
      .returning()

    // ── Mark case as stale if movement is tier 1 or 2
    if (criticalityTier === '1' || criticalityTier === '2') {
      await db
        .update(executionCases)
        .set({
          documentFreshnessStatus: 'stale',
          pendingCriticalMovementSince: occurredAt,
          pendingCriticalMovementType: tipo,
          updatedAt: new Date(),
        })
        .where(eq(executionCases.id, execCase.id))
    }

    // ── Registrar a intimação estruturada (fonte separada de timeline/autos)
    let provisionalDeadlineId: string | null = null
    try {
      const possibleDeadline =
        hasDeadlineSignal(tipo, conteudo) || criticalityTier === '1' || criticalityTier === '2'

      const [comm] = await db
        .insert(courtCommunications)
        .values({
          organizationId: execCase.organizationId,
          executionCaseId: execCase.id,
          processNumber: cnj.trim(),
          kind: 'intimacao',
          source: 'aasp',
          content: `${tipo}: ${conteudo}`.substring(0, 8000),
          availableAt: occurredAt,
          publishedAt: occurredAt,
          possibleDeadline,
          status: 'processed',
          rawPayload: body,
          contentHash: communicationHash(cnj, tipo, conteudo, dataRaw ?? ''),
        })
        .onConflictDoNothing()
        .returning()

      // ── PRAZO PROVISÓRIO (spec §10 "movimentação com possível prazo"):
      // criado APENAS quando a intimação é nova (comm definido — dedup passou).
      // A IA identifica o evento; o prazo aqui é uma CONTAGEM CONSERVADORA de
      // segurança (5 dias corridos — o menor prazo recursal comum do CPP),
      // marcado como PROVISÓRIO e prioridade crítica. O advogado valida ou
      // descarta; nunca é tratado como prazo definitivo (origin='extracted').
      if (comm && possibleDeadline) {
        provisionalDeadlineId = await createProvisionalDeadline({
          organizationId: execCase.organizationId,
          executionCaseId: execCase.id,
          tipo,
          conteudo,
          publishedAt: occurredAt,
          sourceEventId: newEvent?.id ?? null,
        })
        if (provisionalDeadlineId) {
          await db
            .update(courtCommunications)
            .set({ deadlineId: provisionalDeadlineId, updatedAt: new Date() })
            .where(eq(courtCommunications.id, comm.id))
        }
      }
    } catch (e) {
      console.warn('[Webhook AASP] Falha ao gravar court_communication/prazo provisório:', e)
    }

    // ── Emit domain event
    if (newEvent) {
      await db.insert(domainEvents).values({
        id: crypto.randomUUID(),
        organizationId: execCase.organizationId,
        eventType: 'case.movements.received',
        aggregateId: execCase.id,
        aggregateType: 'execution_case',
        correlationId: crypto.randomUUID(),
        actorType: 'system',
        actorId: 'aasp-webhook',
        occurredAt: new Date(),
        recordedAt: new Date(),
        payload: {
          executionCaseId: execCase.id,
          cnj,
          newEventIds: [newEvent.id],
          source: 'aasp_webhook',
          criticalityTier,
        },
        metadata: { source: 'aasp_webhook' },
      })
    }

    // ── Notify office
    await notifications.sendProcessUpdate(
      execCase.organizationId,
      execCase.id,
      cnj,
      tipo,
      conteudo || 'Nova intimação processual.'
    )

    if (oportunidadesCriadas > 0) {
      await notifications.sendProcessUpdate(
        execCase.organizationId,
        execCase.id,
        cnj,
        'Oportunidade detectada',
        `${oportunidadesCriadas} nova(s) oportunidade(s) sugerida(s) pela IA: ${oppTitulos.join('; ')}`
      )
    }

    await insertAaspHealthCheck(execCase.organizationId, 'success', Date.now() - startedAt)

    console.log(
      `[Webhook AASP] ✅ Intimação para ${cnj} (tier=${criticalityTier ?? 'n/a'}, ${oportunidadesCriadas} oportunidade(s) IA)`
    )
    return c.json({
      received: true,
      eventsCreated: newEvent ? 1 : 0,
      opportunitiesCreated: oportunidadesCriadas,
      criticalityTier,
    })
  } catch (error: any) {
    console.error('[Webhook AASP Error]', error)
    await insertAaspHealthCheck(organizationId, 'failure', Date.now() - startedAt, String(error?.message ?? error))
    return c.json({ error: 'Internal Server Error' }, 500)
  }
})

/**
 * Cria um prazo PROVISÓRIO a partir de uma intimação com possível prazo.
 * dueAt conservador: publicação + 5 dias corridos (menor prazo recursal comum
 * do CPP — apelação/RESE/agravo em execução; embargos de declaração são 2 dias,
 * alertado na descrição). status='open', origin='extracted' → exige validação
 * humana antes de qualquer confiança; o sweep de SLA alerta se ninguém validar.
 * Retorna o id criado ou null em falha (nunca derruba o webhook).
 */
async function createProvisionalDeadline(input: {
  organizationId: string
  executionCaseId: string
  tipo: string
  conteudo: string
  publishedAt: Date
  sourceEventId: string | null
}): Promise<string | null> {
  try {
    const { deadlines, memberships, users } = await import('@execflow/db/schema')

    // Ator do sistema: primeiro advogado/admin ativo da organização
    // (created_by_user_id é NOT NULL — nunca usar string mágica como 'system').
    const [actor] = await db
      .select({ userId: users.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, input.organizationId))
      .limit(1)
    if (!actor) return null

    const dueAt = new Date(input.publishedAt.getTime() + 5 * 86_400_000)

    const [deadline] = await db
      .insert(deadlines)
      .values({
        organizationId: input.organizationId,
        executionCaseId: input.executionCaseId,
        title: `PROVISÓRIO — validar prazo: ${input.tipo}`.substring(0, 255),
        description:
          `Prazo provisório criado automaticamente a partir de intimação recebida em ${input.publishedAt.toLocaleDateString('pt-BR')}.\n\n` +
          `Conteúdo: ${input.conteudo.substring(0, 500)}\n\n` +
          `⚠ CONTAGEM CONSERVADORA de 5 dias corridos a partir da publicação. ` +
          `Confira o termo inicial real (publicação × intimação pessoal × ciência), a natureza da peça ` +
          `(embargos de declaração = 2 dias!) e dias úteis/feriados antes de confiar nesta data. ` +
          `Valide ou descarte — este prazo NÃO é definitivo.`,
        dueAt,
        deadlineClass: 'legal',
        origin: 'extracted',
        priority: 'critical',
        status: 'open',
        sourceEventId: input.sourceEventId,
        legalBasis: 'Provisório — pendente de enquadramento legal na validação humana.',
        createdByUserId: actor.userId,
      })
      .returning()

    return deadline?.id ?? null
  } catch (e) {
    console.warn('[Webhook AASP] Falha ao criar prazo provisório:', e)
    return null
  }
}

/** Dedup determinístico de comunicações: mesmo processo + tipo + conteúdo + data → mesmo hash. */
function communicationHash(cnj: string, tipo: string, conteudo: string, dataRaw: string): string {
  return createHash('sha256')
    .update(`${cnj.trim()}|${tipo.trim()}|${conteudo.trim()}|${dataRaw.trim()}`)
    .digest('hex')
}

/** Heurística determinística: a comunicação provavelmente abre prazo (spec §10). */
function hasDeadlineSignal(tipo: string, conteudo: string): boolean {
  const t = `${tipo} ${conteudo}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  return [
    'intima',
    'publicad',
    'disponibilizad',
    'ciencia',
    'prazo',
    'vista a defesa',
    'vista da defesa',
  ].some((k) => t.includes(k))
}

/**
 * Intimação para processo SEM caso operacional: registra como órfã (triagem)
 * ou vincula ao item do inventário quando o CNJ bate — nesse caso também
 * atualiza a última movimentação e reclassifica a prioridade do item.
 */
async function recordOrphanCommunication(input: {
  cnj: string
  tipo: string
  conteudo: string
  occurredAt: Date
  /** String de data ORIGINAL do payload (pode ser vazia) — entra no hash de dedup.
   *  Nunca usar occurredAt aqui: quando o payload não traz data, occurredAt é
   *  new Date() e mudaria a cada reenvio, quebrando a deduplicação. */
  dataRaw: string
  rawPayload: unknown
}): Promise<{ status: 'orphan' | 'linked_inventory' | 'skipped'; organizationId: string | null }> {
  try {
    // Organização: single-tenant na prática — mesma resolução do health check.
    const orgs = await db.select({ id: organizations.id }).from(organizations).limit(1)
    const organizationId = orgs[0]?.id ?? null
    if (!organizationId) return { status: 'skipped', organizationId: null }

    // O CNJ bate com algum item do inventário?
    const [invItem] = await db
      .select()
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.organizationId, organizationId),
          eq(inventoryItems.processNumber, input.cnj)
        )
      )
      .limit(1)

    await db
      .insert(courtCommunications)
      .values({
        organizationId,
        inventoryItemId: invItem?.id ?? null,
        processNumber: input.cnj,
        kind: 'intimacao',
        source: 'aasp',
        content: `${input.tipo}: ${input.conteudo}`.substring(0, 8000),
        availableAt: input.occurredAt,
        publishedAt: input.occurredAt,
        possibleDeadline: hasDeadlineSignal(input.tipo, input.conteudo),
        status: invItem ? 'new' : 'orphan',
        rawPayload: input.rawPayload,
        contentHash: communicationHash(input.cnj, input.tipo, input.conteudo, input.dataRaw),
      })
      .onConflictDoNothing()

    // Inventário: intimação nova = movimentação nova → atualiza e reclassifica.
    if (invItem) {
      const movementText = `${input.tipo}: ${input.conteudo}`.substring(0, 4000)
      const updatedItem = {
        ...invItem,
        lastMovementText: movementText,
        lastMovementAt: input.occurredAt,
      }
      const classification = classifyInventoryItem(updatedItem)
      await db
        .update(inventoryItems)
        .set({
          lastMovementText: movementText,
          lastMovementAt: input.occurredAt,
          priority: classification.priority,
          priorityReason: classification.priorityReason,
          needsAutos: classification.needsAutos,
          updatedAt: new Date(),
        })
        .where(eq(inventoryItems.id, invItem.id))
      return { status: 'linked_inventory', organizationId }
    }

    return { status: 'orphan', organizationId }
  } catch (e) {
    console.warn('[Webhook AASP] Falha ao registrar comunicação órfã:', e)
    return { status: 'skipped', organizationId: null }
  }
}

async function insertAaspHealthCheck(
  orgId: string | null,
  status: 'success' | 'failure',
  durationMs: number,
  errorDetails?: string
): Promise<void> {
  try {
    let organizationId = orgId
    if (!organizationId) {
      const orgs = await db.select({ id: organizations.id }).from(organizations).limit(1)
      organizationId = orgs[0]?.id ?? null
    }
    if (!organizationId) return
    await db.insert(systemHealthChecks).values({
      organizationId,
      checkType: 'aasp_webhook_received',
      status,
      durationMs,
      errorDetails: errorDetails ?? null,
    })
  } catch (e) {
    console.warn('[Webhook AASP] Falha ao gravar health check:', e)
  }
}
