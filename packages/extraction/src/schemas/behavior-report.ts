/**
 * BehaviorReportSchema — structured extraction for atestado de comportamento carcerário.
 *
 * The behavior report (atestado de conduta) is issued by the prison unit and
 * is required for progression hearings, remição requests, and other benefits.
 * It certifies the inmate's behavioral record.
 *
 * Disciplinary incidents (faltas disciplinares) directly affect:
 * - Progression eligibility (LEP Art. 112 §1: bom comportamento carcerário)
 * - Remição (LEP Art. 127: falta grave causes loss of up to 1/3 of earned days)
 * - PAD processes
 */

import { z } from 'zod'
import { extractedFieldSchema } from './field.ts'

// ---------------------------------------------------------------------------
// Disciplinary incident sub-schema
// ---------------------------------------------------------------------------

export const DisciplinaryFaultSchema = z.object({
  /** Date the infraction occurred. ISO date string. */
  data_fato: extractedFieldSchema(z.string().nullable()),

  /** Date the infraction was officially homologated. ISO date string. */
  data_homologacao: extractedFieldSchema(z.string().nullable()),

  /**
   * Severity classification per LEP Art. 49/50/51.
   * falta_leve, falta_media, falta_grave
   */
  gravidade: extractedFieldSchema(
    z.enum(['falta_leve', 'falta_media', 'falta_grave', 'desconhecida']).nullable()
  ),

  /** Brief description of the infraction. Max 200 chars. */
  descricao: extractedFieldSchema(z.string().max(200).nullable()),

  /** Whether the infraction was formally homologated (recognized). */
  homologada: extractedFieldSchema(z.boolean()),

  /** Penalty applied. ex: "Isolamento por 15 dias" */
  penalidade_aplicada: extractedFieldSchema(z.string().max(200).nullable()),
})

// ---------------------------------------------------------------------------
// BehaviorReportSchema
// ---------------------------------------------------------------------------

export const BehaviorReportSchema = z.object({
  // ── Identification ────────────────────────────────────────────────────────

  /** Prison unit issuing this report. */
  estabelecimento: extractedFieldSchema(z.string().nullable()),

  /** Name of the responsible official who signed the report. */
  responsavel: extractedFieldSchema(z.string().nullable()),

  /** Report issuance date. ISO date string. */
  data_emissao: extractedFieldSchema(z.string().nullable()),

  /** Reference period of the report (if stated). ex: "01/01/2024 a 30/06/2024" */
  periodo_referencia: extractedFieldSchema(z.string().nullable()),

  // ── Overall behavior classification ──────────────────────────────────────

  /**
   * Formal behavior classification as stated in the report.
   * BOM        → Good behavior (required for progression).
   * REGULAR    → Regular behavior (may affect some benefits).
   * MAU        → Bad behavior (blocks progression and most benefits).
   * NAO_CONSTA → Not stated or not applicable.
   */
  comportamento: extractedFieldSchema(
    z.enum(['BOM', 'REGULAR', 'MAU', 'NAO_CONSTA']).nullable()
  ),

  // ── Disciplinary incidents ────────────────────────────────────────────────

  /**
   * All disciplinary incidents listed in the report.
   * Empty array if the report certifies no incidents.
   */
  faltas_disciplinares: z.array(DisciplinaryFaultSchema),

  /**
   * Whether the report explicitly states "não há falta grave" (no grave infractions).
   * This is legally significant for progression and remição calculations.
   */
  sem_falta_grave_declarado: extractedFieldSchema(z.boolean().nullable()),

  // ── Notes ────────────────────────────────────────────────────────────────

  /** Relevant observations. Max 300 chars. */
  observacoes: extractedFieldSchema(z.string().max(300).nullable()),
})

export type BehaviorReportExtraction = z.infer<typeof BehaviorReportSchema>

export const BEHAVIOR_REPORT_EXTRACTION_TOOL_NAME = 'extract_behavior_report_data' as const
