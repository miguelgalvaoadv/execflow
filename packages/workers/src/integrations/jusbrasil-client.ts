/**
 * Jusbrasil API Client — Integração com a API Jurídica do Jusbrasil.
 *
 * Documentação: https://api.jusbrasil.com.br/docs/
 * Para obter token: suportesolucoes@jusbrasil.com.br
 *
 * Autenticação: header `Authorization: Bearer <JUSBRASIL_API_KEY>`
 * Formato do token: UUID (ex: 0bb5e3a5-cd56-46c1-8552-061839f07aaa)
 *
 * IMPORTANTE — verificação de endpoints:
 * Os caminhos abaixo refletem a estrutura mais provável da API Jusbrasil/Digesto.
 * Confirme os paths exatos na documentação ao conectar sua chave real.
 * Todos os endpoints estão centralizados em JUSBRASIL_PATHS para ajuste fácil.
 *
 * URL base padrão: https://api.jusbrasil.com.br
 * Alternativa Digesto: https://op.digesto.com.br/api
 * Sobrescreva via variável JUSBRASIL_API_URL.
 */

const JUSBRASIL_BASE =
  process.env['JUSBRASIL_API_URL'] ?? 'https://api.jusbrasil.com.br'

const JUSBRASIL_PATHS = {
  /** GET processo por número CNJ (capa, partes, movimentações). */
  processByCnj: (cnj: string) =>
    `/processos?numero_cnj=${encodeURIComponent(cnj)}`,
  /** GET movimentações do processo por CNJ. */
  processMovements: (cnj: string) =>
    `/processos/${encodeURIComponent(cnj)}/movimentacoes`,
  /** Monitoramento de processos (subscribe/unsubscribe). Dispara webhook em nova movimentação. */
  monitoring: '/monitoramentos',
  monitoringById: (id: string | number) => `/monitoramentos/${id}`,
} as const

export interface JusbrasilMovement {
  data?: string
  tipo?: string
  descricao?: string
  conteudo?: string
  complemento?: string
}

export interface JusbrasilMonitoring {
  id: string | number
  numero_cnj?: string
  status?: string
  url_callback?: string
  criado_em?: string
}

/**
 * Payload do CALLBACK que o Jusbrasil envia ao ExecFlow quando há novidade.
 * Configure a URL de callback no painel/contrato e valide com o token de segurança.
 *
 * Nota: o schema exato pode variar — este é tolerante a variações de campo.
 */
export interface JusbrasilCallbackPayload {
  event?: string
  tipo?: string
  numero_cnj?: string
  processo?: {
    numero_cnj?: string
    tribunal?: string
    classe?: string
    titulo_polo_ativo?: string
    titulo_polo_passivo?: string
    numero?: string
    id?: string | number
  }
  movimentacoes?: JusbrasilMovement[]
  andamentos?: JusbrasilMovement[]
}

export interface JusbrasilProcessSummary {
  tribunal: string | null
  classe: string | null
  assunto: string | null
  poloAtivo: string | null
  poloPassivo: string | null
  segredoJustica: boolean | null
  autosLinks: string[]
}

export class JusbrasilClient {
  private apiKey: string

  constructor(apiKey?: string) {
    const key = apiKey || process.env['JUSBRASIL_API_KEY']
    if (!key) {
      throw new Error(
        'JUSBRASIL_API_KEY não configurada. Obtenha em https://api.jusbrasil.com.br/ ou contate suportesolucoes@jusbrasil.com.br'
      )
    }
    this.apiKey = key
  }

  private async request<T>(
    path: string,
    options: {
      method?: string
      body?: unknown
      queryParams?: Record<string, string>
    } = {}
  ): Promise<{ data: T }> {
    const { method = 'GET', body, queryParams } = options
    const url = new URL(JUSBRASIL_BASE + path)

    if (queryParams) {
      Object.entries(queryParams).forEach(([k, v]) => url.searchParams.set(k, v))
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }

    const fetchOptions: RequestInit = { method, headers }
    if (body !== undefined) {
      fetchOptions.body = JSON.stringify(body)
    }

    const response = await fetch(url.toString(), fetchOptions)

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `[Jusbrasil API] ${response.status} ${response.statusText}: ${errorText}`
      )
    }

    const data = (await response.json()) as T
    return { data }
  }

  // ───────────────────────────────────────────────
  // PROCESSOS — consulta e movimentações
  // ───────────────────────────────────────────────

  /** Consulta um processo pelo número CNJ (capa, partes, dados básicos). */
  async getProcessByCnj(cnj: string): Promise<{ data: unknown }> {
    return this.request(JUSBRASIL_PATHS.processByCnj(cnj))
  }

  /** Lista as movimentações de um processo pelo número CNJ. */
  async getProcessMovements(cnj: string): Promise<{
    data: { items?: JusbrasilMovement[]; movimentacoes?: JusbrasilMovement[] }
  }> {
    return this.request(JUSBRASIL_PATHS.processMovements(cnj))
  }

  // ───────────────────────────────────────────────
  // MONITORAMENTO — webhook em nova movimentação
  // ───────────────────────────────────────────────

  /**
   * Cria um monitoramento contínuo de um processo por CNJ.
   * Quando houver nova movimentação, o Jusbrasil chama a URL de callback
   * informada (nosso endpoint `/api/v1/webhooks/jusbrasil`).
   */
  async createMonitoring(
    cnj: string,
    callbackUrl?: string
  ): Promise<JusbrasilMonitoring> {
    const body: Record<string, unknown> = { numero_cnj: cnj }
    if (callbackUrl) body['url_callback'] = callbackUrl
    const { data } = await this.request<JusbrasilMonitoring>(
      JUSBRASIL_PATHS.monitoring,
      { method: 'POST', body }
    )
    return data
  }

  /** Lista os monitoramentos ativos. */
  async listMonitorings(): Promise<JusbrasilMonitoring[]> {
    const { data } = await this.request<
      JusbrasilMonitoring[] | { items?: JusbrasilMonitoring[] }
    >(JUSBRASIL_PATHS.monitoring)
    return Array.isArray(data) ? data : (data.items ?? [])
  }

  /** Remove um monitoramento. */
  async deleteMonitoring(id: string | number): Promise<void> {
    await this.request(JUSBRASIL_PATHS.monitoringById(id), { method: 'DELETE' })
  }

  // ───────────────────────────────────────────────
  // DOWNLOAD DE PDF (autos / documentos)
  // ───────────────────────────────────────────────

  /**
   * Baixa o PDF de um documento a partir de uma URL (pública ou autenticada).
   * Links de PDF vêm na resposta de getProcessByCnj quando disponíveis.
   */
  async downloadFile(fileUrl: string): Promise<Buffer> {
    const response = await fetch(fileUrl, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    })
    if (!response.ok) {
      throw new Error(
        `[Jusbrasil API] Falha ao baixar arquivo: ${response.status} ${response.statusText}`
      )
    }
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }
}

/**
 * Resumo da "capa" do processo, extraído de forma defensiva da resposta do
 * Jusbrasil (os nomes de campo variam entre fontes/tribunais).
 */

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  return null
}

function collectPdfLinks(node: unknown, acc: Set<string>, depth = 0): void {
  if (depth > 6 || node == null) return
  if (typeof node === 'string') {
    if (/^https?:\/\/\S+\.pdf(\?\S*)?$/i.test(node)) acc.add(node)
    return
  }
  if (Array.isArray(node)) {
    for (const item of node) collectPdfLinks(item, acc, depth + 1)
    return
  }
  if (typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) {
      collectPdfLinks(v, acc, depth + 1)
    }
  }
}

/**
 * Extrai capa, partes e links de documentos da resposta de getProcessByCnj.
 * Tolerante a variações de schema entre fontes do Jusbrasil.
 */
export function extractProcessSummary(data: unknown): JusbrasilProcessSummary {
  const root: any =
    data && typeof data === 'object' && 'data' in (data as any)
      ? (data as any).data
      : data

  const resultado: any = Array.isArray(root?.resultados)
    ? root.resultados[0]
    : root?.resultado ?? root?.processo ?? root

  const partes: any[] =
    resultado?.partes ?? root?.partes ?? resultado?.envolvidos ?? root?.envolvidos ?? []
  const ativo = partes.find((e: any) =>
    String(e?.polo ?? e?.tipo ?? e?.participacao ?? '').toLowerCase().includes('ativo')
  )
  const passivo = partes.find((e: any) =>
    String(e?.polo ?? e?.tipo ?? e?.participacao ?? '').toLowerCase().includes('passivo')
  )

  const pdfs = new Set<string>()
  collectPdfLinks(root, pdfs)

  const sigilo = firstString(resultado?.nivel_sigilo, root?.nivel_sigilo, resultado?.segredo_justica)
  const segredoJustica =
    typeof resultado?.segredo_justica === 'boolean'
      ? resultado.segredo_justica
      : sigilo != null
        ? sigilo !== '0' && sigilo.toLowerCase() !== 'false' && sigilo.toLowerCase() !== 'publico'
        : null

  return {
    tribunal: firstString(resultado?.tribunal, root?.tribunal, resultado?.sigla_tribunal),
    classe: firstString(resultado?.classe, root?.classe, resultado?.classe_processual),
    assunto: firstString(resultado?.assunto, root?.assunto),
    poloAtivo: firstString(ativo?.nome, ativo?.nome_normalizado),
    poloPassivo: firstString(passivo?.nome, passivo?.nome_normalizado),
    segredoJustica,
    autosLinks: [...pdfs],
  }
}

/**
 * Extrai movimentações da resposta da API, tolerando diferentes campos.
 */
export function extractMovements(data: unknown): JusbrasilMovement[] {
  const root: any =
    data && typeof data === 'object' && 'data' in (data as any)
      ? (data as any).data
      : data
  return root?.items ?? root?.movimentacoes ?? root?.andamentos ?? root?.resultados ?? []
}

/**
 * Factory — cria o cliente Jusbrasil, ou null se a chave não estiver configurada.
 */
export function createJusbrasilClient(): JusbrasilClient | null {
  const key = process.env['JUSBRASIL_API_KEY']
  if (!key) {
    console.warn(
      '[Jusbrasil] JUSBRASIL_API_KEY não configurada. Integração com tribunais em modo simulado.'
    )
    return null
  }
  return new JusbrasilClient(key)
}
