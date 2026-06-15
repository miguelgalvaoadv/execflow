'use client'

/**
 * ExtractionReviewWorkspace — Side-by-side PDF + LLM field review.
 *
 * GOVERNANCE CONTRACT:
 * The advogado reviews extracted fields and decides:
 * - Accept the LLM value as-is.
 * - Correct it manually.
 * - Reject the entire extraction.
 *
 * Only after the advogado clicks "Gerar Cálculo Proposto" does the system
 * create a sentence_snapshot with status = 'proposed'. No automatic action.
 *
 * CONFIDENCE BADGES:
 * - 🟢 >= 0.85: High (green)
 * - 🟡 >= 0.60: Medium (yellow)
 * - 🔴 < 0.60: Low (red)
 *
 * EVIDENCE:
 * Each field shows a clickable evidence snippet. Clicking it will scroll
 * the PDF to the relevant page (currently via URL fragment).
 */

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, ApiError } from '@/lib/api-client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FieldEvidence = {
  documentId: string
  storageKey: string
  pageNumber: number | null
  textSnippet: string | null
}

type ExtractedFieldRaw = {
  value: unknown
  confidence: number
  evidence: FieldEvidence
}

type ExtractionEnvelope = {
  documentId: string
  classification: {
    documentType: string
    confidence: number
    reasoning: string
    alternativeClass: string | null
  }
  documentConfidence: number
  documentConfidenceLabel: 'high' | 'medium' | 'low' | 'unknown'
  documentData: {
    documentType: string
    data: Record<string, ExtractedFieldRaw | unknown>
  } | null
  conflicts: Array<{
    fieldPath: string
    conflictingValues: unknown[]
    resolution: string
    resolvedValue?: unknown
  }>
  hasBlockingConflicts: boolean
  versioning: {
    extractionVersion: string
    modelProvider: string
    modelName: string
    modelVersion: string
    promptVersion: string
    extractedAt: string
  }
  validationPassed: boolean
  validationErrors: Array<{
    field: string
    message: string
    severity: 'error' | 'warning'
  }>
}

type ExtractionReviewData = {
  documentId: string
  extractionRunId: string
  status: string
  extractionType: string
  structuredData: ExtractionEnvelope
  confidence: string
  providerMetadata: Record<string, unknown>
  extractedAt: string
  documentStatus: string
  documentClass: string | null
  executionCaseId: string | null
  reviewHistory: Array<{
    decision: string
    reason: string
    reviewerUserId: string
    reviewedAt: string
  }>
}

type FieldOverride = {
  fieldPath: string
  correctedValue: unknown
}

// ---------------------------------------------------------------------------
// Confidence badge
// ---------------------------------------------------------------------------

function ConfidenceBadge({ score }: { score: number }) {
  let cls = ''
  let label = ''
  let icon = ''

  if (score >= 0.85) {
    cls = 'bg-emerald-950/50 border-emerald-800/40 text-emerald-400'
    label = `${(score * 100).toFixed(0)}%`
    icon = '🟢'
  } else if (score >= 0.60) {
    cls = 'bg-amber-950/50 border-amber-800/40 text-amber-400'
    label = `${(score * 100).toFixed(0)}%`
    icon = '🟡'
  } else {
    cls = 'bg-red-950/50 border-red-800/40 text-red-400'
    label = `${(score * 100).toFixed(0)}%`
    icon = '🔴'
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono font-semibold ${cls}`}
      title={`Confiança da extração: ${label}`}
    >
      {icon} {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Individual field row
// ---------------------------------------------------------------------------

type FieldRowProps = {
  fieldPath: string
  label: string
  field: ExtractedFieldRaw
  override: unknown
  onOverride: (path: string, value: unknown) => void
  onNavigatePage: (page: number | null) => void
}

function FieldRow({
  fieldPath,
  label,
  field,
  override,
  onOverride,
  onNavigatePage,
}: FieldRowProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(
    String(override ?? field.value ?? '')
  )

  const displayValue = override !== undefined ? override : field.value
  const hasOverride = override !== undefined && override !== field.value

  return (
    <div className={`border rounded-lg p-3 space-y-1.5 ${field.confidence < 0.60 ? 'border-red-900/40 bg-red-950/10' : field.confidence < 0.85 ? 'border-amber-900/30 bg-amber-950/5' : 'border-white/[0.06] bg-white/[0.02]'}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] text-zinc-400 font-medium">{label}</span>
        <ConfidenceBadge score={field.confidence} />
      </div>

      {editing ? (
        <div className="flex gap-2 mt-1">
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="flex-1 bg-black/40 border border-indigo-500/60 text-white rounded px-2 py-1 text-[12px] focus:outline-none"
            autoFocus
          />
          <button
            onClick={() => {
              onOverride(fieldPath, editValue)
              setEditing(false)
            }}
            className="text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white rounded px-2 py-1 cursor-pointer font-medium"
          >
            ✓
          </button>
          <button
            onClick={() => setEditing(false)}
            className="text-[11px] text-zinc-400 hover:text-white rounded px-2 py-1 cursor-pointer"
          >
            ✕
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span
            className={`text-[13px] font-mono ${hasOverride ? 'text-indigo-300' : 'text-white'} ${displayValue === null || displayValue === undefined ? 'text-zinc-500 italic' : ''}`}
          >
            {displayValue === null || displayValue === undefined
              ? 'Não encontrado'
              : typeof displayValue === 'boolean'
              ? displayValue ? 'Sim' : 'Não'
              : String(displayValue)}
          </span>
          {hasOverride && (
            <span className="text-[10px] text-indigo-400 bg-indigo-950/40 border border-indigo-800/40 rounded px-1.5 py-0.5">
              corrigido
            </span>
          )}
          <button
            onClick={() => {
              setEditValue(String(displayValue ?? ''))
              setEditing(true)
            }}
            className="ml-auto text-[10px] text-zinc-500 hover:text-white cursor-pointer"
          >
            ✏️
          </button>
        </div>
      )}

      {field.evidence.textSnippet && (
        <button
          onClick={() => onNavigatePage(field.evidence.pageNumber)}
          className="w-full text-left text-[10px] text-zinc-500 hover:text-zinc-300 italic border-t border-white/[0.04] pt-1.5 mt-1 transition-colors cursor-pointer"
          title={`Evidência na página ${field.evidence.pageNumber ?? '?'}`}
        >
          📌 p.{field.evidence.pageNumber ?? '?'}: &ldquo;{field.evidence.textSnippet.slice(0, 100)}&rdquo;
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Field list from envelope data
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  // guia_execucao
  numero_processo_execucao: 'Nº Processo de Execução',
  numero_processo_origem: 'Nº Processo de Origem',
  vara_execucao: 'Vara de Execução',
  nome_reeducando: 'Nome do Reeducando',
  estabelecimento_penal: 'Estabelecimento Penal',
  data_emissao: 'Data de Emissão',
  pena_total_anos: 'Pena Total (anos)',
  pena_total_meses: 'Pena Total (meses)',
  pena_total_dias: 'Pena Total (dias)',
  regime_atual: 'Regime Atual',
  data_base: 'Data-base',
  tempo_cumprido_anos: 'Tempo Cumprido (anos)',
  tempo_cumprido_meses: 'Tempo Cumprido (meses)',
  tempo_cumprido_dias: 'Tempo Cumprido (dias)',
  detracao_aplicada_dias: 'Detração Aplicada (dias)',
  remicao_acumulada_dias: 'Remição Acumulada (dias)',
  contem_crime_hediondo: 'Contém Crime Hediondo?',
  observacoes: 'Observações',
  // sentenca
  numero_processo: 'Nº do Processo',
  vara_sentenciante: 'Vara Sentenciante',
  data_sentenca: 'Data da Sentença',
  data_transito_julgado: 'Trânsito em Julgado',
  regime_inicial: 'Regime Inicial',
  detracao_dias: 'Detração (dias)',
  algum_crime_hediondo: 'Algum Crime Hediondo?',
}

function getLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/_/g, ' ')
}

function isExtractedField(val: unknown): val is ExtractedFieldRaw {
  return (
    typeof val === 'object' &&
    val !== null &&
    'value' in val &&
    'confidence' in val &&
    'evidence' in val
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type ExtractionReviewWorkspaceProps = {
  organizationId: string
  documentId: string
  caseId: string
  onClose: () => void
  onSnapshotCreated: () => void
}

export function ExtractionReviewWorkspace({
  organizationId,
  documentId,
  caseId,
  onClose,
  onSnapshotCreated,
}: ExtractionReviewWorkspaceProps) {
  const queryClient = useQueryClient()
  const [currentPage, setCurrentPage] = useState<number | null>(null)
  const [fieldOverrides, setFieldOverrides] = useState<Record<string, unknown>>({})
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [effectiveAt, setEffectiveAt] = useState(new Date().toISOString().slice(0, 10))

  // Load extraction review data via the document endpoint
  const reviewQuery = useQuery<{ data: ExtractionReviewData }, ApiError>({
    queryKey: ['document-extraction', organizationId, documentId],
    queryFn: ({ signal }) =>
      apiGet<{ data: ExtractionReviewData }>(
        `/api/v1/documents/${documentId}/extraction`,
        { organizationId, signal }
      ),
    staleTime: 60 * 1000,
    enabled: documentId !== '',
  })

  const reviewData = reviewQuery.data?.data
  const extractionRunId = reviewData?.extractionRunId ?? ''
  const envelope = reviewData?.structuredData

  // Confirm extraction mutation
  const confirmMutation = useMutation({
    mutationFn: () =>
      apiPost<{ data: { extractionRunId: string; documentId: string } }>(
        `/api/v1/extractions/${extractionRunId}/confirm`,
        {},
        { organizationId }
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['case-documents', organizationId, caseId] })
    },
  })

  // Reject extraction mutation
  const rejectMutation = useMutation({
    mutationFn: (reason: string) =>
      apiPost<{ data: { extractionRunId: string; documentId: string } }>(
        `/api/v1/extractions/${extractionRunId}/reject`,
        { reason },
        { organizationId }
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['case-documents', organizationId, caseId] })
      onClose()
    },
  })

  // Promote to snapshot mutation
  const promoteMutation = useMutation({
    mutationFn: () =>
      apiPost<{ data: { snapshotId: string; snapshotPromotionId: string } }>(
        `/api/v1/extractions/${extractionRunId}/promote-snapshot`,
        {
          executionCaseId: caseId,
          effectiveAt: `${effectiveAt}T00:00:00.000Z`,
          fieldOverrides: Object.entries(fieldOverrides).map(([fieldPath, correctedValue]) => ({
            fieldPath,
            correctedValue,
          })),
          reason: 'Extração revisada e aprovada pelo advogado.',
        },
        { organizationId }
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['case-documents', organizationId, caseId] })
      void queryClient.invalidateQueries({ queryKey: ['case-snapshots', organizationId, caseId] })
      onSnapshotCreated()
      onClose()
    },
  })

  const pdfSrc = currentPage
    ? `/api/v1/documents/${documentId}/download#page=${currentPage}`
    : `/api/v1/documents/${documentId}/download`

  // Collect all fields from envelope.documentData.data
  const fields = useMemo(() => {
    if (!envelope?.documentData?.data) return []
    return Object.entries(envelope.documentData.data)
      .filter(([, val]) => isExtractedField(val))
      .map(([key, val]) => ({ key, field: val as ExtractedFieldRaw }))
  }, [envelope])

  // Validation errors from envelope
  const validationErrors = envelope?.validationErrors?.filter((e) => e.severity === 'error') ?? []
  const validationWarnings = envelope?.validationErrors?.filter((e) => e.severity === 'warning') ?? []

  const canPromote = envelope !== undefined &&
    envelope.validationPassed &&
    !envelope.hasBlockingConflicts &&
    !promoteMutation.isPending

  if (reviewQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-zinc-400 text-[13px]">
        Carregando dados da extração…
      </div>
    )
  }

  if (reviewQuery.isError || !envelope) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-red-400 text-[13px]">Erro ao carregar dados da extração.</p>
        <button
          onClick={onClose}
          className="text-[12px] text-zinc-400 hover:text-white cursor-pointer"
        >
          Fechar
        </button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-zinc-950/90">
        <div className="flex items-center gap-4">
          <div>
            <span className="text-[10px] uppercase tracking-widest font-bold text-amber-400">
              Revisão de Extração
            </span>
            <h2 className="text-[16px] font-semibold text-white mt-0.5">
              {envelope.classification.documentType.replace(/_/g, ' ')}
            </h2>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-zinc-400">
            <ConfidenceBadge score={envelope.documentConfidence} />
            <span>confiança global</span>
          </div>
          {envelope.versioning && (
            <span className="text-[10px] text-zinc-600">
              {envelope.versioning.modelName} · {envelope.versioning.promptVersion}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-white text-[20px] cursor-pointer"
        >
          ✕
        </button>
      </div>

      {/* Classification reasoning */}
      {envelope.classification.reasoning && (
        <div className="px-6 py-2 bg-zinc-900/60 border-b border-white/[0.04]">
          <p className="text-[11px] text-zinc-400">
            <span className="text-zinc-500">Classificação:</span>{' '}
            {envelope.classification.reasoning}
          </p>
        </div>
      )}

      {/* Validation alerts */}
      {validationErrors.length > 0 && (
        <div className="px-6 py-2 bg-red-950/30 border-b border-red-900/40">
          {validationErrors.map((err, i) => (
            <p key={i} className="text-[11px] text-red-400">
              🚫 [{err.field}] {err.message}
            </p>
          ))}
          <p className="text-[10px] text-red-500 mt-1">
            ⚠ Erros acima bloqueiam a criação de cálculo proposto. Corrija os campos.
          </p>
        </div>
      )}
      {validationWarnings.length > 0 && (
        <div className="px-6 py-2 bg-amber-950/20 border-b border-amber-900/30">
          {validationWarnings.map((w, i) => (
            <p key={i} className="text-[11px] text-amber-400">
              ⚠ [{w.field}] {w.message}
            </p>
          ))}
        </div>
      )}

      {/* Main split pane */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: PDF viewer */}
        <div className="w-[58%] border-r border-white/[0.08] flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06] bg-zinc-900/40">
            <span className="text-[11px] text-zinc-400">Documento Original</span>
            {currentPage && (
              <span className="text-[11px] text-indigo-400 font-mono">
                Página {currentPage}
              </span>
            )}
          </div>
          <div className="flex-1 bg-black/60">
            <iframe
              key={pdfSrc}
              src={pdfSrc}
              className="w-full h-full border-0"
              title="Visualizador PDF"
            />
          </div>
        </div>

        {/* Right: Fields */}
        <div className="w-[42%] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06] bg-zinc-900/40">
            <span className="text-[11px] text-zinc-400">Campos Extraídos</span>
            <span className="text-[11px] text-zinc-500">
              {fields.length} campos · {Object.keys(fieldOverrides).length} corrigidos
            </span>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {fields.length === 0 ? (
              <p className="text-[12px] text-zinc-500 italic text-center py-8">
                Nenhum campo estruturado encontrado.
              </p>
            ) : (
              fields.map(({ key, field }) => (
                <FieldRow
                  key={key}
                  fieldPath={key}
                  label={getLabel(key)}
                  field={field}
                  override={fieldOverrides[key]}
                  onOverride={(path, value) =>
                    setFieldOverrides((prev) => ({ ...prev, [path]: value }))
                  }
                  onNavigatePage={setCurrentPage}
                />
              ))
            )}

            {/* Conflicts */}
            {envelope.conflicts.length > 0 && (
              <div className="border border-red-900/40 bg-red-950/20 rounded-lg p-3">
                <p className="text-[11px] text-red-400 font-semibold mb-2">
                  ⚡ Conflitos Documentais Detectados
                </p>
                {envelope.conflicts.map((conflict, i) => (
                  <div key={i} className="text-[11px] text-red-300 mt-1">
                    Campo: <span className="font-mono">{conflict.fieldPath}</span> —{' '}
                    {conflict.conflictingValues.length} valores conflitantes
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Action bar */}
          <div className="border-t border-white/[0.08] px-4 py-4 space-y-3 bg-zinc-950/60">
            {/* Effective date for snapshot */}
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">
                Data efetiva do cálculo proposto
              </label>
              <input
                type="date"
                value={effectiveAt}
                onChange={(e) => setEffectiveAt(e.target.value)}
                className="bg-black/40 border border-white/[0.08] text-white rounded px-2 py-1 text-[12px] focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Primary action */}
            {!showRejectForm ? (
              <div className="flex gap-2">
                <button
                  id="btn-generate-snapshot"
                  onClick={() => promoteMutation.mutate()}
                  disabled={!canPromote}
                  className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-white rounded text-[12px] font-semibold transition cursor-pointer"
                >
                  {promoteMutation.isPending
                    ? 'Gerando…'
                    : '✓ Gerar Cálculo Proposto'}
                </button>
                <button
                  onClick={() => setShowRejectForm(true)}
                  className="px-3 py-2 border border-red-900/40 text-red-400 hover:bg-red-950/30 rounded text-[12px] transition cursor-pointer"
                >
                  Rejeitar
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block text-[11px] text-zinc-400">
                  Motivo da rejeição (obrigatório)
                </label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={3}
                  placeholder="Descreva o motivo da rejeição..."
                  className="w-full bg-black/40 border border-white/[0.08] text-white rounded px-2 py-1 text-[12px] focus:outline-none focus:border-red-500 resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (rejectReason.length >= 10) {
                        rejectMutation.mutate(rejectReason)
                      }
                    }}
                    disabled={rejectReason.length < 10 || rejectMutation.isPending}
                    className="flex-1 py-2 bg-red-700 hover:bg-red-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded text-[12px] font-semibold transition cursor-pointer"
                  >
                    {rejectMutation.isPending ? 'Rejeitando…' : 'Confirmar Rejeição'}
                  </button>
                  <button
                    onClick={() => setShowRejectForm(false)}
                    className="px-3 py-2 text-zinc-400 hover:text-white text-[12px] transition cursor-pointer"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* Feedback */}
            {promoteMutation.isSuccess && (
              <p className="text-[11px] text-emerald-400 bg-emerald-950/20 border border-emerald-900/30 rounded p-2">
                ✓ Cálculo proposto gerado com sucesso! Disponível na aba Cálculos.
              </p>
            )}
            {promoteMutation.isError && (
              <p className="text-[11px] text-red-400 bg-red-950/20 border border-red-900/30 rounded p-2">
                Erro: {promoteMutation.error?.message ?? 'Falha ao gerar cálculo.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
