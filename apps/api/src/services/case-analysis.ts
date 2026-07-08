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
import { eq, and, notInArray } from 'drizzle-orm'
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
  'progression', 'remission', 'detraction', 'amnesty', 'indult', 'commutation', 'hc',
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

  // Blocos com proteção de limite: PDFs ≤600 pág. vão nativos (limite real da
  // API Anthropic pra modelos de 1M de contexto); maiores vão como texto OCR
  // com triagem por relevância via Haiku (barato) — só as páginas prováveis
  // de conter sentença/cálculo/PAD/etc. chegam ao Sonnet, com cabeça+cauda
  // sempre incluídas; sem OCR → aviso explícito.
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
 "oportunidades": [ { "tipo": "progression|remission|parole|amnesty|indult|commutation|detraction|hc|excess_execution|prescription|pad_challenge|rights_violation|recalculation", "titulo": string, "fundamentacao": string, "prazo": string, "confianca": "high|medium|low" } ],
 "prazos": [ { "titulo": string, "classe": "legal|benefit|disciplinary|calculation", "dias": number|null, "dataLimite": "YYYY-MM-DD"|null, "descricao": string } ]
}
REGRAS DAS OPORTUNIDADES (muito importante):
- Liste APENAS o que pode ser pleiteado AGORA (dentro do prazo) ou NO FUTURO. NÃO liste oportunidades referentes a atos já passados/perdidos.
- Em "prazo", diga SEMPRE quando cabe: "imediato — já cumpriu o requisito", ou uma data/previsão aproximada (ex.: "previsto para ~03/2027, ao atingir 2/5 da pena"). Se não der pra estimar, explique objetivamente o gatilho futuro.

TABELA DE FRAÇÕES DO ART. 112 DA LEP (progressão de regime) — USE ESTA TABELA, não confie só no que você já sabe: as Leis 15.358/2026 e 15.402/2026 mudaram os percentuais recentemente e podem estar fora do que você aprendeu em treinamento.
REGRA DE OURO — IRRETROATIVIDADE (art. 5º, XL, CF/88): use a fração vigente na DATA DO FATO (data do crime), NUNCA a fração vigente hoje nem a da data da petição. Lei penal mais gravosa não retroage. Se o crime foi cometido ANTES da vigência da lei que aumentou a fração, use a fração ANTIGA (mais branda), mesmo que o cálculo/petição seja posterior.
Frações vigentes por período (para crimes SEM outra causa de aumento específica no processo):
- Crime comum (sem violência/grave ameaça), réu primário: 1/6 (~16,67%) — inalterado desde a Lei 13.964/2019.
- Crime comum, reincidente: 20% — inalterado desde 2019.
- Crime com violência ou grave ameaça (exceto crimes contra a dignidade sexual), réu primário: 25% (Lei 15.402/2026, vigência 08/05/2026); ANTES dessa data: também 25% (já era assim desde 2019 — sem mudança aqui).
- Crime com violência ou grave ameaça, reincidente específico: 30% — inalterado desde 2019.
- Crime hediondo/equiparado SEM resultado morte, réu primário: cometido A PARTIR de 25/03/2026 (Lei 15.358/2026) → 70%. Cometido ANTES de 25/03/2026 → 40% (regra do Pacote Anticrime, Lei 13.964/2019).
- Crime hediondo/equiparado SEM resultado morte, reincidente: a partir de 25/03/2026 → 80%. Antes → 60%.
- Crime hediondo/equiparado COM resultado morte, réu primário: a partir de 25/03/2026 → 75% (VEDADO livramento condicional se também for líder de organização criminosa ultraviolenta, milícia privada, ou feminicídio). Antes → 50%.
- Crime hediondo/equiparado COM resultado morte, reincidente: a partir de 25/03/2026 → 85% (VEDADO livramento condicional). Antes → 70%.
Se os autos não deixarem claro a data exata do crime (data-base costuma ser a da prisão/flagrante, mas o crime pode ter sido cometido antes), use a data do crime narrada na denúncia/sentença — não a data-base de detração.
Livramento condicional (art. 83 CP): 1/3 da pena (primário, bons antecedentes), 1/2 (reincidente em crime doloso), 2/3 (condenado por crime hediondo/equiparado — mas VEDADO se for reincidente específico em crime hediondo, art. 83, V, CP c/c art. 5º, Lei 8.072/90).
Remição (art. 126 LEP): 1 dia de pena para cada 3 dias trabalhados, ou a cada 12h de estudo (em ao menos 3 dias). Desde a Lei 15.402/2026, regime domiciliar NÃO impede a remição.
Detração (art. 42 CP): tempo de prisão provisória/internação/prisão administrativa conta para TODOS os fins, inclusive no numerador da fração de progressão — confira se já foi computada no cálculo homologado.

CHECKLIST DE PRAZOS (percorra cada item; inclua em "prazos" só o que tiver base real nos autos — não invente data nem gatilho):
- Recurso de agravo em execução (art. 197 LEP) — 5 dias da ciência/intimação de decisão do juízo da execução.
- Embargos de declaração — 2 dias (prazo curto, não confundir com o do agravo).
- Manifestação sobre cálculo de pena / PEC (planilha de execução) — prazo de vista à defesa.
- Impugnação de excesso de execução.
- Defesa em PAD (falta grave) e prazo pra audiência de justificação.
- Audiência de justificação (oitiva do apenado, art. 118 §2º LEP) ANTES de qualquer regressão de regime por falta grave — sem essa oitiva a regressão é nula e cabe HC; se os autos mostrarem regressão sem menção a essa audiência, sinalize isso na oportunidade/prazo.
- Recurso administrativo contra decisão de PAD.
- Manifestação sobre laudo/parecer da Comissão Técnica de Classificação (CTC) ou exame criminológico, se houver.
- Exame criminológico: desde a Lei 14.843/2024, é obrigatório em determinados casos para progressão (não mais facultativo) — se os autos indicarem que a progressão está condicionada a esse exame e ele ainda não foi feito/juntado, registre como prazo/pendência.
- Regime Disciplinar Diferenciado (RDD): se os autos mencionarem inclusão ou prorrogação em RDD, há prazo de recurso próprio — ganhou relevância com o Marco Legal do Crime Organizado (2026), especialmente em casos de organização criminosa ou milícia.
- Monitoramento eletrônico: quando houver condição de monitoramento (comum em saída temporária e livramento condicional), verifique prazo de vencimento/renovação do equipamento ou da autorização.
- Prazo de retorno de saída temporária (e renovação, se aplicável).
- Relatório periódico de cumprimento de condições do livramento condicional.
- Indulto natalino ou outro decreto de indulto/comutação vigente: decretos de indulto têm janela de vigência e requisitos próprios (geralmente publicados em dezembro) — se os autos mencionarem algum decreto de indulto/comutação e o réu parecer se enquadrar, registre a oportunidade e o prazo de requerimento dentro da vigência do decreto.
- Prescrição da pretensão executória (data-limite pra execução da pena, se identificável).
- Data prevista de término da pena (vencimento) — marco de monitoramento, não é bem um "prazo processual", mas deve ser registrado se calculável.
- Prazo pra requerer detração (tempo de prisão provisória a abater) quando há elemento nos autos sugerindo abatimento ainda não computado.
- Prazo pra juntar comprovante de trabalho/estudo pendente de remição.
- Prazo pra manifestação do MP sobre petição da defesa, quando essa manifestação for pré-requisito pra decisão que afeta o reeducando.
- Unificação/soma de penas — prazo pra requerer quando há notícia de nova condenação nos autos.
- Qualquer outro prazo com data ou termo inicial explícito no texto, mesmo que não se encaixe nas categorias acima.
DATA DO PRAZO — use "dias" OU "dataLimite", nunca os dois:
- "dataLimite" (YYYY-MM-DD): use quando souber ou puder calcular a data real do marco (ex.: previsão de progressão, livramento condicional, término de pena — você já calcula isso no campo "pena" e no resumo, reuse o mesmo cálculo aqui). É o caso mais comum pra prazos de benefício/cálculo.
- "dias": use SÓ para prazos processuais contados a partir de HOJE (ex.: agravo em execução = 5, embargos de declaração = 2). Nunca use "dias" pra estimar uma data que já está anos no futuro — isso conta errado.
NÃO invente dados ausentes (use null). Liste apenas oportunidades e prazos realmente cabíveis com base nos autos — a ausência de uma categoria do checklist nos autos não é erro, é sinal de que ela não se aplica a este caso.`

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

  // 0. Supersede sugestões da IA de rodadas anteriores desta mesma análise.
  // Achado 08/07/2026: a dedup abaixo compara TÍTULO EXATO — como o Claude
  // varia a redação a cada rodada ("Progressão ao regime semiaberto" vs.
  // "Progressão de regime para semiaberto"), reanalisar o mesmo caso
  // acumulava quase-duplicatas em vez de substituir. Antes de inserir o novo
  // lote, descarta as sugestões da IA da rodada anterior que o advogado
  // ainda não tocou (oportunidades 'suggested', prazos 'open' com
  // origin='rule') — decisões humanas (qualificado, prazo reconhecido, etc.)
  // nunca são tocadas aqui.
  const supersededNote = `Substituída por nova análise dos autos em ${new Date().toLocaleDateString('pt-BR')}.`
  await db
    .update(opportunities)
    .set({
      status: 'dismissed',
      dismissedAt: new Date(),
      dismissedByUserId: userId,
      dismissedReason: supersededNote,
      updatedAt: new Date(),
    })
    .where(and(eq(opportunities.executionCaseId, caseId), eq(opportunities.status, 'suggested')))
  await db
    .update(deadlines)
    .set({
      status: 'dismissed',
      dismissedAt: new Date(),
      dismissedByUserId: userId,
      dismissedReason: supersededNote,
      dismissedReasonCode: 'superseded_by_reanalysis',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(deadlines.executionCaseId, caseId),
        eq(deadlines.status, 'open'),
        eq(deadlines.origin, 'rule')
      )
    )

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
      .where(
        and(
          eq(opportunities.executionCaseId, caseId),
          eq(opportunities.summary, titulo),
          notInArray(opportunities.status, ['dismissed', 'expired'])
        )
      )
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
      .where(
        and(
          eq(deadlines.executionCaseId, caseId),
          eq(deadlines.title, titulo),
          notInArray(deadlines.status, ['dismissed', 'completed'])
        )
      )
      .limit(1)
    if (existing.length > 0) continue
    // Prefere dataLimite (data real, calculada pela IA) — "dias" só serve pra
    // prazos processuais curtos contados de hoje. Achado 07/07/2026: usar só
    // "dias" fazia previsão de anos no futuro (progressão, livramento) virar
    // "vence hoje", porque a IA não tinha como expressar uma data absoluta.
    const dataLimite = typeof p.dataLimite === 'string' ? new Date(`${p.dataLimite}T12:00:00Z`) : null
    const dias = Number(p.dias)
    const due =
      dataLimite && !isNaN(dataLimite.getTime())
        ? dataLimite
        : new Date(Date.now() + (Number.isFinite(dias) ? dias : 15) * 86400000)
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
