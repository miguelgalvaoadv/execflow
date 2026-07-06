/**
 * Detector de oportunidades por IA a partir do TEXTO das movimentações.
 *
 * Diferente de `case-analysis.ts` (que lê os autos em PDF), este serviço é leve:
 * recebe o texto das movimentações novas (ex.: vindas do webhook do Escavador) e
 * pergunta ao Claude se há uma oportunidade jurídica de execução penal ali.
 * Oportunidades entram como 'suggested' (o advogado confirma).
 */
import Anthropic from '@anthropic-ai/sdk'
import { logAiInteraction } from './ai-log.ts'
import { eq, and } from 'drizzle-orm'
import { db } from '../lib/db.ts'
import { executionCases, clients, opportunities } from '@execflow/db/schema'

const OPP_TYPES = new Set([
  'progression', 'remission', 'detraction', 'amnesty', 'commutation', 'hc',
  'pad_challenge', 'prescription', 'recalculation', 'excess_execution',
  'rights_violation', 'parole',
])

function parseJsonLoose(text: string): any {
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1]!.trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) t = t.slice(start, end + 1)
  return JSON.parse(t)
}

export type MovementOpportunityResult = {
  oportunidadesCriadas: number
  titulos: string[]
  /** Highest criticality tier across all movements in this batch, or null if none classified. */
  criticalityTier: '1' | '2' | '3' | null
}

/**
 * Analisa o texto das movimentações novas de um caso e cria oportunidades
 * sugeridas quando o Claude identifica algo cabível. Best-effort: se a chave
 * não estiver configurada ou a IA não retornar JSON, retorna 0 sem lançar.
 */
export async function detectOpportunitiesFromMovements(params: {
  organizationId: string
  executionCaseId: string
  movements: string[]
}): Promise<MovementOpportunityResult> {
  const empty: MovementOpportunityResult = { oportunidadesCriadas: 0, titulos: [], criticalityTier: null }
  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) return empty
  if (params.movements.length === 0) return empty

  const rows = await db
    .select({ case: executionCases, client: clients })
    .from(executionCases)
    .innerJoin(clients, eq(executionCases.clientId, clients.id))
    .where(
      and(
        eq(executionCases.id, params.executionCaseId),
        eq(executionCases.organizationId, params.organizationId)
      )
    )
  const row = rows[0]
  if (!row) return empty

  const client = new Anthropic({ apiKey })
  const system = `Você é advogado criminalista brasileiro especialista em Execução Penal (LEP).
Recebe NOVAS MOVIMENTAÇÕES de um processo de execução penal e deve:
1. Identificar se surgiu alguma OPORTUNIDADE jurídica acionável (ex.: progressão, livramento, remição, indulto, comutação, HC, impugnação de PAD, excesso de execução, prescrição, recálculo).
2. Classificar a CRITICIDADE dessas movimentações para os autos já existentes do processo.

RESPONDA APENAS COM JSON VÁLIDO, sem texto fora do JSON, no formato EXATO:
{
  "oportunidades": [ { "tipo": "progression|remission|parole|commutation|detraction|hc|excess_execution|prescription|pad_challenge|rights_violation|recalculation", "titulo": string, "fundamentacao": string, "prazo": string, "confianca": "high|medium|low" } ],
  "criticalidadeTier": "1"|"2"|"3"|null
}

Regras para criticalidadeTier (escolha o PIOR tier entre todas as movimentações):
- "1" (INVALIDA OS AUTOS): regressão de regime, extinção da pena, cálculo novo de pena, revogação de benefício, falta grave homologada — qualquer movimentação que torna os autos anteriores desatualizados para fins de petição.
- "2" (RELEVANTE MAS NÃO INVALIDA): progressão aguardando guia de recolhimento, audiência marcada, remição parcial concedida — impacto real mas os autos ainda são válidos.
- "3" (PROCEDIMENTAL/INFORMATIVO): vistas, cargas, certidões expedidas, conclusos ao juiz, expedição de mandado — sem impacto no mérito dos autos.
- null: nenhuma movimentação de mérito identificada.

Liste APENAS oportunidades que podem ser feitas AGORA ou no FUTURO — nunca atos já passados.
Se NÃO houver nada acionável, retorne oportunidades: [].
Não invente fatos ausentes.`

  const userPrompt = `Processo ${row.case.executionProcessNumber ?? 'sem número'} de ${row.client.fullName}.
Novas movimentações:
${params.movements.map((m, i) => `${i + 1}. ${m}`).join('\n')}

Retorne somente o JSON.`

  let parsed: any
  const startedAt = Date.now()
  try {
    const resp = await client.messages.create({
      // @ts-ignore — id de modelo validado no servidor
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: userPrompt }],
    })
    const text = resp.content.filter((c) => c.type === 'text').map((c) => (c as any).text).join('\n')
    void logAiInteraction({
      organizationId: params.organizationId,
      agent: 'movement_classifier',
      model: 'claude-sonnet-4-6',
      promptText: `${system}\n\n---\n\n${userPrompt}`,
      responseText: text,
      executionCaseId: params.executionCaseId,
      inputTokens: resp.usage?.input_tokens ?? null,
      outputTokens: resp.usage?.output_tokens ?? null,
      status: 'success',
      durationMs: Date.now() - startedAt,
    })
    parsed = parseJsonLoose(text)
  } catch (e) {
    console.warn('[opportunity-detector] IA indisponível ou JSON inválido:', e)
    void logAiInteraction({
      organizationId: params.organizationId,
      agent: 'movement_classifier',
      model: 'claude-sonnet-4-6',
      promptText: `${system}\n\n---\n\n${userPrompt}`,
      executionCaseId: params.executionCaseId,
      status: 'error',
      errorMessage: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - startedAt,
    })
    return empty
  }

  const rawTier = parsed.criticalidadeTier
  const criticalityTier: '1' | '2' | '3' | null =
    rawTier === '1' || rawTier === '2' || rawTier === '3' ? rawTier : null

  let oportunidadesCriadas = 0
  const titulos: string[] = []
  for (const o of parsed.oportunidades ?? []) {
    const titulo = String(o.titulo ?? 'Oportunidade').slice(0, 255)
    const existing = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(and(eq(opportunities.executionCaseId, params.executionCaseId), eq(opportunities.summary, titulo)))
      .limit(1)
    if (existing.length > 0) continue
    await db.insert(opportunities).values({
      organizationId: params.organizationId,
      executionCaseId: params.executionCaseId,
      opportunityType: OPP_TYPES.has(o.tipo) ? o.tipo : 'recalculation',
      status: 'suggested',
      summary: titulo,
      rationale: (o.prazo ? `⏳ Prazo/previsão: ${String(o.prazo)}\n\n` : '') + String(o.fundamentacao ?? ''),
      confidenceLevel: ['high', 'medium', 'low'].includes(o.confianca) ? o.confianca : 'medium',
      isBlocked: false,
    } as any)
    oportunidadesCriadas++
    titulos.push(titulo)
  }

  return { oportunidadesCriadas, titulos, criticalityTier }
}
