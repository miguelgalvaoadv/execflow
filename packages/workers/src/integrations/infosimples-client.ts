/**
 * Cliente InfoSimples — consultas processuais pagas (eles resolvem captcha/scraping).
 *
 * Autenticação: token via env INFOSIMPLES_TOKEN (NUNCA em chat/log/git).
 *
 * Endpoint usado para o TJSP (São Paulo): `tribunal/tjsp/primeiro-grau`.
 * É o ÚNICO que busca por OAB e já devolve, por processo: número, classe, foro,
 * vara, executado (o réu = cliente), e últimas movimentações. R$0,20/página,
 * 25 processos/página. Verificado ao vivo 04/07/2026 com a OAB 206292 (10 pág.).
 *
 * SEEU (`cnj/seeu/processos`) fica disponível como fallback para tribunais que
 * usam SEEU (não é o caso do TJSP) — busca por número/CPF/nome, R$0,24.
 *
 * Sem token → desabilitado com aviso (nunca derruba o worker).
 */

import { setDefaultResultOrder } from 'node:dns'
try {
  setDefaultResultOrder('ipv4first')
} catch {
  /* Node < 17 */
}

const BASE = 'https://api.infosimples.com/api/v2/consultas'

export function createInfosimplesConfig(): { token: string } | null {
  const token = process.env['INFOSIMPLES_TOKEN']
  if (!token) return null
  return { token }
}

export type InfosimplesMovement = { data: string; movimento: string }

export type InfosimplesProcess = {
  processo: string
  classe: string | null
  assunto: string | null
  foro: string | null
  vara: string | null
  /** Nome do executado/réu, já limpo (sem "Advogado: ..."). */
  clientName: string | null
  movimentacoes: InfosimplesMovement[]
  /** Texto bruto do executado, para diagnóstico. */
  executadoRaw: string | null
}

export type InfosimplesTjspResult = {
  ok: boolean
  networkError: boolean
  code: number
  message: string
  currentPage: number
  totalPages: number
  processes: InfosimplesProcess[]
}

/**
 * "Higor ... Advogado: X" / "Gabriel ... Def. Púb: DEFENSORIA" → só o nome.
 * O e-SAJ gruda o representante no campo do executado — cortamos no 1º rótulo.
 */
function cleanExecutado(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const name = raw
    .split(/\s+(?:Advogad[oa]s?|Def(?:ensor)?\.?\s*P[úu]b|Defensor[a]?|Representante|Curador[a]?)\s*:/i)[0]
    ?.replace(/\s+/g, ' ')
    .trim()
  return name && name.length > 1 ? name : null
}

/** dd/mm/yyyy → Date (meio-dia UTC para não trocar de dia por fuso). */
export function parseBrDate(s: string): Date | null {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (!m) return null
  const d = new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00Z`)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Busca uma página de processos por OAB no TJSP 1º grau.
 * Nunca lança — erros viram { networkError: true }.
 */
export async function fetchTjspByOab(
  config: { token: string },
  oab: string,
  page: number
): Promise<InfosimplesTjspResult> {
  const empty: InfosimplesTjspResult = {
    ok: false,
    networkError: false,
    code: 0,
    message: '',
    currentPage: page,
    totalPages: 0,
    processes: [],
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 90_000)
    const res = await fetch(`${BASE}/tribunal/tjsp/primeiro-grau`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: config.token, oab, pagina: String(page) }).toString(),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return { ...empty, networkError: true, code: res.status }

    const body = (await res.json()) as {
      code: number
      code_message: string
      data?: Array<{
        pagina_atual?: number
        paginas?: number
        processos?: Array<Record<string, unknown>>
      }>
    }

    // 600-family: erros da InfoSimples (612 = nada encontrado, 606 = params, etc.)
    if (body.code !== 200) {
      return { ...empty, code: body.code, message: body.code_message }
    }

    const d = body.data?.[0]
    const rawProcessos = d?.processos ?? []
    const processes: InfosimplesProcess[] = rawProcessos.map((p) => {
      const movs = (p['ultimas_movimentacoes'] as InfosimplesMovement[] | undefined) ?? []
      return {
        processo: String(p['processo'] ?? '').trim(),
        classe: (p['classe'] as string | undefined) ?? null,
        assunto: (p['assunto'] as string | undefined) ?? null,
        foro: (p['foro'] as string | undefined) ?? null,
        vara: (p['vara'] as string | undefined) ?? null,
        clientName: cleanExecutado(p['exectdo'] ?? p['indiciado'] ?? p['reqdo']),
        executadoRaw: (p['exectdo'] as string | undefined) ?? null,
        movimentacoes: movs
          .filter((m) => m && m.movimento)
          .map((m) => ({ data: String(m.data ?? ''), movimento: String(m.movimento ?? '') })),
      }
    })

    return {
      ok: true,
      networkError: false,
      code: 200,
      message: 'ok',
      currentPage: d?.pagina_atual ?? page,
      totalPages: d?.paginas ?? 1,
      processes: processes.filter((p) => p.processo !== ''),
    }
  } catch (err) {
    console.warn(`[infosimples] Falha OAB ${oab} pág ${page}:`, err instanceof Error ? err.message : err)
    return { ...empty, networkError: true }
  }
}
