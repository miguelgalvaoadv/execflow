/** Operational labels for deadline lifecycle (PT). */

import { DEADLINE_CLASS_LABELS } from '@/lib/operational/queue-display'

export const DEADLINE_STATUS_LABELS: Record<string, string> = {
  open: 'Aberto',
  acknowledged: 'Em acompanhamento',
  overdue: 'Vencido',
  completed: 'Concluído',
  dismissed: 'Encerrado',
}

export const DEADLINE_PRIORITY_LABELS: Record<string, string> = {
  critical: 'Crítica',
  high: 'Alta',
  normal: 'Normal',
  low: 'Baixa',
}

export const DEADLINE_ORIGIN_LABELS: Record<string, string> = {
  manual: 'Manual',
  extracted: 'Extraído',
  rule: 'Regra',
  recurring: 'Recorrente',
}

export const DEADLINE_HISTORY_LABELS: Record<string, string> = {
  acknowledged: 'Reconhecido',
  completed: 'Concluído',
  dismissed: 'Encerrado',
  status_changed: 'Alteração de status',
  due_date_changed: 'Data alterada',
  priority_changed: 'Prioridade alterada',
  assignee_changed: 'Responsável alterado',
  escalation_changed: 'Escalada alterada',
  blocking_changed: 'Bloqueio alterado',
}

export const DISMISS_REASON_CODE_LABELS: Record<string, string> = {
  completed_elsewhere: 'Concluído noutro local',
  superseded: 'Substituído',
  not_applicable: 'Não aplicável',
  court_extension: 'Prorrogação judicial',
  client_withdrawal: 'Desistência do cliente',
  other: 'Outro',
}

export function deadlineStatusLabel(status: string): string {
  return DEADLINE_STATUS_LABELS[status] ?? status
}

export function deadlinePriorityLabel(priority: string): string {
  return DEADLINE_PRIORITY_LABELS[priority] ?? priority
}

export function deadlineClassLabel(deadlineClass: string): string {
  return DEADLINE_CLASS_LABELS[deadlineClass] ?? deadlineClass
}

export function deadlineOriginLabel(origin: string): string {
  return DEADLINE_ORIGIN_LABELS[origin] ?? origin
}

export function deadlineHistoryLabel(changeType: string, newValue: Record<string, unknown> | null): string {
  if (changeType === 'status_changed' && newValue?.['status'] === 'overdue') {
    return 'Marcado como vencido'
  }
  return DEADLINE_HISTORY_LABELS[changeType] ?? changeType
}

export function deadlineCardAccentClass(status: string, priority: string): string {
  if (status === 'overdue') {
    return 'border-red-200 bg-red-50'
  }
  if (priority === 'critical') {
    return 'border-red-200 bg-red-50'
  }
  if (priority === 'high') {
    return 'border-orange-200 bg-orange-50'
  }
  return ''
}

export function deadlineStatusBadgeClass(status: string): string {
  if (status === 'overdue') return 'text-red-700 bg-red-50 border-red-200'
  if (status === 'completed') return 'text-emerald-700 bg-emerald-50 border-emerald-200'
  if (status === 'dismissed') return 'text-zinc-400 bg-white/[0.03] border-white/[0.06]'
  if (status === 'acknowledged') return 'text-blue-700 bg-blue-50 border-blue-200'
  return 'text-zinc-400 bg-white/[0.03] border-white/[0.06]'
}

export function deadlinePriorityBadgeClass(priority: string): string {
  if (priority === 'critical') return 'text-red-700 bg-red-50 border-red-200'
  if (priority === 'high') return 'text-orange-700 bg-orange-50 border-orange-200'
  return 'text-zinc-400 bg-white/[0.03] border-white/[0.06]'
}

export const DEADLINE_STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'open', label: 'Aberto' },
  { value: 'acknowledged', label: 'Em acompanhamento' },
  { value: 'overdue', label: 'Vencido' },
  { value: 'completed', label: 'Concluído' },
  { value: 'dismissed', label: 'Encerrado' },
] as const

export const DEADLINE_PRIORITY_FILTER_OPTIONS = [
  { value: '', label: 'Todas as prioridades' },
  { value: 'critical', label: 'Crítica' },
  { value: 'high', label: 'Alta' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Baixa' },
] as const

export const DEADLINE_CLASS_FILTER_OPTIONS = [
  { value: '', label: 'Todas as classes' },
  { value: 'legal', label: 'Processual' },
  { value: 'benefit', label: 'Benefício' },
  { value: 'disciplinary', label: 'Disciplinar' },
  { value: 'calculation', label: 'Cálculo' },
  { value: 'internal', label: 'Interno' },
  { value: 'recurring', label: 'Recorrente' },
  { value: 'sla', label: 'SLA' },
] as const
