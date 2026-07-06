/**
 * Trilha de auditoria da IA — grava toda interação com o Claude em
 * ai_interaction_logs (spec §14 "Histórico da IA" + §21 LGPD).
 *
 * FIRE-AND-FORGET: logAiInteraction nunca lança — uma falha de log jamais
 * pode derrubar a operação principal (detector, drafter, análise).
 *
 * A API key NUNCA aparece aqui. Prompt/resposta são truncados para evitar
 * inchaço de banco; o conteúdo integral dos autos continua nos documents.
 */

import { db } from '../lib/db.ts'
import { aiInteractionLogs } from '@execflow/db/schema'

const MAX_TEXT_LENGTH = 30_000

/** Preço por MTok em USD (input/output) — estimativa para relatório de custo. */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-8': { input: 15, output: 75 },
  'claude-haiku-4-5': { input: 1, output: 5 },
}

export type AiLogInput = {
  organizationId: string
  agent:
    | 'extractor'
    | 'phase_classifier'
    | 'strategic_reader'
    | 'deadline_spotter'
    | 'updater'
    | 'draft_generator'
    | 'movement_classifier'
    | 'email_parser'
    | 'sentence_calculator'
  model: string
  promptText?: string | null
  responseText?: string | null
  executionCaseId?: string | null
  clientId?: string | null
  documentId?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  status: 'success' | 'error'
  errorMessage?: string | null
  durationMs?: number | null
}

function estimateCostUsd(model: string, inputTokens: number | null | undefined, outputTokens: number | null | undefined): string | null {
  const pricing = MODEL_PRICING[model]
  if (!pricing || (inputTokens == null && outputTokens == null)) return null
  const cost =
    ((inputTokens ?? 0) / 1_000_000) * pricing.input +
    ((outputTokens ?? 0) / 1_000_000) * pricing.output
  return cost.toFixed(6)
}

export async function logAiInteraction(input: AiLogInput): Promise<void> {
  try {
    await db.insert(aiInteractionLogs).values({
      organizationId: input.organizationId,
      agent: input.agent,
      model: input.model,
      promptText: input.promptText?.substring(0, MAX_TEXT_LENGTH) ?? null,
      responseText: input.responseText?.substring(0, MAX_TEXT_LENGTH) ?? null,
      executionCaseId: input.executionCaseId ?? null,
      clientId: input.clientId ?? null,
      documentId: input.documentId ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      estimatedCostUsd: estimateCostUsd(input.model, input.inputTokens, input.outputTokens),
      status: input.status,
      errorMessage: input.errorMessage ?? null,
      durationMs: input.durationMs ?? null,
    })
  } catch (e) {
    console.warn('[ai-log] Falha ao gravar histórico da IA (operação principal não afetada):', e)
  }
}
