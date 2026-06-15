/**
 * seed-demo-phase2.ts — Fase 2: Clients + ExecutionCases
 *
 * Materializa os 12 casos do catálogo de demonstração.
 *
 * PRÉ-REQUISITO:
 *   Execute primeiro:
 *     pnpm --filter @execflow/db db:seed           (seed base)
 *     pnpm --filter @execflow/db db:seed:demo      (fase 1)
 *
 * CRIA:
 *   clients (8 clientes):
 *     CLI-001 José Antônio dos Santos
 *     CLI-002 Maria da Conceição Lima
 *     CLI-003 Roberto Carlos Ferreira
 *     CLI-004 Ana Paula Rodrigues         (2 casos)
 *     CLI-005 Carlos Eduardo Martins
 *     CLI-006 Marcos Vinícius Carvalho
 *     CLI-007 Pedro Henrique Alves        (status=inactive)
 *     CLI-008 Fernanda Lima Souza         (2 casos)
 *     CLI-009 Paulo Roberto da Silva      (status=archived)
 *
 *   execution_cases (12 casos):
 *     CASO-001 José Antônio — tráfico hediondo, ativo, progressão sugerida
 *     CASO-002 Maria Conceição — furto, semiaberto, deadline crítico
 *     CASO-003 Roberto Ferreira — estelionato, excesso de execução
 *     CASO-004 Ana Paula (1) — furto, aberto, OCR em revisão
 *     CASO-005 Ana Paula (2) — tráfico baixo, semiaberto, LC overdue
 *     CASO-006 Carlos Martins — roubo, intake
 *     CASO-007 Marcos Carvalho — homicídio hediondo, histórico rico
 *     CASO-008 José Antônio (apenso) — PAD disciplinar (parentId=CASO-001)
 *     CASO-009 Pedro Alves — estelionato, suspended
 *     CASO-010 Fernanda Souza (1) — furto qualificado, dismissed
 *     CASO-011 Paulo Roberto — furto simples, closed
 *     CASO-012 Fernanda Souza (2) — receptação, conflito de cálculo
 *
 * IDEMPOTENTE: verifica existência por ID determinístico antes de inserir.
 *
 * Usage:
 *   pnpm --filter @execflow/db db:seed:demo:phase2
 *
 * Architecture ref: catalogo_casos_seed.md, seed_preflight_check.md
 */

import { createHash } from 'node:crypto'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq, and, isNull } from 'drizzle-orm'
import {
  organizations,
  users,
  playbookFamilies,
  playbookVersions,
  clients,
  executionCases,
} from './schema/index.ts'

// ---------------------------------------------------------------------------
// Database connection
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env['DATABASE_URL']
if (DATABASE_URL === undefined || DATABASE_URL === '') {
  throw new Error('[seed-demo:phase2] DATABASE_URL is not set.')
}

const sql = postgres(DATABASE_URL)
const db = drizzle(sql)

// ---------------------------------------------------------------------------
// Deterministic ID helper (same namespace/algorithm as Fase 1)
// ---------------------------------------------------------------------------

function deterministicUUID(name: string): string {
  const NAMESPACE = 'execflow-demo-seed-phase1-v1' // mesmo namespace da fase 1
  const hash = createHash('sha1').update(`${NAMESPACE}:${name}`).digest()
  hash[6] = ((hash[6]! & 0x0f) | 0x50) as number
  hash[8] = ((hash[8]! & 0x3f) | 0x80) as number
  const h = hash.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

// ---------------------------------------------------------------------------
// Stable IDs (deterministicos, imutáveis)
// ---------------------------------------------------------------------------

// --- Usuários (da Fase 1) ---
const DEMO_LAWYER_ID    = deterministicUUID('user.rafael-mendes.lawyer')
const DEMO_ASSISTANT_ID = deterministicUUID('user.isabela-costa.assistant')

// --- Clientes ---
const CLI_001_JOSE_ID      = deterministicUUID('client.jose-antonio-dos-santos')
const CLI_002_MARIA_ID     = deterministicUUID('client.maria-conceicao-lima')
const CLI_003_ROBERTO_ID   = deterministicUUID('client.roberto-carlos-ferreira')
const CLI_004_ANAPAULA_ID  = deterministicUUID('client.ana-paula-rodrigues')
const CLI_005_CARLOS_ID    = deterministicUUID('client.carlos-eduardo-martins')
const CLI_006_MARCOS_ID    = deterministicUUID('client.marcos-vinicius-carvalho')
const CLI_007_PEDRO_ID     = deterministicUUID('client.pedro-henrique-alves')
const CLI_008_FERNANDA_ID  = deterministicUUID('client.fernanda-lima-souza')
const CLI_009_PAULO_ID     = deterministicUUID('client.paulo-roberto-da-silva')

// --- Casos ---
const CASO_001_ID = deterministicUUID('case.jose-antonio.trafico-hediondo')
const CASO_002_ID = deterministicUUID('case.maria-conceicao.furto-qualificado')
const CASO_003_ID = deterministicUUID('case.roberto-ferreira.estelionato')
const CASO_004_ID = deterministicUUID('case.ana-paula.furto-simples')
const CASO_005_ID = deterministicUUID('case.ana-paula.trafico-leve-santos')
const CASO_006_ID = deterministicUUID('case.carlos-martins.roubo-intake')
const CASO_007_ID = deterministicUUID('case.marcos-carvalho.homicidio-hediondo')
const CASO_008_ID = deterministicUUID('case.jose-antonio.apenso-pad')
const CASO_009_ID = deterministicUUID('case.pedro-alves.estelionato-suspenso')
const CASO_010_ID = deterministicUUID('case.fernanda-souza.furto-qualificado')
const CASO_011_ID = deterministicUUID('case.paulo-roberto.furto-simples-closed')
const CASO_012_ID = deterministicUUID('case.fernanda-souza.receptacao-conflito')

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

type BaseCtx = {
  orgId: string
  lawyerId: string
  assistantId: string
  adminId: string
}

// ---------------------------------------------------------------------------
// Step 0 — Lookup de entidades base (Fase 1 + seed.ts)
// ---------------------------------------------------------------------------

async function lookupBaseEntities(): Promise<BaseCtx> {
  console.log('\n[demo:phase2] Step 0 — Verificando entidades base...')

  const orgRows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, 'execflow-demo'))
    .limit(1)
  if (!orgRows[0]) throw new Error('[demo:phase2] BLOCKED: Organização não encontrada. Execute db:seed primeiro.')
  const orgId = orgRows[0].id
  console.log(`  ✓ Org: ${orgId}`)

  const adminRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'admin@execflow.local'))
    .limit(1)
  if (!adminRows[0]) throw new Error('[demo:phase2] BLOCKED: Admin user não encontrado. Execute db:seed primeiro.')
  const adminId = adminRows[0].id
  console.log(`  ✓ Admin: ${adminId}`)

  const lawyerRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, DEMO_LAWYER_ID))
    .limit(1)
  if (!lawyerRows[0]) throw new Error('[demo:phase2] BLOCKED: Dr. Rafael Mendes não encontrado. Execute db:seed:demo primeiro.')
  const lawyerId = lawyerRows[0].id
  console.log(`  ✓ Lawyer (Dr. Rafael Mendes): ${lawyerId}`)

  const assistantRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, DEMO_ASSISTANT_ID))
    .limit(1)
  if (!assistantRows[0]) throw new Error('[demo:phase2] BLOCKED: Dra. Isabela Costa não encontrada. Execute db:seed:demo primeiro.')
  const assistantId = assistantRows[0].id
  console.log(`  ✓ Assistant (Dra. Isabela Costa): ${assistantId}`)

  return { orgId, adminId, lawyerId, assistantId }
}

// ---------------------------------------------------------------------------
// Step 1 — Clients (9 clientes)
// ---------------------------------------------------------------------------

async function upsertClients(ctx: BaseCtx): Promise<number> {
  console.log('\n[demo:phase2] Step 1 — Clients...')
  const now = new Date()
  let created = 0

  const clientDefs = [
    {
      id: CLI_001_JOSE_ID,
      fullName: 'José Antônio dos Santos',
      cpf: '11144477735',
      birthDate: '1985-03-12',
      status: 'active' as const,
      responsibleLawyerUserId: ctx.lawyerId,
      notes: 'Tráfico de drogas (art. 33 Lei 11.343/2006). Pena 5 anos regime fechado. Elegível para progressão.',
    },
    {
      id: CLI_002_MARIA_ID,
      fullName: 'Maria da Conceição Lima',
      cpf: '22255588846',
      birthDate: '1979-11-07',
      status: 'active' as const,
      responsibleLawyerUserId: ctx.lawyerId,
      notes: 'Furto qualificado (art. 155 §4 CP). Prazo crítico para petição de progressão ao regime aberto.',
    },
    {
      id: CLI_003_ROBERTO_ID,
      fullName: 'Roberto Carlos Ferreira',
      cpf: '33366699957',
      birthDate: '1975-09-22',
      status: 'active' as const,
      responsibleLawyerUserId: ctx.lawyerId,
      notes: 'Estelionato (art. 171 CP). EXCESSO DE EXECUÇÃO — pena extinta em 14/09/2021. Liberty risk crítico.',
    },
    {
      id: CLI_004_ANAPAULA_ID,
      fullName: 'Ana Paula Rodrigues',
      cpf: '44477700068',
      birthDate: '1990-06-15',
      status: 'active' as const,
      responsibleLawyerUserId: ctx.lawyerId,
      notes: 'Dois casos ativos. Furto simples + tráfico de menor potencial. OCR em revisão no caso 1.',
    },
    {
      id: CLI_005_CARLOS_ID,
      fullName: 'Carlos Eduardo Martins',
      cpf: '55588811179',
      birthDate: '1998-04-03',
      status: 'active' as const,
      responsibleLawyerUserId: ctx.assistantId,
      notes: 'Roubo simples (art. 157 CP). Novo intake — documento aguardando triagem.',
    },
    {
      id: CLI_006_MARCOS_ID,
      fullName: 'Marcos Vinícius Carvalho',
      cpf: '66699922280',
      birthDate: '1982-07-28',
      status: 'active' as const,
      responsibleLawyerUserId: ctx.lawyerId,
      notes: 'Homicídio qualificado (art. 121 §2 CP). Crime hediondo. Caso antigo com histórico rico de engine runs.',
    },
    {
      id: CLI_007_PEDRO_ID,
      fullName: 'Pedro Henrique Alves',
      cpf: '77700033391',
      birthDate: '1988-02-11',
      status: 'inactive' as const,
      responsibleLawyerUserId: ctx.assistantId,
      notes: 'Estelionato. Caso suspenso por transferência de vara. Cliente inativo.',
    },
    {
      id: CLI_008_FERNANDA_ID,
      fullName: 'Fernanda Lima Souza',
      cpf: '88811144402',
      birthDate: '1993-12-19',
      status: 'active' as const,
      responsibleLawyerUserId: ctx.lawyerId,
      notes: 'Dois casos. Furto qualificado (oportunidade dismissed) + receptação (conflito de cálculo).',
    },
    {
      id: CLI_009_PAULO_ID,
      fullName: 'Paulo Roberto da Silva',
      cpf: '99922255513',
      birthDate: '1970-08-04',
      status: 'archived' as const,
      responsibleLawyerUserId: ctx.lawyerId,
      notes: 'Furto simples. Caso encerrado em 12/01/2024. Extinção da punibilidade. Cliente arquivado.',
    },
  ]

  for (const def of clientDefs) {
    const existing = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.id, def.id))
      .limit(1)

    if (existing[0]) {
      console.log(`  ↩ Cliente já existe: ${def.fullName}`)
      continue
    }

    await db.insert(clients).values({
      id: def.id,
      organizationId: ctx.orgId,
      fullName: def.fullName,
      cpf: def.cpf,
      birthDate: def.birthDate,
      status: def.status,
      responsibleLawyerUserId: def.responsibleLawyerUserId,
      createdByUserId: ctx.adminId,
      notes: def.notes,
      aliases: [],
      createdAt: now,
      updatedAt: now,
    })
    console.log(`  ✓ Cliente criado: ${def.fullName} (${def.id})`)
    created++
  }

  return created
}

// ---------------------------------------------------------------------------
// Step 2 — ExecutionCases (12 casos)
// ---------------------------------------------------------------------------

async function upsertExecutionCases(ctx: BaseCtx): Promise<number> {
  console.log('\n[demo:phase2] Step 2 — ExecutionCases...')
  const now = new Date()
  let created = 0

  // Estrutura: cada caso é inserido em ordem para respeitar parentExecutionCaseId
  // CASO-008 depende de CASO-001 → inserido depois
  const caseDefs = [
    // -------------------------------------------------------------------------
    // CASO-001 — José Antônio dos Santos
    // Tráfico hediondo, 5 anos, fechado, progressão sugerida pelo motor
    // -------------------------------------------------------------------------
    {
      id: CASO_001_ID,
      clientId: CLI_001_JOSE_ID,
      internalRef: 'EXE-2022-001',
      executionProcessNumber: '0004271-15.2022.8.26.0050',
      courtName: '2ª Vara de Execuções Penais de São Paulo',
      courtJurisdiction: 'São Paulo/SP',
      caseKind: 'primary' as const,
      parentExecutionCaseId: null,
      status: 'active' as const,
      responsibleLawyerUserId: ctx.lawyerId,
      sentenceSummary: '5 anos, regime fechado, crime hediondo (tráfico LEP 33 Lei 11.343/2006). Fração 2/5 cumprida.',
      openedAt: new Date('2022-08-15T00:00:00.000Z'),
    },
    // -------------------------------------------------------------------------
    // CASO-002 — Maria da Conceição Lima
    // Furto qualificado, semiaberto, prazo crítico de petição
    // -------------------------------------------------------------------------
    {
      id: CASO_002_ID,
      clientId: CLI_002_MARIA_ID,
      internalRef: 'EXE-2023-001',
      executionProcessNumber: '0001582-33.2023.8.26.0050',
      courtName: '3ª Vara de Execuções Penais de São Paulo',
      courtJurisdiction: 'São Paulo/SP',
      caseKind: 'primary' as const,
      parentExecutionCaseId: null,
      status: 'active' as const,
      responsibleLawyerUserId: ctx.lawyerId,
      sentenceSummary: '4 anos, regime semiaberto, furto qualificado (art. 155 §4 CP). Elegível para aberto.',
      openedAt: new Date('2023-03-03T00:00:00.000Z'),
    },
    // -------------------------------------------------------------------------
    // CASO-003 — Roberto Carlos Ferreira
    // Estelionato, domiciliar, excesso de execução — liberty risk
    // -------------------------------------------------------------------------
    {
      id: CASO_003_ID,
      clientId: CLI_003_ROBERTO_ID,
      internalRef: 'EXE-2019-001',
      executionProcessNumber: '0003344-22.2019.8.26.0050',
      courtName: '1ª Vara de Execuções Penais de São Paulo',
      courtJurisdiction: 'São Paulo/SP',
      caseKind: 'primary' as const,
      parentExecutionCaseId: null,
      status: 'active' as const,
      responsibleLawyerUserId: ctx.lawyerId,
      sentenceSummary: '2 anos, regime domiciliar (estelionato art. 171 CP). EXCESSO: pena extinta em 14/09/2021.',
      openedAt: new Date('2019-09-14T00:00:00.000Z'),
    },
    // -------------------------------------------------------------------------
    // CASO-004 — Ana Paula Rodrigues (1º caso)
    // Furto simples, aberto, OCR em revisão, remição bloqueada
    // -------------------------------------------------------------------------
    {
      id: CASO_004_ID,
      clientId: CLI_004_ANAPAULA_ID,
      internalRef: 'EXE-2025-001',
      executionProcessNumber: '0000891-44.2025.8.26.0050',
      courtName: '5ª Vara de Execuções Penais de São Paulo',
      courtJurisdiction: 'São Paulo/SP',
      caseKind: 'primary' as const,
      parentExecutionCaseId: null,
      status: 'active' as const,
      responsibleLawyerUserId: ctx.lawyerId,
      sentenceSummary: '1 ano e 6 meses, regime aberto (furto simples art. 155 CP). Comprovante de trabalho em extração.',
      openedAt: new Date('2025-01-20T00:00:00.000Z'),
    },
    // -------------------------------------------------------------------------
    // CASO-005 — Ana Paula Rodrigues (2º caso)
    // Tráfico menor potencial, semiaberto, livramento condicional overdue
    // -------------------------------------------------------------------------
    {
      id: CASO_005_ID,
      clientId: CLI_004_ANAPAULA_ID,
      internalRef: 'EXE-2021-001',
      executionProcessNumber: '0002233-11.2021.8.26.0562',
      courtName: '2ª Vara de Execuções Penais de Santos',
      courtJurisdiction: 'Santos/SP',
      caseKind: 'primary' as const,
      parentExecutionCaseId: null,
      status: 'active' as const,
      responsibleLawyerUserId: ctx.lawyerId,
      sentenceSummary: '3 anos, regime semiaberto (tráfico menor art. 28 Lei 11.343). Elegível LC desde 05/04/2024. Prazo OVERDUE.',
      openedAt: new Date('2021-08-10T00:00:00.000Z'),
    },
    // -------------------------------------------------------------------------
    // CASO-006 — Carlos Eduardo Martins
    // Roubo simples, status intake, sem processo definido
    // -------------------------------------------------------------------------
    {
      id: CASO_006_ID,
      clientId: CLI_005_CARLOS_ID,
      internalRef: 'EXE-2026-001',
      executionProcessNumber: null,
      courtName: null,
      courtJurisdiction: null,
      caseKind: 'primary' as const,
      parentExecutionCaseId: null,
      status: 'intake' as const,
      responsibleLawyerUserId: ctx.assistantId,
      sentenceSummary: '4 anos e 6 meses, regime fechado (roubo simples art. 157 CP). Caso em intake — processo sem número.',
      openedAt: new Date('2026-05-28T00:00:00.000Z'),
      processNumberPendingSince: new Date('2026-05-28T00:00:00.000Z'),
    },
    // -------------------------------------------------------------------------
    // CASO-007 — Marcos Vinícius Carvalho
    // Homicídio hediondo, fechado, histórico rico de snapshots/engine
    // -------------------------------------------------------------------------
    {
      id: CASO_007_ID,
      clientId: CLI_006_MARCOS_ID,
      internalRef: 'EXE-2018-001',
      executionProcessNumber: '0007788-99.2018.8.26.0050',
      courtName: '1ª Vara de Execuções Penais de São Paulo',
      courtJurisdiction: 'São Paulo/SP',
      caseKind: 'primary' as const,
      parentExecutionCaseId: null,
      status: 'active' as const,
      responsibleLawyerUserId: ctx.lawyerId,
      sentenceSummary: '12 anos, regime fechado, crime hediondo (homicídio qualificado art. 121 §2 CP). Snapshot superseded. Fração 2/5 cumprida.',
      openedAt: new Date('2018-06-05T00:00:00.000Z'),
    },
    // -------------------------------------------------------------------------
    // CASO-008 — José Antônio dos Santos (apenso — PAD disciplinar)
    // Incident vinculado ao CASO-001 via parentExecutionCaseId
    // ATENÇÃO: depende de CASO-001 — deve ser inserido após
    // -------------------------------------------------------------------------
    {
      id: CASO_008_ID,
      clientId: CLI_001_JOSE_ID,
      internalRef: 'EXE-2022-001-AP001',
      executionProcessNumber: '0004271-15.2022.8.26.0050-AP001',
      courtName: '2ª Vara de Execuções Penais de São Paulo',
      courtJurisdiction: 'São Paulo/SP',
      caseKind: 'incident' as const,
      parentExecutionCaseId: CASO_001_ID,
      status: 'active' as const,
      responsibleLawyerUserId: ctx.lawyerId,
      sentenceSummary: 'Apenso — PAD disciplinar por uso de celular (LEP art. 50 VII). Defesa protocolada em 18/04/2026.',
      openedAt: new Date('2026-04-10T00:00:00.000Z'),
    },
    // -------------------------------------------------------------------------
    // CASO-009 — Pedro Henrique Alves
    // Estelionato, semiaberto, suspenso por transferência de vara
    // -------------------------------------------------------------------------
    {
      id: CASO_009_ID,
      clientId: CLI_007_PEDRO_ID,
      internalRef: 'EXE-2022-002',
      executionProcessNumber: '0005566-77.2022.8.26.0114',
      courtName: '2ª Vara de Execuções Penais de Campinas',
      courtJurisdiction: 'Campinas/SP',
      caseKind: 'primary' as const,
      parentExecutionCaseId: null,
      status: 'suspended' as const,
      responsibleLawyerUserId: ctx.assistantId,
      sentenceSummary: '2 anos e 8 meses, regime semiaberto (estelionato art. 171 CP). SUSPENSO: transferência para VEP de Ribeirão Preto.',
      openedAt: new Date('2022-09-30T00:00:00.000Z'),
    },
    // -------------------------------------------------------------------------
    // CASO-010 — Fernanda Lima Souza (1º caso)
    // Furto qualificado, fechado, oportunidade de detração dismissed
    // -------------------------------------------------------------------------
    {
      id: CASO_010_ID,
      clientId: CLI_008_FERNANDA_ID,
      internalRef: 'EXE-2022-003',
      executionProcessNumber: '0006655-44.2022.8.26.0050',
      courtName: '4ª Vara de Execuções Penais de São Paulo',
      courtJurisdiction: 'São Paulo/SP',
      caseKind: 'primary' as const,
      parentExecutionCaseId: null,
      status: 'active' as const,
      responsibleLawyerUserId: ctx.lawyerId,
      sentenceSummary: '3 anos e 6 meses, regime fechado (furto qualificado art. 155 §4 CP). Detração 180 dias descartada — doc insuficiente.',
      openedAt: new Date('2022-02-08T00:00:00.000Z'),
    },
    // -------------------------------------------------------------------------
    // CASO-011 — Paulo Roberto da Silva
    // Furto simples, aberto, encerrado, extinção da punibilidade
    // -------------------------------------------------------------------------
    {
      id: CASO_011_ID,
      clientId: CLI_009_PAULO_ID,
      internalRef: 'EXE-2023-002',
      executionProcessNumber: '0001111-22.2023.8.26.0050',
      courtName: '4ª Vara de Execuções Penais de São Paulo',
      courtJurisdiction: 'São Paulo/SP',
      caseKind: 'primary' as const,
      parentExecutionCaseId: null,
      status: 'closed' as const,
      responsibleLawyerUserId: ctx.lawyerId,
      sentenceSummary: '1 ano, regime aberto (furto simples art. 155 CP). ENCERRADO: extinção da punibilidade 12/01/2024.',
      openedAt: new Date('2023-01-10T00:00:00.000Z'),
      closedAt: new Date('2024-01-12T00:00:00.000Z'),
      closedReason: 'Extinção da punibilidade pelo cumprimento integral da pena. Alvará de soltura expedido em 12/01/2024.',
    },
    // -------------------------------------------------------------------------
    // CASO-012 — Fernanda Lima Souza (2º caso)
    // Receptação, aberto, engine run failed por conflito de snapshots
    // -------------------------------------------------------------------------
    {
      id: CASO_012_ID,
      clientId: CLI_008_FERNANDA_ID,
      internalRef: 'EXE-2023-003',
      executionProcessNumber: '0008844-11.2023.8.26.0050',
      courtName: '4ª Vara de Execuções Penais de São Paulo',
      courtJurisdiction: 'São Paulo/SP',
      caseKind: 'primary' as const,
      parentExecutionCaseId: null,
      status: 'active' as const,
      responsibleLawyerUserId: ctx.lawyerId,
      sentenceSummary: '1 ano e 4 meses × 1 ano (CONFLITO). Receptação art. 180 CP. Engine falhou: BLK_SNAPSHOT_CONFLICT.',
      openedAt: new Date('2023-07-22T00:00:00.000Z'),
    },
  ]

  for (const def of caseDefs) {
    const existing = await db
      .select({ id: executionCases.id })
      .from(executionCases)
      .where(eq(executionCases.id, def.id))
      .limit(1)

    if (existing[0]) {
      console.log(`  ↩ Caso já existe: ${def.internalRef}`)
      continue
    }

    await db.insert(executionCases).values({
      id: def.id,
      organizationId: ctx.orgId,
      clientId: def.clientId,
      internalRef: def.internalRef,
      executionProcessNumber: def.executionProcessNumber ?? undefined,
      courtName: def.courtName ?? undefined,
      courtJurisdiction: def.courtJurisdiction ?? undefined,
      caseKind: def.caseKind,
      parentExecutionCaseId: def.parentExecutionCaseId ?? undefined,
      status: def.status,
      responsibleLawyerUserId: def.responsibleLawyerUserId,
      sentenceSummary: def.sentenceSummary,
      openedAt: def.openedAt,
      closedAt: 'closedAt' in def ? def.closedAt : undefined,
      closedReason: 'closedReason' in def ? def.closedReason : undefined,
      processNumberPendingSince: 'processNumberPendingSince' in def ? def.processNumberPendingSince : undefined,
      createdByUserId: ctx.adminId,
      createdAt: now,
      updatedAt: now,
    })
    console.log(`  ✓ Caso criado: ${def.internalRef} (${def.id})`)
    created++
  }

  return created
}

// ---------------------------------------------------------------------------
// Step 3 — Validação e relatório
// ---------------------------------------------------------------------------

async function validateAndReport(ctx: BaseCtx): Promise<void> {
  console.log('\n[demo:phase2] Step 3 — Validação...')

  // Clients
  const allClients = await db
    .select({ id: clients.id, fullName: clients.fullName, status: clients.status, cpf: clients.cpf })
    .from(clients)
    .where(eq(clients.organizationId, ctx.orgId))

  console.log(`\n  Clientes na org (${allClients.length} total):`)
  for (const c of allClients) {
    console.log(`    ${c.id}  ${c.fullName.padEnd(30)}  status=${c.status}`)
  }

  // ExecutionCases
  const allCases = await db
    .select({
      id: executionCases.id,
      internalRef: executionCases.internalRef,
      status: executionCases.status,
      caseKind: executionCases.caseKind,
      parentExecutionCaseId: executionCases.parentExecutionCaseId,
    })
    .from(executionCases)
    .where(eq(executionCases.organizationId, ctx.orgId))

  console.log(`\n  ExecutionCases na org (${allCases.length} total):`)
  for (const c of allCases) {
    const parent = c.parentExecutionCaseId ? `  ← apenso de ${c.parentExecutionCaseId.slice(0, 8)}...` : ''
    console.log(`    ${c.id}  ${c.internalRef.padEnd(20)}  kind=${c.caseKind.padEnd(8)} status=${c.status}${parent}`)
  }

  // Verificar apenso
  const apenso = allCases.find(c => c.id === CASO_008_ID)
  if (apenso?.parentExecutionCaseId === CASO_001_ID) {
    console.log(`\n  ✓ Relacionamento apenso correto: CASO-008 → parentId = CASO-001`)
  } else {
    console.log(`\n  ⚠ Relacionamento apenso não confirmado`)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function seedDemoPhase2(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║    EXECFLOW Demo Seed — Fase 2: Clients + Cases          ║')
  console.log('╚══════════════════════════════════════════════════════════╝')

  try {
    const ctx = await lookupBaseEntities()

    const clientsCreated = await upsertClients(ctx)
    const casesCreated = await upsertExecutionCases(ctx)

    await validateAndReport(ctx)

    console.log()
    console.log('╔══════════════════════════════════════════════════════════════════╗')
    console.log('║  ✅  Fase 2 concluída                                             ║')
    console.log('║                                                                   ║')
    console.log(`║  clients criados nesta execução:         ${String(clientsCreated).padEnd(24)}║`)
    console.log(`║  execution_cases criados nesta execução: ${String(casesCreated).padEnd(24)}║`)
    console.log('║                                                                   ║')
    console.log('║  IDs estáveis disponíveis para Fase 3:                            ║')
    console.log(`║  CASO_001_ID = ${CASO_001_ID}  ║`)
    console.log(`║  CASO_002_ID = ${CASO_002_ID}  ║`)
    console.log(`║  CASO_003_ID = ${CASO_003_ID}  ║`)
    console.log(`║  CASO_004_ID = ${CASO_004_ID}  ║`)
    console.log(`║  CASO_005_ID = ${CASO_005_ID}  ║`)
    console.log(`║  CASO_006_ID = ${CASO_006_ID}  ║`)
    console.log(`║  CASO_007_ID = ${CASO_007_ID}  ║`)
    console.log(`║  CASO_008_ID = ${CASO_008_ID}  ║`)
    console.log(`║  CASO_009_ID = ${CASO_009_ID}  ║`)
    console.log(`║  CASO_010_ID = ${CASO_010_ID}  ║`)
    console.log(`║  CASO_011_ID = ${CASO_011_ID}  ║`)
    console.log(`║  CASO_012_ID = ${CASO_012_ID}  ║`)
    console.log('║                                                                   ║')
    console.log('║  Fase 3 (documents + snapshots) pode iniciar.                     ║')
    console.log('╚══════════════════════════════════════════════════════════════════╝')

  } catch (err) {
    console.error('\n[demo:phase2] ❌ FALHOU:', err)
    process.exitCode = 1
  } finally {
    await sql.end({ timeout: 5 })
  }
}

void seedDemoPhase2().catch((err) => {
  console.error(err)
  process.exit(1)
})
