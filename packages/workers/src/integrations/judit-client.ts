/**
 * JUDIT API Client — Integração com a API de monitoramento processual JUDIT.
 *
 * Documentação oficial: https://docs.judit.io
 *
 * Serviços utilizados:
 * - Requests (https://requests.production.judit.io) — consultas assíncronas
 * - Tracking (https://tracking.production.judit.io) — monitoramento contínuo
 * - Lawsuits (https://lawsuits.production.judit.io) — dados do datalake
 *
 * Autenticação: Header `api-key: <JUDIT_API_KEY>`
 */

const REQUESTS_BASE = 'https://requests.production.judit.io'
const TRACKING_BASE = 'https://tracking.production.judit.io'
const LAWSUITS_BASE = 'https://lawsuits.production.judit.io'

export type JuditSearchType = 'cpf' | 'cnpj' | 'oab' | 'name' | 'lawsuit_cnj' | 'lawsuit_id' | 'custom'

export interface JuditTrackingConfig {
  /** Tipo de busca (normalmente 'lawsuit_cnj' para execução penal) */
  searchType: JuditSearchType
  /** O valor buscado (ex: número CNJ do processo) */
  searchValue: string
  /** URL de callback para receber notificações de movimentações */
  callbackUrl: string
  /** Recorrência de verificação: 'daily', 'weekly', etc. */
  recurrence?: 'daily' | 'weekly' | 'biweekly' | 'monthly'
  /** Filtro por tipo de tribunal */
  courtFilter?: string
}

export interface JuditWebhookPayload {
  /** ID do response no JUDIT */
  response_id: string
  /** ID da request que originou */
  request_id: string
  /** ID do tracking (se veio de monitoramento) */
  origin_id?: string
  /** Se veio do cache ou do tribunal direto */
  cached_response: boolean
  /** Objeto do processo com movimentações */
  lawsuit?: {
    cnj: string
    court?: string
    instance?: number
    jurisdiction?: string
    subject?: string
    status?: string
    steps?: Array<{
      date: string
      type: string
      description: string
      attachments?: Array<{
        id: string
        name: string
        url?: string
      }>
    }>
    parties?: Array<{
      name: string
      role: string
      cpf_cnpj?: string
      lawyers?: Array<{
        name: string
        oab?: string
      }>
    }>
  }
}

export interface JuditRequestResult {
  id: string
  status: string
  search_type: string
  search_value: string
  created_at: string
  updated_at: string
}

export interface JuditTrackingResult {
  id: string
  status: 'active' | 'paused' | 'deleted'
  search_type: string
  search_value: string
  recurrence: string
  callback_url?: string
  created_at: string
}

export class JuditClient {
  private apiKey: string

  constructor(apiKey?: string) {
    const key = apiKey || process.env['JUDIT_API_KEY']
    if (!key) {
      throw new Error(
        'JUDIT_API_KEY não configurada. Solicite em: https://api.whatsapp.com/send/?phone=5521985284143'
      )
    }
    this.apiKey = key
  }

  private async request<T>(
    baseUrl: string,
    path: string,
    options: {
      method?: string
      body?: unknown
      queryParams?: Record<string, string>
    } = {}
  ): Promise<T> {
    const { method = 'GET', body, queryParams } = options
    const url = new URL(path, baseUrl)

    if (queryParams) {
      Object.entries(queryParams).forEach(([key, value]) => {
        url.searchParams.set(key, value)
      })
    }

    const headers: Record<string, string> = {
      'api-key': this.apiKey,
      'Content-Type': 'application/json',
    }

    const fetchOptions: RequestInit = { method, headers }
    if (body) {
      fetchOptions.body = JSON.stringify(body)
    }

    const response = await fetch(url.toString(), fetchOptions)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`[JUDIT API] ${response.status} ${response.statusText}: ${errorText}`)
    }

    return (await response.json()) as T
  }

  // ───────────────────────────────────────────────
  // REQUESTS — Consulta assíncrona por CNJ
  // ───────────────────────────────────────────────

  /**
   * Cria uma consulta assíncrona ao tribunal.
   * O resultado será entregue via webhook ou polling.
   */
  async createRequest(config: {
    searchType: JuditSearchType
    searchValue: string
    callbackUrl?: string
  }): Promise<JuditRequestResult> {
    return this.request<JuditRequestResult>(REQUESTS_BASE, '/requests', {
      method: 'POST',
      body: {
        search: {
          search_type: config.searchType,
          search_value: config.searchValue,
        },
        ...(config.callbackUrl ? { callback_url: config.callbackUrl } : {}),
      },
    })
  }

  /**
   * Busca o resultado de uma consulta já feita.
   */
  async getRequestResult(requestId: string): Promise<any> {
    return this.request(REQUESTS_BASE, `/requests/${requestId}`)
  }

  /**
   * Lista resultados disponíveis.
   */
  async listResponses(page = 1, perPage = 20): Promise<any> {
    return this.request(REQUESTS_BASE, '/responses', {
      queryParams: { page: String(page), per_page: String(perPage) },
    })
  }

  // ───────────────────────────────────────────────
  // TRACKING — Monitoramento contínuo
  // ───────────────────────────────────────────────

  /**
   * Cria um monitoramento contínuo para um processo.
   * O JUDIT verificará o tribunal periodicamente e enviará um webhook
   * quando houver novas movimentações.
   */
  async createTracking(config: JuditTrackingConfig): Promise<JuditTrackingResult> {
    return this.request<JuditTrackingResult>(TRACKING_BASE, '/tracking', {
      method: 'POST',
      body: {
        search: {
          search_type: config.searchType,
          search_value: config.searchValue,
        },
        recurrence: config.recurrence || 'daily',
        callback_url: config.callbackUrl,
      },
    })
  }

  /**
   * Cria monitoramentos em lote (para importar vários casos de uma vez).
   */
  async createBulkTracking(configs: JuditTrackingConfig[]): Promise<JuditTrackingResult[]> {
    const items = configs.map((c) => ({
      search: {
        search_type: c.searchType,
        search_value: c.searchValue,
      },
      recurrence: c.recurrence || 'daily',
      callback_url: c.callbackUrl,
    }))

    return this.request<JuditTrackingResult[]>(TRACKING_BASE, '/tracking/bulk', {
      method: 'POST',
      body: { items },
    })
  }

  /**
   * Lista todos os monitoramentos ativos.
   */
  async listTracking(page = 1, perPage = 50): Promise<{ data: JuditTrackingResult[]; total: number }> {
    return this.request(TRACKING_BASE, '/tracking', {
      queryParams: { page: String(page), per_page: String(perPage) },
    })
  }

  /**
   * Busca um monitoramento específico.
   */
  async getTracking(trackingId: string): Promise<JuditTrackingResult> {
    return this.request<JuditTrackingResult>(TRACKING_BASE, `/tracking/${trackingId}`)
  }

  /**
   * Pausa um monitoramento.
   */
  async pauseTracking(trackingId: string): Promise<void> {
    await this.request(TRACKING_BASE, `/tracking/${trackingId}/pause`, { method: 'POST' })
  }

  /**
   * Retoma um monitoramento pausado.
   */
  async resumeTracking(trackingId: string): Promise<void> {
    await this.request(TRACKING_BASE, `/tracking/${trackingId}/resume`, { method: 'POST' })
  }

  /**
   * Remove um monitoramento.
   */
  async deleteTracking(trackingId: string): Promise<void> {
    await this.request(TRACKING_BASE, `/tracking/${trackingId}`, { method: 'DELETE' })
  }

  // ───────────────────────────────────────────────
  // LAWSUITS — Leitura do datalake (síncrono)
  // ───────────────────────────────────────────────

  /**
   * Busca um processo pelo CNJ no datalake JUDIT (resposta síncrona).
   */
  async getLawsuitByCNJ(cnj: string): Promise<any> {
    return this.request(LAWSUITS_BASE, `/lawsuits/${encodeURIComponent(cnj)}`)
  }

  /**
   * Busca dados cadastrais por CPF ou CNPJ.
   */
  async getEntityData(document: string): Promise<any> {
    const docType = document.replace(/\D/g, '').length <= 11 ? 'cpf' : 'cnpj'
    return this.request(LAWSUITS_BASE, '/entities', {
      method: 'POST',
      body: {
        search: {
          search_type: docType,
          search_value: document.replace(/\D/g, ''),
        },
      },
    })
  }
}

/**
 * Factory helper — cria cliente JUDIT com fallback para mock quando não há API key.
 */
export function createJuditClient(): JuditClient | null {
  const key = process.env['JUDIT_API_KEY']
  if (!key) {
    console.warn(
      '[JUDIT] API Key não configurada. Monitoramento de tribunais funcionará em modo simulado.'
    )
    return null
  }
  return new JuditClient(key)
}
