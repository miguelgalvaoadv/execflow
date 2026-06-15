/**
 * Document Classification Schema.
 *
 * Step 1 of the extraction pipeline: identify the document type BEFORE
 * attempting structured extraction. This routes the document to the correct
 * domain-specific schema.
 *
 * Supported document classes in Phase 5A.1:
 *   guia_execucao        → Guia de Execução Penal (primary source for sentence arithmetic)
 *   sentenca             → Sentença condenatória
 *   acordao              → Acórdão de tribunal
 *   calculo              → Cálculo de pena (court or attorney calculation)
 *   boletim_informativo  → Boletim informativo do estabelecimento
 *   atestado_conduta     → Atestado de comportamento carcerário
 *   pad                  → Processo Administrativo Disciplinar
 *   decisao_judicial     → Decisão judicial (despacho, interlocutória, etc.)
 *   desconhecido         → Could not classify; requires manual review
 */

import { z } from 'zod'

export const DocumentClassSchema = z.enum([
  'guia_execucao',
  'sentenca',
  'acordao',
  'calculo',
  'boletim_informativo',
  'atestado_conduta',
  'pad',
  'decisao_judicial',
  'desconhecido',
])

export type DocumentClass = z.infer<typeof DocumentClassSchema>

/**
 * Result of the classification step.
 * The LLM must always produce this before structured extraction.
 */
export const ClassificationResultSchema = z.object({
  /** Detected document type. */
  documentType: DocumentClassSchema,

  /**
   * Classification confidence (0.0 to 1.0).
   * < 0.70 → 'desconhecido' should be used instead.
   */
  confidence: z.number().min(0).max(1),

  /**
   * Short reasoning for the classification decision.
   * Used for human review and debugging prompt issues.
   * Max 300 chars to keep it concise.
   */
  reasoning: z.string().max(300),

  /**
   * Suggested alternative class if confidence is borderline (0.50–0.70).
   * Null if classification is confident.
   */
  alternativeClass: DocumentClassSchema.nullable(),
})

export type ClassificationResult = z.infer<typeof ClassificationResultSchema>

/**
 * Prompt tool name used for tool_use (function calling) with Claude.
 */
export const CLASSIFICATION_TOOL_NAME = 'classify_legal_document' as const
