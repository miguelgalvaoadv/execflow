/**
 * Cliente do endpoint interno da API (worker → apps/api).
 *
 * Por que existe: a cadeia de reanálise (IA de oportunidades, tier, stale,
 * prazo provisório) vive em apps/api e o worker não pode importar de lá. Então
 * DataJud/DJEN empurram as movimentações novas por HTTP para
 * POST /api/v1/internal/case-movements, autenticado por INTERNAL_API_TOKEN.
 *
 * Sem EXECFLOW_API_URL + INTERNAL_API_TOKEN → desabilitado (aviso, sem crash).
 */

export type InternalMovementItem = {
  tipo: string
  conteudo: string
  occurredAt: string // ISO
  source: string
  kind: 'movimentacao' | 'intimacao'
  dedupKey: string
  link?: string | null
}

export type InternalIngestResult = {
  matched: boolean
  orphaned: number
  total: number
  processed: number
  duplicates: number
  markedStale: boolean
  opportunitiesCreated: number
  tiers: Array<'1' | '2' | '3' | null>
}

export function createInternalApiConfig(): { baseUrl: string; token: string } | null {
  const baseUrl = process.env['EXECFLOW_API_URL']
  const token = process.env['INTERNAL_API_TOKEN']
  if (!baseUrl || !token) return null
  return { baseUrl: baseUrl.replace(/\/$/, ''), token }
}

export type DiscoveredProcessPayload = {
  cnj: string
  clientName?: string | null
  courtName?: string | null
  jurisdiction?: string | null
  classe?: string | null
  source: string
  movements: Array<{ data: string; texto: string }>
}

export type RegisterResult = {
  clientsCreated: number
  casesCreated: number
  casesExisting: number
  casesArchived: number
  movementsInserted: number
  autosTasksCreated: number
  skipped: number
}

/** Registra em massa processos descobertos (InfoSimples) como casos. */
export async function pushRegisterCases(
  config: { baseUrl: string; token: string },
  processes: DiscoveredProcessPayload[]
): Promise<RegisterResult | null> {
  if (processes.length === 0) return null
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 120_000)
    const res = await fetch(`${config.baseUrl}/api/v1/internal/register-cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': config.token },
      body: JSON.stringify({ processes }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      console.warn(`[internal-api] register-cases HTTP ${res.status}`)
      return null
    }
    const body = (await res.json()) as { data: RegisterResult }
    return body.data
  } catch (err) {
    console.warn('[internal-api] Falha ao registrar casos:', err instanceof Error ? err.message : err)
    return null
  }
}

/** Dispara o backfill de "pedido de autos" para todos os casos sem autos. */
export async function pushBackfillAutosTasks(
  config: { baseUrl: string; token: string }
): Promise<{ evaluated: number; tasksCreated: number } | null> {
  try {
    const res = await fetch(`${config.baseUrl}/api/v1/internal/backfill-autos-tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': config.token },
      body: '{}',
    })
    if (!res.ok) return null
    const body = (await res.json()) as { data: { evaluated: number; tasksCreated: number } }
    return body.data
  } catch {
    return null
  }
}

/**
 * Envia movimentações novas de um processo para a reanálise.
 * Nunca lança — erros viram { matched:false } com warning (o sync em lote não
 * pode parar por causa de um caso).
 */
export async function pushCaseMovements(
  config: { baseUrl: string; token: string },
  cnj: string,
  movements: InternalMovementItem[]
): Promise<InternalIngestResult> {
  const fail: InternalIngestResult = {
    matched: false,
    orphaned: 0,
    total: 0,
    processed: 0,
    duplicates: 0,
    markedStale: false,
    opportunitiesCreated: 0,
    tiers: [],
  }
  if (movements.length === 0) return fail

  try {
    const controller = new AbortController()
    // Generoso: a reanálise pode chamar a IA (Claude) para várias movimentações.
    const timer = setTimeout(() => controller.abort(), 120_000)
    const res = await fetch(`${config.baseUrl}/api/v1/internal/case-movements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': config.token,
      },
      body: JSON.stringify({ cnj, movements }),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      console.warn(`[internal-api] HTTP ${res.status} para ${cnj}`)
      return fail
    }
    return (await res.json()) as InternalIngestResult
  } catch (err) {
    console.warn(`[internal-api] Falha ao enviar movimentações de ${cnj}:`, err instanceof Error ? err.message : err)
    return fail
  }
}
