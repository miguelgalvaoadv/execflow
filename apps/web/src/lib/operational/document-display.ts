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

export function ocrStatusLabel(status: string): string {
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
