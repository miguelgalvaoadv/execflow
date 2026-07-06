/**
 * Worker-local mirror of apps/api/src/services/opportunity-detector.ts.
 *
 * WHY DUPLICATED, NOT IMPORTED: packages/workers cannot import from apps/api
 * (apps depend on packages, never the reverse — keeps the dependency graph
 * acyclic). The Astrea IMAP poller lives entirely in packages/workers (there
 * is no HTTP webhook to receive it on, unlike Jusbrasil), so this copy keeps
 * the same model, prompt, and output contract without crossing that
 * boundary. If the two ever drift, treat apps/api's version as the source of
 * truth and re-sync this one.
 */
import Anthropic from '@anthropic-ai/sdk'
import { executionCases, clients, opportunities } from '@execflow/db/schema'
import { eq, and } from '@execflow/db/client'
import type { WorkersDb } from '../lib/db.ts'

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
}

export async function detectAstreaOpportunities(
  db: WorkersDb,
  params: { organizationId: string; executionCaseId: string; movements: string[] }
): Promise<MovementOpportunityResult> {
  const empty: MovementOpportunityResult = { oportunidadesCriadas: 0, titulos: [] }
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
Recebe NOVAS MOVIMENTAÇÕES de um processo de execução penal e deve identificar se
surgiu alguma OPORTUNIDADE jurídica acionável (ex.: progressão, livramento, remição,
indulto, comutação, HC, impugnação de PAD, excesso de execução, prescrição, recálculo).
RESPONDA APENAS COM JSON VÁLIDO, sem texto fora do JSON, no formato EXATO:
{ "oportunidades": [ { "tipo": "progression|remission|parole|commutation|detraction|hc|excess_execution|prescription|pad_challenge|rights_violation|recalculation", "titulo": string, "fundamentacao": string, "prazo": string, "confianca": "high|medium|low" } ] }
Liste APENAS o que pode ser feito AGORA (dentro do prazo) ou no FUTURO — nunca atos já passados. Em "prazo", diga sempre quando cabe (imediato, ou data/previsão aproximada).
Se NÃO houver nada acionável, retorne { "oportunidades": [] }. Não invente fatos ausentes.`

  let parsed: any
  try {
    const resp = await client.messages.create({
      // @ts-ignore — id de modelo validado no servidor
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system,
      messages: [
        {
          role: 'user',
          content: `Processo ${row.case.executionProcessNumber ?? 'sem número'} de ${row.client.fullName}.
Novas movimentações:
${params.movements.map((m, i) => `${i + 1}. ${m}`).join('\n')}

Retorne somente o JSON.`,
        },
      ],
    })
    const text = resp.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
    parsed = parseJsonLoose(text)
  } catch (e) {
    console.warn('[astrea-opportunity-detector] IA indisponível ou JSON inválido:', e)
    return empty
  }

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

  return { oportunidadesCriadas, titulos }
}
