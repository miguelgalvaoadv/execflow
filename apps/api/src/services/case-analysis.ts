/**
 * Análise dos autos por IA (Claude) — gera o cálculo de pena, oportunidades e
 * prazos a partir dos autos confirmados do caso, escrevendo no banco.
 *
 * Substitui (de forma pragmática) o motor LEP determinístico (stub): a IA propõe,
 * o advogado confirma. Snapshots saem como 'proposed', oportunidades como
 * 'suggested', prazos como 'open'.
 */
import Anthropic from '@anthropic-ai/sdk'
import { logAiInteraction } from './ai-log.ts'
import { buildDocumentBlocks } from './claude-doc-blocks.ts'
import { eq, and } from 'drizzle-orm'
import { db } from '../lib/db.ts'
import {
  executionCases,
  clients,
  documents,
  sentenceSnapshots,
  opportunities,
  deadlines,
} from '@execflow/db/schema'
import { createStorageProviderFromEnv } from '@execflow/storage'

const RELEVANT_CLASSES = [
  'sentenca', 'acórdão', 'despacho', 'guia_de_execucao', 'atestado_medico',
  'laudo_disciplinar', 'atestado_penas', 'ficha_reu', 'pad', 'certidao_carceraria',
  'comprovante_trabalho_estudo', 'autos_iniciais', 'autos_integral',
]
const OPP_TYPES = new Set([
  'progression', 'remission', 'detraction', 'amnesty', 'commutation', 'hc',
  'pad_challenge', 'prescription', 'recalculation', 'excess_execution',
  'rights_violation', 'parole',
])
const DL_CLASSES = new Set(['legal', 'benefit', 'disciplinary', 'calculation', 'internal', 'recurring', 'sla'])

function parseJsonLoose(text: string): any {
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1]!.trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) t = t.slice(start, end + 1)
  return JSON.parse(t)
}

export type CaseAnalysisResult = {
  snapshotId: string | null
  resumoPena: string | null
  oportunidadesCriadas: number
  prazosCriados: number
}

export async function analyzeAutosForCase(
  organizationId: string,
  caseId: string,
  userId: string
): Promise<CaseAnalysisResult> {
  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada no servidor.')
  const client = new Anthropic({ apiKey })

  const rows = await db
    .select({ case: executionCases, client: clients })
    .from(executionCases)
    .innerJoin(clients, eq(executionCases.clientId, clients.id))
    .where(and(eq(executionCases.id, caseId), eq(executionCases.organizationId, organizationId)))
  const row = rows[0]
  if (!row) throw new Error('Caso não encontrado.')

  const docs = await db
    .select()
    .from(documents)
    .where(and(eq(documents.executionCaseId, caseId), eq(documents.status, 'confirmed')))
  const autos = docs.filter(
    (d: any) => d.documentClass && RELEVANT_CLASSES.includes(d.documentClass) && d.mimeType === 'application/pdf'
  )
  if (autos.length === 0) {
    throw new Error('Nenhum documento confirmado (autos em PDF) para analisar. Suba os autos primeiro.')
  }

  // Blocos com proteção de limite: PDFs ≤95 pág. vão nativos; maiores vão como
  // texto OCR recortado (início+fim com numeração); sem OCR → aviso explícito.
  const { blocks, manifest } = await buildDocumentBlocks(
    autos.map((d: any) => ({
      id: d.id,
      fileName: d.fileName,
      mimeType: d.mimeType,
      byteSize: Number(d.byteSize),
      storageKey: d.storageKey,
    }))
  )
  if (blocks.length === 0) {
    throw new Error(
      `Nenhum documento pôde ser incluído na análise. Detalhe: ${manifest.join(' | ') || 'autos sem conteúdo legível'}. Se o PDF for grande, aguarde o OCR processar (worker) e tente de novo.`
    )
  }

  const system = `Você é advogado criminalista brasileiro especialista em Execução Penal (LEP).
Analise os autos e RESPONDA APENAS COM JSON VÁLIDO (sem nenhum texto fora do JSON, sem cercas markdown), no formato EXATO:
{
 "pena": { "penaTotalDias": number|null, "regimeAtual": string|null, "dataBase": "YYYY-MM-DD"|null, "diasRemidos": number|null, "diasCumpridosAprox": number|null, "resumo": string },
 "oportunidades": [ { "tipo": "progression|remission|parole|commutation|detraction|hc|excess_execution|prescription|pad_challenge|rights_violation|recalculation", "titulo": string, "fundamentacao": string, "prazo": string, "confianca": "high|medium|low" } ],
 "prazos": [ { "titulo": string, "classe": "legal|benefit|disciplinary|calculation", "dias": number, "descricao": string } ]
}
REGRAS DAS OPORTUNIDADES (muito importante):
- Liste APENAS o que pode ser pleiteado AGORA (dentro do prazo) ou NO FUTURO. NÃO liste oportunidades referentes a atos já passados/perdidos.
- Em "prazo", diga SEMPRE quando cabe: "imediato — já cumpriu o requisito", ou uma data/previsão aproximada (ex.: "previsto para ~03/2027, ao atingir 2/5 da pena"). Se não der pra estimar, explique objetivamente o gatilho futuro.
NÃO invente dados ausentes (use null). Liste apenas oportunidades realmente cabíveis com base nos autos.`

  blocks.push({
    type: 'text',
    text: `Analise os autos de execução penal de ${row.client.fullName} (processo ${row.case.executionProcessNumber ?? 'sem número'}).\nDocumentos fornecidos: ${manifest.join('; ')}.\nRetorne somente o JSON conforme as instruções.`,
  })

  const startedAt = Date.now()
  let resp
  try {
    resp = await client.messages.create({
      // @ts-ignore
      model: 'claude-sonnet-4-6',
      max_tokens: 6000,
      system,
      messages: [{ role: 'user', content: blocks as unknown as Anthropic.MessageParam['content'] }],
    })
  } catch (err) {
    void logAiInteraction({
      organizationId,
      agent: 'sentence_calculator',
      model: 'claude-sonnet-4-6',
      promptText: system,
      executionCaseId: caseId,
      clientId: row.client.id,
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    })
    throw err
  }
  const text = resp.content.filter((c) => c.type === 'text').map((c) => (c as any).text).join('\n')

  void logAiInteraction({
    organizationId,
    agent: 'sentence_calculator',
    model: 'claude-sonnet-4-6',
    promptText: `${system}\n\n[+ ${autos.length} PDF(s) dos autos anexado(s)]`,
    responseText: text,
    executionCaseId: caseId,
    clientId: row.client.id,
    inputTokens: resp.usage?.input_tokens ?? null,
    outputTokens: resp.usage?.output_tokens ?? null,
    status: 'success',
    durationMs: Date.now() - startedAt,
  })

  let parsed: any
  try {
    parsed = parseJsonLoose(text)
  } catch {
    console.error('[case-analysis] JSON inválido. stop_reason=', (resp as any).stop_reason, 'len=', text.length)
    console.error('[case-analysis] resposta crua (início):', text.slice(0, 600))
    console.error('[case-analysis] resposta crua (fim):', text.slice(-400))
    throw new Error('A IA não retornou um JSON válido. Tente novamente.')
  }

  // 1. Snapshot de pena (proposto)
  let snapshotId: string | null = null
  const pena = parsed.pena
  if (pena && (pena.penaTotalDias || pena.resumo)) {
    const total = Number(pena.penaTotalDias) || 0
    const served = Number(pena.diasCumpridosAprox) || 0
    const remission = Number(pena.diasRemidos) || 0
    const remaining = Math.max(total - served - remission, 0)
    const pct = total > 0 ? Math.min(served / total, 1).toFixed(4) : '0'
    const inserted = await db
      .insert(sentenceSnapshots)
      .values({
        organizationId,
        executionCaseId: caseId,
        effectiveAt: pena.dataBase ? new Date(pena.dataBase) : new Date(),
        status: 'proposed',
        totalSentenceDays: total,
        servedDays: served,
        remissionDays: remission,
        detractionDays: 0,
        remainingDays: remaining,
        percentServed: pct,
        calculationMethod: 'Análise dos autos por IA (Claude) — requer confirmação do advogado.',
        crimesBreakdown: [],
        missingDataFlags: [],
        createdByUserId: userId,
      } as any)
      .returning({ id: sentenceSnapshots.id })
    snapshotId = inserted[0]?.id ?? null
  }

  // 2. Oportunidades (sugeridas), com dedup por título
  let oportunidadesCriadas = 0
  for (const o of parsed.oportunidades ?? []) {
    const titulo = String(o.titulo ?? 'Oportunidade').slice(0, 255)
    const existing = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(and(eq(opportunities.executionCaseId, caseId), eq(opportunities.summary, titulo)))
      .limit(1)
    if (existing.length > 0) continue
    await db.insert(opportunities).values({
      organizationId,
      executionCaseId: caseId,
      opportunityType: OPP_TYPES.has(o.tipo) ? o.tipo : 'recalculation',
      status: 'suggested',
      summary: titulo,
      rationale: (o.prazo ? `⏳ Prazo/previsão: ${String(o.prazo)}\n\n` : '') + String(o.fundamentacao ?? ''),
      confidenceLevel: ['high', 'medium', 'low'].includes(o.confianca) ? o.confianca : 'medium',
      isBlocked: false,
    } as any)
    oportunidadesCriadas++
  }

  // 3. Prazos (abertos), com dedup por título
  let prazosCriados = 0
  for (const p of parsed.prazos ?? []) {
    const titulo = String(p.titulo ?? 'Prazo').slice(0, 255)
    const existing = await db
      .select({ id: deadlines.id })
      .from(deadlines)
      .where(and(eq(deadlines.executionCaseId, caseId), eq(deadlines.title, titulo)))
      .limit(1)
    if (existing.length > 0) continue
    const dias = Number(p.dias)
    const due = new Date(Date.now() + (Number.isFinite(dias) ? dias : 15) * 86400000)
    await db.insert(deadlines).values({
      organizationId,
      executionCaseId: caseId,
      title: titulo,
      description: String(p.descricao ?? ''),
      dueAt: due,
      deadlineClass: DL_CLASSES.has(p.classe) ? p.classe : 'legal',
      origin: 'rule',
      priority: 'normal',
      status: 'open',
      createdByUserId: userId,
    } as any)
    prazosCriados++
  }

  return {
    snapshotId,
    resumoPena: pena?.resumo ?? null,
    oportunidadesCriadas,
    prazosCriados,
  }
}
