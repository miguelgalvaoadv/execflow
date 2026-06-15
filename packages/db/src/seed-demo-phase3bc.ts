/**
 * seed-demo-phase3bc.ts — Fase 3B & 3C: Opportunities, Deadlines, Engine Runs, and Queue Projections
 *
 * Popula os cenários operacionais jurídicos realistas nos Hero Cases da Fase 2,
 * garantindo consistência narrativa e alinhamento do motor/fila no banco de dados.
 *
 * Usage:
 *   pnpm --filter @execflow/db db:seed:demo:phase3bc
 */

import { createHash } from 'node:crypto'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq, and, isNull } from 'drizzle-orm'
import {
  organizations,
  users,
  clients,
  executionCases,
  playbookFamilies,
  playbookVersions,
  opportunities,
  deadlines,
  engineRuns,
  queueProjections,
} from './schema/index.ts'

const DATABASE_URL = process.env['DATABASE_URL']
if (!DATABASE_URL) throw new Error('[demo:phase3bc] DATABASE_URL is not set.')

const sql = postgres(DATABASE_URL)
const db = drizzle(sql)

function deterministicUUID(name: string): string {
  const NAMESPACE = 'execflow-demo-seed-phase1-v1' // Same namespace as Phase 1 and 2
  const hash = createHash('sha1').update(`${NAMESPACE}:${name}`).digest()
  hash[6] = ((hash[6]! & 0x0f) | 0x50) as number
  hash[8] = ((hash[8]! & 0x3f) | 0x80) as number
  const h = hash.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

// Stable IDs for Lawyers and Clients
const DEMO_LAWYER_ID = deterministicUUID('user.rafael-mendes.lawyer')
const DEMO_ASSISTANT_ID = deterministicUUID('user.isabela-costa.assistant')

const CLI_001_JOSE_ID = deterministicUUID('client.jose-antonio-dos-santos')
const CLI_002_MARIA_ID = deterministicUUID('client.maria-conceicao-lima')
const CLI_003_ROBERTO_ID = deterministicUUID('client.roberto-carlos-ferreira')
const CLI_006_MARCOS_ID = deterministicUUID('client.marcos-vinicius-carvalho')

// Stable IDs for Cases
const CASO_001_ID_ACTUAL = deterministicUUID('case.jose-antonio.trafico-hediondo')
const CASO_002_ID_ACTUAL = deterministicUUID('case.maria-conceicao.furto-qualificado')
const CASO_003_ID_ACTUAL = deterministicUUID('case.roberto-ferreira.estelionato')
const CASO_007_ID_ACTUAL = deterministicUUID('case.marcos-carvalho.homicidio-hediondo')
const CASO_008_ID_ACTUAL = deterministicUUID('case.jose-antonio.apenso-pad')

type BaseCtx = {
  orgId: string
  lawyerId: string
  assistantId: string
  playbookVersionId: string
}

async function lookupBaseEntities(): Promise<BaseCtx> {
  const orgRows = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, 'execflow-demo')).limit(1)
  if (orgRows.length === 0) throw new Error('Organization "execflow-demo" not found.')

  const familyRows = await db
    .select({ id: playbookFamilies.id })
    .from(playbookFamilies)
    .where(and(eq(playbookFamilies.slug, 'execflow-br-fed-base'), isNull(playbookFamilies.organizationId)))
    .limit(1)
  if (familyRows.length === 0) throw new Error('Playbook family "execflow-br-fed-base" not found.')

  const versionRows = await db
    .select({ id: playbookVersions.id })
    .from(playbookVersions)
    .where(and(eq(playbookVersions.familyId, familyRows[0]!.id), eq(playbookVersions.status, 'published')))
    .limit(1)
  if (versionRows.length === 0) throw new Error('Published playbook version not found.')

  return {
    orgId: orgRows[0]!.id,
    lawyerId: DEMO_LAWYER_ID,
    assistantId: DEMO_ASSISTANT_ID,
    playbookVersionId: versionRows[0]!.id,
  }
}

async function seedOpportunities(ctx: BaseCtx) {
  console.log('Seeding opportunities...')
  let created = 0
  const now = new Date()

  const oppDefs = [
    // Caso 001 - José Antônio dos Santos (High confidence, progression suggestion)
    {
      id: deterministicUUID('opp.caso001.progressao'),
      executionCaseId: CASO_001_ID_ACTUAL,
      opportunityType: 'progression' as const,
      status: 'suggested' as const,
      summary: 'Progressão para o regime semiaberto',
      rationale: 'O apenado cumpriu a fração de 1/6 exigida para crimes cometidos antes da Lei 13.964/19 (Pacote Anticrime) e apresenta conduta carcerária classificada como EXCELENTE no Atestado de Conduta.',
      confidenceLevel: 'high' as const,
      legalBasis: 'LEP, art. 112, I.',
      windowStartAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 10), // 10 days ago
      windowEndAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 90), // 90 days from now
      isBlocked: false,
    },
    {
      id: deterministicUUID('opp.caso001.remicao'),
      executionCaseId: CASO_001_ID_ACTUAL,
      opportunityType: 'remission' as const,
      status: 'qualified' as const,
      summary: 'Remição de pena por trabalho (30 dias remidos)',
      rationale: 'Declaração emitida pela oficina de trabalho atesta 90 dias de atividade laboral efetiva no período de out/2024 a jan/2025.',
      confidenceLevel: 'high' as const,
      legalBasis: 'LEP, art. 126, § 1º, II.',
      windowStartAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 5),
      windowEndAt: null,
      isBlocked: false,
    },
    // Caso 002 - Maria da Conceição Lima (Blocked due to missing data)
    {
      id: deterministicUUID('opp.caso002.progressao'),
      executionCaseId: CASO_002_ID_ACTUAL,
      opportunityType: 'progression' as const,
      status: 'suggested' as const,
      summary: 'Progressão ao regime aberto',
      rationale: 'Fração temporal teoricamente atingida baseada em dados parciais. No entanto, necessita de confirmação da Guia de Execução original.',
      confidenceLevel: 'medium' as const,
      legalBasis: 'LEP, art. 112, II.',
      windowStartAt: null,
      windowEndAt: null,
      isBlocked: true,
      blockingConditions: [
        { condition: 'Falta confirmação da data-base de cálculo', type: 'missing_data' }
      ],
    },
    // Caso 003 - Roberto Carlos Ferreira (Excess execution)
    {
      id: deterministicUUID('opp.caso003.excesso'),
      executionCaseId: CASO_003_ID_ACTUAL,
      opportunityType: 'excess_execution' as const,
      status: 'suggested' as const,
      summary: 'Excesso de execução detectado',
      rationale: 'O término projetado da pena ocorreu em 2021, porém não consta decisão judicial extinguindo a punibilidade formalmente no prontuário.',
      confidenceLevel: 'high' as const,
      legalBasis: 'LEP, art. 185.',
      windowStartAt: new Date('2021-09-14T00:00:00Z'),
      windowEndAt: null,
      isBlocked: false,
    },
    // Caso 007 - Marcos Vinícius Carvalho (Dismissed progression opportunity)
    {
      id: deterministicUUID('opp.caso007.progressao'),
      executionCaseId: CASO_007_ID_ACTUAL,
      opportunityType: 'progression' as const,
      status: 'dismissed' as const,
      summary: 'Progressão ao regime semiaberto',
      rationale: 'Tempo de cumprimento de 2/5 atingido, mas conduta obstada temporariamente por falta grave.',
      confidenceLevel: 'low' as const,
      legalBasis: 'LEP, art. 112.',
      windowStartAt: null,
      windowEndAt: null,
      dismissedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 3), // 3 days ago
      dismissedByUserId: ctx.lawyerId,
      dismissedReason: 'Falta disciplinar de natureza grave cometida em 12/03/2026 impede a progressão temporal imediata.',
      isBlocked: false,
    }
  ]

  for (const def of oppDefs) {
    const existing = await db.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.id, def.id)).limit(1)
    if (existing.length > 0) continue

    await db.insert(opportunities).values({
      id: def.id,
      organizationId: ctx.orgId,
      executionCaseId: def.executionCaseId,
      opportunityType: def.opportunityType,
      status: def.status,
      summary: def.summary,
      rationale: def.rationale,
      confidenceLevel: def.confidenceLevel,
      legalBasis: def.legalBasis,
      windowStartAt: def.windowStartAt,
      windowEndAt: def.windowEndAt,
      isBlocked: def.isBlocked,
      blockingConditions: def.blockingConditions || null,
      dismissedAt: def.dismissedAt || null,
      dismissedByUserId: def.dismissedByUserId || null,
      dismissedReason: def.dismissedReason || null,
      playbookVersionId: ctx.playbookVersionId,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 5),
      updatedAt: now,
    } as any)
    created++
  }

  return created
}

async function seedDeadlines(ctx: BaseCtx) {
  console.log('Seeding deadlines...')
  let created = 0
  const now = new Date()

  const deadlineDefs = [
    // Caso 008 (Apenso PAD de José Antônio) - Overdue Critical legal deadline
    {
      id: deterministicUUID('deadline.caso008.pad'),
      executionCaseId: CASO_008_ID_ACTUAL,
      title: 'Defesa Escrita em PAD - Prontuário 102/2026',
      description: 'Apresentar defesa técnica em face da imputação de posse de aparelho celular (falta grave).',
      dueAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 2), // 2 days overdue
      deadlineClass: 'disciplinary' as const,
      origin: 'rule' as const,
      priority: 'critical' as const,
      status: 'overdue' as const,
      assigneeUserId: ctx.lawyerId,
      legalBasis: 'LEP, art. 59.',
    },
    // Caso 001 - Open Benefit deadline in future
    {
      id: deterministicUUID('deadline.caso001.beneficio'),
      executionCaseId: CASO_001_ID_ACTUAL,
      title: 'Pedir Progressão de Regime (Fração 1/6)',
      description: 'Protocolar petição de progressão de regime semiaberto instruída com atestado de conduta carcerária.',
      dueAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 7), // 7 days in future
      deadlineClass: 'benefit' as const,
      origin: 'rule' as const,
      priority: 'high' as const,
      status: 'open' as const,
      assigneeUserId: ctx.lawyerId,
      legalBasis: 'LEP, art. 112, I.',
    },
    // Caso 003 - Completed deadline
    {
      id: deterministicUUID('deadline.caso003.excesso'),
      executionCaseId: CASO_003_ID_ACTUAL,
      title: 'Impugnação de Cálculo de Liquidação',
      description: 'Manifestar-se sobre o cálculo de liquidação de penas apresentado pelo Ministério Público.',
      dueAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 4), // due 4 days ago
      deadlineClass: 'legal' as const,
      origin: 'manual' as const,
      priority: 'normal' as const,
      status: 'completed' as const,
      completedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 4.5), // completed before due
      completedByUserId: ctx.lawyerId,
      assigneeUserId: ctx.lawyerId,
      legalBasis: 'LEP, art. 185.',
    }
  ]

  for (const def of deadlineDefs) {
    const existing = await db.select({ id: deadlines.id }).from(deadlines).where(eq(deadlines.id, def.id)).limit(1)
    if (existing.length > 0) continue

    await db.insert(deadlines).values({
      id: def.id,
      organizationId: ctx.orgId,
      executionCaseId: def.executionCaseId,
      title: def.title,
      description: def.description,
      dueAt: def.dueAt,
      deadlineClass: def.deadlineClass,
      origin: def.origin,
      priority: def.priority,
      status: def.status,
      assigneeUserId: def.assigneeUserId,
      legalBasis: def.legalBasis,
      completedAt: def.completedAt || null,
      completedByUserId: def.completedByUserId || null,
      playbookVersionId: ctx.playbookVersionId,
      createdByUserId: ctx.lawyerId,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 10),
      updatedAt: now,
    } as any)
    created++
  }

  return created
}

async function seedEngineRuns(ctx: BaseCtx) {
  console.log('Seeding engine runs...')
  let created = 0
  const now = new Date()

  const runs = [
    // Caso 001 - Successful execution
    {
      id: deterministicUUID('run.caso001.run1'),
      executionCaseId: CASO_001_ID_ACTUAL,
      evaluatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 1), // 1 day ago
      startedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 1),
      completedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 1 + 1200),
      status: 'completed' as const,
      trigger: 'manual' as const,
      uncertaintyLevel: 'none' as const,
      blockingCodes: [],
      opportunitiesCreated: ['progression', 'remission'],
    },
    // Caso 002 - Evaluated with missing database (Blocked/high uncertainty)
    {
      id: deterministicUUID('run.caso002.run1'),
      executionCaseId: CASO_002_ID_ACTUAL,
      evaluatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 2), // 2 days ago
      startedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 2),
      completedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 2 + 800),
      status: 'completed' as const,
      trigger: 'document_associated' as const,
      triggerEntityType: 'Document',
      triggerEntityId: deterministicUUID('doc.caso002.sentenca'),
      uncertaintyLevel: 'high' as const,
      blockingCodes: ['BLK_DATABASE_MISSING'],
      opportunitiesCreated: ['progression'],
    }
  ]

  for (const def of runs) {
    const existing = await db.select({ id: engineRuns.id }).from(engineRuns).where(eq(engineRuns.id, def.id)).limit(1)
    if (existing.length > 0) continue

    await db.insert(engineRuns).values({
      id: def.id,
      organizationId: ctx.orgId,
      executionCaseId: def.executionCaseId,
      playbookVersionId: ctx.playbookVersionId,
      evaluatedAt: def.evaluatedAt,
      startedAt: def.startedAt,
      completedAt: def.completedAt,
      status: def.status,
      trigger: def.trigger,
      triggerEntityType: def.triggerEntityType || null,
      triggerEntityId: def.triggerEntityId || null,
      uncertaintyLevel: def.uncertaintyLevel,
      blockingCodes: def.blockingCodes,
      opportunitiesCreated: def.opportunitiesCreated,
      requestedByUserId: ctx.lawyerId,
      createdAt: def.startedAt,
    } as any)
    created++
  }

  return created
}

async function seedQueueProjections(ctx: BaseCtx) {
  console.log('Seeding queue projections...')
  let created = 0
  const now = new Date()

  const projections = [
    // 1. Progression opportunity for Jose Antonio (Active in queue)
    {
      id: deterministicUUID('qproj.caso001.prog'),
      queueType: 'progression_opportunities' as const,
      entityType: 'Opportunity',
      entityId: deterministicUUID('opp.caso001.progressao'),
      executionCaseId: CASO_001_ID_ACTUAL,
      status: 'active' as const,
      priority: 2, // operational level 2
      assigneeUserId: ctx.lawyerId,
      responsibleLawyerUserId: ctx.lawyerId,
      displayTitle: 'Análise de Progressão de Regime — José Antônio',
      displayLabel: 'progression',
      keyDate: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 10),
      metadata: { opportunityType: 'progression', confidence: 'high' },
    },
    // 2. Overdue critical disciplinary deadline for Jose Antonio (PAD)
    {
      id: deterministicUUID('qproj.caso008.pad'),
      queueType: 'pad_defense' as const,
      entityType: 'Deadline',
      entityId: deterministicUUID('deadline.caso008.pad'),
      executionCaseId: CASO_008_ID_ACTUAL,
      status: 'active' as const,
      priority: 0, // interrupt priority
      assigneeUserId: ctx.lawyerId,
      responsibleLawyerUserId: ctx.lawyerId,
      displayTitle: 'Apresentar Defesa Escrita em PAD — José Antônio (Apenso)',
      displayLabel: 'disciplinary',
      keyDate: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 2), // due date
      metadata: { deadlineClass: 'disciplinary', priority: 'critical' },
    },
    // 3. Blocked opportunity due to missing data for Maria da Conceição
    {
      id: deterministicUUID('qproj.caso002.missing'),
      queueType: 'missing_data' as const,
      entityType: 'Opportunity',
      entityId: deterministicUUID('opp.caso002.progressao'),
      executionCaseId: CASO_002_ID_ACTUAL,
      status: 'blocked' as const,
      priority: 2,
      assigneeUserId: ctx.lawyerId,
      responsibleLawyerUserId: ctx.lawyerId,
      displayTitle: 'Coletar Data-base faltante — Maria da Conceição Lima',
      displayLabel: 'missing_data',
      isBlocked: true,
      blockingReason: 'Data-base ausente na timeline de execução.',
      keyDate: now,
      metadata: { blockingCode: 'BLK_DATABASE_MISSING' },
    }
  ]

  for (const def of projections) {
    const existing = await db.select({ id: queueProjections.id }).from(queueProjections).where(eq(queueProjections.id, def.id)).limit(1)
    if (existing.length > 0) continue

    await db.insert(queueProjections).values({
      id: def.id,
      organizationId: ctx.orgId,
      queueType: def.queueType,
      entityType: def.entityType,
      entityId: def.entityId,
      executionCaseId: def.executionCaseId,
      status: def.status,
      priority: def.priority,
      assigneeUserId: def.assigneeUserId,
      responsibleLawyerUserId: def.responsibleLawyerUserId,
      displayTitle: def.displayTitle,
      displayLabel: def.displayLabel,
      isBlocked: def.isBlocked || false,
      blockingReason: def.blockingReason || null,
      keyDate: def.keyDate,
      metadata: def.metadata,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 3),
      updatedAt: now,
    } as any)
    created++
  }

  return created
}

async function seedDemoPhase3bc() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  EXECFLOW Demo Seed — Fase 3B & 3C: Opp, Deadlines, runs ║')
  console.log('╚══════════════════════════════════════════════════════════╝')

  try {
    const ctx = await lookupBaseEntities()
    
    // Fase 3B
    const oppCount = await seedOpportunities(ctx)
    console.log(`✓ Oportunidades criadas: ${oppCount}`)

    const dlCount = await seedDeadlines(ctx)
    console.log(`✓ Prazos criados: ${dlCount}`)

    // Fase 3C
    const runsCount = await seedEngineRuns(ctx)
    console.log(`✓ Engine runs criados: ${runsCount}`)

    const projCount = await seedQueueProjections(ctx)
    console.log(`✓ Fila de projections criadas: ${projCount}`)

    console.log('\n✅ Fase 3B & 3C concluídas com sucesso.')
  } catch (err) {
    console.error('\n❌ FALHOU:', err)
    process.exitCode = 1
  } finally {
    await sql.end({ timeout: 5 })
  }
}

void seedDemoPhase3bc().catch(console.error)
