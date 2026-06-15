/**
 * WhatsApp Notification Service para SLA de prazos.
 *
 * Usa o WhatsAppMetaClient real quando configurado (WHATSAPP_API_TOKEN),
 * caso contrário faz mock no console.
 */

import { createWhatsAppClient } from '../integrations/whatsapp-meta-client.ts'

// Singleton do client WhatsApp
const whatsapp = createWhatsAppClient()

/**
 * Envia lembrete de prazo para o advogado via WhatsApp.
 */
export async function sendWhatsappDeadlineReminder(
  advogadoName: string,
  advogadoPhone: string | null,
  clientName: string,
  deadlineTitle: string,
  dueAt: string,
  status: 'warning' | 'overdue'
): Promise<void> {
  const phone = advogadoPhone || process.env['OFFICE_PHONE_NUMBER'] || '+5500000000000'

  await whatsapp.notifyDeadlineAlert(
    phone,
    advogadoName,
    clientName,
    deadlineTitle,
    dueAt,
    status,
    process.env['DASHBOARD_URL'] || 'http://localhost:3000'
  )
}

/**
 * Envia notificação de movimentação processual.
 */
export async function sendWhatsappCourtNotification(
  phone: string,
  cnj: string,
  movementType: string,
  description: string
): Promise<void> {
  await whatsapp.notifyCourtMovement(
    phone,
    cnj,
    movementType,
    description,
    process.env['DASHBOARD_URL'] || 'http://localhost:3000'
  )
}

/**
 * Envia notificação de oportunidade detectada.
 */
export async function sendWhatsappOpportunityAlert(
  phone: string,
  clientName: string,
  opportunityType: string,
  summary: string
): Promise<void> {
  await whatsapp.notifyOpportunityDetected(
    phone,
    clientName,
    opportunityType,
    summary,
    process.env['DASHBOARD_URL'] || 'http://localhost:3000'
  )
}
