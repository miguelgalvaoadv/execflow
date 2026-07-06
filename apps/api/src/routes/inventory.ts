/**
 * Inventário por OAB — rotas de descoberta e triagem em massa de processos.
 *
 * Fluxo (spec §5): achar os processos pela OAB → jogar SÓ metadados no painel →
 * monitorar → baixar autos apenas dos importantes. inventory_items é a antessala
 * do ExecutionCase; a promoção é explícita e humana.
 *
 * Endpoints (montados em /api/v1/inventory):
 *   GET    /profiles              — perfis OAB com contadores agregados
 *   POST   /profiles              — cria perfil
 *   PATCH  /profiles/:id          — atualiza perfil
 *   GET    /items                 — lista itens (filtros: priority, reviewStatus, q, needsAutos)
 *   POST   /import                — importa lote de linhas (CSV/XLSX parseado no cliente)
 *   POST   /classify              — reclassifica prioridade (regras determinísticas)
 *   PATCH  /items/:id             — triagem (revisão, cliente, needsAutos, segredo, notas)
 *   POST   /items/:id/promote     — promove a ExecutionCase (cliente existente ou novo)
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, desc, sql, ilike, or } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireMinRole } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import { buildWriteContext } from '../lib/write-context.ts'
import { safeJsonBody, serviceErrorToResponse } from '../lib/route-helpers.ts'
import { parseBody } from '../lib/zod-helpers.ts'
import { unprocessable, notFound } from '../lib/respond.ts'
import { normalizeProcessNumber, validateProcessNumber } from '../lib/validation.ts'
import { oabProfiles, inventoryItems, clients } from '@execflow/db/schema'
import { createCase } from '../services/case.ts'
import { createClient } from '../services/client.ts'
import { classifyInventoryItem } from '@execflow/engine'
import type { HonoVariables } from '../context/types.ts'

export const inventoryRouter = new Hono<{ Variables: HonoVariables }>()

inventoryRouter.use('*', authMiddleware, orgMiddleware)

// ---------------------------------------------------------------------------
// Perfis OAB
// ---------------------------------------------------------------------------

const CreateProfileSchema = z.object({
  lawyerName: z.string().min(1).max(200),
  oabNumber: z.string().min(1).max(20),
  oabUf: z.string().length(2),
  primaryTribunal: z.string().max(50).optional(),
  primarySystem: z.string().max(50).optional(),
  searchSource: z.string().max(50).optional(),
})

inventoryRouter.get('/profiles', requireMinRole('assistant'), async (c) => {
  const { organization } = c.get('org')

  const profiles = await db
    .select()
    .from(oabProfiles)
    .where(eq(oabProfiles.organizationId, organization.id))
    .orderBy(desc(oabProfiles.createdAt))

  // Contadores agregados do inventário inteiro da organização (spec §5).
  const [counters] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where coalesce(${inventoryItems.situation}, 'ativo') not in ('arquivado','suspenso','baixado','extinto') and ${inventoryItems.reviewStatus} not in ('not_ours','archived'))::int`,
      archived: sql<number>`count(*) filter (where coalesce(${inventoryItems.situation},'') in ('arquivado','suspenso','baixado','extinto') or ${inventoryItems.reviewStatus} = 'archived')::int`,
      highPriority: sql<number>`count(*) filter (where ${inventoryItems.priority} = 'high')::int`,
      needsAutos: sql<number>`count(*) filter (where ${inventoryItems.needsAutos} = true and ${inventoryItems.autosDownloaded} = false)::int`,
      sealed: sql<number>`count(*) filter (where ${inventoryItems.isSealed} = true)::int`,
      withoutClient: sql<number>`count(*) filter (where ${inventoryItems.clientId} is null and ${inventoryItems.reviewStatus} not in ('not_ours','archived'))::int`,
      unreviewed: sql<number>`count(*) filter (where ${inventoryItems.reviewStatus} = 'unreviewed')::int`,
      promoted: sql<number>`count(*) filter (where ${inventoryItems.executionCaseId} is not null)::int`,
    })
    .from(inventoryItems)
    .where(eq(inventoryItems.organizationId, organization.id))

  return c.json({ data: profiles, counters: counters ?? null })
})

inventoryRouter.post('/profiles', requireMinRole('lawyer'), async (c) => {
  const body = await safeJsonBody(c)
  if (body === null) return unprocessable(c, 'Corpo deve ser JSON válido.')

  const parsed = parseBody(CreateProfileSchema, body)
  if (!parsed.success) return unprocessable(c, parsed.message, parsed.issues)

  const { organization, domainUserId } = c.get('org')

  const [profile] = await db
    .insert(oabProfiles)
    .values({
      organizationId: organization.id,
      lawyerName: parsed.data.lawyerName.trim(),
      oabNumber: parsed.data.oabNumber.trim(),
      oabUf: parsed.data.oabUf.toUpperCase(),
      primaryTribunal: parsed.data.primaryTribunal?.trim() ?? null,
      primarySystem: parsed.data.primarySystem?.trim() ?? null,
      searchSource: parsed.data.searchSource ?? 'csv_import',
      createdByUserId: domainUserId,
    })
    .onConflictDoNothing()
    .returning()

  if (!profile) {
    return unprocessable(c, 'Já existe um perfil para esta OAB/UF nesta organização.')
  }

  return c.json({ data: profile }, 201)
})

inventoryRouter.patch('/profiles/:id', requireMinRole('lawyer'), async (c) => {
  const profileId = c.req.param('id')
  const body = await safeJsonBody(c)
  if (body === null) return unprocessable(c, 'Corpo deve ser JSON válido.')

  const parsed = parseBody(CreateProfileSchema.partial(), body)
  if (!parsed.success) return unprocessable(c, parsed.message, parsed.issues)

  const { organization } = c.get('org')

  const [updated] = await db
    .update(oabProfiles)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(oabProfiles.id, profileId), eq(oabProfiles.organizationId, organization.id)))
    .returning()

  if (!updated) return notFound(c, 'Perfil OAB não encontrado.')
  return c.json({ data: updated })
})

// ---------------------------------------------------------------------------
// Listagem de itens
// ---------------------------------------------------------------------------

const ListItemsQuerySchema = z.object({
  priority: z.enum(['high', 'medium', 'low']).optional(),
  reviewStatus: z.enum(['unreviewed', 'confirmed', 'not_ours', 'archived']).optional(),
  needsAutos: z.enum(['true', 'false']).optional(),
  withoutClient: z.enum(['true', 'false']).optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
})

inventoryRouter.get('/items', requireMinRole('assistant'), async (c) => {
  const parsed = ListItemsQuerySchema.safeParse(c.req.query())
  if (!parsed.success) {
    return unprocessable(c, 'Parâmetros inválidos.', { issues: parsed.error.issues })
  }
  const { organization } = c.get('org')
  const q = parsed.data

  const conditions = [eq(inventoryItems.organizationId, organization.id)]
  if (q.priority) conditions.push(eq(inventoryItems.priority, q.priority))
  if (q.reviewStatus) conditions.push(eq(inventoryItems.reviewStatus, q.reviewStatus))
  if (q.needsAutos === 'true') conditions.push(eq(inventoryItems.needsAutos, true))
  if (q.withoutClient === 'true') conditions.push(sql`${inventoryItems.clientId} is null`)
  if (q.q) {
    const term = `%${q.q}%`
    const search = or(
      ilike(inventoryItems.processNumber, term),
      ilike(inventoryItems.partiesText, term),
      ilike(inventoryItems.comarca, term),
      ilike(inventoryItems.vara, term),
      ilike(inventoryItems.lastMovementText, term)
    )
    if (search) conditions.push(search)
  }

  const items = await db
    .select()
    .from(inventoryItems)
    .where(and(...conditions))
    .orderBy(
      // alta primeiro, depois média, depois baixa, depois não-classificado
      sql`case ${inventoryItems.priority} when 'high' then 0 when 'medium' then 1 when 'low' then 2 else 3 end`,
      desc(inventoryItems.lastMovementAt)
    )
    .limit(q.limit)
    .offset(q.offset)

  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(inventoryItems)
    .where(and(...conditions))

  return c.json({ data: items, total })
})

// ---------------------------------------------------------------------------
// Importação em lote (CSV/XLSX parseado no cliente → linhas canônicas JSON)
// ---------------------------------------------------------------------------

const ImportRowSchema = z.object({
  processNumber: z.string().min(5).max(60),
  tribunal: z.string().max(50).optional(),
  degree: z.string().max(20).optional(),
  system: z.string().max(50).optional(),
  comarca: z.string().max(200).optional(),
  vara: z.string().max(200).optional(),
  courtClass: z.string().max(200).optional(),
  area: z.string().max(100).optional(),
  situation: z.string().max(100).optional(),
  partiesText: z.string().max(2000).optional(),
  link: z.string().max(1000).optional(),
  lastMovementText: z.string().max(4000).optional(),
  lastMovementAt: z.string().optional(), // ISO ou dd/mm/yyyy — normalizado abaixo
  notes: z.string().max(2000).optional(),
})

const ImportSchema = z.object({
  oabProfileId: z.string().uuid().optional(),
  sourceInfo: z.string().max(50).default('csv_import'),
  rows: z.array(ImportRowSchema).min(1).max(2000),
})

/** Aceita ISO 8601 ou dd/mm/yyyy; retorna null se irreconhecível. */
function parseFlexibleDate(raw: string | undefined): Date | null {
  if (!raw || !raw.trim()) return null
  const s = raw.trim()
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (br) {
    const d = new Date(`${br[3]}-${br[2]}-${br[1]}T12:00:00Z`)
    return isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

inventoryRouter.post('/import', requireMinRole('lawyer'), async (c) => {
  const body = await safeJsonBody(c)
  if (body === null) return unprocessable(c, 'Corpo deve ser JSON válido.')

  const parsed = parseBody(ImportSchema, body)
  if (!parsed.success) return unprocessable(c, parsed.message, parsed.issues)

  const { organization, domainUserId } = c.get('org')
  const batchId = `import-${Date.now().toString(36)}`

  let created = 0
  let updated = 0
  let skipped = 0
  const errors: Array<{ row: number; processNumber: string; error: string }> = []

  for (const [i, row] of parsed.data.rows.entries()) {
    try {
      const cnjValid = validateProcessNumber(row.processNumber)
      const processNumber = cnjValid
        ? normalizeProcessNumber(row.processNumber)
        : row.processNumber.trim()

      const [existing] = await db
        .select()
        .from(inventoryItems)
        .where(
          and(
            eq(inventoryItems.organizationId, organization.id),
            eq(inventoryItems.processNumber, processNumber)
          )
        )
        .limit(1)

      const movementAt = parseFlexibleDate(row.lastMovementAt)

      if (existing) {
        // REGRA (spec §5): nunca sobrescrever dado já preenchido — só completar
        // campos vazios; a última movimentação atualiza apenas se for mais nova.
        const fill: Record<string, unknown> = {}
        const fillIfEmpty = (col: keyof typeof existing, val: string | undefined) => {
          if (val && !existing[col]) fill[col] = val.trim()
        }
        fillIfEmpty('tribunal', row.tribunal)
        fillIfEmpty('degree', row.degree)
        fillIfEmpty('system', row.system)
        fillIfEmpty('comarca', row.comarca)
        fillIfEmpty('vara', row.vara)
        fillIfEmpty('courtClass', row.courtClass)
        fillIfEmpty('area', row.area)
        fillIfEmpty('situation', row.situation)
        fillIfEmpty('partiesText', row.partiesText)
        fillIfEmpty('link', row.link)

        const isNewerMovement =
          movementAt !== null &&
          (existing.lastMovementAt === null || movementAt > existing.lastMovementAt)
        if (isNewerMovement) {
          fill['lastMovementText'] = row.lastMovementText?.trim() ?? existing.lastMovementText
          fill['lastMovementAt'] = movementAt
        }

        if (Object.keys(fill).length === 0) {
          skipped++
          continue
        }
        await db
          .update(inventoryItems)
          .set({ ...fill, updatedAt: new Date() })
          .where(eq(inventoryItems.id, existing.id))
        updated++
      } else {
        await db.insert(inventoryItems).values({
          organizationId: organization.id,
          oabProfileId: parsed.data.oabProfileId ?? null,
          processNumber,
          tribunal: row.tribunal?.trim() ?? null,
          degree: row.degree?.trim() ?? null,
          system: row.system?.trim() ?? null,
          comarca: row.comarca?.trim() ?? null,
          vara: row.vara?.trim() ?? null,
          courtClass: row.courtClass?.trim() ?? null,
          area: row.area?.trim() ?? null,
          situation: row.situation?.trim() ?? null,
          partiesText: row.partiesText?.trim() ?? null,
          link: row.link?.trim() ?? null,
          lastMovementText: row.lastMovementText?.trim() ?? null,
          lastMovementAt: movementAt,
          sourceInfo: parsed.data.sourceInfo,
          importBatchId: batchId,
          notes: row.notes?.trim() ?? null,
          createdByUserId: domainUserId,
        })
        created++
      }
    } catch (err) {
      errors.push({
        row: i + 1,
        processNumber: row.processNumber,
        error: err instanceof Error ? err.message : 'erro desconhecido',
      })
    }
  }

  // Classifica automaticamente os itens do lote recém-importado.
  const batchItems = await db
    .select()
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.organizationId, organization.id),
        eq(inventoryItems.importBatchId, batchId)
      )
    )
  for (const item of batchItems) {
    const result = classifyInventoryItem(item)
    await db
      .update(inventoryItems)
      .set({
        priority: result.priority,
        priorityReason: result.priorityReason,
        needsAutos: result.needsAutos,
        updatedAt: new Date(),
      })
      .where(eq(inventoryItems.id, item.id))
  }

  // Atualiza estado de sincronização do perfil, se informado.
  if (parsed.data.oabProfileId) {
    await db
      .update(oabProfiles)
      .set({ searchStatus: 'synced', lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(oabProfiles.id, parsed.data.oabProfileId),
          eq(oabProfiles.organizationId, organization.id)
        )
      )
  }

  return c.json({
    data: { batchId, created, updated, skipped, classified: batchItems.length, errors },
  })
})

// ---------------------------------------------------------------------------
// Reclassificação determinística de prioridade
// ---------------------------------------------------------------------------

inventoryRouter.post('/classify', requireMinRole('assistant'), async (c) => {
  const { organization } = c.get('org')

  const items = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.organizationId, organization.id))

  let changed = 0
  for (const item of items) {
    const result = classifyInventoryItem(item)
    if (
      result.priority !== item.priority ||
      result.priorityReason !== item.priorityReason ||
      result.needsAutos !== item.needsAutos
    ) {
      await db
        .update(inventoryItems)
        .set({
          priority: result.priority,
          priorityReason: result.priorityReason,
          needsAutos: result.needsAutos,
          updatedAt: new Date(),
        })
        .where(eq(inventoryItems.id, item.id))
      changed++
    }
  }

  return c.json({ data: { evaluated: items.length, changed } })
})

// ---------------------------------------------------------------------------
// Triagem de item individual
// ---------------------------------------------------------------------------

const PatchItemSchema = z.object({
  reviewStatus: z.enum(['unreviewed', 'confirmed', 'not_ours', 'archived']).optional(),
  clientId: z.string().uuid().nullable().optional(),
  needsAutos: z.boolean().optional(),
  autosDownloaded: z.boolean().optional(),
  isSealed: z.boolean().optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  notes: z.string().max(2000).nullable().optional(),
})

inventoryRouter.patch('/items/:id', requireMinRole('assistant'), async (c) => {
  const itemId = c.req.param('id')
  const body = await safeJsonBody(c)
  if (body === null) return unprocessable(c, 'Corpo deve ser JSON válido.')

  const parsed = parseBody(PatchItemSchema, body)
  if (!parsed.success) return unprocessable(c, parsed.message, parsed.issues)

  const { organization } = c.get('org')

  // Se estiver vinculando cliente, confirmar que pertence à organização.
  if (parsed.data.clientId) {
    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, parsed.data.clientId), eq(clients.organizationId, organization.id)))
      .limit(1)
    if (!client) return unprocessable(c, 'Cliente não encontrado nesta organização.')
  }

  const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() }
  // Ajuste manual de prioridade registra a origem humana da decisão.
  if (parsed.data.priority) {
    updateData['priorityReason'] = 'Prioridade ajustada manualmente.'
  }

  const [updated] = await db
    .update(inventoryItems)
    .set(updateData)
    .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.organizationId, organization.id)))
    .returning()

  if (!updated) return notFound(c, 'Item de inventário não encontrado.')
  return c.json({ data: updated })
})

// ---------------------------------------------------------------------------
// Promoção a ExecutionCase — ação explícita e humana (nunca automática)
// ---------------------------------------------------------------------------

const PromoteSchema = z.object({
  // Ou vincula cliente existente, ou cria um novo — nunca implícito.
  clientId: z.string().uuid().optional(),
  newClient: z
    .object({
      fullName: z.string().min(1).max(300),
      cpf: z.string().max(20).optional(),
    })
    .optional(),
  internalRef: z.string().max(100).optional(),
  courtName: z.string().max(300).optional(),
})

inventoryRouter.post('/items/:id/promote', requireMinRole('lawyer'), async (c) => {
  const itemId = c.req.param('id')
  const body = await safeJsonBody(c)
  if (body === null) return unprocessable(c, 'Corpo deve ser JSON válido.')

  const parsed = parseBody(PromoteSchema, body)
  if (!parsed.success) return unprocessable(c, parsed.message, parsed.issues)

  if (!parsed.data.clientId && !parsed.data.newClient) {
    return unprocessable(c, 'Informe clientId (existente) ou newClient (criar novo).')
  }

  const { organization } = c.get('org')

  const [item] = await db
    .select()
    .from(inventoryItems)
    .where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.organizationId, organization.id)))
    .limit(1)

  if (!item) return notFound(c, 'Item de inventário não encontrado.')
  if (item.executionCaseId) {
    return unprocessable(c, 'Este processo já foi promovido a caso.')
  }

  const ctx = buildWriteContext(c, db)

  // 1. Resolver o cliente (existente ou novo)
  let clientId = parsed.data.clientId ?? null
  if (!clientId && parsed.data.newClient) {
    const internalRefForClient = `INV-${Date.now().toString(36).toUpperCase()}`
    const clientResult = await createClient(ctx, {
      fullName: parsed.data.newClient.fullName,
      cpf: parsed.data.newClient.cpf,
      // CPF ausente → internalRef obrigatório (regra do serviço existente)
      ...(parsed.data.newClient.cpf ? {} : { internalRef: internalRefForClient }),
    })
    if (!clientResult.success) {
      return serviceErrorToResponse(c, clientResult.error)
    }
    clientId = clientResult.data.id
  }

  // 2. Criar o caso reaproveitando o serviço canônico (timeline + audit + evento)
  const cnjValid = item.processNumber ? validateProcessNumber(item.processNumber) : false
  const internalRef =
    parsed.data.internalRef ??
    `EXE-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`

  const caseResult = await createCase(ctx, {
    clientId: clientId!,
    internalRef,
    openedAt: new Date().toISOString(),
    ...(cnjValid ? { executionProcessNumber: item.processNumber } : {}),
    ...(item.vara ? { courtName: parsed.data.courtName ?? item.vara } : {}),
    ...(item.comarca ? { courtJurisdiction: item.comarca } : {}),
  })

  if (!caseResult.success) {
    return serviceErrorToResponse(c, caseResult.error)
  }

  // 3. Marcar o item como promovido
  await db
    .update(inventoryItems)
    .set({
      executionCaseId: caseResult.data.id,
      clientId,
      reviewStatus: 'confirmed',
      updatedAt: new Date(),
    })
    .where(eq(inventoryItems.id, item.id))

  return c.json(
    {
      data: {
        executionCaseId: caseResult.data.id,
        internalRef: caseResult.data.internalRef,
        clientId,
        processNumberAccepted: cnjValid,
        warning: cnjValid
          ? null
          : 'Número do processo fora do padrão CNJ — caso criado sem número (preencher depois).',
      },
    },
    201
  )
})
