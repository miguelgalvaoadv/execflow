/**
 * JudgmentSchema — structured extraction for acórdão (appellate court decision).
 *
 * An acórdão may: confirm, reduce, or increase the original sentence.
 * It is crucial to capture whether the sentence was modified and the new terms.
 */

import { z } from 'zod'
import { extractedFieldSchema } from './field.ts'

export const JudgmentSchema = z.object({
  // ── Identification ────────────────────────────────────────────────────────

  /** Appellate court (tribunal). ex: "Tribunal de Justiça de São Paulo" */
  tribunal: extractedFieldSchema(z.string().nullable()),

  /** Acórdão number. ex: "2018.0000012345-8" */
  numero_acordao: extractedFieldSchema(z.string().nullable()),

  /** Original criminal case process number. */
  numero_processo_origem: extractedFieldSchema(z.string().nullable()),

  /** Date of the appellate judgment. ISO date string. */
  data_julgamento: extractedFieldSchema(z.string().nullable()),

  /** Date the acórdão was published. ISO date string. */
  data_publicacao: extractedFieldSchema(z.string().nullable()),

  // ── Result ────────────────────────────────────────────────────────────────

  /**
   * Outcome of the appeal.
   * 'mantido'      → Original sentence upheld.
   * 'reduzido'     → Sentence reduced.
   * 'aumentado'    → Sentence increased.
   * 'anulado'      → Conviction annulled.
   * 'parcial'      → Partial changes.
   * 'desconhecido' → Could not determine from text.
   */
  resultado: extractedFieldSchema(
    z.enum(['mantido', 'reduzido', 'aumentado', 'anulado', 'parcial', 'desconhecido']).nullable()
  ),

  // ── New sentence (if modified) ────────────────────────────────────────────

  /**
   * New total sentence fixed by the appellate court (if modified).
   * Null if the original sentence was maintained without change.
   */
  nova_pena_anos: extractedFieldSchema(z.number().int().min(0).nullable()),
  nova_pena_meses: extractedFieldSchema(z.number().int().min(0).max(11).nullable()),
  nova_pena_dias: extractedFieldSchema(z.number().int().min(0).max(30).nullable()),

  /** New regime ordered by the appellate court (if changed). */
  novo_regime: extractedFieldSchema(
    z.enum(['fechado', 'semiaberto', 'aberto', 'unknown']).nullable()
  ),

  // ── Criminal classification ───────────────────────────────────────────────

  /** Whether the acórdão reclassified any crime as hediondo. */
  reclassificou_hediondo: extractedFieldSchema(z.boolean().nullable()),

  // ── Notes ────────────────────────────────────────────────────────────────

  /** Key dispositivo text from the acórdão. Max 500 chars. */
  dispositivo: extractedFieldSchema(z.string().max(500).nullable()),

  /** Relevant observations. Max 300 chars. */
  observacoes: extractedFieldSchema(z.string().max(300).nullable()),
})

export type JudgmentExtraction = z.infer<typeof JudgmentSchema>

export const JUDGMENT_EXTRACTION_TOOL_NAME = 'extract_judgment_data' as const
