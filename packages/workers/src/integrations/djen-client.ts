/**
 * Cliente DJEN / Comunica (comunicaapi.pje.jus.br) — intimações oficiais.
 *
 * É o Diário de Justiça Eletrônico Nacional. Canal OFICIAL de intimações desde
 * nov/2024. Consulta por número de OAB — GRÁTIS, SEM CNPJ, SEM autenticação.
 * Ideal para advogado que não tem API da AASP.
 *
 * Verificado ao vivo (03/07/2026): GET /api/v1/comunicacao?numeroOab&ufOab
 * → 200, sem chave. Campos úteis: numero_processo, tipoComunicacao,
 * data_disponibilizacao (termo do prazo!), texto (HTML), hash (dedup), link.
 *
 * BLOQUEADO desde ~06/07/2026: proteção anti-bot (WAF na frente do CloudFront)
 * passou a barrar este endpoint filtrado por OAB — testado de 3 redes
 * diferentes (residencial BR, datacenter Render, infra Anthropic), todas
 * bloqueadas (403 ou travamento em renegociação TLS). O sync em produção usa
 * `djen-caderno-client.ts` (baixa o Diário do dia inteiro e filtra local, sem
 * bloqueio). `fetchDjenIntimacoes` fica aqui só de referência/fallback manual
 * — não é mais chamada por nenhum consumer.
 */

import { setDefaultResultOrder } from 'node:dns'
try {
  setDefaultResultOrder('ipv4first')
} catch {
  /* Node < 17 */
}

export type DjenIntimacao = {
  /** CNJ só dígitos. */
  processNumber: string
  tipoComunicacao: string
  /** Data de disponibilização (YYYY-MM-DD) — termo inicial do prazo. */
  dataDisponibilizacao: Date
  siglaTribunal: string | null
  nomeOrgao: string | null
  /** Texto da intimação (ainda em HTML — limpo na ingestão). */
  texto: string
  link: string | null
  /** hash oficial do DJEN — chave de dedup perfeita. */
  hash: string
}

export type DjenQueryResult = {
  found: boolean
  networkError: boolean
  intimacoes: DjenIntimacao[]
}

export type DjenOab = { numero: string; uf: string }

/** Lê as OABs a monitorar de DJEN_OABS (fallback; a fonte primária é oab_profiles). */
export function parseDjenOabsFromEnv(): DjenOab[] {
  const raw = process.env['DJEN_OABS']
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((token) => {
      const [numero, uf] = token.split('/')
      return { numero: (numero ?? '').trim(), uf: (uf ?? '').trim().toUpperCase() }
    })
    .filter((o) => o.numero !== '' && o.uf.length === 2)
}

export function isDjenEnabled(): boolean {
  return process.env['DJEN_ENABLED'] !== 'false'
}

const BASE_URL = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao'

/**
 * Busca intimações de uma OAB nos últimos `days` dias.
 * Nunca lança — erros viram { networkError: true }.
 */
export async function fetchDjenIntimacoes(
  oab: DjenOab,
  options: { days?: number; maxItems?: number } = {}
): Promise<DjenQueryResult> {
  const empty: DjenQueryResult = { found: false, networkError: false, intimacoes: [] }
  const days = options.days ?? 7
  const maxItems = options.maxItems ?? 100

  const since = new Date(Date.now() - days * 86_400_000)
  const dataIni = since.toISOString().slice(0, 10)

  const params = new URLSearchParams({
    numeroOab: oab.numero,
    ufOab: oab.uf,
    dataDisponibilizacaoInicio: dataIni,
    itensPorPagina: String(maxItems),
    pagina: '1',
  })

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    const res = await fetch(`${BASE_URL}?${params.toString()}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'ExecFlow/1.0' },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      console.warn(`[djen] HTTP ${res.status} para OAB ${oab.numero}/${oab.uf}`)
      return { ...empty, networkError: true }
    }

    const body = (await res.json()) as {
      status?: string
      items?: Array<Record<string, unknown>>
    }
    const items = body.items ?? []
    const intimacoes: DjenIntimacao[] = []
    for (const it of items) {
      const processNumber = String(it['numero_processo'] ?? '').replace(/\D/g, '')
      const dataRaw = String(it['data_disponibilizacao'] ?? it['datadisponibilizacao'] ?? '')
      const dt = dataRaw ? new Date(`${dataRaw}T12:00:00Z`) : null
      const hash = String(it['hash'] ?? it['id'] ?? '')
      if (!processNumber || !dt || isNaN(dt.getTime()) || !hash) continue
      intimacoes.push({
        processNumber,
        tipoComunicacao: String(it['tipoComunicacao'] ?? 'Intimação'),
        dataDisponibilizacao: dt,
        siglaTribunal: (it['siglaTribunal'] as string | undefined) ?? null,
        nomeOrgao: (it['nomeOrgao'] as string | undefined) ?? null,
        texto: String(it['texto'] ?? ''),
        link: (it['link'] as string | undefined) ?? null,
        hash,
      })
    }
    return { found: true, networkError: false, intimacoes }
  } catch (err) {
    console.warn(`[djen] Falha ao consultar OAB ${oab.numero}/${oab.uf}:`, err instanceof Error ? err.message : err)
    return { ...empty, networkError: true }
  }
}
