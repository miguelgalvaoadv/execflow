/**
 * CalculationSchema — structured extraction for cálculo de pena.
 *
 * A "cálculo de pena" is a formal calculation document produced by either:
 * - The execution court (cálculo oficial).
 * - The prison administration.
 * - The attorney (cálculo defensivo).
 *
 * It presents the arithmetic of sentence execution at a specific date,
 * summarizing totals and the resulting balance.
 */

import { z } from 'zod'
import { extractedFieldSchema } from './field.ts'

export const CalculationSchema = z.object({
  // ── Identification ────────────────────────────────────────────────────────

  /** Who produced this calculation. */
  autor_calculo: extractedFieldSchema(
    z.enum(['vara_execucao', 'estabelecimento_penal', 'defesa', 'ministerio_publico', 'desconhecido']).nullable()
  ),

  /** Reference date of the calculation (as-of date). ISO date string. */
  data_referencia: extractedFieldSchema(z.string().nullable()),

  /** Process number this calculation refers to. */
  numero_processo: extractedFieldSchema(z.string().nullable()),

  // ── Arithmetic ────────────────────────────────────────────────────────────

  /** Total sentence in days. */
  total_dias: extractedFieldSchema(z.number().int().min(0)),

  /** Days served as of the reference date. */
  dias_cumpridos: extractedFieldSchema(z.number().int().min(0)),

  /** Remição days earned and recognized. */
  remicao_dias: extractedFieldSchema(z.number().int().min(0)),

  /** Detração days credited. */
  detracao_dias: extractedFieldSchema(z.number().int().min(0)),

  /** Remaining days (saldo de pena). May be derived but stated explicitly in the doc. */
  saldo_dias: extractedFieldSchema(z.number().int().min(0).nullable()),

  /**
   * Percentage of sentence served (0.0 to 100.0).
   * As stated in the document (not derived by EXECFLOW).
   */
  percentual_cumprido: extractedFieldSchema(z.number().min(0).max(100).nullable()),

  // ── Dates ────────────────────────────────────────────────────────────────

  /** Data-base used in this calculation. ISO date string. */
  data_base: extractedFieldSchema(z.string().nullable()),

  /**
   * Projected benefit dates stated in the calculation (if any).
   * ex: { tipo: "progressao_1_6", data: "2025-03-15" }
   */
  datas_beneficio: z.array(
    z.object({
      tipo: extractedFieldSchema(z.string()),
      data: extractedFieldSchema(z.string().nullable()),
    })
  ),

  // ── Notes ────────────────────────────────────────────────────────────────

  /** Relevant observations. Max 300 chars. */
  observacoes: extractedFieldSchema(z.string().max(300).nullable()),
})

export type CalculationExtraction = z.infer<typeof CalculationSchema>

export const CALCULATION_EXTRACTION_TOOL_NAME = 'extract_calculation_data' as const
