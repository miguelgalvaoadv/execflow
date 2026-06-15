/**
 * WhatsApp Business Cloud API Client (Meta Graph API)
 *
 * Envia mensagens reais via WhatsApp Business usando a API oficial da Meta.
 * Documentação: https://developers.facebook.com/docs/whatsapp/cloud-api
 *
 * Variáveis de ambiente necessárias:
 * - WHATSAPP_API_TOKEN: Token de acesso do System User (Meta Business Manager)
 * - WHATSAPP_PHONE_NUMBER_ID: ID do número de telefone registrado no WhatsApp Business
 * - WHATSAPP_BUSINESS_ACCOUNT_ID: ID da conta WhatsApp Business (opcional)
 *
 * Custos:
 * - Mensagens de serviço (dentro da janela 24h do cliente): GRÁTIS
 * - Mensagens de template (fora da janela): ~R$0,25/msg
 */

const GRAPH_API_VERSION = 'v21.0'
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

export interface WhatsAppConfig {
  apiToken: string
  phoneNumberId: string
}

export interface WhatsAppMessageResult {
  messaging_product: string
  contacts: Array<{ input: string; wa_id: string }>
  messages: Array<{ id: string }>
}

export class WhatsAppMetaClient {
  private apiToken: string
  private phoneNumberId: string

  constructor(config?: Partial<WhatsAppConfig>) {
    this.apiToken = config?.apiToken || process.env['WHATSAPP_API_TOKEN'] || ''
    this.phoneNumberId = config?.phoneNumberId || process.env['WHATSAPP_PHONE_NUMBER_ID'] || ''
  }

  get isConfigured(): boolean {
    return Boolean(this.apiToken && this.phoneNumberId)
  }

  /**
   * Envia uma mensagem de texto simples via WhatsApp.
   */
  async sendTextMessage(to: string, body: string): Promise<WhatsAppMessageResult | null> {
    if (!this.isConfigured) {
      this.logMock(to, body)
      return null
    }

    const url = `${GRAPH_API_BASE}/${this.phoneNumberId}/messages`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: this.normalizePhone(to),
        type: 'text',
        text: {
          preview_url: true,
          body,
        },
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error(`[WhatsApp API] Erro ao enviar mensagem: ${response.status} ${error}`)
      throw new Error(`WhatsApp API Error: ${response.status}`)
    }

    const result = (await response.json()) as WhatsAppMessageResult
    console.log(`[WhatsApp API] ✅ Mensagem enviada para ${to} (ID: ${result.messages?.[0]?.id})`)
    return result
  }

  /**
   * Envia uma mensagem usando um template previamente aprovado pela Meta.
   * Templates devem ser criados e aprovados no WhatsApp Manager.
   */
  async sendTemplateMessage(
    to: string,
    templateName: string,
    language: string = 'pt_BR',
    parameters?: Array<{ type: string; text: string }>
  ): Promise<WhatsAppMessageResult | null> {
    if (!this.isConfigured) {
      this.logMock(to, `[TEMPLATE: ${templateName}] params: ${JSON.stringify(parameters)}`)
      return null
    }

    const url = `${GRAPH_API_BASE}/${this.phoneNumberId}/messages`

    const templateObj: any = {
      name: templateName,
      language: { code: language },
    }

    if (parameters && parameters.length > 0) {
      templateObj.components = [
        {
          type: 'body',
          parameters: parameters.map((p) => ({ type: 'text', text: p.text })),
        },
      ]
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: this.normalizePhone(to),
        type: 'template',
        template: templateObj,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error(`[WhatsApp API] Erro ao enviar template: ${response.status} ${error}`)
      throw new Error(`WhatsApp API Template Error: ${response.status}`)
    }

    const result = (await response.json()) as WhatsAppMessageResult
    console.log(`[WhatsApp API] ✅ Template "${templateName}" enviado para ${to}`)
    return result
  }

  /**
   * Envia uma mensagem interativa com botões de ação rápida.
   * Útil para o advogado responder direto do WhatsApp.
   */
  async sendInteractiveMessage(
    to: string,
    headerText: string,
    bodyText: string,
    buttons: Array<{ id: string; title: string }>
  ): Promise<WhatsAppMessageResult | null> {
    if (!this.isConfigured) {
      this.logMock(to, `[INTERACTIVE] ${headerText}\n${bodyText}\nBotões: ${buttons.map((b) => b.title).join(', ')}`)
      return null
    }

    const url = `${GRAPH_API_BASE}/${this.phoneNumberId}/messages`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: this.normalizePhone(to),
        type: 'interactive',
        interactive: {
          type: 'button',
          header: { type: 'text', text: headerText },
          body: { text: bodyText },
          action: {
            buttons: buttons.slice(0, 3).map((b) => ({
              type: 'reply',
              reply: { id: b.id, title: b.title.substring(0, 20) },
            })),
          },
        },
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error(`[WhatsApp API] Erro ao enviar interativa: ${response.status} ${error}`)
      throw new Error(`WhatsApp API Interactive Error: ${response.status}`)
    }

    return (await response.json()) as WhatsAppMessageResult
  }

  // ───────────────────────────────────────────────
  // Métodos auxiliares específicos do ExecFlow
  // ───────────────────────────────────────────────

  /**
   * Notifica sobre prazo vencendo ou vencido.
   */
  async notifyDeadlineAlert(
    phone: string,
    advogadoName: string,
    clientName: string,
    deadlineTitle: string,
    dueAt: string,
    status: 'warning' | 'overdue',
    dashboardUrl?: string
  ): Promise<void> {
    const icon = status === 'overdue' ? '🚨' : '⚠️'
    const statusText = status === 'overdue' ? 'venceu' : 'está próximo do vencimento'
    const dueDate = new Date(dueAt).toLocaleDateString('pt-BR')

    const message = [
      `${icon} *Lembrete de Prazo — ExecFlow*`,
      '',
      `Olá Dr(a). ${advogadoName},`,
      '',
      `O prazo referente ao cliente *${clientName}*:`,
      `📋 ${deadlineTitle}`,
      `📅 ${statusText} em *${dueDate}*`,
      '',
      dashboardUrl
        ? `🔗 Acesse o painel: ${dashboardUrl}`
        : '🔗 Acesse o painel do ExecFlow para atualizar o status.',
      '',
      '_Mensagem automática do ExecFlow._',
    ].join('\n')

    await this.sendTextMessage(phone, message)
  }

  /**
   * Notifica sobre nova movimentação no tribunal.
   */
  async notifyCourtMovement(
    phone: string,
    cnj: string,
    movementType: string,
    description: string,
    dashboardUrl?: string
  ): Promise<void> {
    const message = [
      '🏛️ *Nova Movimentação Processual — ExecFlow*',
      '',
      `*Processo:* ${cnj}`,
      `*Tipo:* ${movementType}`,
      `*Resumo:* ${description}`,
      '',
      dashboardUrl
        ? `🔗 Ver no painel: ${dashboardUrl}`
        : '🔗 Acesse o painel do ExecFlow para verificar oportunidades.',
      '',
      '_Mensagem automática do ExecFlow._',
    ].join('\n')

    await this.sendTextMessage(phone, message)
  }

  /**
   * Notifica sobre oportunidade detectada pelo motor.
   */
  async notifyOpportunityDetected(
    phone: string,
    clientName: string,
    opportunityType: string,
    summary: string,
    dashboardUrl?: string
  ): Promise<void> {
    const message = [
      '✨ *Oportunidade Detectada — ExecFlow*',
      '',
      `*Cliente:* ${clientName}`,
      `*Tipo:* ${opportunityType}`,
      `*Resumo:* ${summary}`,
      '',
      'O motor de cálculos do ExecFlow identificou que este cliente pode ter direito a um benefício.',
      '',
      dashboardUrl
        ? `🔗 Redigir petição: ${dashboardUrl}`
        : '🔗 Acesse o painel do ExecFlow para redigir a petição com IA.',
      '',
      '_Mensagem automática do ExecFlow._',
    ].join('\n')

    await this.sendTextMessage(phone, message)
  }

  // ───────────────────────────────────────────────
  // Helpers internos
  // ───────────────────────────────────────────────

  private normalizePhone(phone: string): string {
    // Remove tudo que não é dígito e adiciona código do país se necessário
    let digits = phone.replace(/\D/g, '')
    if (digits.startsWith('0')) digits = digits.substring(1)
    if (!digits.startsWith('55')) digits = '55' + digits
    return digits
  }

  private logMock(to: string, body: string): void {
    console.info(`\n══════════════════════════════════════════════════`)
    console.info(`📱 [WHATSAPP MOCK] Mensagem simulada`)
    console.info(`──────────────────────────────────────────────────`)
    console.info(`Para: ${to}`)
    console.info(`──────────────────────────────────────────────────`)
    console.info(body)
    console.info(`══════════════════════════════════════════════════\n`)
  }
}

/**
 * Factory helper — cria o client WhatsApp, funcionando em mock se não configurado.
 */
export function createWhatsAppClient(): WhatsAppMetaClient {
  const client = new WhatsAppMetaClient()
  if (!client.isConfigured) {
    console.warn(
      '[WhatsApp] API não configurada. Notificações funcionarão em modo simulado (console.log).'
    )
  }
  return client
}
