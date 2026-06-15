/**
 * seed-demo.ts — Fase 1: Infraestrutura de demonstração.
 *
 * NÃO sobrescreve seed.ts. Este script complementa o seed base com:
 *   - Lookup dos registros criados pelo seed.ts (org, admin user, playbookVersion)
 *   - 1 usuário adicional com role 'lawyer' (Dr. Rafael Mendes)
 *   - 1 usuário adicional com role 'assistant' (Dra. Isabela Costa)
 *   - 4 prison_units globais (null organization_id) para os 12 casos de demo
 *
 * PRÉ-REQUISITO:
 *   Execute primeiro: pnpm --filter @execflow/db db:seed
 *   As seguintes entidades DEVEM existir antes desta fase:
 *     - 1 organization (slug='execflow-demo')
 *     - 1 user (email='admin@execflow.local', role=admin)
 *     - 1 playbookFamily (slug='execflow-br-fed-base')
 *     - 1 playbookVersion (versionLabel='v1.0-SEED', status='published')
 *
 * IDEMPOTÊNCIA:
 *   Este script verifica a existência de cada registro antes de inserir.
 *   É seguro para reexecução. Não cria duplicatas.
 *
 * FASE 1 cria:
 *   - users: Dr. Rafael Mendes (lawyer) + Dra. Isabela Costa (assistant)
 *   - memberships: lawyer + assistant na org seed
 *   - authUsers + authAccounts: credentials para os dois usuários
 *   - prison_units: 4 unidades globais de referência
 *
 * FASE 1 NÃO cria:
 *   - clients
 *   - execution_cases
 *   - documents
 *   - sentence_snapshots
 *   - deadlines
 *   - opportunities
 *   - queue_projections
 *
 * Usage:
 *   pnpm --filter @execflow/db db:seed:demo
 *
 * Architecture ref: seed_strategy.md, seed_preflight_check.md
 */

import { createHash, randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq, and, isNull } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import {
  organizations,
  users,
  memberships,
  playbookFamilies,
  playbookVersions,
  prisonUnits,
  authUsers,
  authAccounts,
} from './schema/index.ts'

// ---------------------------------------------------------------------------
// Database connection
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env['DATABASE_URL']
if (DATABASE_URL === undefined || DATABASE_URL === '') {
  throw new Error(
    '[seed-demo] DATABASE_URL is not set. Copy packages/db/.env.example to .env.local and pass --env-file.'
  )
}

const sql = postgres(DATABASE_URL)
const db = drizzle(sql)

// ---------------------------------------------------------------------------
// Deterministic ID helpers
// ---------------------------------------------------------------------------

/**
 * Generates a deterministic UUID v5-style ID from a namespace + name.
 * Same inputs → same output on every run. Enables idempotent inserts.
 *
 * Uses SHA-1 with UUID v5 bit layout (RFC 4122 §4.3).
 */
function deterministicUUID(name: string): string {
  const NAMESPACE = 'execflow-demo-seed-phase1-v1'
  const hash = createHash('sha1').update(`${NAMESPACE}:${name}`).digest()
  // UUID v5 bit manipulation per RFC 4122
  hash[6] = ((hash[6]! & 0x0f) | 0x50) as number // version 5
  hash[8] = ((hash[8]! & 0x3f) | 0x80) as number // variant bits
  const h = hash.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

// Stable IDs for Fase 1 — deterministic across all runs
const DEMO_LAWYER_ID    = deterministicUUID('user.rafael-mendes.lawyer')
const DEMO_ASSISTANT_ID = deterministicUUID('user.isabela-costa.assistant')

const PRISON_TREMEMBÉ_ID   = deterministicUUID('prison.penitenciaria-tremebe-ii.SP')
const PRISON_PRES_PRUDENTE_ID = deterministicUUID('prison.penitenciaria-presidente-prudente.SP')
const PRISON_CR_SP_ID      = deterministicUUID('prison.centro-ressocializacao-sao-paulo.SP')
const PRISON_CR_SANTOS_ID  = deterministicUUID('prison.centro-ressocializacao-santos.SP')

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

type LookupResult = {
  orgId: string
  adminUserId: string
  playbookVersionId: string
  playbookFamilyId: string
}

// ---------------------------------------------------------------------------
// Step 0 — Lookup de entidades existentes (criadas pelo seed.ts base)
// ---------------------------------------------------------------------------

async function lookupBaseEntities(): Promise<LookupResult> {
  console.log('\n[demo:phase1] Step 0 — Verifying base entities from seed.ts...')

  // Org
  const orgRows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, 'execflow-demo'))
    .limit(1)

  if (orgRows.length === 0 || orgRows[0] === undefined) {
    throw new Error(
      '[demo:phase1] BLOCKED: Organization "execflow-demo" not found.\n' +
      '  Run first: pnpm --filter @execflow/db db:seed'
    )
  }
  const orgId = orgRows[0].id
  console.log(`  ✓ Organization found: ${orgId}`)

  // Admin user
  const adminRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'admin@execflow.local'))
    .limit(1)

  if (adminRows.length === 0 || adminRows[0] === undefined) {
    throw new Error(
      '[demo:phase1] BLOCKED: Admin user "admin@execflow.local" not found.\n' +
      '  Run first: pnpm --filter @execflow/db db:seed'
    )
  }
  const adminUserId = adminRows[0].id
  console.log(`  ✓ Admin user found: ${adminUserId}`)

  // PlaybookFamily
  const familyRows = await db
    .select({ id: playbookFamilies.id })
    .from(playbookFamilies)
    .where(
      and(
        eq(playbookFamilies.slug, 'execflow-br-fed-base'),
        isNull(playbookFamilies.organizationId)
      )
    )
    .limit(1)

  if (familyRows.length === 0 || familyRows[0] === undefined) {
    throw new Error(
      '[demo:phase1] BLOCKED: PlaybookFamily "execflow-br-fed-base" not found.\n' +
      '  Run first: pnpm --filter @execflow/db db:seed'
    )
  }
  const playbookFamilyId = familyRows[0].id
  console.log(`  ✓ PlaybookFamily found: ${playbookFamilyId}`)

  // PlaybookVersion (published)
  const versionRows = await db
    .select({ id: playbookVersions.id })
    .from(playbookVersions)
    .where(
      and(
        eq(playbookVersions.familyId, playbookFamilyId),
        eq(playbookVersions.status, 'published')
      )
    )
    .limit(1)

  if (versionRows.length === 0 || versionRows[0] === undefined) {
    throw new Error(
      '[demo:phase1] BLOCKED: No published PlaybookVersion found for family "execflow-br-fed-base".\n' +
      '  Run first: pnpm --filter @execflow/db db:seed'
    )
  }
  const playbookVersionId = versionRows[0].id
  console.log(`  ✓ PlaybookVersion found: ${playbookVersionId} (status=published)`)

  return { orgId, adminUserId, playbookVersionId, playbookFamilyId }
}

// ---------------------------------------------------------------------------
// Step 1 — Usuário: Dr. Rafael Mendes (lawyer)
// ---------------------------------------------------------------------------

async function upsertLawyer(orgId: string, adminUserId: string): Promise<void> {
  console.log('\n[demo:phase1] Step 1 — Dr. Rafael Mendes (lawyer)...')

  const seedPassword = process.env['EXECFLOW_SEED_AUTH_PASSWORD'] ?? 'ExecflowDevSmoke123!'

  // Check if already exists
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'rafael.mendes@execflow.local'))
    .limit(1)

  if (existing.length > 0 && existing[0] !== undefined) {
    console.log(`  ↩ Already exists: ${existing[0].id} — skipping`)
    return
  }

  const now = new Date()
  const hashedPassword = await hashPassword(seedPassword)

  // Domain user
  await db.insert(users).values({
    id: DEMO_LAWYER_ID,
    email: 'rafael.mendes@execflow.local',
    displayName: 'Dr. Rafael Mendes',
    barNumber: 'SP-123456',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  })
  console.log(`  ✓ users: Dr. Rafael Mendes (${DEMO_LAWYER_ID})`)

  // Membership — lawyer
  await db.insert(memberships).values({
    id: deterministicUUID('membership.rafael-mendes.execflow-demo'),
    organizationId: orgId,
    userId: DEMO_LAWYER_ID,
    role: 'lawyer',
    status: 'active',
    invitedByUserId: adminUserId,
    invitedAt: now,
    acceptedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  console.log(`  ✓ memberships: Dr. Rafael Mendes → lawyer`)

  // Better Auth tables
  await db.insert(authUsers).values({
    id: DEMO_LAWYER_ID,
    name: 'Dr. Rafael Mendes',
    email: 'rafael.mendes@execflow.local',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })

  await db.insert(authAccounts).values({
    id: deterministicUUID('auth-account.rafael-mendes'),
    accountId: DEMO_LAWYER_ID,
    providerId: 'credential',
    userId: DEMO_LAWYER_ID,
    password: hashedPassword,
    createdAt: now,
    updatedAt: now,
  })
  console.log(`  ✓ auth: credential provisioned (rafael.mendes@execflow.local)`)
}

// ---------------------------------------------------------------------------
// Step 2 — Usuário: Dra. Isabela Costa (assistant)
// ---------------------------------------------------------------------------

async function upsertAssistant(orgId: string, adminUserId: string): Promise<void> {
  console.log('\n[demo:phase1] Step 2 — Dra. Isabela Costa (assistant)...')

  const seedPassword = process.env['EXECFLOW_SEED_AUTH_PASSWORD'] ?? 'ExecflowDevSmoke123!'

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'isabela.costa@execflow.local'))
    .limit(1)

  if (existing.length > 0 && existing[0] !== undefined) {
    console.log(`  ↩ Already exists: ${existing[0].id} — skipping`)
    return
  }

  const now = new Date()
  const hashedPassword = await hashPassword(seedPassword)

  await db.insert(users).values({
    id: DEMO_ASSISTANT_ID,
    email: 'isabela.costa@execflow.local',
    displayName: 'Dra. Isabela Costa',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  })
  console.log(`  ✓ users: Dra. Isabela Costa (${DEMO_ASSISTANT_ID})`)

  await db.insert(memberships).values({
    id: deterministicUUID('membership.isabela-costa.execflow-demo'),
    organizationId: orgId,
    userId: DEMO_ASSISTANT_ID,
    role: 'assistant',
    status: 'active',
    invitedByUserId: adminUserId,
    invitedAt: now,
    acceptedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  console.log(`  ✓ memberships: Dra. Isabela Costa → assistant`)

  await db.insert(authUsers).values({
    id: DEMO_ASSISTANT_ID,
    name: 'Dra. Isabela Costa',
    email: 'isabela.costa@execflow.local',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })

  await db.insert(authAccounts).values({
    id: deterministicUUID('auth-account.isabela-costa'),
    accountId: DEMO_ASSISTANT_ID,
    providerId: 'credential',
    userId: DEMO_ASSISTANT_ID,
    password: hashedPassword,
    createdAt: now,
    updatedAt: now,
  })
  console.log(`  ✓ auth: credential provisioned (isabela.costa@execflow.local)`)
}

// ---------------------------------------------------------------------------
// Step 3 — Prison Units (global — organizationId = null)
// ---------------------------------------------------------------------------

async function upsertPrisonUnits(): Promise<void> {
  console.log('\n[demo:phase1] Step 3 — Prison units (global catalog)...')

  const now = new Date()

  const units = [
    {
      id: PRISON_TREMEMBÉ_ID,
      organizationId: null,
      name: 'Penitenciária Estadual de Tremembé II',
      code: 'SAP-SP-TREMB-002',
      stateCode: 'SP',
      city: 'Tremembé',
      regimeCapabilities: ['fechado'],
      administrativeAuthority: 'SAP-SP',
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PRISON_PRES_PRUDENTE_ID,
      organizationId: null,
      name: 'Penitenciária Estadual de Presidente Prudente I',
      code: 'SAP-SP-PRPRU-001',
      stateCode: 'SP',
      city: 'Presidente Prudente',
      regimeCapabilities: ['fechado'],
      administrativeAuthority: 'SAP-SP',
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PRISON_CR_SP_ID,
      organizationId: null,
      name: 'Centro de Ressocialização de São Paulo — Zona Leste',
      code: 'SAP-SP-CRSP-001',
      stateCode: 'SP',
      city: 'São Paulo',
      regimeCapabilities: ['semiaberto'],
      administrativeAuthority: 'SAP-SP',
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PRISON_CR_SANTOS_ID,
      organizationId: null,
      name: 'Centro de Ressocialização de Santos',
      code: 'SAP-SP-CRSAN-001',
      stateCode: 'SP',
      city: 'Santos',
      regimeCapabilities: ['semiaberto'],
      administrativeAuthority: 'SAP-SP',
      active: true,
      createdAt: now,
      updatedAt: now,
    },
  ]

  for (const unit of units) {
    // Check existence by deterministic ID
    const existing = await db
      .select({ id: prisonUnits.id })
      .from(prisonUnits)
      .where(eq(prisonUnits.id, unit.id))
      .limit(1)

    if (existing.length > 0) {
      console.log(`  ↩ Already exists: ${unit.code} — skipping`)
      continue
    }

    await db.insert(prisonUnits).values(unit)
    console.log(`  ✓ prison_units: ${unit.name} (${unit.code})`)
  }
}

// ---------------------------------------------------------------------------
// Step 4 — Validação final
// ---------------------------------------------------------------------------

async function validatePhase1(ctx: LookupResult): Promise<void> {
  console.log('\n[demo:phase1] Step 4 — Validation...')

  // Org
  const orgCheck = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, 'execflow-demo'))
    .limit(1)
  console.log(`  ✓ Organization:       ${orgCheck[0]?.id ?? 'MISSING'}`)

  // Users
  const lawyerCheck = await db
    .select({ id: users.id, email: users.email, status: users.status })
    .from(users)
    .where(eq(users.id, DEMO_LAWYER_ID))
    .limit(1)
  console.log(`  ✓ Lawyer user:        ${lawyerCheck[0]?.email ?? 'MISSING'} (${lawyerCheck[0]?.id ?? '?'})`)

  const assistantCheck = await db
    .select({ id: users.id, email: users.email, status: users.status })
    .from(users)
    .where(eq(users.id, DEMO_ASSISTANT_ID))
    .limit(1)
  console.log(`  ✓ Assistant user:     ${assistantCheck[0]?.email ?? 'MISSING'} (${assistantCheck[0]?.id ?? '?'})`)

  // Memberships
  const lawyerMbCheck = await db
    .select({ id: memberships.id, role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, ctx.orgId),
        eq(memberships.userId, DEMO_LAWYER_ID)
      )
    )
    .limit(1)
  console.log(`  ✓ Lawyer membership:  role=${lawyerMbCheck[0]?.role ?? 'MISSING'}`)

  const assistantMbCheck = await db
    .select({ id: memberships.id, role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, ctx.orgId),
        eq(memberships.userId, DEMO_ASSISTANT_ID)
      )
    )
    .limit(1)
  console.log(`  ✓ Assistant membership: role=${assistantMbCheck[0]?.role ?? 'MISSING'}`)

  // PlaybookVersion
  console.log(`  ✓ PlaybookVersion:    ${ctx.playbookVersionId} (status=published)`)

  // Prison units
  const prisonCount = await db
    .select({ id: prisonUnits.id, code: prisonUnits.code, name: prisonUnits.name })
    .from(prisonUnits)
    .where(
      and(
        isNull(prisonUnits.organizationId)
      )
    )
  console.log(`  ✓ Prison units (global): ${prisonCount.length} registered`)
  for (const u of prisonCount) {
    console.log(`      - ${u.code}: ${u.name}`)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function seedDemoPhase1(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║       EXECFLOW Demo Seed — Fase 1: Infraestrutura        ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log()
  console.log('  Senha usada: EXECFLOW_SEED_AUTH_PASSWORD env var')
  console.log('  (default: ExecflowDevSmoke123!)')

  try {
    // Step 0: lookup base entities (must exist from seed.ts)
    const ctx = await lookupBaseEntities()

    // Step 1: Dr. Rafael Mendes (lawyer)
    await upsertLawyer(ctx.orgId, ctx.adminUserId)

    // Step 2: Dra. Isabela Costa (assistant)
    await upsertAssistant(ctx.orgId, ctx.adminUserId)

    // Step 3: Prison units
    await upsertPrisonUnits()

    // Step 4: Validate everything
    await validatePhase1(ctx)

    console.log()
    console.log('╔══════════════════════════════════════════════════════════╗')
    console.log('║  ✅  Fase 1 concluída com sucesso                        ║')
    console.log('║                                                          ║')
    console.log('║  IDs estáveis (deterministicos) disponíveis:             ║')
    console.log(`║  DEMO_LAWYER_ID    = ${DEMO_LAWYER_ID}  ║`)
    console.log(`║  DEMO_ASSISTANT_ID = ${DEMO_ASSISTANT_ID}  ║`)
    console.log('║                                                          ║')
    console.log('║  Fase 2 (clients + execution_cases) pode iniciar.        ║')
    console.log('╚══════════════════════════════════════════════════════════╝')

  } catch (err) {
    console.error('\n[demo:phase1] ❌ FAILED:', err)
    process.exitCode = 1
  } finally {
    await sql.end({ timeout: 5 })
  }
}

void seedDemoPhase1().catch((err) => {
  console.error(err)
  process.exit(1)
})
