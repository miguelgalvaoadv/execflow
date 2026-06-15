import { describe, it } from 'node:test'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { eq } from '@execflow/db/client'
import {
  domainEvents,
  recalculationRuns,
  engineRuns,
  opportunities,
  queueProjections,
} from '@execflow/db/schema'
import { scheduleRecalculation } from '@execflow/engine'
import { handleEngineEvaluationRequested } from '../consumers/engine-events.ts'
import { createWorkersDb } from '../lib/db.ts'

const DATABASE_URL = process.env['DATABASE_URL'] || 'postgres://execflow:execflow@localhost:5432/execflow'

describe('Manual E2E Test', () => {
  it('runs full e2e validation on dev database', async () => {
    console.log('[E2E] Iniciando simulação de E2E...')
    const workersDb = createWorkersDb(DATABASE_URL)

    // 1. Pegar o José Antônio (EXE-2022-001)
    const caseId = 'e1f45530-bed7-5e22-9ea1-386729484e44' // CASO_001_ID
    const orgId = 'eeeca998-668f-4988-916c-2fe0de090c04' // Org do seed demo
    const upstreamEventId = randomUUID()
    const correlationId = randomUUID()

    console.log(`[E2E] 1. Agendando recálculo para caso José Antônio (${caseId})...`)
    const recalcRunId = await scheduleRecalculation(workersDb, {
      organizationId: orgId,
      executionCaseId: caseId,
      triggerEntityType: 'manual_validation',
      triggerEntityId: upstreamEventId,
      triggerReason: 'E2E Manual Run via Agent',
      parentRecalculationRunId: null,
      chainDepth: 0,
      correlationId,
      causationId: upstreamEventId,
      jurisdictionScope: 'BR-FED', // Mocked playbook
    })
    console.log(`[E2E] Recalculation Run ID: ${recalcRunId}`)

    // 2. Simular worker recebendo do pg-boss
    console.log(`[E2E] 2. Buscando evento de domínio gerado (outbox)...`)
    const [evalEvent] = await workersDb
      .select()
      .from(domainEvents)
      .where(eq(domainEvents.aggregateId, recalcRunId!))
      .limit(1)

    if (!evalEvent) throw new Error('Evento de domínio não encontrado!')
    
    console.log(`[E2E] Evento de domínio capturado: ${evalEvent.id} (${evalEvent.eventType})`)

    console.log(`[E2E] 3. Acionando worker manualmente (handleEngineEvaluationRequested)...`)
    const job = {
      id: randomUUID(),
      name: 'engine.evaluation.requested',
      data: {
        eventId: evalEvent.id,
        organizationId: orgId,
        correlationId,
        causationId: upstreamEventId,
        payload: evalEvent.payload as any,
      }
    }

    await handleEngineEvaluationRequested(workersDb, job as any)
    console.log(`[E2E] Worker processou com sucesso.`)

    // 4. Confirmar EngineRun persistido
    console.log(`[E2E] 4. Validando EngineRun persistido...`)
    const [recalc] = await workersDb.select().from(recalculationRuns).where(eq(recalculationRuns.id, recalcRunId!)).limit(1)
    const engineRunId = recalc.producedEngineRunId
    console.log(`[E2E] Produced EngineRun ID: ${engineRunId}`)

    const [engineRun] = await workersDb.select().from(engineRuns).where(eq(engineRuns.id, engineRunId!)).limit(1)
    console.log(`[E2E] EngineRun status: ${engineRun.status}, isReplay: ${engineRun.isReplay}`)

    // 5. Confirmar Oportunidades
    console.log(`[E2E] 5. Buscando oportunidades do caso...`)
    const opps = await workersDb.select().from(opportunities).where(eq(opportunities.executionCaseId, caseId))
    console.log(`[E2E] Oportunidades encontradas: ${opps.length}`)

    // 6. Confirmar Filas
    console.log(`[E2E] 6. Buscando queue projections para o caso...`)
    const qps = await workersDb.select().from(queueProjections).where(eq(queueProjections.entityId, caseId))
    console.log(`[E2E] Queue projections ativas: ${qps.length}`)

    console.log('[E2E] Validação E2E concluída.')
  })
})
