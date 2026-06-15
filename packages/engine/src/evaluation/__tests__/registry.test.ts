import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { InMemoryEvaluationRegistry } from '../registry.js'
import type { EvaluationBatch } from '../../types/evaluators.js'

describe('EvaluationRegistry (Append-Only)', () => {
  const createMockBatch = (executionCaseId: string, evaluatedAt: Date): EvaluationBatch => ({
    batchId: randomUUID(),
    executionCaseId,
    engineRunId: randomUUID(),
    playbookVersion: 'V1',
    evaluatedAt,
    batchStatus: 'completed',
    evaluations: []
  })

  it('salva e recupera um batch mantendo a imutabilidade estrutural', async () => {
    const registry = new InMemoryEvaluationRegistry()
    const batch = createMockBatch('case-1', new Date())
    
    await registry.saveBatch(batch)
    const retrieved = await registry.getBatch(batch.batchId)
    
    assert.ok(retrieved)
    assert.equal(retrieved.batchId, batch.batchId)
    assert.equal(retrieved.executionCaseId, 'case-1')
    
    // Mutando o original para garantir que a cópia no registry não sofreu side-effect
    batch.batchStatus = 'failed'
    const retrievedAgain = await registry.getBatch(batch.batchId)
    assert.equal(retrievedAgain?.batchStatus, 'completed', 'Registry não deve sofrer mutação externa')
  })

  it('bloqueia tentativa de sobrescrever (append-only enforcement)', async () => {
    const registry = new InMemoryEvaluationRegistry()
    const batch = createMockBatch('case-2', new Date())
    
    await registry.saveBatch(batch)
    
    // Tenta salvar o mesmo batchId novamente
    await assert.rejects(
      async () => await registry.saveBatch(batch),
      { message: `[Append-Only Violation] Batch ${batch.batchId} já existe e não pode ser sobrescrito.` }
    )
  })

  it('recupera o histórico do caso ordenado temporalmente (mais recente primeiro)', async () => {
    const registry = new InMemoryEvaluationRegistry()
    const caseId = 'case-history'
    
    const batchOld = createMockBatch(caseId, new Date('2023-01-01T00:00:00Z'))
    const batchNew = createMockBatch(caseId, new Date('2024-01-01T00:00:00Z'))
    const batchMid = createMockBatch(caseId, new Date('2023-06-01T00:00:00Z'))
    
    // Salvando fora de ordem
    await registry.saveBatch(batchMid)
    await registry.saveBatch(batchNew)
    await registry.saveBatch(batchOld)
    
    // Adicionando um ruído de outro caso
    await registry.saveBatch(createMockBatch('other-case', new Date()))

    const history = await registry.getHistoryByCase(caseId)
    
    assert.equal(history.length, 3, 'Deve retornar apenas os 3 batches do caso específico')
    
    // Ordem esperada: New, Mid, Old
    assert.equal(history[0].batchId, batchNew.batchId)
    assert.equal(history[1].batchId, batchMid.batchId)
    assert.equal(history[2].batchId, batchOld.batchId)
  })
})
