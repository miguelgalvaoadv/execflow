/**
 * Bootstrap-only: confirmed SentenceSnapshot + custody snapshot for HTTP engine smoke tests.
 *
 * There are no API routes yet that insert these rows; engine evaluate requires them.
 * Run after HTTP-created Client + ExecutionCase (pass CASE_ID).
 *
 *   DATABASE_URL=... CASE_ID=<uuid> pnpm --filter @execflow/db db:snapshot:http-engine
 */

import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq, and } from 'drizzle-orm'
import {
  executionCases,
  sentenceSnapshots,
  custodySnapshots,
  playbookVersions,
  playbookFamilies,
  memberships,
} from './schema/index.ts'

const DATABASE_URL = process.env['DATABASE_URL']
const executionCaseIdEnv = process.env['CASE_ID']

async function main(): Promise<void> {
  if (DATABASE_URL === undefined || DATABASE_URL === '') {
    throw new Error('DATABASE_URL is required.')
  }
  if (executionCaseIdEnv === undefined || executionCaseIdEnv === '') {
    throw new Error('CASE_ID is required (ExecutionCase UUID from POST /api/v1/cases).')
  }
  const executionCaseId = executionCaseIdEnv

  const sql = postgres(DATABASE_URL)
  const db = drizzle(sql)

  try {
    const [caseRow] = await db
      .select({
        id: executionCases.id,
        organizationId: executionCases.organizationId,
      })
      .from(executionCases)
      .where(eq(executionCases.id, executionCaseId))
      .limit(1)

    if (caseRow === undefined) {
      throw new Error(`execution_cases row not found for CASE_ID=${executionCaseId}`)
    }

    const [member] = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, caseRow.organizationId),
          eq(memberships.status, 'active')
        )
      )
      .limit(1)

    if (member === undefined) {
      throw new Error('No active membership found for case organization.')
    }

    const lawyerUserId = member.userId

    const [pbRow] = await db
      .select({ versionId: playbookVersions.id })
      .from(playbookVersions)
      .innerJoin(playbookFamilies, eq(playbookVersions.familyId, playbookFamilies.id))
      .where(
        and(
          eq(playbookFamilies.slug, 'execflow-br-fed-base'),
          eq(playbookVersions.versionLabel, 'v1.0-SEED'),
          eq(playbookVersions.status, 'published')
        )
      )
      .limit(1)

    if (pbRow === undefined) {
      throw new Error('Published playbook v1.0-SEED not found — run db:seed first.')
    }

    const evaluatedAt = new Date()
    const snapshotEffectiveAt = new Date(evaluatedAt.getTime() - 24 * 60 * 60 * 1000)

    const [existingSentence] = await db
      .select({ id: sentenceSnapshots.id })
      .from(sentenceSnapshots)
      .where(
        and(eq(sentenceSnapshots.executionCaseId, executionCaseId), eq(sentenceSnapshots.status, 'confirmed'))
      )
      .limit(1)

    if (existingSentence === undefined) {
      await db.insert(sentenceSnapshots).values({
        organizationId: caseRow.organizationId,
        executionCaseId,
        effectiveAt: snapshotEffectiveAt,
        status: 'confirmed',
        totalSentenceDays: 1000,
        servedDays: 200,
        remissionDays: 0,
        detractionDays: 0,
        remainingDays: 800,
        percentServed: '0.2000',
        confidenceLevel: 'high',
        playbookVersionId: pbRow.versionId,
        confirmedByUserId: lawyerUserId,
        confirmedAt: evaluatedAt,
      })
      console.log('[snapshot:http-engine] Inserted confirmed SentenceSnapshot.')
    } else {
      console.log('[snapshot:http-engine] Confirmed SentenceSnapshot already exists.')
    }

    const [existingCustody] = await db
      .select({ id: custodySnapshots.id })
      .from(custodySnapshots)
      .where(
        and(eq(custodySnapshots.executionCaseId, executionCaseId), eq(custodySnapshots.regime, 'fechado'))
      )
      .limit(1)

    if (existingCustody === undefined) {
      await db.insert(custodySnapshots).values({
        organizationId: caseRow.organizationId,
        executionCaseId,
        regime: 'fechado',
        effectiveAt: snapshotEffectiveAt,
        confidence: 'high',
        confirmedByUserId: lawyerUserId,
        confirmedAt: evaluatedAt,
      })
      console.log('[snapshot:http-engine] Inserted confirmed custody snapshot.')
    } else {
      console.log('[snapshot:http-engine] Custody snapshot already present.')
    }

    console.log(`[snapshot:http-engine] CASE_ID=${executionCaseId}`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

void main().catch((err) => {
  console.error('[snapshot:http-engine] Failed:', err)
  process.exit(1)
})
