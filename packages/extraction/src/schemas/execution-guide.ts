/**
 * ExecutionGuideSchema — structured extraction for Guia de Execução Penal.
 *
 * The Guia de Execução (also known as Guia de Recolhimento) is issued by the
 * court when the convicted person is remanded to the penal system. It is the
 * primary operational document for the prison unit and the execution court.
 *
 * This document is the MOST IMPORTANT source for sentence arithmetic in
 * EXECFLOW because it consolidates: conviction, regime, data-base, and
 * the trajectory of sentence execution up to the issuance date.
 */

import { z } from 'zod'
import { extractedFieldSchema } from './field.ts'

export const ExecutionGuideSchema = z.object({
  // ── Identification ────────────────────────────────────────────────────────

  /** Execution court process number. ex: "7001234-56.2019.8.26.0050" */
  numero_processo_execucao: extractedFieldSchema(z.string().nullable()),

  /** Originating criminal case process number. */
  numero_processo_origem: extractedFieldSchema(z.string().nullable()),

  /** Execution court (Vara de Execuções Criminais). */
  vara_execucao: extractedFieldSchema(z.string().nullable()),

  /** Name of the convicted person as stated in the guide. */
  nome_reeducando: extractedFieldSchema(z.string().nullable()),

  /** CPF of the convicted person (masked for LGPD compliance in logs). */
  cpf_reeducando: extractedFieldSchema(z.string().nullable()),

  /** Prison unit where the person was remanded. */
  estabelecimento_penal: extractedFieldSchema(z.string().nullable()),

  /** Guide issuance date. ISO date string. */
  data_emissao: extractedFieldSchema(z.string().nullable()),

  // ── Sentence arithmetic (as of guide issuance date) ───────────────────────

  /** Total sentence in years. */
  pena_total_anos: extractedFieldSchema(z.number().int().min(0)),

  /** Total sentence remaining months (0–11). */
  pena_total_meses: extractedFieldSchema(z.number().int().min(0).max(11)),

  /** Total sentence remaining days (0–30). */
  pena_total_dias: extractedFieldSchema(z.number().int().min(0).max(30)),

  /** Current execution regime at guide issuance. */
  regime_atual: extractedFieldSchema(
    z.enum(['fechado', 'semiaberto', 'aberto', 'albergue', 'domiciliar', 'unknown']).nullable()
  ),

  /**
   * Data-base (legal base date for sentence arithmetic).
   * This is the reference point for all progression calculations.
   * ISO date string.
   */
  data_base: extractedFieldSchema(z.string().nullable()),

  /**
   * Time already served as of the guide issuance (cumprido até esta data).
   * Used for: ongoing calculation from a known checkpoint.
   */
  tempo_cumprido_anos: extractedFieldSchema(z.number().int().min(0).nullable()),
  tempo_cumprido_meses: extractedFieldSchema(z.number().int().min(0).max(11).nullable()),
  tempo_cumprido_dias: extractedFieldSchema(z.number().int().min(0).max(30).nullable()),

  /**
   * Detração penal already applied (days credited from preventive detention).
   */
  detracao_aplicada_dias: extractedFieldSchema(z.number().int().min(0)),

  /**
   * Remição already accumulated and recognized by the court as of the guide date.
   * Work/study remission. Per LEP Art. 126.
   */
  remicao_acumulada_dias: extractedFieldSchema(z.number().int().min(0)),

  // ── Progression fractions ────────────────────────────────────────────────

  /**
   * Progression fractions applicable per the guide or relevant legislation.
   * Stored as human-readable strings. ex: ["1/6", "2/5", "3/5"]
   * The engine will resolve the applicable fraction per playbook.
   */
  fracoes_progressao: z.array(extractedFieldSchema(z.string())),

  // ── Crime classification ──────────────────────────────────────────────────

  /** Whether any crime in the guide is classified as hediondo. */
  contem_crime_hediondo: extractedFieldSchema(z.boolean()),

  // ── Notes ────────────────────────────────────────────────────────────────

  /** Relevant observations not captured by structured fields. Max 500 chars. */
  observacoes: extractedFieldSchema(z.string().max(500).nullable()),
})

export type ExecutionGuideExtraction = z.infer<typeof ExecutionGuideSchema>

export const EXECUTION_GUIDE_EXTRACTION_TOOL_NAME = 'extract_execution_guide_data' as const
