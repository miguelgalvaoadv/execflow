/**
 * DisciplinaryIncidentSchema — structured extraction for PAD documents.
 *
 * A PAD (Processo Administrativo Disciplinar) is the formal disciplinary
 * proceeding initiated when an inmate commits an infraction.
 * It is legally significant because:
 * - Falta grave resets the data-base for progression (LEP Art. 112 §6).
 * - Falta grave causes loss of up to 1/3 of remição days (LEP Art. 127).
 * - PAD defense windows create urgent deadlines for the attorney.
 */

import { z } from 'zod'
import { extractedFieldSchema } from './field.ts'

export const DisciplinaryIncidentSchema = z.object({
  // ── Identification ────────────────────────────────────────────────────────

  /** PAD process number (if available). */
  numero_pad: extractedFieldSchema(z.string().nullable()),

  /** Prison unit where the incident occurred. */
  estabelecimento: extractedFieldSchema(z.string().nullable()),

  // ── Incident facts ────────────────────────────────────────────────────────

  /** Date the infraction occurred. ISO date string. */
  data_fato: extractedFieldSchema(z.string().nullable()),

  /** Date the PAD was initiated. ISO date string. */
  data_abertura_pad: extractedFieldSchema(z.string().nullable()),

  /**
   * Severity of the infraction per LEP Art. 49/50/51.
   */
  gravidade: extractedFieldSchema(
    z.enum(['falta_leve', 'falta_media', 'falta_grave', 'desconhecida'])
  ),

  /**
   * LEP article that classifies this infraction.
   * ex: "Art. 50, VI" (posse de aparelho celular).
   */
  artigo_lep: extractedFieldSchema(z.string().nullable()),

  /** Description of the infraction. Max 300 chars. */
  descricao_fato: extractedFieldSchema(z.string().max(300).nullable()),

  // ── PAD status ────────────────────────────────────────────────────────────

  /**
   * Current PAD status.
   * em_andamento → PAD still open; defense window may be active.
   * homologado   → Penalty homologated; legally effective.
   * arquivado    → PAD archived without penalty.
   * anulado      → PAD annulled (procedural defect).
   */
  status_pad: extractedFieldSchema(
    z.enum(['em_andamento', 'homologado', 'arquivado', 'anulado', 'desconhecido']).nullable()
  ),

  /** Penalty applied (if homologated). ex: "Isolamento por 30 dias" */
  penalidade_aplicada: extractedFieldSchema(z.string().max(200).nullable()),

  /** Date the penalty was homologated. ISO date string. */
  data_homologacao: extractedFieldSchema(z.string().nullable()),

  // ── Defense ──────────────────────────────────────────────────────────────

  /**
   * Defense deadline (prazo para apresentar defesa).
   * Critical: if this date is in the future, creates an urgent deadline.
   * ISO date string.
   */
  prazo_defesa: extractedFieldSchema(z.string().nullable()),

  /** Whether the inmate was formally notified of the PAD opening. */
  notificado: extractedFieldSchema(z.boolean().nullable()),

  // ── Notes ────────────────────────────────────────────────────────────────

  /** Relevant observations. Max 300 chars. */
  observacoes: extractedFieldSchema(z.string().max(300).nullable()),
})

export type DisciplinaryIncidentExtraction = z.infer<typeof DisciplinaryIncidentSchema>

export const DISCIPLINARY_EXTRACTION_TOOL_NAME = 'extract_disciplinary_incident_data' as const
