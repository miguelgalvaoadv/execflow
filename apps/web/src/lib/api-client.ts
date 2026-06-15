/**
 * EXECFLOW API client — typed fetch wrapper.
 *
 * All requests are sent with:
 * - credentials: 'include'  (Better Auth HttpOnly session cookie)
 * - X-Organization-Id       (org-scoped endpoint enforcement)
 * - Content-Type: application/json (for mutations)
 *
 * Business logic, legal calculations, and queue derivation logic
 * remain exclusively on the backend. This client only transports
 * data to and from operational API projections.
 *
 * Architecture ref: technical-stack-decision.md §1 (frontend layer),
 *                   AI_BOUNDARIES.md (no frontend legal logic).
 */

/**
 * Em runtime no browser: usa URL relativa ('/') para que as requisições
 * passem pelo proxy reverso do Next.js (next.config.ts) em localhost:3000.
 * Isso garante que o cookie SameSite=Lax seja enviado (mesma origem).
 *
 * Em runtime no servidor (SSR): usa a URL completa da API.
 */
const apiBase = (): string => {
  if (typeof window !== 'undefined') {
    // Browser: URL relativa → proxy Next.js → cookie vai junto
    return ''
  }
  // SSR / edge: URL absoluta
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type RequestOptions = {
  /** Organization UUID — required for all org-scoped endpoints. */
  organizationId?: string
  /** Request signal for cancellation. */
  signal?: AbortSignal
}

async function request<T>(
  path: string,
  init: RequestInit,
  opts: RequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(opts.organizationId !== undefined
      ? { 'X-Organization-Id': opts.organizationId }
      : {}),
    ...(init.headers as Record<string, string> | undefined),
  }

  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers,
    credentials: 'include',
    signal: opts.signal,
  })

  if (!res.ok) {
    let code = 'API_ERROR'
    let message = res.statusText
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch {
      // response body is not JSON — use status text
    }
    throw new ApiError(res.status, code, message)
  }

  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// GET helpers
// ---------------------------------------------------------------------------

export function apiGet<T>(
  path: string,
  opts?: RequestOptions & { params?: Record<string, string | number | undefined> }
): Promise<T> {
  const url = opts?.params !== undefined
    ? `${path}?${new URLSearchParams(
        Object.fromEntries(
          Object.entries(opts.params)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)])
        )
      ).toString()}`
    : path
  return request<T>(url, { method: 'GET' }, opts)
}

// ---------------------------------------------------------------------------
// POST / mutation helpers
// ---------------------------------------------------------------------------

export function apiPost<T>(
  path: string,
  body: unknown,
  opts?: RequestOptions
): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) }, opts)
}

export function apiPut<T>(
  path: string,
  body: unknown,
  opts?: RequestOptions
): Promise<T> {
  return request<T>(path, { method: 'PUT', body: JSON.stringify(body) }, opts)
}
