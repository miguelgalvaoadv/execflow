/**
 * seed-real-case-andre.ts — Semeia o CASO REAL (André Luis de Souza Arlindo)
 * no ExecFlow, com base na leitura dos autos feita pelo Claude.
 *
 * Cria, sob a org de demonstração (execflow-demo):
 *   - cliente André Luis de Souza Arlindo
 *   - execução penal (proc. 7000279-94.2019.8.26.0196)
 *   - cálculo de pena (sentence_snapshot)
 *   - timeline do processo (prisão → sentença → falta grave → regressão → agravo → acórdão)
 *   - oportunidades (livramento condicional, comutação, progressão bloqueada)
 *   - prazos em aberto
 *   - documento dos AUTOS (PDF) + a PEÇA gerada (piece_draft + documento .docx)
 *
 * Pré-requisito: pnpm -F @execflow/db db:seed && db:seed:demo (org + usuários).
 *
 * Uso:
 *   node --env-file=.env.local --import tsx src/seed-real-case-andre.ts [caminho-do-pdf-dos-autos]
 */
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import {
  organizations,
  users,
  clients,
  executionCases,
  sentenceSnapshots,
  timelineEvents,
  opportunities,
  deadlines,
  documents,
  pieceDrafts,
} from './schema/index.ts'

const DATABASE_URL = process.env['DATABASE_URL']
if (!DATABASE_URL) throw new Error('[seed-andre] DATABASE_URL não configurada.')

const sql = postgres(DATABASE_URL)
const db = drizzle(sql)

// ── caminhos dos arquivos já produzidos pelo teste ───────────────────────────
const DOWNLOADS = 'C:/Users/Miguel Galvão/Downloads'
const AUTOS_PDF = process.argv[2] || path.join(DOWNLOADS, '0001565-58.2026.8.26.0496.pdf')
const PECA_MD = path.join(DOWNLOADS, '0001565-58.2026.8.26.0496-peca.md')
const PECA_DOCX = path.join(DOWNLOADS, '0001565-58.2026.8.26.0496-peca.docx')

// storage local que a API lê (apps/api/.storage), relativo a packages/db
const API_STORAGE = path.resolve(process.cwd(), '../../apps/api/.storage')

function det(name: string): string {
  const h = createHash('sha1').update(`execflow-real-andre-v1:${name}`).digest()
  h[6] = ((h[6]! & 0x0f) | 0x50) as number
  h[8] = ((h[8]! & 0x3f) | 0x80) as number
  const x = h.toString('hex')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`
}
function detPhase1(name: string): string {
  const h = createHash('sha1').update(`execflow-demo-seed-phase1-v1:${name}`).digest()
  h[6] = ((h[6]! & 0x0f) | 0x50) as number
  h[8] = ((h[8]! & 0x3f) | 0x80) as number
  const x = h.toString('hex')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`
}

const LAWYER_ID = detPhase1('user.rafael-mendes.lawyer')
const CLIENT_ID = det('client.andre-luis-souza-arlindo')
const CASE_ID = det('case.andre.trafico-execucao')
const SNAP_ID = det('snap.andre.v1')
const OPP_PAROLE_ID = det('opp.andre.livramento')
const OPP_COMMUT_ID = det('opp.andre.comutacao')
const OPP_PROG_ID = det('opp.andre.progressao')
const DOC_AUTOS_ID = det('doc.andre.autos')
const DOC_PECA_ID = det('doc.andre.peca')
const DRAFT_ID = det('draft.andre.livramento')

async function exists(table: any, id: string): Promise<boolean> {
  const r = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1)
  return r.length > 0
}

function writeToStorage(orgId: string, srcPath: string, ext: string): { storageKey: string; bytes: number; sha: string } | null {
  if (!fs.existsSync(srcPath)) {
    console.warn(`  ⚠ arquivo não encontrado, pulando blob: ${srcPath}`)
    return null
  }
  const buf = fs.readFileSync(srcPath)
  const key = `${orgId}/2026/06/${randomUUID()}${ext}`
  const dest = path.join(API_STORAGE, key)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(srcPath, dest)
  return { storageKey: key, bytes: buf.length, sha: createHash('sha256').update(buf).digest('hex') }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗')
  console.log('║   ExecFlow — Seed do caso REAL: André Luis Souza Arlindo  ║')
  console.log('╚═══════════════════════════════════════════════════════════╝\n')

  const org = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, 'execflow-demo')).limit(1)
  if (!org[0]) throw new Error('Org "execflow-demo" não encontrada. Rode db:seed e db:seed:demo primeiro.')
  const orgId = org[0].id
  const admin = await db.select({ id: users.id }).from(users).where(eq(users.email, 'admin@execflow.local')).limit(1)
  if (!admin[0]) throw new Error('admin@execflow.local não encontrado. Rode db:seed primeiro.')
  const adminId = admin[0].id
  console.log(`✓ Org: ${orgId}`)

  const now = new Date()

  // ── CLIENTE ────────────────────────────────────────────────────────────
  if (!(await exists(clients, CLIENT_ID))) {
    await db.insert(clients).values({
      id: CLIENT_ID,
      organizationId: orgId,
      fullName: 'André Luis de Souza Arlindo',
      cpf: '32601148829',
      birthDate: '1982-05-02',
      status: 'active',
      responsibleLawyerUserId: LAWYER_ID,
      createdByUserId: adminId,
      aliases: ['Dezinho', 'Andrezin'],
      notes: 'Tráfico de drogas (art. 33, Lei 11.343/06), reincidente. Pena 13a1m15d. Regressão ao regime fechado por falta grave (17/03/2025); agravo em execução desprovido pelo TJSP (08/06/2026). Matrícula SAP 477.860-1. RG 41.375.588-5/SP.',
      createdAt: now,
      updatedAt: now,
    } as any)
    console.log('✓ Cliente: André Luis de Souza Arlindo')
  } else console.log('↩ Cliente já existe')

  // ── EXECUÇÃO PENAL ──────────────────────────────────────────────────────
  if (!(await exists(executionCases, CASE_ID))) {
    await db.insert(executionCases).values({
      id: CASE_ID,
      organizationId: orgId,
      clientId: CLIENT_ID,
      internalRef: 'EXE-2019-ANDRE',
      executionProcessNumber: '7000279-94.2019.8.26.0196',
      courtName: 'DEECRIM UR6 — 6ª RAJ — Ribeirão Preto/SP',
      courtJurisdiction: 'Ribeirão Preto/SP',
      caseKind: 'primary',
      status: 'active',
      responsibleLawyerUserId: LAWYER_ID,
      sentenceSummary: '13 anos, 1 mês e 15 dias — tráfico (art. 33, Lei 11.343/06), reincidente. Regime fechado (regressão por falta grave em 17/03/2025).',
      openedAt: new Date('2019-06-01T00:00:00.000Z'),
      createdByUserId: adminId,
      createdAt: now,
      updatedAt: now,
    } as any)
    console.log('✓ Execução: 7000279-94.2019.8.26.0196')
  } else console.log('↩ Caso já existe')

  // ── CÁLCULO DE PENA (snapshot) ──────────────────────────────────────────
  if (!(await exists(sentenceSnapshots, SNAP_ID))) {
    await db.insert(sentenceSnapshots).values({
      id: SNAP_ID,
      organizationId: orgId,
      executionCaseId: CASE_ID,
      effectiveAt: new Date('2025-03-17T00:00:00.000Z'), // data-base reiniciada pela falta grave
      status: 'confirmed',
      totalSentenceDays: 4790,
      servedDays: 2790,
      remissionDays: 0,
      detractionDays: 0,
      remainingDays: 2000,
      percentServed: '0.5825',
      isGenericRecidivist: true,
      confidenceLevel: 'medium',
      calculationMethod: 'Estimativa ExecFlow (Claude) a partir dos autos — PENDENTE cálculo oficial do SAP e total de dias remidos.',
      crimesBreakdown: [
        {
          crimeCode: 'art33-lei11343',
          crimeName: 'Tráfico de drogas',
          article: 'Art. 33',
          law: 'Lei 11.343/2006',
          sentenceDays: 4790,
          isHediondo: false,
          isEquiparado: true,
          hasResultingDeath: false,
          isAttempted: false,
          sentenceDate: '',
          transitDate: '',
        },
      ],
      missingDataFlags: [
        { field: 'remissionDays', whyNeeded: 'Definir dias remidos sobreviventes após perda de 1/3', severity: 'critical' },
        { field: 'officialCalculation', whyNeeded: 'Novo cálculo oficial do SAP ainda não apresentado', severity: 'critical' },
      ],
      confirmedByUserId: LAWYER_ID,
      confirmedAt: now,
      createdByUserId: adminId,
      createdAt: now,
    } as any)
    console.log('✓ Cálculo de pena (snapshot): 4790 dias, ~58% cumprido')
  } else console.log('↩ Snapshot já existe')

  // ── TIMELINE DO PROCESSO ────────────────────────────────────────────────
  const tl = [
    ['prisao', 'prison', 'prison.entry', 'Prisão (início do cumprimento da pena)', '2018-10-20T00:00:00Z'],
    ['inclusao-cpp', 'prison', 'prison.transfer', 'Inclusão no CPP de Jardinópolis (procedente da Penit. de Franca)', '2024-12-10T00:00:00Z'],
    ['falta-grave', 'prison', 'discipline.falta_grave', 'Falta grave: descumprimento de condição de saída temporária (recolhimento em endereço não declarado)', '2025-03-17T00:00:00Z'],
    ['regressao', 'court', 'court.regressao', 'Decisão: homologação da falta grave, regressão ao regime fechado, perda de 1/3 dos remidos e reinício do lapso', '2025-08-21T00:00:00Z'],
    ['decisao-fev', 'court', 'court.decisao', 'Nova decisão reitera as sanções e acrescenta perda de futuras saídas temporárias (fls. 1050/1054)', '2026-02-11T00:00:00Z'],
    ['agravo', 'legal_action', 'legal.agravo', 'Interposição de Agravo em Execução nº 0001565-58.2026.8.26.0496', '2026-02-23T00:00:00Z'],
    ['acordao', 'court', 'court.acordao', 'TJSP nega provimento ao agravo (Rel. Juiz Pedro Ferronato) — mantida a decisão de 1ª instância', '2026-06-08T00:00:00Z'],
  ] as const

  let tlCount = 0
  for (const [slug, cat, type, summary, when] of tl) {
    const id = det(`evt.andre.${slug}`)
    if (await exists(timelineEvents, id)) continue
    await db.insert(timelineEvents).values({
      id,
      organizationId: orgId,
      clientId: CLIENT_ID,
      executionCaseId: CASE_ID,
      eventCategory: cat,
      eventType: type,
      summary,
      occurredAt: new Date(when),
      recordedAt: now,
      visibility: 'both',
      source: 'system_rule',
      actorType: 'system',
      actorId: LAWYER_ID,
      payload: {},
      createdAt: now,
    } as any)
    tlCount++
  }
  console.log(`✓ Timeline: ${tlCount} eventos do processo`)

  // ── OPORTUNIDADES ───────────────────────────────────────────────────────
  const opps = [
    {
      id: OPP_PAROLE_ID, type: 'parole', status: 'suggested', confidence: 'high',
      summary: 'Livramento condicional (2/3 da pena)',
      rationale: 'A falta grave NÃO interrompe o lapso do livramento condicional (Súmulas 441, 534 e 535 do STJ), conforme reconhecido pelo próprio Juízo. Reincidente: 2/3 da pena (art. 83, II, CP). Implemento estimado ≈ set/2027 — antecipável pela remição sobrevivente. Requer cálculo oficial atualizado.',
      legalBasis: 'CP art. 83, II; LEP arts. 131 e ss.; Súmulas 441/534/535 STJ.',
      windowStartAt: new Date('2027-09-01T00:00:00Z'), windowEndAt: null, isBlocked: false,
    },
    {
      id: OPP_COMMUT_ID, type: 'commutation', status: 'suggested', confidence: 'medium',
      summary: 'Comutação / Indulto (decreto vigente)',
      rationale: 'Falta grave não interrompe o lapso para indulto/comutação (Súmula 535 STJ). Avaliar enquadramento do executado nos requisitos do decreto presidencial vigente.',
      legalBasis: 'CF art. 84, XII; Súmula 535 STJ; Decreto de indulto vigente.',
      windowStartAt: null, windowEndAt: null, isBlocked: false,
    },
    {
      id: OPP_PROG_ID, type: 'progression', status: 'suggested', confidence: 'low',
      summary: 'Progressão de regime (após novo cálculo)',
      rationale: 'Data-base reiniciada em 17/03/2025 (falta grave). Fração de reincidente em equiparado a hediondo (40%/60% — art. 112 LEP) depende do novo cálculo oficial, ainda não apresentado.',
      legalBasis: 'LEP art. 112 (Lei 13.964/2019).',
      windowStartAt: null, windowEndAt: null, isBlocked: true,
      blockingConditions: [{ condition: 'Novo cálculo de pena oficial não apresentado', type: 'missing_data' }],
    },
  ] as const

  let oppCount = 0
  for (const o of opps) {
    if (await exists(opportunities, o.id)) continue
    await db.insert(opportunities).values({
      id: o.id,
      organizationId: orgId,
      executionCaseId: CASE_ID,
      opportunityType: o.type,
      status: o.status,
      summary: o.summary,
      rationale: o.rationale,
      confidenceLevel: o.confidence,
      legalBasis: o.legalBasis,
      windowStartAt: o.windowStartAt,
      windowEndAt: o.windowEndAt,
      isBlocked: o.isBlocked,
      blockingConditions: 'blockingConditions' in o ? o.blockingConditions : null,
      createdAt: now,
      updatedAt: now,
    } as any)
    oppCount++
  }
  console.log(`✓ Oportunidades: ${oppCount} (livramento, comutação, progressão)`)

  // ── PRAZOS ──────────────────────────────────────────────────────────────
  const dls = [
    {
      id: det('deadline.andre.calculo'), title: 'Manifestar sobre o novo cálculo de pena',
      description: 'Impugnar/manifestar quando o SAP apresentar o novo cálculo de pena determinado pelo Juízo (data-base 17/03/2025, perda de 1/3 dos remidos).',
      cls: 'calculation', priority: 'high', status: 'open', due: new Date(now.getTime() + 15 * 864e5),
    },
    {
      id: det('deadline.andre.recurso'), title: 'Avaliar recurso ao acórdão (REsp/HC)',
      description: 'Acórdão do TJSP (08/06/2026) negou provimento ao agravo. Avaliar cabimento de Recurso Especial ou HC quanto à regressão/perda de saídas temporárias.',
      cls: 'legal', priority: 'normal', status: 'open', due: new Date(now.getTime() + 10 * 864e5),
    },
  ] as const

  let dlCount = 0
  for (const d of dls) {
    if (await exists(deadlines, d.id)) continue
    await db.insert(deadlines).values({
      id: d.id,
      organizationId: orgId,
      executionCaseId: CASE_ID,
      title: d.title,
      description: d.description,
      dueAt: d.due,
      deadlineClass: d.cls,
      origin: 'rule',
      priority: d.priority,
      status: d.status,
      assigneeUserId: LAWYER_ID,
      createdByUserId: LAWYER_ID,
      createdAt: now,
      updatedAt: now,
    } as any)
    dlCount++
  }
  console.log(`✓ Prazos: ${dlCount} em aberto`)

  // ── DOCUMENTO: AUTOS (PDF) ──────────────────────────────────────────────
  if (!(await exists(documents, DOC_AUTOS_ID))) {
    const blob = writeToStorage(orgId, AUTOS_PDF, '.pdf')
    await db.insert(documents).values({
      id: DOC_AUTOS_ID,
      organizationId: orgId,
      clientId: CLIENT_ID,
      executionCaseId: CASE_ID,
      documentClass: 'autos_integral',
      fileName: 'Autos do Processo — 0001565-58.2026.8.26.0496.pdf',
      mimeType: 'application/pdf',
      byteSize: blob?.bytes ?? 7_500_000,
      status: 'confirmed',
      sourceChannel: 'intake_tribunal',
      ocrStatus: 'completed',
      sensitivityLevel: 'restricted',
      storageKey: blob?.storageKey ?? `mock/${DOC_AUTOS_ID}.pdf`,
      checksumSha256: blob?.sha ?? createHash('sha256').update(DOC_AUTOS_ID).digest('hex'),
      uploadedByUserId: LAWYER_ID,
      uploadedAt: now,
      confirmedByUserId: LAWYER_ID,
      confirmedAt: now,
      createdAt: now,
      updatedAt: now,
    } as any)
    console.log('✓ Documento: AUTOS (PDF) anexado e confirmado')
  } else console.log('↩ Documento autos já existe')

  // ── PEÇA GERADA: piece_draft + documento .docx ──────────────────────────
  const pecaMd = fs.existsSync(PECA_MD)
    ? fs.readFileSync(PECA_MD, 'utf8')
    : '# Petição de Livramento Condicional\n\n(peça gerada pelo Claude)'

  if (!(await exists(pieceDrafts, DRAFT_ID))) {
    await db.insert(pieceDrafts).values({
      id: DRAFT_ID,
      organizationId: orgId,
      executionCaseId: CASE_ID,
      opportunityId: OPP_PAROLE_ID,
      status: 'draft',
      modelUsed: 'claude-sonnet-4-6',
      contentMarkdown: pecaMd,
      createdByUserId: LAWYER_ID,
      createdAt: now,
      updatedAt: now,
    } as any)
    // vincula a peça à oportunidade de livramento
    await db.update(opportunities).set({ realizedPieceDraftId: DRAFT_ID } as any).where(eq(opportunities.id, OPP_PAROLE_ID))
    console.log('✓ Peça gerada (Livramento Condicional) salva como rascunho editável')
  } else console.log('↩ Peça já existe')

  if (!(await exists(documents, DOC_PECA_ID))) {
    const blob = writeToStorage(orgId, PECA_DOCX, '.docx')
    await db.insert(documents).values({
      id: DOC_PECA_ID,
      organizationId: orgId,
      clientId: CLIENT_ID,
      executionCaseId: CASE_ID,
      documentClass: 'petition',
      fileName: 'Petição — Livramento Condicional (gerada).docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      byteSize: blob?.bytes ?? 16000,
      status: 'confirmed',
      sourceChannel: 'intake_api',
      ocrStatus: 'not_applicable',
      sensitivityLevel: 'standard',
      storageKey: blob?.storageKey ?? `mock/${DOC_PECA_ID}.docx`,
      checksumSha256: blob?.sha ?? createHash('sha256').update(DOC_PECA_ID).digest('hex'),
      uploadedByUserId: LAWYER_ID,
      uploadedAt: now,
      confirmedByUserId: LAWYER_ID,
      confirmedAt: now,
      createdAt: now,
      updatedAt: now,
    } as any)
    console.log('✓ Documento: PEÇA gerada (.docx) anexada')
  } else console.log('↩ Documento da peça já existe')

  console.log('\n✅ Caso real do André semeado no ExecFlow.')
  console.log(`   Cliente:   ${CLIENT_ID}`)
  console.log(`   Caso:      ${CASE_ID}`)
}

main()
  .catch((e) => { console.error('\n❌ FALHOU:', e); process.exitCode = 1 })
  .finally(() => sql.end({ timeout: 5 }))
