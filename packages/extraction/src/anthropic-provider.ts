/**
 * AnthropicExtractionProvider — real LLM extraction using Claude Sonnet.
 *
 * Two-stage pipeline per document:
 *
 * Stage 1: CLASSIFICATION
 *   Tool: classify_legal_document
 *   Input: rawText (full OCR output)
 *   Output: ClassificationResult { documentType, confidence, reasoning }
 *
 * Stage 2: EXTRACTION (if not 'desconhecido')
 *   Tool: extract_<document_type>_data
 *   Input: rawText + documentClass hint from Stage 1
 *   Output: Type-specific structured data with per-field evidence
 *
 * GOVERNANCE CONTRACT:
 * - The provider NEVER creates snapshots, deadlines, or opportunities.
 * - The provider ONLY returns structured data for human review.
 * - The ExtractionEnvelope output is ALWAYS subject to:
 *   1. Validation Layer (validation.ts)
 *   2. Human review in the Review Workspace
 *   3. Explicit human confirmation before snapshot creation
 *
 * TOOL_USE:
 * All LLM outputs go through tool_use (function calling), which enforces
 * JSON structure. Free-text responses are rejected.
 *
 * EVIDENCE MAPPING:
 * The prompt instructs the model to include page_number and text_snippet
 * for every extracted field. This enables click-through evidence in the UI.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { ExtractionInput, ExtractionOutput, ExtractionProvider } from './types.ts'
import { ExtractionProviderError } from './types.ts'
import type { ClassificationResult } from './schemas/classification.ts'
import {
  ClassificationResultSchema,
  CLASSIFICATION_TOOL_NAME,
} from './schemas/classification.ts'
import {
  SentenceSchema,
  SENTENCE_EXTRACTION_TOOL_NAME,
} from './schemas/sentence.ts'
import {
  ExecutionGuideSchema,
  EXECUTION_GUIDE_EXTRACTION_TOOL_NAME,
} from './schemas/execution-guide.ts'
import {
  JudgmentSchema,
  JUDGMENT_EXTRACTION_TOOL_NAME,
} from './schemas/judgment.ts'
import {
  BehaviorReportSchema,
  BEHAVIOR_REPORT_EXTRACTION_TOOL_NAME,
} from './schemas/behavior-report.ts'
import {
  CalculationSchema,
  CALCULATION_EXTRACTION_TOOL_NAME,
} from './schemas/calculation.ts'
import {
  DisciplinaryIncidentSchema,
  DISCIPLINARY_EXTRACTION_TOOL_NAME,
} from './schemas/disciplinary.ts'
import {
  CourtDecisionSchema,
  COURT_DECISION_EXTRACTION_TOOL_NAME,
} from './schemas/court-decision.ts'
import type { ExtractionEnvelope } from './schemas/envelope.ts'
import { confidenceLabel } from './schemas/envelope.ts'
import { validateExtractionResult } from './validation.ts'
import type { z } from 'zod'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const EXTRACTION_VERSION = '1.0.0' as const
export const PROMPT_VERSION = 'penal-extraction-v1' as const
const MODEL_NAME = 'claude-3-5-sonnet-latest' as const
const MODEL_VERSION = '20241022' as const

// Max tokens per request. Claude Sonnet handles large legal documents well.
const MAX_TOKENS = 8192

// ---------------------------------------------------------------------------
// Tool definitions for Claude's tool_use
// ---------------------------------------------------------------------------

/** Shared evidence object structure used in all extraction tool schemas. */
const EVIDENCE_SCHEMA = {
  type: 'object',
  description: 'Origin of this extracted value. Must be populated for all fields.',
  required: ['documentId', 'storageKey', 'pageNumber', 'textSnippet'],
  properties: {
    documentId: { type: 'string', description: 'UUID of the source document.' },
    storageKey: { type: 'string', description: 'Storage key of the source document.' },
    pageNumber: {
      type: ['number', 'null'],
      description: 'Page number (1-indexed) where this information appears. Null if not paginated.',
    },
    textSnippet: {
      type: ['string', 'null'],
      description:
        'Verbatim text snippet (max 200 chars) from the source that supports this extraction.',
    },
  },
} as const

/** Generates a standard extracted field object schema for tool_use. */
function extractedField(
  valueSchema: Record<string, unknown>,
  description: string
): Record<string, unknown> {
  return {
    type: 'object',
    description,
    required: ['value', 'confidence', 'evidence'],
    properties: {
      value: valueSchema,
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'Confidence in this value (0.0 = no confidence, 1.0 = certain).',
      },
      evidence: EVIDENCE_SCHEMA,
    },
  }
}

// ---------------------------------------------------------------------------
// Classification tool
// ---------------------------------------------------------------------------

const CLASSIFICATION_TOOL: Anthropic.Tool = {
  name: CLASSIFICATION_TOOL_NAME,
  description:
    'Classify the type of Brazilian penal execution legal document based on its text content. ' +
    'This MUST be called before any extraction. If uncertain, use "desconhecido".',
  input_schema: {
    type: 'object',
    required: ['documentType', 'confidence', 'reasoning', 'alternativeClass'],
    properties: {
      documentType: {
        type: 'string',
        enum: [
          'guia_execucao',
          'sentenca',
          'acordao',
          'calculo',
          'boletim_informativo',
          'atestado_conduta',
          'pad',
          'decisao_judicial',
          'desconhecido',
        ],
        description: 'The type of legal document detected.',
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description:
          'Classification confidence. Use <0.70 only if genuinely uncertain; in that case use "desconhecido".',
      },
      reasoning: {
        type: 'string',
        maxLength: 300,
        description: 'Short reasoning for the classification. Be specific about what signals you found.',
      },
      alternativeClass: {
        type: ['string', 'null'],
        enum: [
          'guia_execucao',
          'sentenca',
          'acordao',
          'calculo',
          'boletim_informativo',
          'atestado_conduta',
          'pad',
          'decisao_judicial',
          'desconhecido',
          null,
        ],
        description: 'Second-most-likely class if confidence is borderline (0.50–0.70). Null otherwise.',
      },
    },
  },
}

// ---------------------------------------------------------------------------
// Extraction tools per document type
// ---------------------------------------------------------------------------

const SENTENCE_EXTRACTION_TOOL: Anthropic.Tool = {
  name: SENTENCE_EXTRACTION_TOOL_NAME,
  description:
    'Extract structured sentencing data from a Brazilian sentença condenatória (conviction sentence). ' +
    'All fields must include value, confidence (0.0–1.0), and evidence (page + snippet). ' +
    'Do NOT generate free text — only extract what is explicitly stated in the document.',
  input_schema: {
    type: 'object',
    required: ['pena_total_anos', 'pena_total_meses', 'pena_total_dias', 'penas_individuais'],
    properties: {
      numero_processo: extractedField({ type: ['string', 'null'] }, 'Criminal process number.'),
      vara_sentenciante: extractedField({ type: ['string', 'null'] }, 'Sentencing court.'),
      data_sentenca: extractedField({ type: ['string', 'null'] }, 'Sentence date (ISO format).'),
      data_transito_julgado: extractedField({ type: ['string', 'null'] }, 'Date sentence became final (trânsito em julgado). ISO format.'),
      pena_total_anos: extractedField({ type: 'number', minimum: 0 }, 'Total unified sentence in years.'),
      pena_total_meses: extractedField({ type: 'number', minimum: 0, maximum: 11 }, 'Remaining months (0–11).'),
      pena_total_dias: extractedField({ type: 'number', minimum: 0, maximum: 30 }, 'Remaining days (0–30).'),
      penas_individuais: {
        type: 'array',
        description: 'Individual sentences per crime. Empty if single crime.',
        items: {
          type: 'object',
          required: ['crime', 'artigo', 'pena_anos', 'pena_meses', 'pena_dias', 'hediondo', 'multa_salarios_minimos'],
          properties: {
            crime: extractedField({ type: 'string' }, 'Crime description.'),
            artigo: extractedField({ type: 'string' }, 'Legal article violated.'),
            pena_anos: extractedField({ type: 'number', minimum: 0 }, 'Sentence years for this crime.'),
            pena_meses: extractedField({ type: 'number', minimum: 0, maximum: 11 }, 'Sentence months.'),
            pena_dias: extractedField({ type: 'number', minimum: 0, maximum: 30 }, 'Sentence days.'),
            hediondo: extractedField({ type: 'boolean' }, 'Is this crime classified as hediondo?'),
            multa_salarios_minimos: extractedField({ type: ['number', 'null'], minimum: 0 }, 'Fine in minimum wages. Null if no fine.'),
          },
        },
      },
      regime_inicial: extractedField(
        { type: ['string', 'null'], enum: ['fechado', 'semiaberto', 'aberto', 'unknown', null] },
        'Initial regime ordered.'
      ),
      detracao_dias: extractedField({ type: 'number', minimum: 0 }, 'Detração penal days. 0 if none.'),
      algum_crime_hediondo: extractedField({ type: 'boolean' }, 'True if any crime in this sentence is hediondo.'),
      observacoes: extractedField({ type: ['string', 'null'] }, 'Relevant observations. Max 500 chars.'),
    },
  },
}

const EXECUTION_GUIDE_EXTRACTION_TOOL: Anthropic.Tool = {
  name: EXECUTION_GUIDE_EXTRACTION_TOOL_NAME,
  description:
    'Extract structured data from a Brazilian Guia de Execução Penal (execution guide). ' +
    'This is the most important document for sentence arithmetic. ' +
    'All fields must include value, confidence (0.0–1.0), and evidence (page + snippet).',
  input_schema: {
    type: 'object',
    required: ['pena_total_anos', 'pena_total_meses', 'pena_total_dias', 'detracao_aplicada_dias', 'remicao_acumulada_dias', 'contem_crime_hediondo'],
    properties: {
      numero_processo_execucao: extractedField({ type: ['string', 'null'] }, 'Execution process number.'),
      numero_processo_origem: extractedField({ type: ['string', 'null'] }, 'Originating criminal case number.'),
      vara_execucao: extractedField({ type: ['string', 'null'] }, 'Execution court.'),
      nome_reeducando: extractedField({ type: ['string', 'null'] }, 'Name of the convicted person.'),
      cpf_reeducando: extractedField({ type: ['string', 'null'] }, 'CPF (masked if possible).'),
      estabelecimento_penal: extractedField({ type: ['string', 'null'] }, 'Prison unit.'),
      data_emissao: extractedField({ type: ['string', 'null'] }, 'Guide issuance date (ISO format).'),
      pena_total_anos: extractedField({ type: 'number', minimum: 0 }, 'Total sentence years.'),
      pena_total_meses: extractedField({ type: 'number', minimum: 0, maximum: 11 }, 'Total sentence months.'),
      pena_total_dias: extractedField({ type: 'number', minimum: 0, maximum: 30 }, 'Total sentence days.'),
      regime_atual: extractedField(
        { type: ['string', 'null'], enum: ['fechado', 'semiaberto', 'aberto', 'albergue', 'domiciliar', 'unknown', null] },
        'Current execution regime.'
      ),
      data_base: extractedField({ type: ['string', 'null'] }, 'Data-base for sentence arithmetic (ISO format). Critical field.'),
      tempo_cumprido_anos: extractedField({ type: ['number', 'null'], minimum: 0 }, 'Years served as of guide issuance.'),
      tempo_cumprido_meses: extractedField({ type: ['number', 'null'], minimum: 0, maximum: 11 }, 'Months served.'),
      tempo_cumprido_dias: extractedField({ type: ['number', 'null'], minimum: 0, maximum: 30 }, 'Days served.'),
      detracao_aplicada_dias: extractedField({ type: 'number', minimum: 0 }, 'Detração days already applied. 0 if none.'),
      remicao_acumulada_dias: extractedField({ type: 'number', minimum: 0 }, 'Remição days accumulated. 0 if none.'),
      fracoes_progressao: {
        type: 'array',
        description: 'Applicable progression fractions.',
        items: extractedField({ type: 'string' }, 'Fraction string, e.g. "1/6", "2/5".'),
      },
      contem_crime_hediondo: extractedField({ type: 'boolean' }, 'True if any crime in this guide is hediondo.'),
      observacoes: extractedField({ type: ['string', 'null'] }, 'Relevant observations.'),
    },
  },
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(documentId: string, storageKey: string): string {
  return `Você é um especialista em Execução Penal brasileira (LEP — Lei nº 7.210/1984).
Sua única função é extrair dados jurídicos estruturados de documentos do sistema de execução penal.

REGRAS ABSOLUTAS:
1. Use SEMPRE as ferramentas (tool_use) fornecidas. NUNCA responda em texto livre.
2. Para cada campo extraído, inclua: value, confidence (0.0–1.0), e evidence (page_number + text_snippet).
3. Extraia SOMENTE o que está explícito no documento. NÃO infira, NÃO calcule, NÃO invente.
4. Se um campo não está no documento, use null (não omita o campo).
5. Datas devem estar no formato ISO 8601 (YYYY-MM-DD). Se não encontrar, use null.
6. Para evidence.documentId use: "${documentId}"
7. Para evidence.storageKey use: "${storageKey}"
8. Para evidence.pageNumber: identifique a página onde o dado aparece (1-indexed). Null se não paginar.
9. Para evidence.textSnippet: copie o trecho textual exato que sustenta o campo (max 200 chars).

GOVERNANÇA JURÍDICA:
- Sua saída será revisada por um advogado antes de qualquer uso.
- Você NÃO toma decisões jurídicas.
- Você NÃO calcula benefícios.
- Você NÃO determina se o réu deve progredir de regime.
- Você APENAS extrai o que está escrito no documento.`
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export type AnthropicExtractionProviderOptions = {
  apiKey: string
  model?: string
}

export function createAnthropicExtractionProvider(
  options: AnthropicExtractionProviderOptions
): ExtractionProvider {
  if (!options.apiKey || options.apiKey.trim() === '') {
    throw new ExtractionProviderError(
      'Anthropic API Key is missing or empty. Please set ANTHROPIC_API_KEY.',
      { retryable: false }
    )
  }
  const client = new Anthropic({ apiKey: options.apiKey })
  const model = options.model ?? MODEL_NAME

  return {
    id: 'anthropic',

    async extractStructured(input: ExtractionInput): Promise<ExtractionOutput> {
      const extractedAt = new Date().toISOString()

      // ── Stage 1: Classification ────────────────────────────────────────────
      let classification: ClassificationResult
      try {
        const classificationResponse = await client.messages.create({
          model,
          max_tokens: 1024,
          system: buildSystemPrompt(input.documentId, input.ocrRunId),
          tools: [CLASSIFICATION_TOOL],
          tool_choice: { type: 'auto' },
          messages: [
            {
              role: 'user',
              content:
                `Classifique o seguinte documento jurídico usando a ferramenta ${CLASSIFICATION_TOOL_NAME}.\n\n` +
                `TEXTO DO DOCUMENTO:\n\`\`\`\n${input.rawText.slice(0, 6000)}\n\`\`\``,
            },
          ],
        })

        const toolUse = classificationResponse.content.find((c) => c.type === 'tool_use')
        if (!toolUse || toolUse.type !== 'tool_use') {
          throw new ExtractionProviderError(
            'Classification step: model did not call the classification tool.',
            { retryable: true }
          )
        }

        const parsed = ClassificationResultSchema.safeParse(toolUse.input)
        if (!parsed.success) {
          throw new ExtractionProviderError(
            `Classification step: invalid tool output: ${parsed.error.message}`,
            { retryable: true }
          )
        }
        classification = parsed.data
      } catch (err) {
        if (err instanceof ExtractionProviderError) throw err
        throw new ExtractionProviderError(
          `Classification step failed: ${err instanceof Error ? err.message : String(err)}`,
          { retryable: true }
        )
      }

      // ── Stage 2: Extraction ───────────────────────────────────────────────
      let documentData: Record<string, unknown> | null = null

      if (classification.documentType !== 'desconhecido') {
        try {
          const extractionTool = resolveExtractionTool(classification.documentType)
          const extractionSchema = resolveExtractionSchema(classification.documentType)

          if (extractionTool !== null && extractionSchema !== null) {
            const extractionResponse = await client.messages.create({
              model,
              max_tokens: MAX_TOKENS,
              system: buildSystemPrompt(input.documentId, input.ocrRunId),
              tools: [extractionTool],
              tool_choice: { type: 'auto' },
              messages: [
                {
                  role: 'user',
                  content:
                    `O documento foi classificado como: ${classification.documentType}\n\n` +
                    `Extraia os dados usando a ferramenta ${extractionTool.name}.\n\n` +
                    `TEXTO COMPLETO DO DOCUMENTO:\n\`\`\`\n${input.rawText}\n\`\`\``,
                },
              ],
            })

            const toolUse = extractionResponse.content.find((c) => c.type === 'tool_use')
            if (!toolUse || toolUse.type !== 'tool_use') {
              throw new ExtractionProviderError(
                'Extraction step: model did not call the extraction tool.',
                { retryable: true }
              )
            }

            const parsed = extractionSchema.safeParse(toolUse.input)
            if (!parsed.success) {
              throw new ExtractionProviderError(
                `Extraction step: invalid tool output: ${parsed.error.message}`,
                { retryable: true }
              )
            }
            documentData = toolUse.input as Record<string, unknown>
          }
        } catch (err) {
          if (err instanceof ExtractionProviderError) throw err
          throw new ExtractionProviderError(
            `Extraction step failed: ${err instanceof Error ? err.message : String(err)}`,
            { retryable: true }
          )
        }
      }

      // ── Build ExtractionEnvelope ───────────────────────────────────────────
      const documentConfidence = computeDocumentConfidence(documentData, classification.confidence)

      const envelope: ExtractionEnvelope = {
        documentId: input.documentId,
        classification,
        documentConfidence,
        documentConfidenceLabel: confidenceLabel(documentConfidence),
        documentData:
          classification.documentType === 'desconhecido' || documentData === null
            ? null
            : ({ documentType: classification.documentType, data: documentData } as ExtractionEnvelope['documentData']),
        conflicts: [], // Multi-doc conflict detection is a case-level operation, not per-document
        hasBlockingConflicts: false,
        versioning: {
          extractionVersion: EXTRACTION_VERSION,
          modelProvider: 'anthropic',
          modelName: model,
          modelVersion: MODEL_VERSION,
          promptVersion: PROMPT_VERSION,
          extractedAt,
        },
        validationPassed: false, // Will be updated by validation layer below
        validationErrors: [],
      }

      // ── Validation Layer ───────────────────────────────────────────────────
      const validationReport = validateExtractionResult(envelope)
      envelope.validationPassed = validationReport.passed
      envelope.validationErrors = validationReport.issues

      // ── Map to ExtractionOutput ────────────────────────────────────────────
      const confidence = mapToConfidenceLevel(documentConfidence)

      return {
        structuredData: envelope as unknown as Record<string, unknown>,
        confidence,
        providerMetadata: {
          provider: 'anthropic',
          model,
          modelVersion: MODEL_VERSION,
          promptVersion: PROMPT_VERSION,
          extractionVersion: EXTRACTION_VERSION,
          extractedAt,
          classificationDocumentType: classification.documentType,
          classificationConfidence: classification.confidence,
          validationPassed: validationReport.passed,
          validationIssueCount: validationReport.issues.length,
        },
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveExtractionTool(documentType: string): Anthropic.Tool | null {
  switch (documentType) {
    case 'sentenca': return SENTENCE_EXTRACTION_TOOL
    case 'guia_execucao': return EXECUTION_GUIDE_EXTRACTION_TOOL
    // Remaining types: will be added in Phase 5A.2
    // acordao, calculo, atestado_conduta, pad, decisao_judicial
    default: return null
  }
}

function resolveExtractionSchema(
  documentType: string
): z.ZodTypeAny | null {
  switch (documentType) {
    case 'sentenca': return SentenceSchema
    case 'guia_execucao': return ExecutionGuideSchema
    case 'acordao': return JudgmentSchema
    case 'calculo': return CalculationSchema
    case 'atestado_conduta': return BehaviorReportSchema
    case 'pad': return DisciplinaryIncidentSchema
    case 'decisao_judicial': return CourtDecisionSchema
    default: return null
  }
}

/**
 * Computes the document-level confidence as the weighted average of all
 * ExtractedField.confidence values in the extracted data.
 * Falls back to classification.confidence if no field data.
 */
function computeDocumentConfidence(
  data: Record<string, unknown> | null,
  classificationConfidence: number
): number {
  if (data === null) return classificationConfidence

  const confidences: number[] = []

  function collectConfidences(obj: unknown): void {
    if (obj === null || typeof obj !== 'object') return
    if (Array.isArray(obj)) {
      for (const item of obj) collectConfidences(item)
      return
    }
    const rec = obj as Record<string, unknown>
    if (
      typeof rec['confidence'] === 'number' &&
      typeof rec['value'] !== 'undefined' &&
      typeof rec['evidence'] === 'object'
    ) {
      confidences.push(rec['confidence'] as number)
      return
    }
    for (const val of Object.values(rec)) collectConfidences(val)
  }

  collectConfidences(data)

  if (confidences.length === 0) return classificationConfidence

  const avg = confidences.reduce((sum, c) => sum + c, 0) / confidences.length
  // Weight with classification confidence
  return avg * 0.85 + classificationConfidence * 0.15
}

function mapToConfidenceLevel(
  score: number
): 'high' | 'medium' | 'low' | 'unknown' {
  if (score >= 0.85) return 'high'
  if (score >= 0.60) return 'medium'
  if (score > 0) return 'low'
  return 'unknown'
}
