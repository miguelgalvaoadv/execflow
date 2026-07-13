/**
 * Classificador de CRITICIDADE de movimentações por IA (a partir do texto).
 *
 * Diferente de `case-analysis.ts` (que lê os autos em PDF), este serviço é leve:
 * recebe o texto das movimentações novas (InfoSimples/DJEN/webhook) e classifica
 * a CRITICIDADE delas para os autos já existentes. É o que dispara o "autos
 * desatualizados" (freshness gate): movimentação crítica → o caso precisa de
 * autos novos antes de gerar peça.
 *
 * MUDANÇA 12/07/2026 (feedback do Miguel via análise do ChatGPT): este serviço
 * NÃO cria mais "oportunidades". Ler só o TEXTO de uma movimentação e chutar
 * oportunidades jurídicas gerava exatamente o lixo que o Miguel reclamou —
 * pra "Unificação e Soma de Penas" ele despejava progressão/recálculo/excesso/
 * livramento/remição genéricos e duplicados, sem base concreta, porque não
 * abriu o PDF. Oportunidade REAL só nasce da análise dos autos
 * (`case-analysis.ts`), que lê o processo inteiro e aplica a regra de ouro
 * (gatilho + evidência + consequência). Aqui a IA só responde UMA pergunta
 * barata: quão crítica é esta movimentação? (tier 1/2/3). Nada é escrito em
 * `opportunities` — o retorno mantém a forma antiga (oportunidadesCriadas: 0)
 * só pra não quebrar os chamadores.
 */
import Anthropic from '@anthropic-ai/sdk'
import { logAiInteraction } from './ai-log.ts'
import { eq, and } from 'drizzle-orm'
import { db } from '../lib/db.ts'
import { executionCases, clients } from '@execflow/db/schema'

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
  /** Mantido por compatibilidade — este serviço NÃO cria mais oportunidades (sempre 0). */
  oportunidadesCriadas: number
  /** Mantido por compatibilidade — sempre vazio. */
  titulos: string[]
  /** Maior criticidade entre as movimentações do lote, ou null se nenhuma classificada. */
  criticalityTier: '1' | '2' | '3' | null
}

/**
 * Classifica a criticidade das movimentações novas de um caso (não cria
 * oportunidades — ver docstring do módulo). Best-effort: se a chave não estiver
 * configurada ou a IA não retornar JSON, retorna criticidade null sem lançar.
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
Recebe NOVAS MOVIMENTAÇÕES de um processo de execução penal e deve APENAS classificar a CRITICIDADE delas para os autos já existentes do processo. NÃO liste oportunidades, teses, prazos ou pedidos — isso é feito por outra etapa que lê o PDF completo dos autos. Sua única tarefa aqui é dizer o quão crítica a movimentação é.

RESPONDA APENAS COM JSON VÁLIDO, sem texto fora do JSON, no formato EXATO:
{
  "criticalidadeTier": "1"|"2"|"3"|null,
  "motivo": string
}

Regras para criticalidadeTier (escolha o PIOR tier entre todas as movimentações):
- "1" (INVALIDA OS AUTOS): regressão de regime, extinção da pena, cálculo novo de pena, unificação/soma de penas, revogação de benefício, falta grave homologada, nova condenação — qualquer movimentação que torna os autos anteriores desatualizados para fins de petição (a base de cálculo mudou).
- "2" (RELEVANTE MAS NÃO INVALIDA): progressão aguardando guia de recolhimento, audiência marcada, remição parcial concedida, decisão que defere benefício — impacto real mas os autos ainda são válidos.
- "3" (PROCEDIMENTAL/INFORMATIVO): vistas, cargas, certidões expedidas, conclusos ao juiz, expedição de mandado — sem impacto no mérito dos autos.
- null: nenhuma movimentação de mérito identificada.
Em "motivo", explique em uma frase curta por que escolheu esse tier (ex.: "Unificação de penas altera a base de cálculo — exige autos atualizados"). Não invente fatos.`

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
      max_tokens: 300,
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
    console.warn('[movement-classifier] IA indisponível ou JSON inválido:', e)
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

  return { oportunidadesCriadas: 0, titulos: [], criticalityTier }
}
