/**
 * Notification Service — Envia notificações via WhatsApp Business API.
 *
 * Quando WHATSAPP_API_TOKEN e WHATSAPP_PHONE_NUMBER_ID estão configurados,
 * envia mensagens reais via Meta Graph API.
 * Caso contrário, faz mock no console para desenvolvimento.
 */

import { db } from '../lib/db.ts'
import { organizations } from '@execflow/db/schema'
import { eq } from 'drizzle-orm'

import nodemailer from 'nodemailer'

const fromEmail = process.env['SMTP_USER'] || 'no-reply@execflow.app'

async function sendEmailMessage(to: string, subject: string, htmlBody: string): Promise<void> {
  const user = process.env['SMTP_USER']
  const pass = process.env['SMTP_PASS']
  const host = process.env['SMTP_HOST'] || 'smtp.gmail.com'
  const port = Number(process.env['SMTP_PORT'] || 465)

  if (!user || !pass) {
    console.log(`\n=============================================`)
    console.log(`[MOCK EMAIL NOTIFICATION] 📧`)
    console.log(`To: ${to}`)
    console.log(`Subject: ${subject}`)
    console.log(`=============================================\n`)
    return
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    })

    const info = await transporter.sendMail({
      from: `"ExecFlow Alertas" <${fromEmail}>`,
      to,
      subject,
      html: htmlBody,
    })
    console.log(`[Email API] ✅ E-mail enviado para ${to} (ID: ${info.messageId})`)
  } catch (e) {
    console.error(`[Email API] Falha de rede ao enviar notificação`, e)
  }
}

export class NotificationService {
  /**
   * Envia uma notificação de andamento processual via WhatsApp.
   */
  async sendProcessUpdate(
    organizationId: string,
    executionCaseId: string,
    cnj: string,
    movementType: string,
    description: string
  ) {
    const officeEmail = process.env['OFFICE_EMAIL'] || 'miguelgalvao.adv@gmail.com'

    const htmlBody = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
        <h2 style="color: #1976d2;">🏛️ Nova Movimentação — ExecFlow</h2>
        <p>O robô detectou uma nova movimentação no processo <strong>${cnj}</strong>:</p>
        <div style="background-color: #e3f2fd; padding: 15px; border-left: 4px solid #1976d2; margin: 15px 0;">
          <p style="margin: 0;"><strong>Tipo:</strong> ${movementType}</p>
          <p style="margin: 5px 0 0 0;"><strong>Resumo:</strong> ${description}</p>
        </div>
      </div>
    `
    await sendEmailMessage(officeEmail, `🏛️ Movimentação: ${cnj}`, htmlBody)
  }

  async sendOpportunityAlert(
    organizationId: string,
    clientName: string,
    opportunityType: string,
    summary: string
  ) {
    const officeEmail = process.env['OFFICE_EMAIL'] || 'miguelgalvao.adv@gmail.com'

    const htmlBody = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
        <h2 style="color: #2e7d32;">✨ Oportunidade Detectada — ExecFlow</h2>
        <p>Possível oportunidade identificada para <strong>${clientName}</strong>:</p>
        <div style="background-color: #f1f8e9; padding: 15px; border-left: 4px solid #2e7d32; margin: 15px 0;">
          <p style="margin: 0;"><strong>Tipo:</strong> ${opportunityType}</p>
          <p style="margin: 5px 0 0 0;"><strong>Resumo:</strong> ${summary}</p>
        </div>
      </div>
    `
    await sendEmailMessage(officeEmail, `✨ Nova Oportunidade: ${clientName}`, htmlBody)
  }

  async sendDeadlineAlert(
    advogadoName: string,
    phone: string, // Kept for backwards compat in arguments, but ignored internally
    deadlineTitle: string,
    dueAt: string,
    status: 'warning' | 'overdue'
  ) {
    const officeEmail = process.env['OFFICE_EMAIL'] || 'miguelgalvao.adv@gmail.com'
    const statusText = status === 'overdue' ? 'venceu' : 'está próximo do vencimento'
    
    const htmlBody = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
        <h2 style="color: #d32f2f;">🚨 Lembrete de Prazo — ExecFlow</h2>
        <p>Olá Dr(a). <strong>${advogadoName}</strong>,</p>
        <div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #d32f2f; margin: 15px 0;">
          <p style="margin: 0;"><strong>Tarefa:</strong> ${deadlineTitle}</p>
          <p style="margin: 5px 0 0 0;"><strong>Status:</strong> ${statusText} em <strong>${new Date(dueAt).toLocaleDateString()}</strong></p>
        </div>
      </div>
    `
    await sendEmailMessage(officeEmail, `🚨 Prazo: ${deadlineTitle}`, htmlBody)
  }
}
