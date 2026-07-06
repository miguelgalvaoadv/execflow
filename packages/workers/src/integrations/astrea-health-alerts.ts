/**
 * Sends Astrea pipeline health alerts to ASTREA_HEALTH_ALERT_EMAIL — a
 * mailbox that MUST be different from ASTREA_IMAP_USER (the one being
 * monitored). This is validated at worker boot (see worker-registry.ts).
 *
 * Always sent over plain SMTP (createEmailClient/nodemailer), never via the
 * IMAP connection being monitored — so a broken IMAP pipeline can never
 * prevent its own alert from going out.
 */
import { createEmailClient } from './email-client.ts'

export async function sendAstreaHealthAlert(alerts: string[]): Promise<void> {
  if (alerts.length === 0) return

  const to = process.env['ASTREA_HEALTH_ALERT_EMAIL']
  if (!to) {
    console.warn('[Astrea Health Alert] ASTREA_HEALTH_ALERT_EMAIL não configurado — alerta apenas no log:', alerts)
    return
  }

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
      <h2 style="color: #d32f2f;">🛑 Alerta — Monitoramento Astrea (ExecFlow)</h2>
      <ul>
        ${alerts.map((a) => `<li style="margin: 8px 0;">${a}</li>`).join('')}
      </ul>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="color: #888; font-size: 12px;">Mensagem gerada automaticamente pelo ExecFlow — verificação de saúde do pipeline Astrea.</p>
    </div>
  `

  try {
    const client = createEmailClient()
    await client.sendEmail(to, '🛑 ExecFlow — problema no monitoramento de tribunais (Astrea)', html)
  } catch (err) {
    console.error('[Astrea Health Alert] Falha ao enviar e-mail de alerta:', err)
  }
}

/**
 * Did the last IMAP failure look like an authentication problem (expired
 * or revoked Gmail app password)? If so, the caller should alert
 * immediately rather than waiting for the daily sweep — auth failures
 * don't self-heal on retry the way transient network errors do.
 */
export function looksLikeAuthFailure(errorMessage: string | null): boolean {
  if (!errorMessage) return false
  const m = errorMessage.toLowerCase()
  return (
    m.includes('authenticationfailed') ||
    m.includes('invalid credentials') ||
    m.includes('auth') && (m.includes('fail') || m.includes('invalid'))
  )
}
