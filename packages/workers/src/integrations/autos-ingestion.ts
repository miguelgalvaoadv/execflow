/**
 * Ingestão de documentos PDF do processo (autos) vindos do Jusbrasil para o ExecFlow.
 *
 * Fluxo:
 *   1. O sync worker recebe links de PDF na resposta de getProcessByCnj (autosLinks).
 *   2. ingestAutosFromLinks() baixa cada PDF e grava no storage como documento confirmado.
 *   3. O documento fica disponível para o Claude Drafter ler e fundamentar peças.
 *
 * Dedup por checksum: se o PDF baixado for idêntico ao autos já presente no caso
 * (mesmo SHA-256), a ingestão é pulada sem gravar duplicata. Se o PDF for DIFERENTE
 * (processo atualizado), o documento antigo é marcado como 'superseded' e o novo recebe
 * supersedesDocumentId apontando para ele — habilitando chains de versão para auditoria.
 *
 * Após ingestão bem-sucedida de nova versão, os campos de frescor do caso são limpos:
 * documentFreshnessStatus='fresh', autosLastIngestedAt=now, pendingCritical*=null.
 */

import { randomUUID } from 'crypto'
import { eq, and, inArray, desc } from '@execflow/db/client'
import { documents, executionCases } from '@execflow/db/schema'
import {
  createStorageProviderFromEnv,
  buildStorageKey,
  sha256Hex,
} from '@execflow/storage'
import type { WorkersDb } from '../lib/db.ts'
import type { JusbrasilClient } from './jusbrasil-client.ts'

export type AutosScope = 'INICIAIS' | 'INTEGRAL'

const AUTOS_DOCUMENT_CLASSES = ['autos_iniciais', 'autos_integral'] as const

function documentClassForScope(scope: AutosScope): string {
  return scope === 'INTEGRAL' ? 'autos_integral' : 'autos_iniciais'
}

/**
 * Verifica se o caso já tem os autos ingeridos.
 * Exportado para uso externo (ex.: crawler-sync.ts), mas a lógica de versioning
 * dentro de ingestAutosFromLinks() é baseada em checksum — esta função apenas informa se
 * existe algum documento de autos (independentemente da versão).
 */
export async function hasAutosDocument(
  db: WorkersDb,
  organizationId: string,
  executionCaseId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, organizationId),
        eq(documents.executionCaseId, executionCaseId),
        inArray(documents.documentClass, AUTOS_DOCUMENT_CLASSES as unknown as string[])
      )
    )
    .limit(1)
  return rows.length > 0
}

/**
 * Busca o documento de autos mais recente (confirmed) para um dado documentClass + caso.
 * Retorna null se não existir.
 */
async function findLatestAutosDoc(
  db: WorkersDb,
  organizationId: string,
  executionCaseId: string,
  documentClass: string
): Promise<{ id: string; checksumSha256: string | null } | null> {
  const rows = await db
    .select({ id: documents.id, checksumSha256: documents.checksumSha256 })
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, organizationId),
        eq(documents.executionCaseId, executionCaseId),
        eq(documents.documentClass, documentClass),
        eq(documents.status, 'confirmed')
      )
    )
    .orderBy(desc(documents.confirmedAt))
    .limit(1)
  return rows[0] ?? null
}

/**
 * Limpa os campos de frescor do caso após ingestão bem-sucedida de novos autos.
 * documentFreshnessStatus → 'fresh', autosLastIngestedAt → now, pendingCritical* → null.
 */
export async function clearCaseStaleness(
  db: WorkersDb,
  executionCaseId: string
): Promise<void> {
  const now = new Date()
  await db
    .update(executionCases)
    .set({
      documentFreshnessStatus: 'fresh',
      autosLastIngestedAt: now,
      pendingCriticalMovementSince: null,
      pendingCriticalMovementType: null,
      updatedAt: now,
    } as any)
    .where(eq(executionCases.id, executionCaseId))
}

/**
 * Baixa PDFs dos links retornados pelo Jusbrasil e cria documentos confirmados.
 * Ingere no máximo maxLinks PDFs (padrão: 1 — o mais recente).
 *
 * Suporta versioning:
 * - Se o PDF for idêntico ao já existente (mesmo checksum) → skip silencioso.
 * - Se o PDF for diferente (ou não existe) → supersede o antigo, insere o novo,
 *   limpa os campos de frescor do caso.
 *
 * @returns array de IDs de documentos criados.
 */
export async function ingestAutosFromLinks(params: {
  db: WorkersDb
  jusbrasil: JusbrasilClient
  organizationId: string
  executionCaseId: string
  clientId?: string | null
  cnj: string
  uploadedByUserId: string
  autosLinks: string[]
  scope?: AutosScope
  maxLinks?: number
}): Promise<string[]> {
  const { db, jusbrasil, autosLinks, scope = 'INICIAIS', maxLinks = 1 } = params
  if (autosLinks.length === 0) return []

  const storage = createStorageProviderFromEnv()
  if (!storage.putObject) {
    throw new Error('[Autos] Storage provider não suporta escrita server-side (putObject).')
  }

  const docClass = documentClassForScope(scope)
  const createdIds: string[] = []
  const links = autosLinks.slice(0, maxLinks)

  for (const fileUrl of links) {
    try {
      const pdfBuffer = await jusbrasil.downloadFile(fileUrl)
      const checksum = sha256Hex(pdfBuffer)

      // ── Versioning: find existing confirmed doc of same class
      const existing = await findLatestAutosDoc(
        db,
        params.organizationId,
        params.executionCaseId,
        docClass
      )

      if (existing?.checksumSha256 === checksum) {
        console.log(
          `[Autos] Caso ${params.executionCaseId}: PDF idêntico ao existente (${docClass}). Sem nova versão.`
        )
        continue
      }

      // ── Upload new PDF
      const uploadId = randomUUID()
      const fileName = `autos-${params.cnj.replace(/\D/g, '')}-${scope.toLowerCase()}.pdf`
      const storageKey = buildStorageKey({
        organizationId: params.organizationId,
        uploadId,
        fileName,
      })
      await storage.putObject(storageKey, pdfBuffer, 'application/pdf')

      const now = new Date()

      // ── Insert new document (with supersedes pointer if old exists)
      const [doc] = await db
        .insert(documents)
        .values({
          organizationId: params.organizationId,
          executionCaseId: params.executionCaseId,
          ...(params.clientId ? { clientId: params.clientId } : {}),
          documentClass: docClass,
          storageKey,
          checksumSha256: checksum,
          mimeType: 'application/pdf',
          fileName,
          byteSize: pdfBuffer.byteLength,
          status: 'confirmed',
          sourceChannel: 'intake_tribunal',
          ocrStatus: 'pending',
          sensitivityLevel: 'restricted',
          uploadedAt: now,
          uploadedByUserId: params.uploadedByUserId,
          confirmedAt: now,
          confirmedByUserId: params.uploadedByUserId,
          ...(existing ? { supersedesDocumentId: existing.id } : {}),
        })
        .returning({ id: documents.id })

      if (!doc?.id) continue

      // ── Mark old doc as superseded
      if (existing) {
        await db
          .update(documents)
          .set({ status: 'superseded' } as any)
          .where(eq(documents.id, existing.id))
      }

      // ── Clear case staleness — new autos make the case fresh
      await clearCaseStaleness(db, params.executionCaseId)

      createdIds.push(doc.id)
      console.log(
        `[Autos] ✅ Autos (${scope}) do CNJ ${params.cnj} ingeridos como documento ${doc.id}${existing ? ` (supersede ${existing.id})` : ''}.`
      )
    } catch (e) {
      console.warn(`[Autos] Falha ao baixar PDF de ${fileUrl}:`, e)
    }
  }

  return createdIds
}
