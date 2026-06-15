import type { EvaluationBatch } from '../types/evaluators.js'

/**
 * Interface purista do Registry.
 * Ignorante sobre persistência física, oportunidades e interface de usuário.
 * Destinado unicamente a registrar e recuperar saídas imutáveis (append-only) dos Evaluators.
 */
export interface EvaluationRegistry {
  /**
   * Salva um novo Batch de forma imutável.
   * Não pode haver sobrescrita.
   */
  saveBatch(batch: EvaluationBatch): Promise<void>

  /**
   * Recupera um Batch específico pela sua chave primária.
   */
  getBatch(batchId: string): Promise<EvaluationBatch | null>

  /**
   * Retorna todo o histórico de Batches para um caso específico, ordenado do mais recente para o mais antigo.
   * Ideal para auditorias, comparações ("o que existia antes da falta grave?") e replays.
   */
  getHistoryByCase(executionCaseId: string): Promise<EvaluationBatch[]>
}

export class InMemoryEvaluationRegistry implements EvaluationRegistry {
  private batches: Map<string, EvaluationBatch> = new Map()

  async saveBatch(batch: EvaluationBatch): Promise<void> {
    if (this.batches.has(batch.batchId)) {
      throw new Error(`[Append-Only Violation] Batch ${batch.batchId} já existe e não pode ser sobrescrito.`)
    }
    
    // Armazena uma cópia profunda (deep clone) estrutural para garantir imutabilidade em memória
    const clone = structuredClone(batch)
    this.batches.set(batch.batchId, clone)
  }

  async getBatch(batchId: string): Promise<EvaluationBatch | null> {
    const batch = this.batches.get(batchId)
    if (!batch) return null
    return structuredClone(batch)
  }

  async getHistoryByCase(executionCaseId: string): Promise<EvaluationBatch[]> {
    const caseBatches = Array.from(this.batches.values()).filter(b => b.executionCaseId === executionCaseId)
    
    // Ordena do mais recente (maior evaluatedAt) para o mais antigo
    return caseBatches
      .sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime())
      .map(b => structuredClone(b))
  }
}
