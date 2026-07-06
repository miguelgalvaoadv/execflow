import type { Job } from 'pg-boss'
import { eq } from '@execflow/db/client'
import type { WorkersDb } from '../lib/db.ts'
import { createEmailClient } from '../integrations/email-client.ts'

type NotificationJob = Job<{
  eventId: string
  eventType: string
  payload: Record<string, unknown>
  occurredAt: string
  organizationId: string | null
  correlationId: string
  causationId: string | null
}>

/**
 * Handles email.notification.requested events (previously whatsapp).
 */
export async function handleEmailNotificationRequested(
  db: WorkersDb,
  job: NotificationJob
): Promise<void> {
  const { payload, organizationId } = job.data

  if (!organizationId) return

  const notificationType = payload['notificationType'] as string | undefined
  const executionCaseId = payload['executionCaseId'] as string | undefined

  if (!notificationType || !executionCaseId) return

  const { executionCases, organizations, clients } = await import('@execflow/db/schema')
  
  const [caseRecord] = await db
    .select({
      clientName: clients.fullName,
      orgName: organizations.name,
    })
    .from(executionCases)
    .innerJoin(organizations, eq(organizations.id, executionCases.organizationId))
    .innerJoin(clients, eq(clients.id, executionCases.clientId))
    .where(eq(executionCases.id, executionCaseId))
    .limit(1)

  if (!caseRecord) return
  
  // Use organization email or specific configured email
  const destinationEmail = process.env['OFFICE_EMAIL'] || 'miguelgalvao.adv@gmail.com'
  const lawyerName = caseRecord.orgName || 'Advogado'
  const clientName = caseRecord.clientName || 'Cliente'

  const client = createEmailClient()

  const dashboardUrl = `https://execflow.app/cases/${executionCaseId}`

  if (notificationType === 'opportunity_detected') {
    const opportunityType = payload['opportunityType'] as string ?? 'Benefício'
    const summary = payload['summary'] as string ?? 'Uma nova oportunidade foi detectada no caso.'
    await client.notifyOpportunityDetected(destinationEmail, clientName, opportunityType, summary, dashboardUrl)
  } else if (notificationType === 'deadline_alert') {
    const deadlineTitle = payload['deadlineTitle'] as string ?? 'Prazo pendente'
    const dueAt = payload['dueAt'] as string ?? new Date().toISOString()
    const status = payload['status'] as 'warning' | 'overdue' ?? 'overdue'
    await client.notifyDeadlineAlert(destinationEmail, lawyerName, clientName, deadlineTitle, dueAt, status, dashboardUrl)
  } else if (notificationType === 'court_movement') {
    const cnj = payload['cnj'] as string ?? 'N/A'
    const movementType = payload['movementType'] as string ?? 'Movimentação'
    const description = payload['description'] as string ?? 'Nova movimentação registrada no tribunal.'
    await client.notifyCourtMovement(destinationEmail, cnj, movementType, description, dashboardUrl)
  }
}
