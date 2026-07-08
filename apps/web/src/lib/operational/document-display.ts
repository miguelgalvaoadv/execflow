/** Operational labels for document pipeline states (PT). */

export const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  pending_association: 'Aguardando associação',
  pending_extraction: 'Aguardando extração',
  extraction_running: 'Extração em curso',
  extraction_review: 'Em revisão',
  confirmed: 'Confirmado',
  archived: 'Arquivado',
  superseded: 'Substituído',
  rejected: 'Rejeitado',
}

export const OCR_STATUS_LABELS: Record<string, string> = {
  not_applicable: 'Não aplicável',
  pending: 'Pendente',
  running: 'OCR em processamento',
  completed: 'OCR concluído',
  failed: 'OCR falhou',
  skipped: 'OCR ignorado',
}

export const EXTRACTION_STATUS_LABELS: Record<string, string> = {
  requested: 'Solicitado',
  running: 'Em processamento',
  review: 'Em revisão',
  confirmed: 'Confirmado',
  failed: 'Falhou',
  rejected: 'Rejeitado',
}

export const SNAPSHOT_PROMOTION_STATUS_LABELS: Record<string, string> = {
  requested: 'Solicitado',
  proposed: 'Proposto',
  confirmed: 'Confirmado',
  skipped: 'Ignorado',
  failed: 'Falhou',
}

export const REVIEW_DECISION_LABELS: Record<string, string> = {
  approved: 'Aprovado',
  rejected: 'Rejeitado',
}

export function documentStatusLabel(status: string): string {
  return DOCUMENT_STATUS_LABELS[status] ?? status
}

/**
 * Rótulo de OCR — leva em conta o status do documento porque "OCR falhou"
 * sozinho é um falso alarme quando o documento foi CONFIRMADO mesmo assim:
 * PDFs dentro do limite de leitura nativa (≤600 pág./28MB) vão direto pro
 * Claude sem precisar de texto OCR — só passam a exigir OCR (e a falha
 * bloquear de verdade) quando excedem esse limite. Achado 08/07/2026:
 * o caso do Marcelo mostrava "OCR falhou" ao lado de "Confirmado" mesmo já
 * tendo sido lido e analisado com sucesso pela IA, o que parecia (errado)
 * um problema real com o arquivo.
 */
export function ocrStatusLabel(status: string, documentStatus?: string): string {
  if (status === 'failed' && documentStatus === 'confirmed') {
    return 'OCR dispensado (PDF lido direto)'
  }
  return OCR_STATUS_LABELS[status] ?? status
}

export function extractionStatusLabel(status: string): string {
  return EXTRACTION_STATUS_LABELS[status] ?? status
}

export function snapshotPromotionStatusLabel(status: string): string {
  return SNAPSHOT_PROMOTION_STATUS_LABELS[status] ?? status
}

export function reviewDecisionLabel(decision: string): string {
  return REVIEW_DECISION_LABELS[decision] ?? decision
}

export const DOCUMENT_STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'pending_association', label: 'Aguardando associação' },
  { value: 'pending_extraction', label: 'Aguardando extração' },
  { value: 'extraction_running', label: 'Extração em curso' },
  { value: 'extraction_review', label: 'Em revisão' },
  { value: 'confirmed', label: 'Confirmado' },
  { value: 'archived', label: 'Arquivado' },
  { value: 'rejected', label: 'Rejeitado' },
] as const
