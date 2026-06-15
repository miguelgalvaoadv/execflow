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

// ─────────────────────────────────────────────────────────────────────
// WhatsApp Client inline (API side — não depende do package workers)
// ─────────────────────────────────────────────────────────────────────

const GRAPH_API_VERSION = 'v21.0'

async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  const token = process.env['WHATSAPP_API_TOKEN']
  const phoneNumberId = process.env['WHATSAPP_PHONE_NUMBER_ID']

  // Normaliza telefone
  let digits = to.replace(/\D/g, '')
  if (digits.startsWith('0')) digits = digits.substring(1)
  if (!digits.startsWith('55')) digits = '55' + digits

  if (!token || !phoneNumberId) {
    // Mock mode
    console.log(`\n=============================================`)
    console.log(`[MOCK WHATSAPP NOTIFICATION] 📱`)
    console.log(`To: ${digits}`)
    console.log(`Body: \n${body}`)
    console.log(`=============================================\n`)
    return
  }

  // Chamada real Meta Cloud API
  try {
    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: digits,
        type: 'text',
        text: { preview_url: true, body },
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error(`[WhatsApp API] Erro ${response.status}: ${error}`)
    } else {
      console.log(`[WhatsApp API] ✅ Mensagem enviada para ${digits}`)
    }
  } catch (e) {
    console.error(`[WhatsApp API] Falha de rede ao enviar notificação`, e)
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
    // 1. Fetch organization details
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))

    if (!org) return

    const officePhone = process.env['OFFICE_PHONE_NUMBER'] || '+5511999999999'

    const messageBody = [
      '🏛️ *Nova Movimentação Processual — ExecFlow*',
      '',
      `*Processo:* ${cnj}`,
      `*Tipo:* ${movementType}`,
      `*Resumo:* ${description}`,
      '',
      '🔗 Acesse o painel do ExecFlow para verificar se isso gerou uma oportunidade automática!',
      '',
      '_Mensagem automática do ExecFlow._',
    ].join('\n')

    await sendWhatsAppMessage(officePhone, messageBody)
  }

  /**
   * Envia notificação de oportunidade detectada.
   */
  async sendOpportunityAlert(
    organizationId: string,
    clientName: string,
    opportunityType: string,
    summary: string
  ) {
    const officePhone = process.env['OFFICE_PHONE_NUMBER'] || '+5511999999999'

    const messageBody = [
      '✨ *Oportunidade Detectada — ExecFlow*',
      '',
      `*Cliente:* ${clientName}`,
      `*Tipo:* ${opportunityType}`,
      `*Resumo:* ${summary}`,
      '',
      'O motor de cálculos do ExecFlow identificou uma possível oportunidade.',
      '🔗 Acesse o painel para redigir a petição com IA.',
      '',
      '_Mensagem automática do ExecFlow._',
    ].join('\n')

    await sendWhatsAppMessage(officePhone, messageBody)
  }

  /**
   * Envia notificação de prazo.
   */
  async sendDeadlineAlert(
    advogadoName: string,
    phone: string,
    deadlineTitle: string,
    dueAt: string,
    status: 'warning' | 'overdue'
  ) {
    const icon = status === 'overdue' ? '🚨' : '⚠️'
    const statusText = status === 'overdue' ? 'venceu' : 'está próximo do vencimento'
    const dueDate = new Date(dueAt).toLocaleDateString('pt-BR')

    const messageBody = [
      `${icon} *Lembrete de Prazo — ExecFlow*`,
      '',
      `Olá Dr(a). ${advogadoName},`,
      '',
      `📋 ${deadlineTitle}`,
      `📅 ${statusText} em *${dueDate}*`,
      '',
      '🔗 Acesse o painel do ExecFlow para atualizar o status.',
      '',
      '_Mensagem automática do ExecFlow._',
    ].join('\n')

    await sendWhatsAppMessage(phone, messageBody)
  }
}
