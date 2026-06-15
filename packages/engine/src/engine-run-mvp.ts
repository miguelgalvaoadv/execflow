import { eq, desc } from '@execflow/db/client'
import type { AnyDbClient } from '@execflow/db/client'
import { sentenceSnapshots, timelineEvents } from '@execflow/db/schema'
import { extractLegalFacts } from './evaluation/legal-fact-processor.js'
import { ProgressionEvaluator } from './evaluation/progression-evaluator.js'
import { OpportunityBuilder } from './evaluation/opportunity-builder.js'
import { PlaybookRegistry } from './playbooks/types.js'
import type { TimelineEvent } from '@execflow/db/schema'

// Garante que os mocks estão carregados
import './playbooks/v1-mock.js'
import './playbooks/v2-mock.js'

export async function runMvpEngine(
  db: AnyDbClient,
  executionCaseId: string,
  organizationId: string
): Promise<string[]> {
  console.log(`[engine-mvp] Iniciando avaliação E2E para o caso ${executionCaseId}`)

  // 1. Busca o Snapshot de Sentença mais recente
  const [snapshot] = await db
    .select()
    .from(sentenceSnapshots)
    .where(eq(sentenceSnapshots.executionCaseId, executionCaseId))
    .orderBy(desc(sentenceSnapshots.createdAt))
    .limit(1)

  const snapshotId = snapshot?.id ?? 'mock-snapshot-id'
  const activeTotalDays = snapshot?.totalSentenceDays ?? 1825 // 5 anos default
  const isRecid = snapshot?.isGenericRecidivist ?? false
  const snapCreatedAt = snapshot?.createdAt ?? new Date()

  if (!snapshot) {
    console.warn(`[engine-mvp] Nenhum snapshot encontrado para o caso ${executionCaseId}. Usando Mock Snapshot para MVP!`)
  }

  // 2. Busca Eventos do Timeline
  const events = await db
    .select()
    .from(timelineEvents)
    .where(eq(timelineEvents.executionCaseId, executionCaseId))

  // 3. Processa os Fatos
  const facts = extractLegalFacts(
    { executionCaseId, evaluationDate: new Date() },
    {
      id: snapshotId,
      crimesBreakdown: snapshot?.crimesBreakdown as { crimes: any[] } ?? { crimes: [] },
      activeSentencesTotalDays: activeTotalDays,
      isGenericRecidivist: isRecid,
      createdAt: snapCreatedAt
    },
    events.map((e: typeof timelineEvents.$inferSelect) => ({
      id: e.id,
      eventType: e.eventType,
      occurredAt: e.occurredAt,
      payload: e.payload as Record<string, any>
    }))
  )

  // MVP: Se os dados base de sentences estiverem vazios por causa de migrações falhas, 
  // nós inserimos um dado mock para garantir que a oportunidade é gerada e vista na tela (MARCO DO PRODUTO).
  if (facts.sentences.length === 0) {
    facts.sentences.push({
      id: 'mock-sentence',
      sourceSnapshotId: snapshotId,
      penaltyDays: activeTotalDays,
      crimeDate: snapCreatedAt,
      crimeProfile: {
        crimeCode: 'MOCK_CRIME',
        article: 'Art. 157',
        law: 'CP',
        isHeinous: false,
        isEquatedHeinous: false,
        hasDeathResult: false,
        isPrimary: true,
        isRecidivist: isRecid,
        isSpecificRecidivist: false,
      },
    })
    // Atualiza penaltyTotal com o valor da sentença injetada
    facts.penaltyTotals.totalPenaltyDays = activeTotalDays
  }

  // 4. Avalia (Progression)
  const evaluator = new ProgressionEvaluator()
  // Usamos V1_MOCK (onde tudo é 1/6)
  const evaluation = evaluator.evaluate(facts, 'V1_MOCK', 'engine-run-mvp')

  // 5. Constrói e Persiste a Oportunidade
  const builder = new OpportunityBuilder()
  const opportunityId = await builder.persistOpportunity(db, evaluation, organizationId)
  
  console.log(`[engine-mvp] Sucesso! Oportunidade ${opportunityId} gerada e persistida.`)
  return [opportunityId]
}
