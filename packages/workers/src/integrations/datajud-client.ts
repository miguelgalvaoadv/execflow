/**
 * Cliente DataJud (CNJ) — API pública de metadados processuais.
 *
 * https://datajud-wiki.cnj.jus.br/api-publica/ (lida integralmente em 03/07/2026):
 *   - Endpoints: /api-publica/endpoints/ — alias por tribunal (TJs, TRFs, STJ,
 *     TST, TSE, STM, TRTs, TREs, Justiça Militar estadual).
 *   - Autenticação: header `Authorization: APIKey {chave pública}` (a chave é
 *     pública, publicada na própria wiki, e pode ser trocada pelo CNJ).
 *   - Query DSL Elasticsearch; paginação por `sort @timestamp` + `search_after`.
 *   - Resposta inclui: classe{codigo,nome}, orgaoJulgador, grau, sistema,
 *     dataAjuizamento, nivelSigilo, assuntos[], movimentos[]{codigo,nome,
 *     dataHora,complementosTabelados} — códigos nacionais TPU/SGT.
 *
 * DIAGNÓSTICO DE REDE (03/07/2026): a rota IPv6 até o CNJ trava o TLS nesta
 * infraestrutura — forçamos resolução IPv4-first (dns.setDefaultResultOrder).
 * Além disso o backend do DataJud fica instável com frequência: o gateway
 * responde 401/406 imediatamente para requests inválidos, mas buscas válidas
 * penduram quando o cluster está fora — por isso o timeout é curto e o erro
 * distingue "backend não respondeu (instabilidade CNJ)" de erro real.
 *
 * USO NO PAINEL (spec §5 fonte 4): enriquecer o inventário por OAB com
 * classe/órgão/última movimentação usando números de processo JÁ CONHECIDOS —
 * o DataJud não busca por OAB, só por processo. Nunca substitui autos.
 *
 * Sem credencial → cliente desabilitado com aviso (mesmo padrão graceful do
 * createJusbrasilClient): o worker nunca cai por falta de chave.
 */

import { setDefaultResultOrder } from 'node:dns'

// IPv4-first: a rota IPv6 para api-publica.datajud.cnj.jus.br trava o TLS
// (diagnóstico 03/07/2026). Afeta só a ordem de tentativa de conexão do
// processo worker — inofensivo para os demais destinos.
try {
  setDefaultResultOrder('ipv4first')
} catch {
  // Node < 17 não suporta — segue com o padrão.
}

/** Resultado normalizado de uma consulta por CNJ. */
export type DatajudProcessInfo = {
  found: boolean
  /** true quando a falha foi de REDE/HTTP (≠ "processo não existe na base").
   *  A rodada de enriquecimento usa isso para reportar erro honesto no
   *  conector em vez de fingir que consultou e não achou. */
  networkError: boolean
  tribunal: string | null
  degree: string | null
  courtClass: string | null
  /** Código nacional da classe (TPU/SGT) — determinístico, útil para regras. */
  courtClassCode: number | null
  vara: string | null
  lastMovementText: string | null
  lastMovementAt: Date | null
  /** Código nacional do último movimento (TPU) — ex.: 193=sentença. */
  lastMovementCode: number | null
  /** nivelSigilo > 0 na base do CNJ → processo com restrição de publicidade. */
  isSealed: boolean
  /** Data de ajuizamento — candidata a openedAt quando o caso não tem. */
  filedAt: Date | null
}

/** UF por código TT da Justiça Estadual (J=8) no número CNJ. */
const STATE_COURT_ALIAS: Record<string, string> = {
  '01': 'tjac', '02': 'tjal', '03': 'tjap', '04': 'tjam', '05': 'tjba',
  '06': 'tjce', '07': 'tjdft', '08': 'tjes', '09': 'tjgo', '10': 'tjma',
  '11': 'tjmt', '12': 'tjms', '13': 'tjmg', '14': 'tjpa', '15': 'tjpb',
  '16': 'tjpr', '17': 'tjpe', '18': 'tjpi', '19': 'tjrj', '20': 'tjrn',
  '21': 'tjrs', '22': 'tjro', '23': 'tjrr', '24': 'tjsc', '25': 'tjse',
  '26': 'tjsp', '27': 'tjto',
}

/**
 * Deriva o alias do endpoint DataJud a partir do número CNJ.
 * NNNNNNN-DD.AAAA.J.TT.OOOO → J (justiça) + TT (tribunal).
 * Retorna null para segmentos não mapeados (o item fica sem enriquecimento — honesto).
 */
/** Justiça Militar estadual (J=9): MG, RS e SP têm TJM próprio. */
const MILITARY_COURT_ALIAS: Record<string, string> = {
  '13': 'tjmmg',
  '21': 'tjmrs',
  '26': 'tjmsp',
}

export function datajudAliasFromCnj(processNumber: string): string | null {
  const digits = processNumber.replace(/\D/g, '')
  if (digits.length !== 20) return null
  const j = digits.charAt(13)
  const tt = digits.substring(14, 16)
  if (j === '8') return STATE_COURT_ALIAS[tt] ?? null
  if (j === '4') {
    const n = Number(tt)
    return n >= 1 && n <= 6 ? `trf${n}` : null
  }
  if (j === '3') return 'stj'
  // Justiça Militar da União (STM) e estadual — relevante em criminal.
  if (j === '7') return 'stm'
  if (j === '9') return MILITARY_COURT_ALIAS[tt] ?? null
  return null
}

type DatajudClientConfig = {
  apiKey: string
  baseUrl: string
}

export function createDatajudConfig(): DatajudClientConfig | null {
  const apiKey = process.env['DATAJUD_API_KEY']
  if (!apiKey) return null
  return {
    apiKey,
    baseUrl: process.env['DATAJUD_API_URL'] ?? 'https://api-publica.datajud.cnj.jus.br',
  }
}

/**
 * Consulta um processo por CNJ. Nunca lança — erros viram { found: false }
 * com warning logado (o enriquecimento em lote não pode parar por um item).
 */
export async function fetchDatajudProcess(
  config: DatajudClientConfig,
  processNumber: string
): Promise<DatajudProcessInfo> {
  const empty: DatajudProcessInfo = {
    found: false,
    networkError: false,
    tribunal: null,
    degree: null,
    courtClass: null,
    courtClassCode: null,
    vara: null,
    lastMovementText: null,
    lastMovementAt: null,
    lastMovementCode: null,
    isSealed: false,
    filedAt: null,
  }

  const alias = datajudAliasFromCnj(processNumber)
  if (!alias) return empty

  const digits = processNumber.replace(/\D/g, '')

  try {
    const controller = new AbortController()
    // Timeout curto de propósito: quando o cluster do CNJ está fora, o gateway
    // deixa a busca pendurada indefinidamente (diagnóstico 03/07/2026).
    const timer = setTimeout(() => controller.abort(), 12_000)
    const res = await fetch(`${config.baseUrl}/api_publica_${alias}/_search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `APIKey ${config.apiKey}`,
        'User-Agent': 'ExecFlow/1.0 (painel juridico; contato via CNJ cadastro)',
      },
      body: JSON.stringify({ query: { match: { numeroProcesso: digits } }, size: 2 }),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      console.warn(`[datajud] HTTP ${res.status} para ${processNumber} (${alias})`)
      return { ...empty, networkError: true }
    }

    const body = (await res.json()) as {
      hits?: { hits?: Array<{ _source?: Record<string, unknown> }> }
    }
    const source = body.hits?.hits?.[0]?._source
    if (!source) return empty

    const classe = source['classe'] as { codigo?: number; nome?: string } | undefined
    const orgao = source['orgaoJulgador'] as { nome?: string } | undefined
    const movimentos =
      (source['movimentos'] as Array<{ codigo?: number; nome?: string; dataHora?: string }> | undefined) ?? []

    // Última movimentação = a de dataHora mais recente (com código TPU nacional).
    let lastMovementText: string | null = null
    let lastMovementAt: Date | null = null
    let lastMovementCode: number | null = null
    for (const mov of movimentos) {
      if (!mov.dataHora) continue
      const at = new Date(mov.dataHora)
      if (isNaN(at.getTime())) continue
      if (lastMovementAt === null || at > lastMovementAt) {
        lastMovementAt = at
        lastMovementText = mov.nome ?? null
        lastMovementCode = typeof mov.codigo === 'number' ? mov.codigo : null
      }
    }

    const nivelSigilo = Number(source['nivelSigilo'] ?? 0)
    const dataAjuizamento = source['dataAjuizamento']
      ? new Date(String(source['dataAjuizamento']))
      : null

    return {
      found: true,
      networkError: false,
      tribunal: (source['tribunal'] as string | undefined)?.toUpperCase() ?? alias.toUpperCase(),
      degree: (source['grau'] as string | undefined) ?? null,
      courtClass: classe?.nome ?? null,
      courtClassCode: typeof classe?.codigo === 'number' ? classe.codigo : null,
      vara: orgao?.nome ?? null,
      lastMovementText,
      lastMovementAt,
      lastMovementCode,
      isSealed: Number.isFinite(nivelSigilo) && nivelSigilo > 0,
      filedAt: dataAjuizamento !== null && !isNaN(dataAjuizamento.getTime()) ? dataAjuizamento : null,
    }
  } catch (err) {
    console.warn(`[datajud] Falha ao consultar ${processNumber}:`, err instanceof Error ? err.message : err)
    return { ...empty, networkError: true }
  }
}

/** Uma movimentação individual da timeline do DataJud (código TPU nacional). */
export type DatajudMovement = {
  codigo: number | null
  nome: string
  dataHora: Date
  /** Chave estável para dedup: código + timestamp (ms). */
  dedupKey: string
}

export type DatajudMovementsResult = {
  found: boolean
  networkError: boolean
  movements: DatajudMovement[]
}

/**
 * Retorna a LISTA COMPLETA de movimentações de um processo, ordenada por data.
 * Usada pelo sync de casos (diff contra a timeline já existente).
 */
export async function fetchDatajudMovements(
  config: DatajudClientConfig,
  processNumber: string
): Promise<DatajudMovementsResult> {
  const empty: DatajudMovementsResult = { found: false, networkError: false, movements: [] }
  const alias = datajudAliasFromCnj(processNumber)
  if (!alias) return empty
  const digits = processNumber.replace(/\D/g, '')

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12_000)
    const res = await fetch(`${config.baseUrl}/api_publica_${alias}/_search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `APIKey ${config.apiKey}`,
        'User-Agent': 'ExecFlow/1.0 (painel juridico)',
      },
      body: JSON.stringify({ query: { match: { numeroProcesso: digits } }, size: 1 }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return { ...empty, networkError: true }

    const body = (await res.json()) as {
      hits?: { hits?: Array<{ _source?: Record<string, unknown> }> }
    }
    const source = body.hits?.hits?.[0]?._source
    if (!source) return empty

    const raw =
      (source['movimentos'] as Array<{ codigo?: number; nome?: string; dataHora?: string }> | undefined) ?? []
    const movements: DatajudMovement[] = []
    for (const mov of raw) {
      if (!mov.dataHora || !mov.nome) continue
      const at = new Date(mov.dataHora)
      if (isNaN(at.getTime())) continue
      const codigo = typeof mov.codigo === 'number' ? mov.codigo : null
      movements.push({
        codigo,
        nome: mov.nome,
        dataHora: at,
        dedupKey: `datajud:${codigo ?? 'x'}:${at.getTime()}`,
      })
    }
    movements.sort((a, b) => a.dataHora.getTime() - b.dataHora.getTime())
    return { found: true, networkError: false, movements }
  } catch (err) {
    console.warn(`[datajud] Falha ao buscar movimentos de ${processNumber}:`, err instanceof Error ? err.message : err)
    return { ...empty, networkError: true }
  }
}
