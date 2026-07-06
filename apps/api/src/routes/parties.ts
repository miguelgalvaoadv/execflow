/**
 * Partes do processo + busca nos autos (spec §14 "Partes" + §19 "Busca").
 *
 * Montado em /api/v1/cases:
 *   GET    /:caseId/parties        — lista partes (assistant+)
 *   POST   /:caseId/parties        — adiciona parte (lawyer+; IA sugere via confidence='suggested')
 *   PATCH  /:caseId/parties/:id    — edita/confirma (lawyer+)
 *   DELETE /:caseId/parties/:id    — remove (lawyer+)
 *   POST   /:caseId/search-autos   — busca no texto OCR dos documentos confirmados
 *
 * BUSCA COM CITAÇÃO DE FONTE: cada resultado cita documento + trecho + página
 * (quando o texto OCR preserva marcadores de página \f) + nível de confiança.
 * Implementação atual: ILIKE sobre document_ocr_results.raw_text — determinística
 * e sem custo. pgvector fica documentado como evolução (exige extensão no
 * Supabase + embeddings; não fingimos que existe).
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth.ts'
import { orgMiddleware } from '../middleware/organization.ts'
import { requireMinRole } from '../middleware/rbac.ts'
import { db } from '../lib/db.ts'
import { caseParties, documents, documentOcrResults, executionCases } from '@execflow/db/schema'
import { unprocessable, notFound } from '../lib/respond.ts'
import { parseBody } from '../lib/zod-helpers.ts'
import { safeJsonBody } from '../lib/route-helpers.ts'
import type { HonoVariables } from '../context/types.ts'

export const partiesRouter = new Hono<{ Variables: HonoVariables }>()

partiesRouter.use('*', authMiddleware, orgMiddleware, requireMinRole('assistant'))

const PARTICIPATION_TYPES = [
  'reu', 'correu', 'autor', 'vitima', 'ministerio_publico', 'advogado',
  'assistente', 'testemunha', 'familiar', 'outro',
] as const

async function assertCase(organizationId: string, caseId: string) {
  const [row] = await db
    .select({ id: executionCases.id })
    .from(executionCases)
    .where(and(eq(executionCases.id, caseId), eq(executionCases.organizationId, organizationId)))
    .limit(1)
  return row ?? null
}

// ---------------------------------------------------------------------------
// Partes
// ---------------------------------------------------------------------------

partiesRouter.get('/:caseId/parties', async (c) => {
  const { organization } = c.get('org')
  const caseId = c.req.param('caseId')
  if (!(await assertCase(organization.id, caseId))) return notFound(c, 'Caso não encontrado.')

  const rows = await db
    .select()
    .from(caseParties)
    .where(eq(caseParties.executionCaseId, caseId))
    .orderBy(caseParties.participationType, caseParties.name)

  return c.json({ data: rows })
})

const CreatePartySchema = z.object({
  name: z.string().min(1).max(300),
  participationType: z.enum(PARTICIPATION_TYPES),
  cpf: z.string().max(20).optional(),
  oab: z.string().max(30).optional(),
  sourceReference: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
})

partiesRouter.post('/:caseId/parties', requireMinRole('lawyer'), async (c) => {
  const { organization, domainUserId } = c.get('org')
  const caseId = c.req.param('caseId')
  if (!(await assertCase(organization.id, caseId))) return notFound(c, 'Caso não encontrado.')

  const body = await safeJsonBody(c)
  if (body === null) return unprocessable(c, 'Corpo deve ser JSON válido.')
  const parsed = parseBody(CreatePartySchema, body)
  if (!parsed.success) return unprocessable(c, parsed.message, parsed.issues)

  const [party] = await db
    .insert(caseParties)
    .values({
      organizationId: organization.id,
      executionCaseId: caseId,
      name: parsed.data.name.trim(),
      participationType: parsed.data.participationType,
      cpf: parsed.data.cpf?.trim() ?? null,
      oab: parsed.data.oab?.trim() ?? null,
      // Criada por humano → já nasce confirmada (a IA usa 'suggested').
      confidence: 'confirmed',
      sourceReference: parsed.data.sourceReference?.trim() ?? null,
      notes: parsed.data.notes?.trim() ?? null,
      createdByUserId: domainUserId,
    })
    .returning()

  return c.json({ data: party }, 201)
})

const PatchPartySchema = CreatePartySchema.partial().extend({
  confidence: z.enum(['suggested', 'confirmed']).optional(),
})

partiesRouter.patch('/:caseId/parties/:partyId', requireMinRole('lawyer'), async (c) => {
  const { organization } = c.get('org')
  const caseId = c.req.param('caseId')
  const partyId = c.req.param('partyId')

  const body = await safeJsonBody(c)
  if (body === null) return unprocessable(c, 'Corpo deve ser JSON válido.')
  const parsed = parseBody(PatchPartySchema, body)
  if (!parsed.success) return unprocessable(c, parsed.message, parsed.issues)

  const [updated] = await db
    .update(caseParties)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(
      and(
        eq(caseParties.id, partyId),
        eq(caseParties.executionCaseId, caseId),
        eq(caseParties.organizationId, organization.id)
      )
    )
    .returning()

  if (!updated) return notFound(c, 'Parte não encontrada.')
  return c.json({ data: updated })
})

partiesRouter.delete('/:caseId/parties/:partyId', requireMinRole('lawyer'), async (c) => {
  const { organization } = c.get('org')
  const caseId = c.req.param('caseId')
  const partyId = c.req.param('partyId')

  const [deleted] = await db
    .delete(caseParties)
    .where(
      and(
        eq(caseParties.id, partyId),
        eq(caseParties.executionCaseId, caseId),
        eq(caseParties.organizationId, organization.id)
      )
    )
    .returning({ id: caseParties.id })

  if (!deleted) return notFound(c, 'Parte não encontrada.')
  return c.json({ data: { deleted: true } })
})

// ---------------------------------------------------------------------------
// Busca nos autos
// ---------------------------------------------------------------------------

const SearchSchema = z.object({
  query: z.string().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(30).default(10),
})

/** Contexto ao redor do match: ~180 caracteres de cada lado, sem quebrar palavras. */
function extractSnippet(text: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - 180)
  const end = Math.min(text.length, matchIndex + matchLength + 180)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`
}

partiesRouter.post('/:caseId/search-autos', async (c) => {
  const { organization } = c.get('org')
  const caseId = c.req.param('caseId')
  if (!(await assertCase(organization.id, caseId))) return notFound(c, 'Caso não encontrado.')

  const body = await safeJsonBody(c)
  if (body === null) return unprocessable(c, 'Corpo deve ser JSON válido.')
  const parsed = parseBody(SearchSchema, body)
  if (!parsed.success) return unprocessable(c, parsed.message, parsed.issues)

  // Documentos confirmados do caso que têm texto OCR
  const docsWithText = await db
    .select({
      documentId: documents.id,
      fileName: documents.fileName,
      documentClass: documents.documentClass,
      rawText: documentOcrResults.rawText,
      pageCount: documentOcrResults.pageCount,
    })
    .from(documents)
    .innerJoin(documentOcrResults, eq(documentOcrResults.documentId, documents.id))
    .where(
      and(
        eq(documents.executionCaseId, caseId),
        eq(documents.organizationId, organization.id),
        eq(documents.status, 'confirmed')
      )
    )
    .orderBy(desc(documents.createdAt))

  const needle = parsed.data.query.toLowerCase()
  const results: Array<{
    documentId: string
    documentName: string
    documentClass: string | null
    page: number | null
    snippet: string
    confidence: 'exata' | 'aproximada'
  }> = []

  for (const doc of docsWithText) {
    if (results.length >= parsed.data.limit) break
    const haystack = doc.rawText.toLowerCase()

    // Páginas: OCR costuma separar páginas com \f (form feed). Quando presente,
    // conseguimos citar a página exata; sem marcador, a página fica null
    // (confiança 'aproximada') — nunca inventamos número de página.
    const pages = doc.rawText.includes('\f') ? doc.rawText.split('\f') : null

    let fromIndex = 0
    while (results.length < parsed.data.limit) {
      const idx = haystack.indexOf(needle, fromIndex)
      if (idx === -1) break

      let page: number | null = null
      if (pages) {
        let acc = 0
        for (let p = 0; p < pages.length; p++) {
          acc += pages[p]!.length + 1 // +1 pelo \f removido
          if (idx < acc) {
            page = p + 1
            break
          }
        }
      }

      results.push({
        documentId: doc.documentId,
        documentName: doc.fileName,
        documentClass: doc.documentClass,
        page,
        snippet: extractSnippet(doc.rawText, idx, needle.length),
        confidence: page !== null ? 'exata' : 'aproximada',
      })
      fromIndex = idx + needle.length
    }
  }

  return c.json({
    data: {
      query: parsed.data.query,
      documentsSearched: docsWithText.length,
      results,
      note:
        docsWithText.length === 0
          ? 'Nenhum documento confirmado com texto OCR neste caso — suba os autos e aguarde o processamento.'
          : null,
    },
  })
})
