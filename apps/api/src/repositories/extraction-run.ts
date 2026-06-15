/**
 * Extraction run repository — read helpers for review API.
 */

import { eq, and, desc } from 'drizzle-orm'
import { extractionRuns, documentExtractionResults, documents } from '@execflow/db/schema'
import type { ExtractionRun, DocumentExtractionResult, Document } from '@execflow/db/schema'
import type { AnyTx } from '../lib/db.ts'
import type { RepositoryResult } from '@execflow/db/repositories'

export async function findExtractionRunById(
  db: AnyTx,
  organizationId: string,
  extractionRunId: string
): Promise<RepositoryResult<ExtractionRun>> {
  try {
    const row = await db.query.extractionRuns.findFirst({
      where: and(
        eq(extractionRuns.id, extractionRunId),
        eq(extractionRuns.organizationId, organizationId)
      ),
    })
    if (row === undefined) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Extraction run not found.' } }
    }
    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to query extraction run.', cause: err },
    }
  }
}

export async function findLatestExtractionForDocument(
  db: AnyTx,
  organizationId: string,
  documentId: string
): Promise<
  RepositoryResult<{
    document: Document
    run: ExtractionRun
    result: DocumentExtractionResult
  }>
> {
  try {
    const [doc] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.organizationId, organizationId)))
      .limit(1)

    if (doc === undefined) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Document not found.' } }
    }

    const [run] = await db
      .select()
      .from(extractionRuns)
      .where(
        and(eq(extractionRuns.documentId, documentId), eq(extractionRuns.organizationId, organizationId))
      )
      .orderBy(desc(extractionRuns.createdAt))
      .limit(1)

    if (run === undefined) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'No extraction run for document.' } }
    }

    const [result] = await db
      .select()
      .from(documentExtractionResults)
      .where(eq(documentExtractionResults.extractionRunId, run.id))
      .limit(1)

    if (result === undefined) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'No extraction result for document.' },
      }
    }

    return { success: true, data: { document: doc, run, result } }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to load document extraction.', cause: err },
    }
  }
}
