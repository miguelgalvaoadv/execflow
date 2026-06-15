/**
 * CourtDecisionSchema — structured extraction for decisão judicial.
 *
 * Court decisions (despachos, decisões interlocutórias, decisões monocráticas)
 * in the execution proceeding may:
 * - Grant or deny progression.
 * - Grant or deny remição.
 * - Grant or deny benefits (livramento condicional, indulto, comutação).
 * - Modify the regime.
 * - Order recalculation.
 * - Dismiss the PAD.
 *
 * Capturing the impact of each decision is critical for maintaining
 * an accurate sentence arithmetic over time.
 */

import { z } from 'zod'
import { extractedFieldSchema } from './field.ts'

export const CourtDecisionSchema = z.object({
  // ── Identification ────────────────────────────────────────────────────────

  /** Process number this decision relates to. */
  numero_processo: extractedFieldSchema(z.string().nullable()),

  /** Court / judicial authority issuing the decision. */
  orgao_julgador: extractedFieldSchema(z.string().nullable()),

  /**
   * Type of decision.
   * despacho               → Simple routing order (not a merit decision).
   * decisao_interlocutoria → Procedural/substantive order.
   * decisao_monocratica    → Single-judge decision (common in execution courts).
   * sentenca_execucao      → Execution-phase judgment (e.g., granting progression).
   */
  tipo_decisao: extractedFieldSchema(
    z.enum([
      'despacho',
      'decisao_interlocutoria',
      'decisao_monocratica',
      'sentenca_execucao',
      'desconhecido',
    ]).nullable()
  ),

  /** Date the decision was issued. ISO date string. */
  data_decisao: extractedFieldSchema(z.string().nullable()),

  // ── Outcome / dispositivo ─────────────────────────────────────────────────

  /**
   * Whether the decision GRANTED (deferido) or DENIED (indeferido) what was requested.
   * 'parcial' for partial grants.
   */
  resultado: extractedFieldSchema(
    z.enum(['deferido', 'indeferido', 'parcial', 'desconhecido']).nullable()
  ),

  /**
   * Subject matter of the decision.
   * What was being decided. ex: "progressao_regime", "remicao", "livramento_condicional"
   */
  materia: extractedFieldSchema(z.string().nullable()),

  /** Short verbatim dispositivo from the decision. Max 500 chars. */
  dispositivo: extractedFieldSchema(z.string().max(500).nullable()),

  // ── Sentence impact ───────────────────────────────────────────────────────

  /**
   * Whether this decision modifies the sentence arithmetic.
   * If true, a new snapshot must be proposed after human review.
   */
  impacta_calculo: extractedFieldSchema(z.boolean()),

  /**
   * New regime ordered by this decision (if regime changed).
   * Null if no regime change.
   */
  novo_regime: extractedFieldSchema(
    z.enum(['fechado', 'semiaberto', 'aberto', 'albergue', 'domiciliar', 'unknown']).nullable()
  ),

  /**
   * Remição days granted by this decision (if any).
   * 0 if no remição was granted.
   */
  remicao_concedida_dias: extractedFieldSchema(z.number().int().min(0).nullable()),

  // ── Dates ────────────────────────────────────────────────────────────────

  /** Date the decision takes legal effect. May differ from data_decisao. ISO date string. */
  data_eficacia: extractedFieldSchema(z.string().nullable()),

  // ── Notes ────────────────────────────────────────────────────────────────

  /** Relevant observations. Max 300 chars. */
  observacoes: extractedFieldSchema(z.string().max(300).nullable()),
})

export type CourtDecisionExtraction = z.infer<typeof CourtDecisionSchema>

export const COURT_DECISION_EXTRACTION_TOOL_NAME = 'extract_court_decision_data' as const
