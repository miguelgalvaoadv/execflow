/** Shared queue display labels — used by /queues and Case Workspace tab Trabalho. */

export const QUEUE_TYPE_LABELS: Record<string, string> = {
  opportunity_review: 'Revisão de oportunidades',
  progression_opportunities: 'Progressão',
  overdue_deadlines: 'Prazos vencidos',
  urgent_liberty_risks: 'Riscos à liberdade',
  recalculation_conflicts: 'Conflitos de recálculo',
  intake_review: 'Triagem de entrada',
  extraction_review: 'Revisão de extração',
  snapshot_review: 'Revisão de snapshot',
  missing_data: 'Dados faltantes',
  pad_defense: 'Defesa em PAD',
  pending_filings: 'Peças pendentes',
  ai_review: 'Revisão de IA',
  workflow_tasks: 'Tarefas',
}

export const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: 'Urgente', color: 'text-red-400 bg-red-950/40 border-red-900/40' },
  1: { label: 'Alta', color: 'text-orange-400 bg-orange-950/40 border-orange-900/40' },
  2: { label: 'Média', color: 'text-yellow-400 bg-yellow-950/40 border-yellow-900/40' },
  3: { label: 'Normal', color: 'text-zinc-400 bg-white/[0.03] border-white/[0.06]' },
}

export const OPPORTUNITY_TYPE_LABELS: Record<string, string> = {
  progression: 'Progressão',
  remission: 'Remição',
  detraction: 'Detração',
  amnesty: 'Indulto',
  commutation: 'Comutação',
  hc: 'Habeas Corpus',
  pad_challenge: 'Impugnação PAD',
  prescription: 'Prescrição',
  recalculation: 'Recálculo',
  excess_execution: 'Excesso de execução',
  rights_violation: 'Violação de direitos',
  manual: 'Manual',
}

export const DEADLINE_CLASS_LABELS: Record<string, string> = {
  legal: 'Processual',
  benefit: 'Benefício',
  disciplinary: 'Disciplinar',
  calculation: 'Cálculo',
  internal: 'Interno',
  recurring: 'Recorrente',
  sla: 'SLA',
}
