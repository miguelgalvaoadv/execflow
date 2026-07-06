import nodemailer from 'nodemailer'

export interface EmailConfig {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
}

export class EmailClient {
  private transporter: nodemailer.Transporter | null = null

  constructor(config?: Partial<EmailConfig>) {
    const user = config?.user || process.env['SMTP_USER']
    const pass = config?.pass || process.env['SMTP_PASS']
    const host = config?.host || process.env['SMTP_HOST'] || 'smtp.gmail.com'
    const port = config?.port || Number(process.env['SMTP_PORT'] || 465)

    if (user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      })
    }
  }

  get isConfigured(): boolean {
    return this.transporter !== null
  }

  async sendEmail(to: string, subject: string, htmlBody: string): Promise<void> {
    if (!this.isConfigured) {
      this.logMock(to, subject, htmlBody)
      return
    }

    try {
      const fromEmail = process.env['SMTP_USER'] || 'no-reply@execflow.app'
      const info = await this.transporter!.sendMail({
        from: `"ExecFlow Alertas" <${fromEmail}>`,
        to,
        subject,
        html: htmlBody,
      })
      console.log(`[Email API] ✅ E-mail enviado para ${to} (ID: ${info.messageId})`)
    } catch (error) {
      console.error(`[Email API] Falha ao enviar e-mail:`, error)
      throw error
    }
  }

  async notifyDeadlineAlert(
    to: string,
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

    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
        <h2 style="color: #d32f2f;">${icon} Lembrete de Prazo — ExecFlow</h2>
        <p>Olá Dr(a). <strong>${advogadoName}</strong>,</p>
        <p>O prazo referente ao cliente <strong>${clientName}</strong>:</p>
        <div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #d32f2f; margin: 15px 0;">
          <p style="margin: 0;"><strong>Tarefa:</strong> ${deadlineTitle}</p>
          <p style="margin: 5px 0 0 0;"><strong>Status:</strong> ${statusText} em <strong>${dueDate}</strong></p>
        </div>
        ${dashboardUrl ? `<p><a href="${dashboardUrl}" style="display: inline-block; padding: 10px 20px; background-color: #0056b3; color: white; text-decoration: none; border-radius: 4px;">Acessar o Painel</a></p>` : ''}
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #888; font-size: 12px;">Mensagem gerada automaticamente pelo ExecFlow.</p>
      </div>
    `
    await this.sendEmail(to, `${icon} Prazo: ${clientName} - ${deadlineTitle}`, html)
  }

  async notifyOpportunityDetected(
    to: string,
    clientName: string,
    opportunityType: string,
    summary: string,
    dashboardUrl?: string
  ): Promise<void> {
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
        <h2 style="color: #2e7d32;">✨ Oportunidade Detectada — ExecFlow</h2>
        <p>O motor de cálculos do ExecFlow identificou uma possível oportunidade para o cliente <strong>${clientName}</strong>:</p>
        <div style="background-color: #f1f8e9; padding: 15px; border-left: 4px solid #2e7d32; margin: 15px 0;">
          <p style="margin: 0;"><strong>Tipo:</strong> ${opportunityType}</p>
          <p style="margin: 5px 0 0 0;"><strong>Resumo:</strong> ${summary}</p>
        </div>
        ${dashboardUrl ? `<p><a href="${dashboardUrl}" style="display: inline-block; padding: 10px 20px; background-color: #2e7d32; color: white; text-decoration: none; border-radius: 4px;">Redigir Petição com IA</a></p>` : ''}
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #888; font-size: 12px;">Mensagem gerada automaticamente pelo ExecFlow.</p>
      </div>
    `
    await this.sendEmail(to, `✨ Nova Oportunidade: ${clientName} - ${opportunityType}`, html)
  }

  async notifyCourtMovement(
    to: string,
    cnj: string,
    movementType: string,
    description: string,
    dashboardUrl?: string
  ): Promise<void> {
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
        <h2 style="color: #1976d2;">🏛️ Nova Movimentação — ExecFlow</h2>
        <p>O robô do ExecFlow detectou uma nova movimentação no processo <strong>${cnj}</strong>:</p>
        <div style="background-color: #e3f2fd; padding: 15px; border-left: 4px solid #1976d2; margin: 15px 0;">
          <p style="margin: 0;"><strong>Tipo:</strong> ${movementType}</p>
          <p style="margin: 5px 0 0 0;"><strong>Resumo:</strong> ${description}</p>
        </div>
        ${dashboardUrl ? `<p><a href="${dashboardUrl}" style="display: inline-block; padding: 10px 20px; background-color: #1976d2; color: white; text-decoration: none; border-radius: 4px;">Ver no Painel</a></p>` : ''}
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #888; font-size: 12px;">Mensagem gerada automaticamente pelo ExecFlow.</p>
      </div>
    `
    await this.sendEmail(to, `🏛️ Movimentação Processual: ${cnj}`, html)
  }

  private logMock(to: string, subject: string, html: string): void {
    console.info(`\n══════════════════════════════════════════════════`)
    console.info(`📧 [EMAIL MOCK] E-mail simulado (SMTP não configurado)`)
    console.info(`──────────────────────────────────────────────────`)
    console.info(`Para: ${to}`)
    console.info(`Assunto: ${subject}`)
    console.info(`──────────────────────────────────────────────────`)
    // Limpar o HTML para exibir só texto no console
    const text = html.replace(/<[^>]*>?/gm, '').replace(/&nbsp;/g, ' ').trim()
    console.info(text)
    console.info(`══════════════════════════════════════════════════\n`)
  }
}

export function createEmailClient(): EmailClient {
  const client = new EmailClient()
  if (!client.isConfigured) {
    console.warn('[Email] SMTP não configurado. Notificações funcionarão em modo simulado (console.log).')
  }
  return client
}
