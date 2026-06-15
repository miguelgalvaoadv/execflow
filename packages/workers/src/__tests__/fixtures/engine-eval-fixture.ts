/**
 * Fixtures for recalculation orchestration integration tests.
 */

import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import type { WorkersDb } from '../../lib/db.ts'
import {
  sentenceSnapshots,
  custodySnapshots,
} from '@execflow/db/schema'
import { createHash } from 'node:crypto'

export type EngineEvalFixture = {
  organizationId: string
  userId: string
  clientId: string
  executionCaseId: string
  playbookVersionId: string
  timelineEventId: string
}

const MINIMAL_RULE_GROUPS = {
  groups: [
    {
      groupId: 'progression_fractions',
      label: 'Test progression',
      rules: [
        {
          ruleId: 'test.progression.16',
          evaluatorId: 'progressionFraction',
          cautionLevel: 'low' as const,
          requiresPartnerReview: false,
          branches: [
            {
              branchId: 'default',
              label: 'Primário (16%)',
              isDefault: true,
              parameters: {
                requiredFraction: 0.16,
                denominatorBasis: 'total_sentence_days',
                targetRegime: 'semiaberto',
              },
              legalReferences: ['LEP, art. 112, I'],
            },
          ],
        },
      ],
    },
  ],
}

function hashRuleGroups(obj: object): string {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex')
}

export async function insertEngineEvalFixture(client: pg.PoolClient): Promise<EngineEvalFixture> {
  const organizationId = randomUUID()
  const userId = randomUUID()
  const clientId = randomUUID()
  const executionCaseId = randomUUID()
  const membershipId = randomUUID()
  const playbookFamilyId = randomUUID()
  const playbookVersionId = randomUUID()
  const timelineEventId = randomUUID()

  await client.query(
    `INSERT INTO organizations (id, slug, name, status)
     VALUES ($1, $2, $3, 'active')`,
    [organizationId, `recalc-org-${organizationId.slice(0, 8)}`, 'Recalc Test Org']
  )

  await client.query(
    `INSERT INTO users (id, email, display_name, status)
     VALUES ($1, $2, $3, 'active')`,
    [userId, `recalc-${userId.slice(0, 8)}@execflow.test`, 'Recalc Test User']
  )

  await client.query(
    `INSERT INTO memberships (id, organization_id, user_id, role, status)
     VALUES ($1, $2, $3, 'lawyer', 'active')`,
    [membershipId, organizationId, userId]
  )

  await client.query(
    `INSERT INTO clients (
       id, organization_id, full_name, internal_ref,
       responsible_lawyer_user_id, created_by_user_id, status
     ) VALUES ($1, $2, $3, $4, $5, $5, 'active')`,
    [clientId, organizationId, 'Recalc Client', `RC-${clientId.slice(0, 8)}`, userId]
  )

  await client.query(
    `INSERT INTO execution_cases (
       id, organization_id, client_id, internal_ref,
       responsible_lawyer_user_id, opened_at, created_by_user_id, case_status
     ) VALUES ($1, $2, $3, $4, $5, NOW(), $5, 'active')`,
    [executionCaseId, organizationId, clientId, `CASE-${executionCaseId.slice(0, 8)}`, userId]
  )

  await client.query(
    `INSERT INTO playbook_families (
       id, slug, name, jurisdiction_scope, is_overlay, organization_id
     ) VALUES ($1, $2, $3, 'BR-FED', FALSE, NULL)`,
    [playbookFamilyId, `pf-${playbookFamilyId.slice(0, 8)}`, 'BR-FED Base Test']
  )

  const ruleGroupsJson = JSON.stringify(MINIMAL_RULE_GROUPS)
  const contentHash = hashRuleGroups(MINIMAL_RULE_GROUPS)

  await client.query(
    `INSERT INTO playbook_versions (
       id, family_id, version_label, status, rule_groups, content_hash,
       effective_from, published_at
     ) VALUES ($1, $2, 'v1-test', 'published', $3::jsonb, $4, NOW() - INTERVAL '1 day', NOW())`,
    [playbookVersionId, playbookFamilyId, ruleGroupsJson, contentHash]
  )

  await client.query(
    `INSERT INTO timeline_events (
       id, organization_id, execution_case_id, event_type, event_category,
       occurred_at, summary, payload, source, actor_type, actor_id
     ) VALUES ($1, $2, $3, 'benefit.granted', 'benefit', NOW(), 'Test benefit granted', '{}'::jsonb, 'manual', 'user', $4)`,
    [timelineEventId, organizationId, executionCaseId, userId]
  )

  return {
    organizationId,
    userId,
    clientId,
    executionCaseId,
    playbookVersionId,
    timelineEventId,
  }
}

export async function insertConfirmedSnapshots(
  db: WorkersDb,
  fixture: EngineEvalFixture
): Promise<void> {
  const evaluatedAt = new Date()
  const snapshotEffectiveAt = new Date(evaluatedAt.getTime() - 24 * 60 * 60 * 1000)

  await db.insert(sentenceSnapshots).values({
    organizationId: fixture.organizationId,
    executionCaseId: fixture.executionCaseId,
    effectiveAt: snapshotEffectiveAt,
    status: 'confirmed',
    totalSentenceDays: 1000,
    servedDays: 200,
    remissionDays: 0,
    detractionDays: 0,
    remainingDays: 800,
    percentServed: '0.2000',
    confidenceLevel: 'high',
    playbookVersionId: fixture.playbookVersionId,
    confirmedByUserId: fixture.userId,
    confirmedAt: evaluatedAt,
  })

  await db.insert(custodySnapshots).values({
    organizationId: fixture.organizationId,
    executionCaseId: fixture.executionCaseId,
    regime: 'fechado',
    effectiveAt: snapshotEffectiveAt,
    confidence: 'high',
    confirmedByUserId: fixture.userId,
    confirmedAt: evaluatedAt,
  })
}

/** Relay-shaped pg-boss job for engine.evaluation.requested. */
export function buildEvaluationRequestedJob(params: {
  eventId: string
  organizationId: string
  correlationId: string
  causationId: string | null
  payload: Record<string, unknown>
}): { data: Record<string, unknown>; id: string } {
  return {
    id: randomUUID(),
    data: {
      eventId: params.eventId,
      eventType: 'engine.evaluation.requested',
      organizationId: params.organizationId,
      correlationId: params.correlationId,
      causationId: params.causationId,
      occurredAt: new Date().toISOString(),
      payload: params.payload,
    },
  }
}
