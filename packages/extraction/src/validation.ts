/**
 * Validation Layer — intermediate gate between extraction and review queue.
 *
 * PIPELINE:
 *   LLM Extraction Result (ExtractionEnvelope)
 *   ↓
 *   validateExtractionResult()
 *   ↓
 *   ValidationReport
 *   ↓
 *   If passed → Review Queue
 *   If failed → Errors surfaced in UI; snapshot NOT created
 *
 * RULES:
 * All rules are pure functions — no database access.
 * Rules are domain-specific: they encode legal and arithmetic invariants
 * that the LLM cannot guarantee (e.g., date coherence, legal limits).
 *
 * GOVERNANCE:
 * Validation failure is NOT a terminal state for the document.
 * The lawyer can override and manually enter corrected values.
 * But snapshot creation is blocked until all 'error'-level issues are resolved.
 * 'warning'-level issues are surfaced but do not block.
 */

import type { ExtractionEnvelope } from './schemas/envelope.ts'

// ---------------------------------------------------------------------------
// ValidationReport types
// ---------------------------------------------------------------------------

export type ValidationSeverity = 'error' | 'warning'

export type ValidationIssue = {
  /** JSON path to the problematic field. ex: "pena_total.anos" */
  field: string
  message: string
  severity: ValidationSeverity
}

export type ValidationReport = {
  passed: boolean
  issues: ValidationIssue[]
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

const MIN_LEGAL_DATE = new Date('1900-01-01')
const MAX_FUTURE_DATE = new Date(Date.now() + 30 * 365 * 24 * 60 * 60 * 1000) // +30 years

function isImpossibleDate(iso: string | null | undefined): boolean {
  if (iso === null || iso === undefined) return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return true
  return d < MIN_LEGAL_DATE || d > MAX_FUTURE_DATE
}

function isFutureDate(iso: string | null | undefined): boolean {
  if (iso === null || iso === undefined) return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  return d > new Date()
}

function dateA_before_dateB(
  isoA: string | null | undefined,
  isoB: string | null | undefined
): boolean {
  if (!isoA || !isoB) return false
  const a = new Date(isoA)
  const b = new Date(isoB)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false
  return a < b
}

// ---------------------------------------------------------------------------
// Field extraction helpers
// ---------------------------------------------------------------------------

function getFieldValue<T>(field: { value: T } | null | undefined): T | null {
  if (field === null || field === undefined) return null
  return field.value ?? null
}

// ---------------------------------------------------------------------------
// Shared numeric validation rules
// ---------------------------------------------------------------------------

function validatePositiveDays(
  days: number | null,
  fieldPath: string,
  issues: ValidationIssue[]
): void {
  if (days === null) return
  if (days < 0) {
    issues.push({
      field: fieldPath,
      message: `Número de dias não pode ser negativo (valor: ${days}).`,
      severity: 'error',
    })
  }
  if (days > 30 * 365 * 100) {
    // > 100 years in days
    issues.push({
      field: fieldPath,
      message: `Número de dias implausível (${days} dias = mais de 100 anos).`,
      severity: 'warning',
    })
  }
}

// ---------------------------------------------------------------------------
// Document-specific validation rules
// ---------------------------------------------------------------------------

function validateSentence(
  data: Record<string, unknown>,
  issues: ValidationIssue[]
): void {
  const anos = getFieldValue(data['pena_total_anos'] as { value: number } | undefined)
  const meses = getFieldValue(data['pena_total_meses'] as { value: number } | undefined)
  const dias = getFieldValue(data['pena_total_dias'] as { value: number } | undefined)
  const dataTransito = getFieldValue(data['data_transito_julgado'] as { value: string | null } | undefined)
  const dataSentenca = getFieldValue(data['data_sentenca'] as { value: string | null } | undefined)
  const detracao = getFieldValue(data['detracao_dias'] as { value: number } | undefined)

  // Pena total deve existir
  if (anos === null && meses === null && dias === null) {
    issues.push({
      field: 'pena_total',
      message: 'Pena total não foi extraída. Campo obrigatório para geração de cálculo.',
      severity: 'error',
    })
  }

  // Pena não pode ser zero (salvo multa pura — mas isso não é sentença penal)
  if (anos === 0 && meses === 0 && dias === 0) {
    issues.push({
      field: 'pena_total',
      message: 'Pena total extraída como zero. Verificar se o documento é uma sentença absolutória.',
      severity: 'error',
    })
  }

  validatePositiveDays(detracao, 'detracao_dias', issues)

  // Data de sentença não pode ser futura
  if (isFutureDate(dataSentenca)) {
    issues.push({
      field: 'data_sentenca',
      message: 'Data da sentença é uma data futura.',
      severity: 'error',
    })
  }

  // Trânsito em julgado não pode ser anterior à sentença
  if (
    dataSentenca &&
    dataTransito &&
    dateA_before_dateB(dataTransito, dataSentenca)
  ) {
    issues.push({
      field: 'data_transito_julgado',
      message: 'Trânsito em julgado não pode ser anterior à data da sentença.',
      severity: 'error',
    })
  }

  // Datas impossíveis
  for (const dateField of ['data_sentenca', 'data_transito_julgado']) {
    const val = getFieldValue(data[dateField] as { value: string | null } | undefined)
    if (isImpossibleDate(val)) {
      issues.push({
        field: dateField,
        message: `Data impossível extraída: "${val}".`,
        severity: 'error',
      })
    }
  }
}

function validateExecutionGuide(
  data: Record<string, unknown>,
  issues: ValidationIssue[]
): void {
  const totalAnos = getFieldValue(data['pena_total_anos'] as { value: number } | undefined)
  const dataBase = getFieldValue(data['data_base'] as { value: string | null } | undefined)
  const dataEmissao = getFieldValue(data['data_emissao'] as { value: string | null } | undefined)
  const tempoCumpridoAnos = getFieldValue(data['tempo_cumprido_anos'] as { value: number | null } | undefined)
  const detracao = getFieldValue(data['detracao_aplicada_dias'] as { value: number } | undefined)
  const remicao = getFieldValue(data['remicao_acumulada_dias'] as { value: number } | undefined)

  if (totalAnos === null) {
    issues.push({
      field: 'pena_total_anos',
      message: 'Pena total em anos não foi extraída. Campo obrigatório.',
      severity: 'error',
    })
  }

  if (!dataBase) {
    issues.push({
      field: 'data_base',
      message: 'Data-base não foi extraída. Campo crítico para progressão.',
      severity: 'error',
    })
  }

  if (isImpossibleDate(dataBase)) {
    issues.push({
      field: 'data_base',
      message: `Data-base impossível: "${dataBase}".`,
      severity: 'error',
    })
  }

  if (isImpossibleDate(dataEmissao)) {
    issues.push({
      field: 'data_emissao',
      message: `Data de emissão impossível: "${dataEmissao}".`,
      severity: 'error',
    })
  }

  // Tempo cumprido não pode ser negativo
  if (tempoCumpridoAnos !== null && tempoCumpridoAnos < 0) {
    issues.push({
      field: 'tempo_cumprido_anos',
      message: 'Tempo cumprido não pode ser negativo.',
      severity: 'error',
    })
  }

  validatePositiveDays(detracao, 'detracao_aplicada_dias', issues)
  validatePositiveDays(remicao, 'remicao_acumulada_dias', issues)

  // Data-base não pode ser futura
  if (isFutureDate(dataBase)) {
    issues.push({
      field: 'data_base',
      message: 'Data-base é uma data futura. Verificar extração.',
      severity: 'error',
    })
  }
}

function validateCalculation(
  data: Record<string, unknown>,
  issues: ValidationIssue[]
): void {
  const totalDias = getFieldValue(data['total_dias'] as { value: number } | undefined)
  const diasCumpridos = getFieldValue(data['dias_cumpridos'] as { value: number } | undefined)
  const remicao = getFieldValue(data['remicao_dias'] as { value: number } | undefined)
  const detracao = getFieldValue(data['detracao_dias'] as { value: number } | undefined)
  const saldo = getFieldValue(data['saldo_dias'] as { value: number | null } | undefined)
  const percentual = getFieldValue(data['percentual_cumprido'] as { value: number | null } | undefined)
  const dataRef = getFieldValue(data['data_referencia'] as { value: string | null } | undefined)

  if (totalDias === null) {
    issues.push({
      field: 'total_dias',
      message: 'Total de dias não foi extraído. Campo obrigatório para cálculo.',
      severity: 'error',
    })
  }

  validatePositiveDays(totalDias, 'total_dias', issues)
  validatePositiveDays(diasCumpridos, 'dias_cumpridos', issues)
  validatePositiveDays(remicao, 'remicao_dias', issues)
  validatePositiveDays(detracao, 'detracao_dias', issues)
  validatePositiveDays(saldo, 'saldo_dias', issues)

  // Dias cumpridos não pode ser maior que o total
  if (totalDias !== null && diasCumpridos !== null && diasCumpridos > totalDias) {
    issues.push({
      field: 'dias_cumpridos',
      message: `Dias cumpridos (${diasCumpridos}) maior que o total da pena (${totalDias}).`,
      severity: 'error',
    })
  }

  // Percentual deve estar em [0, 100]
  if (percentual !== null && (percentual < 0 || percentual > 100)) {
    issues.push({
      field: 'percentual_cumprido',
      message: `Percentual cumprido fora dos limites: ${percentual}%.`,
      severity: 'error',
    })
  }

  if (isFutureDate(dataRef)) {
    issues.push({
      field: 'data_referencia',
      message: 'Data de referência do cálculo é uma data futura.',
      severity: 'warning',
    })
  }
}

// ---------------------------------------------------------------------------
// Conflict validation
// ---------------------------------------------------------------------------

function validateConflicts(
  envelope: ExtractionEnvelope,
  issues: ValidationIssue[]
): void {
  for (const conflict of envelope.conflicts) {
    if (conflict.resolution === 'unresolved') {
      issues.push({
        field: conflict.fieldPath,
        message: `Conflito não resolvido no campo "${conflict.fieldPath}" entre ${conflict.conflictingValues.length} documentos. Revisão humana obrigatória.`,
        severity: 'error',
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Main validation entry point
// ---------------------------------------------------------------------------

/**
 * Validates an ExtractionEnvelope against domain rules.
 * Returns a ValidationReport indicating whether snapshot creation is allowed.
 *
 * This function is PURE — no side effects, no DB access.
 * It can be called on the API server, in workers, and in tests without deps.
 */
export function validateExtractionResult(
  envelope: ExtractionEnvelope
): ValidationReport {
  const issues: ValidationIssue[] = []

  // 1. Validate conflicts (multi-document)
  validateConflicts(envelope, issues)

  // 2. Classification must not be 'desconhecido' for snapshot to be possible
  if (envelope.classification.documentType === 'desconhecido') {
    issues.push({
      field: 'classification.documentType',
      message:
        'Documento classificado como "desconhecido". Não é possível gerar cálculo proposto sem classificação.',
      severity: 'error',
    })
  }

  // 3. Document-specific rules
  if (envelope.documentData !== null) {
    const { documentType, data } = envelope.documentData as {
      documentType: string
      data: Record<string, unknown> | null
    }

    if (data !== null && typeof data === 'object') {
      switch (documentType) {
        case 'sentenca':
          validateSentence(data, issues)
          break
        case 'guia_execucao':
          validateExecutionGuide(data, issues)
          break
        case 'calculo':
          validateCalculation(data, issues)
          break
        // Other document types: basic validation only
        default:
          break
      }
    }
  }

  // 4. Low confidence warning (does not block)
  if (envelope.documentConfidence < 0.60) {
    issues.push({
      field: 'documentConfidence',
      message: `Confiança global da extração baixa (${(envelope.documentConfidence * 100).toFixed(0)}%). Revisão cuidadosa obrigatória.`,
      severity: 'warning',
    })
  }

  const hasErrors = issues.some((i) => i.severity === 'error')

  return {
    passed: !hasErrors,
    issues,
  }
}
