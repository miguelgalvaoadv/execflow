/**
 * Classificador determinístico de prioridade do Inventário por OAB.
 *
 * REGRA DE OURO: isto NÃO é IA. É uma matriz de regras auditável — cada
 * resultado carrega a justificativa legível (priorityReason). A IA pode
 * ENRIQUECER depois (tier de criticidade via opportunity-detector), mas a
 * triagem em massa dos ~200 processos precisa ser barata, instantânea e
 * explicável.
 *
 * Prioridade ALTA: movimentação sensível (intimação/decisão/sentença/acórdão/
 *   alvará/mandado/prisão/falta grave), execução penal ativa, segredo de
 *   justiça, sem cliente identificado, movimentação muito recente.
 * Prioridade MÉDIA: ativo aguardando (audiência/MP/decisão/julgamento/
 *   contrarrazões/diligência) ou ativo sem sinal de prazo.
 * Prioridade BAIXA: arquivado/suspenso/baixado/extinto, "não é nosso",
 *   sem movimentação relevante recente.
 *
 * needsAutos: sugerido quando a prioridade é alta E há sinal de documento
 * decisório novo (sentença/acórdão/decisão/laudo/cálculo) sem autos baixados.
 */

export type ClassifiableItem = {
  situation: string | null
  area: string | null
  lastMovementText: string | null
  lastMovementAt: Date | null
  isSealed: boolean
  clientId: string | null
  reviewStatus: string
  autosDownloaded: boolean
}

export type ClassificationResult = {
  priority: 'high' | 'medium' | 'low'
  priorityReason: string
  needsAutos: boolean
}

/** Normaliza para comparação: minúsculas + sem acentos. */
function norm(s: string | null): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

const ARCHIVED_SITUATIONS = ['arquivado', 'suspenso', 'baixado', 'extinto', 'transito antigo', 'encerrado']

/** Palavras de movimentação SENSÍVEL → prioridade alta (seção 6 do spec). */
const HIGH_MOVEMENT_KEYWORDS = [
  'intimacao',
  'decisao',
  'sentenca',
  'acordao',
  'alvara',
  'mandado',
  'prisao',
  'falta grave',
  'homologacao de calculo',
  'transito em julgado',
  'prazo',
  'regressao',
  'audiencia de custodia',
]

/** Sinal de documento decisório novo → sugerir baixar autos. */
const NEEDS_AUTOS_KEYWORDS = [
  'sentenca',
  'acordao',
  'decisao',
  'laudo',
  'calculo',
  'juntada de certidao',
  'juntada de mandado',
]

/** Palavras de espera → prioridade média. */
const MEDIUM_KEYWORDS = [
  'aguardando audiencia',
  'aguardando manifestacao',
  'aguardando decisao',
  'aguardando julgamento',
  'aguardando contrarrazoes',
  'aguardando cumprimento',
  'conclusos',
  'remetido',
  'vista ao ministerio publico',
]

const RECENT_MOVEMENT_DAYS = 7

export function classifyInventoryItem(item: ClassifiableItem): ClassificationResult {
  const situation = norm(item.situation)
  const movement = norm(item.lastMovementText)
  const area = norm(item.area)
  const reasons: string[] = []

  // ---------------------------------------------------------------------------
  // BAIXA tem precedência absoluta para processos fora de andamento:
  // arquivado/suspenso/baixado/extinto ou marcado como "não é nosso".
  // ---------------------------------------------------------------------------
  if (item.reviewStatus === 'not_ours' || item.reviewStatus === 'archived') {
    return {
      priority: 'low',
      priorityReason: 'Marcado como fora do escritório ou arquivado na triagem.',
      needsAutos: false,
    }
  }
  if (ARCHIVED_SITUATIONS.some((s) => situation.includes(s))) {
    return {
      priority: 'low',
      priorityReason: `Situação "${item.situation}" — sem andamento ativo.`,
      needsAutos: false,
    }
  }

  // ---------------------------------------------------------------------------
  // ALTA — qualquer um dos sinais abaixo
  // ---------------------------------------------------------------------------
  const matchedHigh = HIGH_MOVEMENT_KEYWORDS.filter((k) => movement.includes(k))
  if (matchedHigh.length > 0) {
    reasons.push(`movimentação contém: ${matchedHigh.join(', ')}`)
  }
  if (area.includes('execucao')) {
    reasons.push('execução penal ativa')
  }
  if (item.isSealed) {
    reasons.push('segredo de justiça')
  }
  if (item.lastMovementAt !== null) {
    const ageDays = (Date.now() - item.lastMovementAt.getTime()) / 86_400_000
    if (ageDays <= RECENT_MOVEMENT_DAYS) {
      reasons.push(`movimentação recente (${Math.max(0, Math.round(ageDays))}d)`)
    }
  }
  // "Sem cliente identificado" (spec §6) só REFORÇA a prioridade alta quando há
  // outro sinal ativo — sozinho não basta, senão TODO item recém-importado
  // (nenhum CSV vem com cliente vinculado) viraria prioridade alta e a
  // classificação perderia o propósito de dizer "quais autos baixar primeiro".
  if (item.clientId === null && reasons.length > 0) {
    reasons.push('sem cliente identificado')
  }

  if (reasons.length > 0) {
    const decisionSignal = NEEDS_AUTOS_KEYWORDS.some((k) => movement.includes(k))
    return {
      priority: 'high',
      priorityReason: `Prioridade alta: ${reasons.join('; ')}.`,
      needsAutos: !item.autosDownloaded && decisionSignal,
    }
  }

  // ---------------------------------------------------------------------------
  // MÉDIA — ativo aguardando algo, ou ativo sem sinal de prazo
  // ---------------------------------------------------------------------------
  const matchedMedium = MEDIUM_KEYWORDS.filter((k) => movement.includes(k))
  if (matchedMedium.length > 0) {
    return {
      priority: 'medium',
      priorityReason: `Em andamento: ${matchedMedium.join(', ')}.`,
      needsAutos: false,
    }
  }
  if (situation.includes('ativo') || situation === '') {
    return {
      priority: 'medium',
      priorityReason: 'Processo ativo sem sinal de prazo aparente.',
      needsAutos: false,
    }
  }

  // ---------------------------------------------------------------------------
  // BAIXA — resto
  // ---------------------------------------------------------------------------
  return {
    priority: 'low',
    priorityReason: 'Sem movimentação relevante recente.',
    needsAutos: false,
  }
}
