/**
 * Portal do cliente — API restrita com projeção WHITELIST (spec §17).
 *
 * REGRA ABSOLUTA: o cliente NUNCA vê dado interno. Este endpoint monta a
 * resposta campo a campo (whitelist) — nunca repassa linhas inteiras de
 * tabelas. PROIBIDO aqui: teses, riscos, estratégia, notas internas,
 * oportunidades, prazos detalhados, análises da IA, prioridade, motivos
 * de frescor, honorários de outros, qualquer campo de outro cliente.
 *
 * Status simples permitidos (spec): aguardando decisão / prazo em andamento /
 * peça em elaboração / aguardando audiência / aguardando julgamento /
 * documento em análise / providência interna em andamento / aguardando
 * atualização / encerrado.
 *
 * Acesso:
 *   role 'client' → dados do próprio linked_client_id (obrigatório)
 *   role lawyer/admin → pré-visualização via ?clientId= (suporte/conferência)
 *
 * Montado em /api/v1/portal
 */

import { Hono } from 'hono'
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { db } from '../lib/db.ts'
import {
  clients,
  executionCases,
  timelineEvents,
  documents,
  deadlines,
  pieceDrafts,
  memberships,
} from '@execflow/db/schema'
import { forbidden, notFound, unprocessable } from '../lib/respond.ts'
import type { HonoVariables } from '../context/types.ts'

export const portalRouter = new Hono<{ Variables: HonoVariables }>()

portalRouter.use('*', authMiddleware, orgMiddleware)

/** Mapa interno→simples. Nunca expor o status interno cru. */
async function simpleStatusForCase(caseRow: {
  id: string
  status: string
}): Promise<string> {
  if (caseRow.status === 'intake') return 'documento em análise'
  if (caseRow.status === 'suspended') return 'aguardando atualização'
  if (caseRow.status === 'closed' || caseRow.status === 'archived') return 'encerrado'

  // active — refina pelo que existe (só EXISTÊNCIA, nunca conteúdo)
  const [draft] = await db
    .select({ id: pieceDrafts.id })
    .from(pieceDrafts)
    .where(
      and(
        eq(pieceDrafts.executionCaseId, caseRow.id),
        inArray(pieceDrafts.status, ['generating', 'draft'])
      )
    )
    .limit(1)
  if (draft) return 'peça em elaboração'

  const [openDeadline] = await db
    .select({ id: deadlines.id })
    .from(deadlines)
    .where(
      and(
        eq(deadlines.executionCaseId, caseRow.id),
        inArray(deadlines.status, ['open', 'acknowledged'])
      )
    )
    .limit(1)
  if (openDeadline) return 'prazo em andamento'

  return 'providência interna em andamento'
}

portalRouter.get('/overview', async (c) => {
  const { organization, role, domainUserId } = c.get('org')

  // Resolve o cliente-alvo conforme o papel
  let clientId: string | null = null
  if (role === 'client') {
    const [membership] = await db
      .select({ linkedClientId: memberships.linkedClientId })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organization.id),
          eq(memberships.userId, domainUserId)
        )
      )
      .limit(1)
    clientId = membership?.linkedClientId ?? null
    if (!clientId) {
      return forbidden(c, 'Seu acesso ainda não foi vinculado a um cadastro de cliente. Fale com o escritório.')
    }
  } else if (role === 'lawyer' || role === 'admin') {
    clientId = c.req.query('clientId') ?? null
    if (!clientId) {
      return unprocessable(c, 'Pré-visualização: informe ?clientId=<uuid> do cliente.')
    }
  } else {
    return forbidden(c, 'Acesso ao portal é exclusivo de clientes (ou pré-visualização por advogado).')
  }

  const [client] = await db
    .select({
      id: clients.id,
      fullName: clients.fullName,
      displayName: clients.displayName,
    })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.organizationId, organization.id)))
    .limit(1)

  if (!client) return notFound(c, 'Cadastro não encontrado.')

  const caseRows = await db
    .select({
      id: executionCases.id,
      executionProcessNumber: executionCases.executionProcessNumber,
      status: executionCases.status,
      courtName: executionCases.courtName,
    })
    .from(executionCases)
    .where(
      and(
        eq(executionCases.clientId, client.id),
        eq(executionCases.organizationId, organization.id)
      )
    )

  const casesOut = []
  for (const caseRow of caseRows) {
    // Última atualização RESUMIDA: só eventos de TRIBUNAL (fatos públicos do
    // processo) — nunca eventos internos, notas ou análises.
    const [lastCourtEvent] = await db
      .select({ summary: timelineEvents.summary, occurredAt: timelineEvents.occurredAt })
      .from(timelineEvents)
      .where(
        and(
          eq(timelineEvents.executionCaseId, caseRow.id),
          eq(timelineEvents.eventCategory, 'court')
        )
      )
      .orderBy(desc(timelineEvents.occurredAt))
      .limit(1)

    // Documentos enviados: nome/classe/data apenas — sem conteúdo, sem status interno.
    const docs = await db
      .select({
        fileName: documents.fileName,
        documentClass: documents.documentClass,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(and(eq(documents.executionCaseId, caseRow.id), eq(documents.status, 'confirmed')))
      .orderBy(desc(documents.createdAt))
      .limit(20)

    casesOut.push({
      id: caseRow.id,
      processNumber: caseRow.executionProcessNumber,
      courtName: caseRow.courtName,
      statusSimples: await simpleStatusForCase(caseRow),
      ultimaAtualizacao: lastCourtEvent
        ? {
            resumo: lastCourtEvent.summary.substring(0, 200),
            data: lastCourtEvent.occurredAt,
          }
        : null,
      documentosEnviados: docs.map((d) => ({
        nome: d.fileName,
        classe: d.documentClass,
        data: d.createdAt,
      })),
    })
  }

  return c.json({
    data: {
      cliente: { nome: client.displayName ?? client.fullName },
      processos: casesOut,
    },
  })
})
