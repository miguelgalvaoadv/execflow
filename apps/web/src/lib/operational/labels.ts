/**
 * Rótulos em português para valores de enum/código do domínio.
 * Evita que códigos crus (ex.: "process_movement", "suggested") apareçam na tela.
 */

function humanize(value: string): string {
  const last = value.includes('.') ? value.split('.').pop()! : value
  const txt = last.replace(/_/g, ' ').trim()
  return txt.charAt(0).toUpperCase() + txt.slice(1)
}

export function opportunityStatusLabel(status: string): string {
  const map: Record<string, string> = {
    suggested: 'Sugerida',
    qualified: 'Qualificada',
    pursuing: 'Em andamento',
    realized: 'Realizada',
    dismissed: 'Descartada',
    expired: 'Expirada',
  }
  return map[status] ?? humanize(status)
}

export function engineTriggerLabel(trigger: string): string {
  const map: Record<string, string> = {
    manual: 'Manual',
    document_associated: 'Documento anexado',
    snapshot_confirmed: 'Cálculo confirmado',
    movements_received: 'Movimentações recebidas',
    recalculation: 'Recálculo',
    scheduled: 'Agendado',
  }
  return map[trigger] ?? humanize(trigger)
}

export function engineStatusLabel(status: string): string {
  const map: Record<string, string> = {
    completed: 'Concluído',
    running: 'Em execução',
    failed: 'Falhou',
    scheduled: 'Agendado',
    pending: 'Pendente',
  }
  return map[status] ?? humanize(status)
}

export function uncertaintyLevelLabel(level: string): string {
  const map: Record<string, string> = {
    none: 'Nenhuma',
    low: 'Baixa',
    medium: 'Média',
    high: 'Alta',
  }
  return map[level] ?? humanize(level)
}

export function documentClassLabel(documentClass: string | null): string {
  if (documentClass === null || documentClass === '') return 'Sem classe'
  const map: Record<string, string> = {
    sentenca: 'Sentença',
    'acórdão': 'Acórdão',
    acordao: 'Acórdão',
    despacho: 'Despacho',
    certidao_carceraria: 'Certidão carcerária',
    guia_de_execucao: 'Guia de execução',
    laudo_disciplinar: 'Laudo disciplinar',
    comprovante_trabalho_estudo: 'Comprovante de trabalho/estudo',
    mandado_prisao: 'Mandado de prisão',
    alvara_soltura: 'Alvará de soltura',
    hc_decisao: 'Decisão de HC',
    atestado_medico: 'Atestado médico',
    atestado_penas: 'Atestado de pena',
    documento_pessoal: 'Documento pessoal',
    procuracao: 'Procuração',
    autos_iniciais: 'Autos (peças iniciais)',
    autos_integral: 'Autos (cópia integral)',
    autos_apenso: 'Apenso',
    petition: 'Petição',
    ficha_reu: 'Ficha do réu',
    pad: 'PAD',
    outros: 'Outros',
  }
  return map[documentClass] ?? humanize(documentClass)
}

export function timelineCategoryLabel(category: string): string {
  const map: Record<string, string> = {
    court: 'Tribunal',
    prison: 'Prisional',
    sentence: 'Pena',
    benefit: 'Benefício',
    legal_action: 'Ato processual',
    document: 'Documento',
    ai: 'Análise IA',
    internal: 'Interno',
    system: 'Sistema',
  }
  return map[category] ?? humanize(category)
}

export function timelineVisibilityLabel(visibility: string): string {
  const map: Record<string, string> = {
    legal: 'Jurídico',
    internal: 'Interno',
    both: 'Geral',
  }
  return map[visibility] ?? humanize(visibility)
}

export function timelineEventTypeLabel(eventType: string): string {
  const map: Record<string, string> = {
    process_movement: 'Movimentação processual',
    'prison.entry': 'Início de cumprimento',
    'prison.transfer': 'Transferência prisional',
    'discipline.falta_grave': 'Falta grave',
    'court.sentenca': 'Sentença',
    'court.regressao': 'Regressão de regime',
    'court.decisao': 'Decisão judicial',
    'court.acordao': 'Acórdão',
    'legal.agravo': 'Agravo em execução',
    'sentence.extincao': 'Extinção da pena',
    autos_requested: 'Autos solicitados',
    'system.document_associated': 'Documento anexado',
  }
  return map[eventType] ?? humanize(eventType)
}
