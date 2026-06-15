/**
 * Minimal runtime smoke: playbook resolution → evaluation → commit persistence.
 *
 * Prerequisites: migrations applied + db:seed (org execflow-demo, admin user, BR-FED playbook).
 *
 * Usage (from repo root):
 *   pnpm --filter @execflow/workers smoke:runtime
 *
 * Requires DATABASE_URL (via packages/workers/.env.local or shell).
 */

import { randomUUID } from 'node:crypto'
import { eq, and } from '@execflow/db/client'
import {
  organizations,
  users,
  clients,
  executionCases,
  sentenceSnapshots,
  custodySnapshots,
  playbookVersions,
  playbookFamilies,
  engineRuns,
  engineRuleTraces,
  explanationBundles,
} from '@execflow/db/schema'
import { resolvePlaybookVersions, runEvaluation, commitEngineRun } from '@execflow/engine'
import { assertEngineRunRowIsReplayBoolean } from '@execflow/db/types'
import { createWorkersDb } from '../src/lib/db.ts'

const SMOKE_CLIENT_REF = 'SMOKE-E2E-CLIENT'
const SMOKE_CASE_REF = 'SMOKE-E2E-CASE'
/** Stable synthetic CNJ-shaped number for uniqueness smoke runs */
const SMOKE_PROCESS_NUMBER = '0000999-99.2099.8.26.0999'

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL']
  if (databaseUrl === undefined || databaseUrl === '') {
    console.error('[smoke] DATABASE_URL is required')
    process.exit(1)
  }

  const db = createWorkersDb(databaseUrl)

  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, 'execflow-demo'))
    .limit(1)

  if (org === undefined) {
    console.error('[smoke] Organization slug execflow-demo not found. Run pnpm --filter @execflow/db db:seed')
    process.exit(1)
  }

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'admin@execflow.local'))
    .limit(1)

  if (admin === undefined) {
    console.error('[smoke] admin@execflow.local not found. Run db:seed.')
    process.exit(1)
  }

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
    console.error('[smoke] Published playbook v1.0-SEED not found. Run db:seed.')
    process.exit(1)
  }

  const playbookVersionId = pbRow.versionId

  let executionCaseId: string

  const [existingCase] = await db
    .select({ id: executionCases.id })
    .from(executionCases)
    .where(and(eq(executionCases.organizationId, org.id), eq(executionCases.internalRef, SMOKE_CASE_REF)))
    .limit(1)

  if (existingCase !== undefined) {
    executionCaseId = existingCase.id
    console.info('[smoke] Reusing execution case', executionCaseId)
  } else {
    const clientId = randomUUID()
    executionCaseId = randomUUID()

    await db.insert(clients).values({
      id: clientId,
      organizationId: org.id,
      fullName: 'Smoke Test Client',
      internalRef: SMOKE_CLIENT_REF,
      responsibleLawyerUserId: admin.id,
      createdByUserId: admin.id,
    })

    await db.insert(executionCases).values({
      id: executionCaseId,
      organizationId: org.id,
      clientId,
      internalRef: SMOKE_CASE_REF,
      executionProcessNumber: SMOKE_PROCESS_NUMBER,
      responsibleLawyerUserId: admin.id,
      createdByUserId: admin.id,
      openedAt: new Date('2024-01-15T12:00:00.000Z'),
      status: 'active',
    })
    console.info('[smoke] Created smoke client + execution case', executionCaseId)
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
      organizationId: org.id,
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
      playbookVersionId,
      confirmedByUserId: admin.id,
      confirmedAt: evaluatedAt,
    })
    console.info('[smoke] Inserted confirmed SentenceSnapshot')
  } else {
    console.info('[smoke] Confirmed SentenceSnapshot already present')
  }

  const [existingCustody] = await db
    .select({ id: custodySnapshots.id })
    .from(custodySnapshots)
    .where(
      and(
        eq(custodySnapshots.executionCaseId, executionCaseId),
        eq(custodySnapshots.regime, 'fechado')
      )
    )
    .limit(1)

  if (existingCustody === undefined) {
    await db.insert(custodySnapshots).values({
      organizationId: org.id,
      executionCaseId,
      regime: 'fechado',
      effectiveAt: snapshotEffectiveAt,
      confidence: 'high',
      confirmedByUserId: admin.id,
      confirmedAt: evaluatedAt,
    })
    console.info('[smoke] Inserted custody snapshot (confirmed)')
  } else {
    console.info('[smoke] Custody snapshot already present')
  }

  const resolution = await resolvePlaybookVersions(db, {
    organizationId: org.id,
    jurisdictionScope: 'BR-FED',
    evaluatedAt,
  })

  console.info('[smoke] Playbook resolution:', JSON.stringify(resolution))

  if (!resolution.found) {
    console.error('[smoke] Playbook resolution failed — cannot evaluate.')
    process.exit(1)
  }

  const runId = randomUUID()
  const { result, ctx } = await runEvaluation(db, {
    runId,
    organizationId: org.id,
    executionCaseId,
    evaluatedAt,
    jurisdictionScope: 'BR-FED',
    trigger: 'manual',
  })

  console.info(
    '[smoke] Evaluation complete:',
    `traces=${result.ruleTraces.length}, proposals=${result.opportunityProposals.length}, warnings=${result.warnings.length}`
  )

  await commitEngineRun(db, ctx, result, {
    trigger: 'manual',
    requestedByUserId: admin.id,
    isReplay: false,
    overlayVersionId: resolution.overlayVersionId ?? undefined,
  })

  const [runRow] = await db.select().from(engineRuns).where(eq(engineRuns.id, runId)).limit(1)
  const traces = await db
    .select()
    .from(engineRuleTraces)
    .where(eq(engineRuleTraces.engineRunId, runId))
  const bundles = await db
    .select()
    .from(explanationBundles)
    .where(eq(explanationBundles.engineRunId, runId))

  console.info('[smoke] Persisted EngineRun status:', runRow?.status ?? '(missing)')
  console.info('[smoke] engine_rule_traces rows:', traces.length)
  console.info('[smoke] explanation_bundles rows:', bundles.length)

  if (runRow === undefined || runRow.status !== 'completed') {
    console.error('[smoke] EngineRun missing or not completed')
    process.exit(1)
  }

  try {
    assertEngineRunRowIsReplayBoolean(runRow, 'smoke-runtime-validation')
  } catch (err) {
    console.error('[smoke] engine_runs.is_replay type integrity failed:', err)
    process.exit(1)
  }
  if (runRow.isReplay !== false) {
    console.error('[smoke] Expected isReplay=false for operational commit, got', runRow.isReplay)
    process.exit(1)
  }
  if (typeof runRow.isReplay !== 'boolean') {
    console.error('[smoke] typeof isReplay must be boolean, got', typeof runRow.isReplay)
    process.exit(1)
  }

  if (traces.length === 0) {
    console.error('[smoke] Expected at least one rule trace')
    process.exit(1)
  }
  if (bundles.length === 0) {
    console.error('[smoke] Expected at least one explanation bundle (from opportunity proposals)')
    process.exit(1)
  }

  console.info('[smoke] OK — minimal engine persistence validated.')
  process.exit(0)
}

main().catch((err) => {
  console.error('[smoke] Fatal:', err)
  process.exit(1)
})
