/**
 * SentenceSchema — structured extraction for sentença condenatória.
 *
 * Primary source: sentença transitada em julgado.
 * This is the original conviction document that establishes the sentence
 * that all subsequent execution calculations derive from.
 *
 * All fields use ExtractedField<T> to carry confidence + evidence.
 * The LLM must populate evidence.pageNumber and evidence.textSnippet
 * for each field it extracts.
 */

import { z } from 'zod'
import { extractedFieldSchema } from './field.ts'

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

/** Individual sentence for a single crime (when multiple crimes convicted). */
export const IndividualSentenceSchema = z.object({
  /** Crime description as stated in the sentence. */
  crime: extractedFieldSchema(z.string()),

  /** Criminal code article(s). ex: "Art. 33, §4º, Lei 11.343/2006" */
  artigo: extractedFieldSchema(z.string()),

  /** Sentence length in years, months, and days (all required fields). */
  pena_anos: extractedFieldSchema(z.number().int().min(0)),
  pena_meses: extractedFieldSchema(z.number().int().min(0).max(11)),
  pena_dias: extractedFieldSchema(z.number().int().min(0).max(30)),

  /**
   * Whether this crime is classified as hediondo (heinous crime).
   * Affects progression fractions (3/5 vs 1/6 per LEP Art. 112).
   */
  hediondo: extractedFieldSchema(z.boolean()),

  /**
   * Fine amount in minimum wages (salários mínimos), if any.
   * Null if no fine was imposed.
   */
  multa_salarios_minimos: extractedFieldSchema(z.number().min(0).nullable()),
})

// ---------------------------------------------------------------------------
// SentenceSchema
// ---------------------------------------------------------------------------

export const SentenceSchema = z.object({
  // ── Case identification ──────────────────────────────────────────────────

  /** Criminal court process number. ex: "0001234-56.2018.8.26.0050" */
  numero_processo: extractedFieldSchema(z.string().nullable()),

  /** Sentencing court. ex: "3ª Vara Criminal da Comarca de São Paulo" */
  vara_sentenciante: extractedFieldSchema(z.string().nullable()),

  /** Date the sentence was issued. ISO date string. */
  data_sentenca: extractedFieldSchema(z.string().nullable()),

  /** Date the sentence became final (trânsito em julgado). ISO date string. */
  data_transito_julgado: extractedFieldSchema(z.string().nullable()),

  // ── Unified sentence (cúmulo material / concurso) ────────────────────────

  /** Total unified sentence in years. */
  pena_total_anos: extractedFieldSchema(z.number().int().min(0)),

  /** Total unified sentence remaining months (0–11). */
  pena_total_meses: extractedFieldSchema(z.number().int().min(0).max(11)),

  /** Total unified sentence remaining days (0–30). */
  pena_total_dias: extractedFieldSchema(z.number().int().min(0).max(30)),

  // ── Individual crimes ────────────────────────────────────────────────────

  /**
   * Per-crime sentences when there are multiple crimes.
   * Allows reconstruction of how the unified sentence was computed.
   * Empty array if the sentence only covers a single crime.
   */
  penas_individuais: z.array(IndividualSentenceSchema),

  // ── Regime ──────────────────────────────────────────────────────────────

  /** Initial regime ordered by the judge. */
  regime_inicial: extractedFieldSchema(
    z.enum(['fechado', 'semiaberto', 'aberto', 'unknown']).nullable()
  ),

  // ── Sentence start / data-base ──────────────────────────────────────────

  /**
   * Detração penal: days of preventive detention to be credited.
   * 0 if none. Per CPP Art. 387 §2.
   */
  detracao_dias: extractedFieldSchema(z.number().int().min(0)),

  /**
   * Whether any heinous crime (Lei 8.072/90) appears in this sentence.
   * Affects global progression fraction rules.
   */
  algum_crime_hediondo: extractedFieldSchema(z.boolean()),

  // ── Notes ────────────────────────────────────────────────────────────────

  /**
   * Any relevant observation from the sentence that doesn't fit a structured field.
   * Max 500 chars.
   */
  observacoes: extractedFieldSchema(z.string().max(500).nullable()),
})

export type SentenceExtraction = z.infer<typeof SentenceSchema>

export const SENTENCE_EXTRACTION_TOOL_NAME = 'extract_sentence_data' as const
