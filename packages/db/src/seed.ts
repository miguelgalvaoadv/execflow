/**
 * Minimal development seed — idempotent enough for empty databases.
 *
 * Populates:
 * - 1 organization, 1 domain user, 1 membership (admin)
 * - 1 platform PlaybookFamily (BR-FED base) + 1 published PlaybookVersion
 *
 * Rule branches use ONLY implemented evaluatorIds:
 *   progressionFraction, blockingConditionCheck, snapshotStalenessCheck
 *   (see packages/engine/src/rules/registry.ts)
 *
 * progressionFraction expects:
 *   requiredFraction, denominatorBasis; optional targetRegime
 * blockingConditionCheck expects:
 *   blockingCode (matches global blocking code strings when active)
 * snapshotStalenessCheck expects:
 *   maxDays (optional, default 180 in evaluator)
 *
 * Usage:
 *   DATABASE_URL=... node --env-file=.env.local --import tsx src/seed.ts
 *   or: pnpm --filter @execflow/db db:seed
 *
 * Architecture ref: playbook-system.md §2, execution-engine.md §0.
 */

import { createHash, randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { hashPassword } from 'better-auth/crypto'
import {
  organizations,
  users,
  memberships,
  playbookFamilies,
  playbookVersions,
  authUsers,
  authAccounts,
} from './schema/index.ts'

const DATABASE_URL = process.env['DATABASE_URL']
if (DATABASE_URL === undefined || DATABASE_URL === '') {
  throw new Error(
    'DATABASE_URL is not set. Copy packages/db/.env.example to .env.local and pass --env-file, or export DATABASE_URL.'
  )
}

const sql = postgres(DATABASE_URL)
const db = drizzle(sql)

/** Stable hash for content_hash column (integrity marker, not legal semantics). */
function hashRuleGroupsJson(obj: object): string {
  const payload = JSON.stringify(obj)
  return createHash('sha256').update(payload).digest('hex')
}

const RULE_GROUPS = {
  groups: [
    {
      groupId: 'progression_fractions',
      label: 'Frações de progressão (Pacote Anticrime — seed)',
      rules: [
        {
          ruleId: 'seed.progression.primary.16',
          evaluatorId: 'progressionFraction',
          cautionLevel: 'low' as const,
          requiresPartnerReview: false,
          branches: [
            {
              branchId: 'default',
              label: 'Primário sem violência (16%)',
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
        {
          ruleId: 'seed.progression.primary.25',
          evaluatorId: 'progressionFraction',
          cautionLevel: 'elevated' as const,
          requiresPartnerReview: false,
          branches: [
            {
              branchId: 'default',
              label: 'Primário com violência (25%)',
              isDefault: true,
              parameters: {
                requiredFraction: 0.25,
                denominatorBasis: 'total_sentence_days',
                targetRegime: 'semiaberto',
              },
              legalReferences: ['LEP, art. 112, III'],
            },
          ],
        },
        {
          ruleId: 'seed.progression.hediondo.40',
          evaluatorId: 'progressionFraction',
          cautionLevel: 'elevated' as const,
          requiresPartnerReview: false,
          branches: [
            {
              branchId: 'default',
              label: 'Hediondo primário (40%)',
              isDefault: true,
              parameters: {
                requiredFraction: 0.4,
                denominatorBasis: 'total_sentence_days',
                targetRegime: 'semiaberto',
              },
              legalReferences: ['LEP, art. 112, V'],
            },
          ],
        },
      ],
    },
    {
      groupId: 'guards',
      label: 'Bloqueios e integridade de snapshot (seed)',
      rules: [
        {
          ruleId: 'seed.blocking.escape',
          evaluatorId: 'blockingConditionCheck',
          cautionLevel: 'low' as const,
          requiresPartnerReview: false,
          branches: [
            {
              branchId: 'default',
              label: 'Alerta se condição de bloqueio ativa',
              isDefault: true,
              parameters: {
                blockingCode: 'BLK_ESCAPE',
              },
              legalReferences: [],
            },
          ],
        },
        {
          ruleId: 'seed.staleness.sentence',
          evaluatorId: 'snapshotStalenessCheck',
          cautionLevel: 'low' as const,
          requiresPartnerReview: false,
          branches: [
            {
              branchId: 'default',
              label: 'Snapshot de pena desatualizado',
              isDefault: true,
              parameters: {
                maxDays: 180,
              },
              legalReferences: [],
            },
          ],
        },
      ],
    },
  ],
  metadata: {
    changelog: 'Minimal runtime seed compatible with engine evaluators',
    legalReferences: ['Lei de Execução Penal', 'Pacote Anticrime (Lei 13.964/2019)'],
    testPackIds: [] as string[],
  },
}

async function seed(): Promise<void> {
  console.log('[db:seed] Starting minimal operational seed...')

  try {
    const orgId = randomUUID()
    await db.insert(organizations).values({
      id: orgId,
      name: 'ExecFlow Demo Org',
      slug: 'execflow-demo',
      status: 'active',
    })
    console.log(`[db:seed] Organization: ${orgId}`)

    const userId = randomUUID()
    await db.insert(users).values({
      id: userId,
      email: 'admin@execflow.local',
      displayName: 'System Admin',
      status: 'active',
    })
    console.log(`[db:seed] User: ${userId} (admin@execflow.local)`)

    await db.insert(memberships).values({
      id: randomUUID(),
      organizationId: orgId,
      userId,
      role: 'admin',
      status: 'active',
    })
    console.log('[db:seed] Membership: admin')

    const seedPassword =
      process.env['EXECFLOW_SEED_AUTH_PASSWORD'] ?? 'ExecflowDevSmoke123!'
    const hashedPassword = await hashPassword(seedPassword)
    const authNow = new Date()

    await db.insert(authUsers).values({
      id: userId,
      name: 'System Admin',
      email: 'admin@execflow.local',
      emailVerified: true,
      createdAt: authNow,
      updatedAt: authNow,
    })

    await db.insert(authAccounts).values({
      id: randomUUID(),
      accountId: userId,
      providerId: 'credential',
      userId,
      password: hashedPassword,
      createdAt: authNow,
      updatedAt: authNow,
    })
    console.log(
      '[db:seed] Better Auth credential provisioned for admin@execflow.local (password from EXECFLOW_SEED_AUTH_PASSWORD or dev default).'
    )

    const familyId = randomUUID()
    await db.insert(playbookFamilies).values({
      id: familyId,
      organizationId: null,
      slug: 'execflow-br-fed-base',
      name: 'Execução Penal Federal (BR) — base',
      jurisdictionScope: 'BR-FED',
      isOverlay: false,
      description: 'Platform base family for BR-FED progression seed.',
    })
    console.log(`[db:seed] PlaybookFamily: ${familyId}`)

    const versionId = randomUUID()
    const contentHash = hashRuleGroupsJson(RULE_GROUPS)

    await db.insert(playbookVersions).values({
      id: versionId,
      familyId,
      organizationId: null,
      versionLabel: 'v1.0-SEED',
      status: 'published',
      effectiveFrom: new Date('2020-01-23T00:00:00.000Z'),
      ruleGroups: RULE_GROUPS,
      contentHash,
      legalReferences: ['LEP, art. 112'],
      publishedByUserId: userId,
      publishedAt: new Date(),
      createdByUserId: userId,
    })
    console.log(`[db:seed] PlaybookVersion published: ${versionId} (content_hash set)`)

    console.log('\n[db:seed] Done. Apply migrations first, then run the API and workers with the same DATABASE_URL.')
  } catch (err) {
    console.error('[db:seed] Failed:', err)
    process.exitCode = 1
  } finally {
    await sql.end({ timeout: 5 })
  }
}

void seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
