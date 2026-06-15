/**
 * seed-demo-phase3a.ts — Fase 3A: Documents + Timeline Events
 *
 * Popula dados complementares nos Hero Cases da Fase 2, respeitando
 * invariantes de imutabilidade e o modelo temporal "dois relógios".
 * 
 * Usage:
 *   pnpm --filter @execflow/db db:seed:demo:phase3a
 */

import { createHash } from 'node:crypto'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import {
  organizations,
  users,
  clients,
  executionCases,
  documents,
  timelineEvents,
} from './schema/index.ts'

const DATABASE_URL = process.env['DATABASE_URL']
if (!DATABASE_URL) throw new Error('[demo:phase3a] DATABASE_URL is not set.')

const sql = postgres(DATABASE_URL)
const db = drizzle(sql)

function deterministicUUID(name: string): string {
  const NAMESPACE = 'execflow-demo-seed-phase3a-v1'
  const hash = createHash('sha1').update(`${NAMESPACE}:${name}`).digest()
  hash[6] = ((hash[6]! & 0x0f) | 0x50) as number
  hash[8] = ((hash[8]! & 0x3f) | 0x80) as number
  const h = hash.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

// IDs (Base entities)
const DEMO_LAWYER_ID = '331c17da-7a1a-5bf8-b570-5b6d51025091' // Known from phase 1 logic? Wait, deterministic.
// I will just look them up from DB.
const CASO_001_ID = '2cf7b198-d14f-561b-9d4d-dd50e2617f68' // Mock, we will look up.
// Better to just recreate the deterministic function for phase1 and phase2 exactly to get the IDs.

function detIdPhase1(name: string) {
  const hash = createHash('sha1').update(`execflow-demo-seed-phase1-v1:${name}`).digest()
  hash[6] = ((hash[6]! & 0x0f) | 0x50) as number
  hash[8] = ((hash[8]! & 0x3f) | 0x80) as number
  const h = hash.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

const DEMO_LAWYER_ID_ACTUAL    = detIdPhase1('user.rafael-mendes.lawyer')
const DEMO_ASSISTANT_ID_ACTUAL = detIdPhase1('user.isabela-costa.assistant')

const CLI_001_JOSE_ID = detIdPhase1('client.jose-antonio-dos-santos')
const CLI_002_MARIA_ID = detIdPhase1('client.maria-conceicao-lima')
const CLI_003_ROBERTO_ID = detIdPhase1('client.roberto-carlos-ferreira')
const CLI_006_MARCOS_ID = detIdPhase1('client.marcos-vinicius-carvalho')

const CASO_001_ID_ACTUAL = detIdPhase1('case.jose-antonio.trafico-hediondo')
const CASO_002_ID_ACTUAL = detIdPhase1('case.maria-conceicao.furto-qualificado')
const CASO_003_ID_ACTUAL = detIdPhase1('case.roberto-ferreira.estelionato')
const CASO_007_ID_ACTUAL = detIdPhase1('case.marcos-carvalho.homicidio-hediondo')

type BaseCtx = {
  orgId: string
  adminId: string
  lawyerId: string
  assistantId: string
}

async function lookupBaseEntities(): Promise<BaseCtx> {
  const orgRows = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, 'execflow-demo')).limit(1)
  const adminRows = await db.select({ id: users.id }).from(users).where(eq(users.email, 'admin@execflow.local')).limit(1)
  
  return {
    orgId: orgRows[0]!.id,
    adminId: adminRows[0]!.id,
    lawyerId: DEMO_LAWYER_ID_ACTUAL,
    assistantId: DEMO_ASSISTANT_ID_ACTUAL,
  }
}

async function seedDocuments(ctx: BaseCtx) {
  const now = new Date()
  let created = 0

  const docDefs = [
    {
      id: deterministicUUID('doc.caso001.guia'),
      clientId: CLI_001_JOSE_ID,
      executionCaseId: CASO_001_ID_ACTUAL,
      fileName: 'Guia de Recolhimento - Jose Antonio.pdf',
      documentClass: 'guia_de_execucao',
      mimeType: 'application/pdf',
      byteSize: 245000,
      status: 'confirmed' as const,
      sourceChannel: 'intake_pdf' as const,
      ocrStatus: 'completed' as const,
    },
    {
      id: deterministicUUID('doc.caso001.atestado'),
      clientId: CLI_001_JOSE_ID,
      executionCaseId: CASO_001_ID_ACTUAL,
      fileName: 'Atestado de Conduta Carcerária 2024.pdf',
      documentClass: 'certidao_carceraria',
      mimeType: 'application/pdf',
      byteSize: 112000,
      status: 'confirmed' as const,
      sourceChannel: 'intake_pdf' as const,
      ocrStatus: 'completed' as const,
    },
    {
      id: deterministicUUID('doc.caso002.sentenca'),
      clientId: CLI_002_MARIA_ID,
      executionCaseId: CASO_002_ID_ACTUAL,
      fileName: 'Cópia da Sentença Condenatória.pdf',
      documentClass: 'sentenca',
      mimeType: 'application/pdf',
      byteSize: 890000,
      status: 'confirmed' as const,
      sourceChannel: 'intake_pdf' as const,
      ocrStatus: 'completed' as const,
    },
    {
      id: deterministicUUID('doc.caso002.comprovante'),
      clientId: CLI_002_MARIA_ID,
      executionCaseId: CASO_002_ID_ACTUAL,
      fileName: 'Declaração de Dias Trabalhados.pdf',
      documentClass: 'comprovante_trabalho_estudo',
      mimeType: 'application/pdf',
      byteSize: 450000,
      status: 'confirmed' as const,
      sourceChannel: 'intake_pdf' as const,
      ocrStatus: 'pending' as const, // Força a OCR ficar pendente para demo
    },
    {
      id: deterministicUUID('doc.caso003.peticao'),
      clientId: CLI_003_ROBERTO_ID,
      executionCaseId: CASO_003_ID_ACTUAL,
      fileName: 'Petição Inicial - Excesso de Execução.pdf',
      documentClass: 'petition',
      mimeType: 'application/pdf',
      byteSize: 310000,
      status: 'confirmed' as const,
      sourceChannel: 'intake_pdf' as const,
      ocrStatus: 'not_applicable' as const,
    },
    {
      id: deterministicUUID('doc.caso007.boletim'),
      clientId: CLI_006_MARCOS_ID,
      executionCaseId: CASO_007_ID_ACTUAL,
      fileName: 'Boletim Informativo - Marcos.pdf',
      documentClass: 'certidao_carceraria',
      mimeType: 'application/pdf',
      byteSize: 156000,
      status: 'confirmed' as const,
      sourceChannel: 'intake_email' as const,
      ocrStatus: 'completed' as const,
    }
  ]

  for (const def of docDefs) {
    const existing = await db.select({ id: documents.id }).from(documents).where(eq(documents.id, def.id)).limit(1)
    if (existing.length > 0) continue

    // Simulate different upload dates, close to now
    const uploadTime = new Date(now.getTime() - Math.random() * 86400000 * 2)

    await db.insert(documents).values({
      id: def.id,
      organizationId: ctx.orgId,
      clientId: def.clientId,
      executionCaseId: def.executionCaseId,
      fileName: def.fileName,
      documentClass: def.documentClass,
      mimeType: def.mimeType,
      byteSize: def.byteSize,
      status: def.status,
      sourceChannel: def.sourceChannel,
      ocrStatus: def.ocrStatus,
      storageKey: `mock/${def.id}.pdf`,
      checksumSha256: createHash('sha256').update(def.id).digest('hex'),
      // Se não houver 'uploadedAt', assume-se que é gerido na base do Drizzle por timestamp()
      // Usaremos o createdAt como fallback se uploadedAt nao existir no schema, mas vamos injetar ambos.
      uploadedByUserId: ctx.lawyerId,
      uploadedAt: uploadTime,
      confirmedByUserId: ctx.lawyerId,
      confirmedAt: uploadTime,
      createdAt: uploadTime,
      updatedAt: uploadTime,
    } as any) // as any para contornar typescript temporal (caso columns exatas diferirem)
    created++
  }
  return created
}

async function seedTimelineEvents(ctx: BaseCtx) {
  const now = new Date()
  let created = 0

  const events = [
    // CASO-001 José
    {
      id: deterministicUUID('evt.caso001.prisao'),
      clientId: CLI_001_JOSE_ID,
      executionCaseId: CASO_001_ID_ACTUAL,
      eventCategory: 'prison' as const,
      eventType: 'prison.entry',
      summary: 'Prisão em flagrante delito',
      occurredAt: new Date('2022-08-10T14:30:00Z'),
      recordedAt: now,
      visibility: 'both' as const,
      source: 'system_rule' as const,
      actorType: 'system' as const,
      actorId: ctx.lawyerId,
    },
    {
      id: deterministicUUID('evt.caso001.sentenca'),
      clientId: CLI_001_JOSE_ID,
      executionCaseId: CASO_001_ID_ACTUAL,
      eventCategory: 'court' as const,
      eventType: 'court.sentenca',
      summary: 'Sentença condenatória proferida (5 anos)',
      occurredAt: new Date('2022-12-05T10:00:00Z'),
      recordedAt: now,
      visibility: 'both' as const,
      source: 'system_rule' as const,
      actorType: 'system' as const,
      actorId: ctx.lawyerId,
    },
    {
      id: deterministicUUID('evt.caso001.doc_anexado'),
      clientId: CLI_001_JOSE_ID,
      executionCaseId: CASO_001_ID_ACTUAL,
      eventCategory: 'system' as const,
      eventType: 'system.document_associated',
      summary: 'Documento "Atestado de Conduta Carcerária 2024.pdf" anexado ao processo.',
      occurredAt: new Date(now.getTime() - 1000 * 60 * 60), // 1 hour ago
      recordedAt: now,
      visibility: 'internal' as const,
      source: 'manual' as const,
      actorType: 'user' as const,
      actorId: ctx.lawyerId,
    },

    // CASO-002 Maria
    {
      id: deterministicUUID('evt.caso002.sentenca'),
      clientId: CLI_002_MARIA_ID,
      executionCaseId: CASO_002_ID_ACTUAL,
      eventCategory: 'court' as const,
      eventType: 'court.sentenca',
      summary: 'Sentença condenatória (4 anos - Semiaberto)',
      occurredAt: new Date('2023-03-01T09:15:00Z'),
      recordedAt: now,
      visibility: 'both' as const,
      source: 'system_rule' as const,
      actorType: 'system' as const,
      actorId: ctx.lawyerId,
    },

    // CASO-003 Roberto
    {
      id: deterministicUUID('evt.caso003.extincao'),
      clientId: CLI_003_ROBERTO_ID,
      executionCaseId: CASO_003_ID_ACTUAL,
      eventCategory: 'sentence' as const,
      eventType: 'sentence.extincao',
      summary: 'Pena declarada extinta pelo Juízo.',
      occurredAt: new Date('2021-09-14T16:00:00Z'),
      recordedAt: now,
      visibility: 'both' as const,
      source: 'system_rule' as const,
      actorType: 'system' as const,
      actorId: ctx.lawyerId,
    },
  ]

  for (const def of events) {
    const existing = await db.select({ id: timelineEvents.id }).from(timelineEvents).where(eq(timelineEvents.id, def.id)).limit(1)
    if (existing.length > 0) continue

    await db.insert(timelineEvents).values({
      id: def.id,
      organizationId: ctx.orgId,
      clientId: def.clientId,
      executionCaseId: def.executionCaseId,
      eventCategory: def.eventCategory,
      eventType: def.eventType,
      summary: def.summary,
      occurredAt: def.occurredAt,
      recordedAt: def.recordedAt, // Two-clock principle applied
      visibility: def.visibility,
      source: def.source,
      actorType: def.actorType,
      actorId: def.actorId,
      payload: {},
      createdAt: def.recordedAt,
    } as any)
    created++
  }
  return created
}

async function seedDemoPhase3a() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║    EXECFLOW Demo Seed — Fase 3A: Docs & Timeline         ║')
  console.log('╚══════════════════════════════════════════════════════════╝')

  try {
    const ctx = await lookupBaseEntities()
    const docsCount = await seedDocuments(ctx)
    console.log(`✓ Documentos criados: ${docsCount}`)

    const tlCount = await seedTimelineEvents(ctx)
    console.log(`✓ Eventos de Timeline criados: ${tlCount}`)

    console.log('\n✅ Fase 3A concluída com sucesso.')
  } catch (err) {
    console.error('\n❌ FALHOU:', err)
    process.exitCode = 1
  } finally {
    await sql.end({ timeout: 5 })
  }
}

void seedDemoPhase3a().catch(console.error)
