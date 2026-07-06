/**
 * Astrea Email Sync — the orchestration entry point for the IMAP poller.
 *
 * Called every 10 minutes by the QUEUE_ASTREA_EMAIL_POLL cron (see
 * bootstrap/worker-registry.ts). Each run:
 *   1. Opens a fresh IMAP session (see astrea-imap-client.ts — never persistent).
 *   2. Fetches every UNSEEN e-mail.
 *   3. For each: dedups by Message-ID/content hash, extracts CNJ + movement
 *      data (regex, falling back to Claude Haiku), matches to an
 *      ExecutionCase, writes the timeline event, triggers opportunity
 *      detection + office notification — same pipeline Jusbrasil used.
 *   4. ALWAYS writes exactly one astrea_email_logs row per e-mail and moves
 *      it to ExecFlow/Processados | Orfaos | Erros — nothing is silently lost.
 *   5. ALWAYS writes exactly one system_health_checks row for the run,
 *      success or failure — this is what the daily health sweep reads.
 *
 * ISOLATION: a failure on one e-mail (bad parse, DB hiccup, IMAP move
 * failure) never aborts the rest of the batch — caught, logged, recorded.
 * A failure connecting to IMAP at all is caught at the top level and still
 * produces a 'failure' health-check row, so the alerting in
 * sla/system-health-sweep.ts always has something to read.
 */

import { randomUUID } from 'crypto'
import { sha256Hex } from '@execflow/storage'
import {
  astreaEmailLogs,
  executionCases,
  organizations,
  systemHealthChecks,
} from '@execflow/db/schema'
import { eq, or } from '@execflow/db/client'
import type { WorkersDb } from '../lib/db.ts'
import {
  createAstreaImapConfig,
  withAstreaImapSession,
  fetchUnseenEmails,
  moveMessage,
  type FetchedAstreaEmail,
  type AstreaTriageDestination,
} from '../integrations/astrea-imap-client.ts'
import {
  parseAstreaEmailWithRegex,
  CNJ_REGEX,
  type ExtractedMovement,
} from '../integrations/astrea-email-parser.ts'
import { extractMovementsViaClaude } from '../integrations/astrea-claude-extractor.ts'
import { upsertTimelineEvent, emitMovementsReceived } from '../integrations/timeline-sync-helpers.ts'
import { detectAstreaOpportunities } from '../integrations/astrea-opportunity-detector.ts'
import { createEmailClient } from '../integrations/email-client.ts'
import { sendAstreaHealthAlert, looksLikeAuthFailure } from '../integrations/astrea-health-alerts.ts'

type AstreaSyncSummary = {
  emailsFound: number
  emailsProcessed: number
  emailsOrphan: number
  emailsParseFailed: number
}

type ProcessEmailResult = { destination: AstreaTriageDestination; logId: string }

function stripHtml(html: string | null): string {
  if (!html) return ''
  return html.replace(/<[^>]*>?/gm, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeForHash(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Single-tenant simplification: this office runs one organization. If
 * ExecFlow ever needs multi-org, this should resolve org per matched case
 * instead of needing one upfront for the health-check row.
 */
async function getDefaultOrganization(db: WorkersDb) {
  const rows = await db.select().from(organizations).limit(1)
  return rows[0] ?? null
}

export async function runAstreaEmailSync(db: WorkersDb): Promise<void> {
  const startedAt = Date.now()
  const config = createAstreaImapConfig()
  if (!config) {
    console.warn('[Astrea Email Sync] ASTREA_IMAP_HOST/USER/PASS ausentes — execução pulada.')
    return
  }

  const org = await getDefaultOrganization(db)
  if (!org) {
    console.error('[Astrea Email Sync] Nenhuma organização encontrada — não há onde gravar o health check.')
    return
  }

  const summary: AstreaSyncSummary = {
    emailsFound: 0,
    emailsProcessed: 0,
    emailsOrphan: 0,
    emailsParseFailed: 0,
  }
  let sessionError: string | null = null

  try {
    await withAstreaImapSession(config, async (client, folders) => {
      const emails = await fetchUnseenEmails(client, config.sourceFolder)
      summary.emailsFound = emails.length

      for (const email of emails) {
        let result: ProcessEmailResult
        try {
          result = await processOneEmail(db, org.id, email)
        } catch (err) {
          console.error(`[Astrea Email Sync] Falha isolada processando e-mail uid=${email.uid}:`, err)
          // Even an unexpected crash here must leave a trace — write a
          // minimal log row so the e-mail isn't silently unaccounted for.
          const fallbackLogId = randomUUID()
          try {
            await db.insert(astreaEmailLogs).values({
              id: fallbackLogId,
              organizationId: org.id,
              messageId: email.messageId,
              contentHash: sha256Hex(Buffer.from(normalizeForHash(email.textBody || stripHtml(email.htmlBody)), 'utf8')),
              emailSubject: email.subject,
              emailFrom: email.from,
              emailReceivedAt: email.date,
              rawBodySnapshot: (email.textBody || stripHtml(email.htmlBody)).slice(0, 20000),
              status: 'parse_failed',
              extractionMethod: 'failed',
              errorDetails: err instanceof Error ? err.message : String(err),
            })
          } catch (logErr) {
            console.error('[Astrea Email Sync] Falha também ao gravar o log de fallback:', logErr)
          }
          result = { destination: 'error', logId: fallbackLogId }
        }

        if (result.destination === 'processed') summary.emailsProcessed++
        else if (result.destination === 'orphan') summary.emailsOrphan++
        else summary.emailsParseFailed++

        try {
          const movedToFolder = await moveMessage(client, config.sourceFolder, email.uid, result.destination, folders)
          await db.update(astreaEmailLogs).set({ movedToFolder }).where(eq(astreaEmailLogs.id, result.logId))
        } catch (moveErr) {
          // The e-mail stays UNSEEN in the source folder — next poll will
          // re-fetch it, hit the database dedup check, and just retry the
          // move. Nothing is lost or double-processed.
          console.error(`[Astrea Email Sync] Falha ao mover e-mail uid=${email.uid} (será tentado de novo no próximo ciclo):`, moveErr)
        }
      }
    })
  } catch (err) {
    sessionError = err instanceof Error ? err.message : String(err)
    console.error('[Astrea Email Sync] Falha de conexão/sessão IMAP:', err)

    // Auth failures don't self-heal on retry — alert immediately instead of
    // waiting for the daily health sweep.
    if (looksLikeAuthFailure(sessionError)) {
      await sendAstreaHealthAlert([
        `⚠️ Falha de autenticação no IMAP do Astrea (${process.env['ASTREA_IMAP_USER'] ?? 'conta não identificada'}). A senha de app do Gmail provavelmente expirou ou foi revogada — gere uma nova em myaccount.google.com/apppasswords. Detalhe técnico: ${sessionError}`,
      ])
    }
  }

  await db.insert(systemHealthChecks).values({
    organizationId: org.id,
    checkType: 'astrea_email_poll',
    status: sessionError ? 'failure' : 'success',
    emailsFound: summary.emailsFound,
    emailsProcessed: summary.emailsProcessed,
    emailsOrphan: summary.emailsOrphan,
    emailsParseFailed: summary.emailsParseFailed,
    errorDetails: sessionError,
    durationMs: Date.now() - startedAt,
  })

  console.log(
    `[Astrea Email Sync] Concluído. found=${summary.emailsFound} processed=${summary.emailsProcessed} orphan=${summary.emailsOrphan} parse_failed=${summary.emailsParseFailed}${sessionError ? ` ERRO=${sessionError}` : ''}`
  )
}

/**
 * Processes one e-mail end to end. ALWAYS writes exactly one astrea_email_logs
 * row before returning, regardless of outcome — that row is the contract: no
 * e-mail this function looks at is ever left without a database trace.
 */
async function processOneEmail(
  db: WorkersDb,
  organizationId: string,
  email: FetchedAstreaEmail
): Promise<ProcessEmailResult> {
  const plainText = email.textBody && email.textBody.trim() !== '' ? email.textBody : stripHtml(email.htmlBody)
  const contentHash = sha256Hex(Buffer.from(normalizeForHash(plainText), 'utf8'))
  const logId = randomUUID()

  // --- Layer 0: authoritative dedup (Message-ID and/or content hash) ---
  const dedupConditions = email.messageId
    ? or(eq(astreaEmailLogs.messageId, email.messageId), eq(astreaEmailLogs.contentHash, contentHash))
    : eq(astreaEmailLogs.contentHash, contentHash)

  const existing = await db
    .select({ id: astreaEmailLogs.id, status: astreaEmailLogs.status })
    .from(astreaEmailLogs)
    .where(dedupConditions)
    .limit(1)

  if (existing.length > 0) {
    const prevStatus = existing[0]!.status
    const destination: AstreaTriageDestination =
      prevStatus === 'processed' || prevStatus === 'ignored_no_cnj'
        ? 'processed'
        : prevStatus === 'orphan'
          ? 'orphan'
          : 'error'
    return { destination, logId: existing[0]!.id }
  }

  // --- Extraction + case matching, wrapped so a partial failure still
  //     produces a usable log row instead of losing the e-mail entirely. ---
  let movements: ExtractedMovement[] = []
  let extractionMethod: 'regex' | 'claude_haiku' | 'failed' = 'failed'
  let status: 'processed' | 'orphan' | 'parse_failed' | 'ignored_no_cnj' = 'parse_failed'
  let matchedExecutionCaseId: string | null = null
  let timelineEventsCreated = 0
  let errorDetails: string | null = null

  try {
    const regexResult = parseAstreaEmailWithRegex(email.subject, plainText)
    movements = regexResult.movements
    extractionMethod = movements.length > 0 ? 'regex' : 'failed'

    const needsFallback = movements.length === 0 || movements.some((m) => m.confidence === 'low')
    if (needsFallback && !regexResult.looksAdministrative) {
      const claudeMovements = await extractMovementsViaClaude(email.subject, plainText)
      if (claudeMovements.length > 0) {
        movements = claudeMovements
        extractionMethod = 'claude_haiku'
      }
    }

    if (movements.length === 0) {
      status = regexResult.looksAdministrative ? 'ignored_no_cnj' : 'parse_failed'
      if (status === 'parse_failed') {
        errorDetails = 'Nenhum CNJ extraído por regex nem pela camada de IA (Haiku).'
      }
    } else {
      const byCnj = new Map<string, ExtractedMovement[]>()
      for (const m of movements) {
        if (!CNJ_REGEX.test(m.cnj)) continue
        CNJ_REGEX.lastIndex = 0
        const list = byCnj.get(m.cnj) ?? []
        list.push(m)
        byCnj.set(m.cnj, list)
      }

      let anyMatched = false
      let anyOrphan = false

      for (const [cnj, movs] of byCnj) {
        try {
          const [matchedCase] = await db
            .select()
            .from(executionCases)
            .where(eq(executionCases.executionProcessNumber, cnj.trim()))
            .limit(1)

          if (!matchedCase) {
            anyOrphan = true
            continue
          }
          anyMatched = true
          matchedExecutionCaseId = matchedCase.id

          let newCount = 0
          const movementTexts: string[] = []
          for (const m of movs) {
            const desc = m.descricao || m.tipo || 'Atualização'
            const summary = `Movimentação: ${m.tipo || 'Andamento'} - ${desc}`.substring(0, 255)
            const created = await upsertTimelineEvent(db, matchedCase.organizationId, matchedCase.id, {
              eventCategory: 'court',
              eventType: 'process_movement',
              occurredAt: m.data ? new Date(m.data) : (email.date ?? new Date()),
              summary,
              actorId: 'astrea-email',
              sourceRefType: 'AstreaEmailLog',
              sourceRefId: logId,
            })
            if (created) {
              newCount++
              movementTexts.push(summary)
            }
          }
          timelineEventsCreated += newCount

          if (newCount > 0) {
            await db
              .update(executionCases)
              .set({
                monitoringStatus: matchedCase.monitoringStatus === 'sealed' ? 'sealed' : 'monitored',
                lastSyncedAt: new Date(),
              })
              .where(eq(executionCases.id, matchedCase.id))

            await emitMovementsReceived(db, matchedCase, matchedCase.organizationId, newCount, 'astrea_email')

            await notifyOfficeOfMovement(matchedCase.executionProcessNumber ?? cnj, movs)
            await runOpportunityDetectionAndNotify(db, matchedCase, movementTexts)
          }
        } catch (caseErr) {
          // One bad CNJ in a multi-process e-mail never blocks the others.
          console.error(`[Astrea Email Sync] Falha processando CNJ ${cnj} dentro do e-mail:`, caseErr)
          anyOrphan = true
        }
      }

      status = anyMatched ? 'processed' : anyOrphan ? 'orphan' : 'parse_failed'
    }
  } catch (err) {
    status = 'parse_failed'
    errorDetails = err instanceof Error ? err.message : String(err)
    console.error('[Astrea Email Sync] Falha inesperada na extração/gravação:', err)
  }

  await db.insert(astreaEmailLogs).values({
    id: logId,
    organizationId,
    messageId: email.messageId,
    contentHash,
    emailSubject: email.subject,
    emailFrom: email.from,
    emailReceivedAt: email.date,
    rawBodySnapshot: plainText.slice(0, 20000),
    status,
    extractionMethod,
    extractedCnj: movements[0]?.cnj ?? null,
    extractedData: movements.length > 0 ? movements : null,
    matchedExecutionCaseId,
    timelineEventsCreated,
    errorDetails,
  })

  const destination: AstreaTriageDestination =
    status === 'processed' || status === 'ignored_no_cnj' ? 'processed' : status === 'orphan' ? 'orphan' : 'error'
  return { destination, logId }
}

async function notifyOfficeOfMovement(cnj: string, movs: ExtractedMovement[]): Promise<void> {
  try {
    const emailClient = createEmailClient()
    const officeEmail = process.env['OFFICE_EMAIL'] || 'miguelgalvao.adv@gmail.com'
    const latest = movs[movs.length - 1]!
    await emailClient.notifyCourtMovement(
      officeEmail,
      cnj,
      latest.tipo || 'Andamento',
      latest.descricao || latest.tipo || 'Nova movimentação processual.',
      process.env['DASHBOARD_URL']
    )
  } catch (err) {
    // Notification failure must never block the data write that already happened.
    console.warn('[Astrea Email Sync] Falha ao enviar e-mail de notificação de andamento:', err)
  }
}

async function runOpportunityDetectionAndNotify(
  db: WorkersDb,
  execCase: typeof executionCases.$inferSelect,
  movementTexts: string[]
): Promise<void> {
  try {
    const result = await detectAstreaOpportunities(db, {
      organizationId: execCase.organizationId,
      executionCaseId: execCase.id,
      movements: movementTexts,
    })
    if (result.oportunidadesCriadas > 0) {
      const emailClient = createEmailClient()
      const officeEmail = process.env['OFFICE_EMAIL'] || 'miguelgalvao.adv@gmail.com'
      await emailClient.notifyOpportunityDetected(
        officeEmail,
        execCase.executionProcessNumber ?? execCase.id,
        'Oportunidade detectada',
        result.titulos.join('; '),
        process.env['DASHBOARD_URL']
      )
    }
  } catch (err) {
    console.warn('[Astrea Email Sync] Falha na detecção de oportunidades / notificação:', err)
  }
}
