/**
 * Modo híbrido ChatGPT (Direção 2, 12/07/2026 — pedido do Miguel).
 *
 * Em vez de gastar a API do Claude lendo os autos, o advogado pode: (1) clicar
 * "Preparar pacote pro ChatGPT", copiar o texto gerado aqui, colar no
 * chatgpt.com JUNTO com o PDF dos autos (usando a assinatura fixa dele, sem
 * custo por token); (2) copiar a resposta e colar de volta no "Importar do
 * ChatGPT". O import reusa a MESMA persistência da análise da IA
 * (`persistAnalysisReport`), então o relatório colado entra igual — vira
 * snapshot de pena, oportunidades (sugeridas), prazos, alertas e fatos, tudo
 * na fila de revisão normal.
 *
 * O pacote carrega o CONTEXTO já conhecido do caso (dossiê da última análise,
 * oportunidades/prazos abertos, movimentações recentes) + a INSTRUÇÃO com o
 * schema JSON EXATO que o importador espera. Assim o ChatGPT devolve algo que
 * cola sem retrabalho.
 */
import { eq, and, desc, inArray } from 'drizzle-orm'
import { db } from '../lib/db.ts'
import {
  executionCases,
  clients,
  sentenceSnapshots,
  opportunities,
  deadlines,
  timelineEvents,
} from '@execflow/db/schema'

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  return isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR')
}

/** Instrução + schema que o ChatGPT deve seguir pra que a resposta importe direto. */
const INSTRUCTION = `Você é advogado criminalista brasileiro especialista em Execução Penal (LEP). Vou anexar o PDF dos autos deste processo. Leia os autos com profundidade de sócio de banca e devolva um relatório ESTRUTURADO seguindo EXATAMENTE o schema JSON abaixo — nada de texto fora do JSON no bloco final (pode explicar antes em prosa se quiser, mas termine com um único bloco \`\`\`json ... \`\`\` no formato exato).

TAXONOMIA (regra mais importante — NÃO jogue tudo em "oportunidades"):
- "fatos": algo JÁ consumado/confirmado nos autos que o advogado precisa saber (ex.: "42 dias de remição já deferidos"). Não é ação.
- "alertas": possibilidade a CONFERIR, ainda não madura pra virar peça (ex.: "possível excesso após o novo cálculo — conferir").
- "prazos" com classe "benefit" = MARCO FUTURO (data estimada de progressão/livramento/término). Use "dataLimite".
- "prazos" com classe "legal"/"disciplinary"/"calculation" = prazo processual real (agravo, embargos, manifestação). Use "dias".
- "oportunidades": SÓ o que tiver as 3 pernas juntas — GATILHO (fato concreto), EVIDÊNCIA (documento+data/página), CONSEQUÊNCIA (efeito jurídico + peça). Sem as três, é alerta ou fato, não oportunidade. Deduplique (um recálculo, não três). Remição já deferida = fato, não oportunidade. Livramento/progressão com data distante = marco futuro, não oportunidade (só vira oportunidade se ≤180 dias ou já vencido). Se houve movimentação crítica sem cálculo novo homologado, progressão/excesso viram alerta, não oportunidade.

Schema JSON EXATO (todos os campos; use null quando não souber — nunca invente número/data):
{
  "pena": {
    "penaTotalDias": number|null, "regimeAtual": string|null, "dataBase": "YYYY-MM-DD"|null,
    "diasRemidos": number|null, "diasCumpridosAprox": number|null, "resumo": string,
    "confiancaGeral": "high|medium|low",
    "crimes": [ { "tipificacao": string, "artigo": string, "lei": string, "dataFato": "YYYY-MM-DD"|null, "hediondo": boolean, "diasPena": number|null } ],
    "componentesDoCalculo": [ { "nome": string, "valor": string, "confianca": "high|medium|low", "fonte": string, "comoChegou": string } ],
    "premissasAssumidas": string[],
    "dadosFaltantes": [ { "campo": string, "impacto": "high|medium|low", "descricao": string } ],
    "baseLegal": string[]
  },
  "oportunidades": [ { "tipo": "progression|remission|parole|amnesty|indult|commutation|detraction|hc|excess_execution|prescription|pad_challenge|rights_violation|recalculation", "titulo": string, "fundamentacao": string, "evidencia": string, "consequencia": string, "prazo": string, "confianca": "high|medium|low" } ],
  "alertas": [ { "titulo": string, "descricao": string, "oQueConferir": string, "gatilho": string } ],
  "fatos": [ { "titulo": string, "descricao": string, "impactoNoCalculo": string } ],
  "prazos": [ { "titulo": string, "classe": "legal|benefit|disciplinary|calculation", "dias": number|null, "dataLimite": "YYYY-MM-DD"|null, "descricao": string, "porque": string } ]
}

DISCIPLINA: todo número/data precisa estar literal nos autos ou ser conta aritmética direta sobre dados dos autos (mostre a conta em "comoChegou"/"fundamentacao"). "null" é sempre melhor que um valor chutado. Para progressão, use a fração vigente na DATA DO FATO (irretroatividade da lei penal mais gravosa) — as Leis 15.358/2026 e 15.402/2026 mudaram as frações do art. 112 LEP recentemente.`

export type AnalysisPackage = {
  prompt: string
  clientName: string
  processNumber: string | null
}

export async function buildAnalysisPackage(
  organizationId: string,
  caseId: string
): Promise<AnalysisPackage | null> {
  const [row] = await db
    .select({ case: executionCases, client: clients })
    .from(executionCases)
    .innerJoin(clients, eq(executionCases.clientId, clients.id))
    .where(and(eq(executionCases.id, caseId), eq(executionCases.organizationId, organizationId)))
  if (!row) return null

  const [snap] = await db
    .select()
    .from(sentenceSnapshots)
    .where(and(eq(sentenceSnapshots.executionCaseId, caseId), eq(sentenceSnapshots.organizationId, organizationId)))
    .orderBy(desc(sentenceSnapshots.createdAt))
    .limit(1)

  const openOpps = await db
    .select({ type: opportunities.opportunityType, summary: opportunities.summary, status: opportunities.status })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.executionCaseId, caseId),
        inArray(opportunities.status, ['suggested', 'qualified', 'pursuing'])
      )
    )
    .limit(30)

  const openDeadlines = await db
    .select({ title: deadlines.title, dueAt: deadlines.dueAt, cls: deadlines.deadlineClass, status: deadlines.status })
    .from(deadlines)
    .where(
      and(
        eq(deadlines.executionCaseId, caseId),
        inArray(deadlines.status, ['open', 'acknowledged', 'overdue'])
      )
    )
    .limit(30)

  const recentMovements = await db
    .select({ summary: timelineEvents.summary, occurredAt: timelineEvents.occurredAt })
    .from(timelineEvents)
    .where(and(eq(timelineEvents.executionCaseId, caseId), eq(timelineEvents.eventCategory, 'court')))
    .orderBy(desc(timelineEvents.occurredAt))
    .limit(15)

  const c = row.case
  const cl = row.client

  const dossieLines: string[] = []
  if (snap) {
    const expl = (snap.explanation as { basis?: string } | null) ?? null
    dossieLines.push(`- Última análise (${fmtDate(snap.createdAt)}, status ${snap.status}):`)
    if (snap.totalSentenceDays) dossieLines.push(`  Pena total: ${snap.totalSentenceDays} dias`)
    if (snap.servedDays) dossieLines.push(`  Cumprido (aprox.): ${snap.servedDays} dias`)
    if (snap.remissionDays) dossieLines.push(`  Remição: ${snap.remissionDays} dias`)
    if (snap.percentServed) dossieLines.push(`  % cumprido: ${(Number(snap.percentServed) * 100).toFixed(1)}%`)
    if (expl?.basis) dossieLines.push(`  Resumo: ${expl.basis.slice(0, 1500)}`)
  } else {
    dossieLines.push('- Ainda não há análise de pena registrada para este caso.')
  }

  const oppLines = openOpps.length
    ? openOpps.map((o) => `- [${o.type}] ${o.summary} (${o.status})`).join('\n')
    : '- Nenhuma oportunidade aberta.'
  const dlLines = openDeadlines.length
    ? openDeadlines.map((d) => `- ${d.title} — ${d.cls} — ${fmtDate(d.dueAt)} (${d.status})`).join('\n')
    : '- Nenhum prazo aberto.'
  const movLines = recentMovements.length
    ? recentMovements.map((m) => `- ${fmtDate(m.occurredAt)}: ${m.summary}`).join('\n')
    : '- Sem movimentações registradas.'

  const context = `==== CONTEXTO DO CASO (já conhecido pelo ExecFlow) ====
Cliente: ${cl.fullName}
Processo de execução: ${c.executionProcessNumber ?? 'sem número'}
Vara: ${c.courtName ?? '—'}
Comarca/foro: ${c.courtJurisdiction ?? '—'}
Regime/observações da execução: ${c.sentenceSummary ?? '—'}

-- Dossiê da última análise --
${dossieLines.join('\n')}

-- Oportunidades abertas hoje no painel --
${oppLines}

-- Prazos/marcos abertos hoje no painel --
${dlLines}

-- Movimentações recentes do tribunal --
${movLines}
==== FIM DO CONTEXTO ====`

  const prompt = `${INSTRUCTION}\n\n${context}\n\nAgora analise o PDF dos autos que estou anexando e devolva o relatório no schema JSON acima. Considere o contexto acima como o que já se sabe (atualize/corrija se os autos disserem o contrário).`

  return { prompt, clientName: cl.fullName, processNumber: c.executionProcessNumber ?? null }
}
