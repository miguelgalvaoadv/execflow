/**
 * Astrea IMAP client — reads court-movement notification e-mails from the
 * dedicated Gmail mailbox the office configured inside Astrea
 * ("todos os processos públicos do escritório" → e-mail).
 *
 * DESIGN: poll, not a persistent IDLE connection. Every call opens a fresh
 * connection, does its work, and always closes — there is no long-lived
 * connection state to leak or get stuck. If a run fails, the next scheduled
 * run (10 minutes later) tries again on a clean slate. This is the
 * foundation of the "self-correcting" requirement: nothing here can get
 * permanently wedged.
 *
 * After processing, every message is moved out of the source folder into
 * one of three subfolders — this gives a second, human-readable audit trail
 * directly inside Gmail, independent of the database.
 */

import { ImapFlow, type FetchMessageObject } from 'imapflow'
import { simpleParser } from 'mailparser'

export type AstreaImapConfig = {
  host: string
  port: number
  user: string
  pass: string
  sourceFolder: string
}

export type AstreaFolders = {
  processed: string
  orphan: string
  error: string
}

export type FetchedAstreaEmail = {
  uid: number
  messageId: string | null
  subject: string | null
  from: string | null
  date: Date | null
  textBody: string
  htmlBody: string | null
}

export type AstreaTriageDestination = 'processed' | 'orphan' | 'error'

/**
 * Reads ASTREA_IMAP_* from the environment. Returns null (never throws) if
 * any required variable is missing — callers must treat that as "poller
 * disabled", not a fatal error, matching the graceful-degradation pattern
 * used by createJusbrasilClient().
 */
export function createAstreaImapConfig(): AstreaImapConfig | null {
  const host = process.env['ASTREA_IMAP_HOST']
  const user = process.env['ASTREA_IMAP_USER']
  const pass = process.env['ASTREA_IMAP_PASS']
  if (!host || !user || !pass) return null

  const port = Number(process.env['ASTREA_IMAP_PORT'] || '993')
  const sourceFolder = process.env['ASTREA_IMAP_SOURCE_FOLDER'] || 'INBOX'
  return { host, port, user, pass, sourceFolder }
}

export function getAstreaFolders(): AstreaFolders {
  const prefix = process.env['ASTREA_IMAP_FOLDER_PREFIX'] || 'ExecFlow'
  return {
    processed: `${prefix}/Processados`,
    orphan: `${prefix}/Orfaos`,
    error: `${prefix}/Erros`,
  }
}

/**
 * Opens a connection, ensures the ExecFlow/* subfolders exist, runs `handler`,
 * and ALWAYS closes the connection afterward — success or failure. Never call
 * connect()/logout() directly outside of this wrapper.
 */
export async function withAstreaImapSession<T>(
  config: AstreaImapConfig,
  handler: (client: ImapFlow, folders: AstreaFolders) => Promise<T>
): Promise<T> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  })

  const folders = getAstreaFolders()

  await client.connect()
  try {
    await ensureFolders(client, folders)
    return await handler(client, folders)
  } finally {
    try {
      await client.logout()
    } catch {
      client.close()
    }
  }
}

async function ensureFolders(client: ImapFlow, folders: AstreaFolders): Promise<void> {
  for (const path of [folders.processed, folders.orphan, folders.error]) {
    try {
      await client.mailboxCreate(path.split('/'))
    } catch {
      // Already exists — fine. imapflow throws on duplicate creation.
    }
  }
}

/**
 * Fetches and parses every UNSEEN message currently in `sourceFolder`.
 * This is the "fast, best-effort" idempotency layer — see the database
 * messageId/contentHash check in the consumer for the authoritative layer.
 */
export async function fetchUnseenEmails(
  client: ImapFlow,
  sourceFolder: string
): Promise<FetchedAstreaEmail[]> {
  const lock = await client.getMailboxLock(sourceFolder)
  const results: FetchedAstreaEmail[] = []
  try {
    const uids = await client.search({ seen: false }, { uid: true })
    if (!uids || uids.length === 0) return results

    for await (const message of client.fetch(
      uids,
      { uid: true, source: true, envelope: true },
      { uid: true }
    )) {
      const fetched = message as FetchMessageObject
      if (!fetched.source) continue
      const parsed = await simpleParser(fetched.source)
      results.push({
        uid: fetched.uid,
        messageId: parsed.messageId ?? null,
        subject: parsed.subject ?? null,
        from: parsed.from?.text ?? null,
        date: parsed.date ?? null,
        textBody: parsed.text ?? '',
        htmlBody: typeof parsed.html === 'string' ? parsed.html : null,
      })
    }
  } finally {
    lock.release()
  }
  return results
}

/**
 * Moves a message out of the source folder into the subfolder matching its
 * processing result. Moving (not just flagging \Seen) is what actually
 * removes it from future UNSEEN searches — the move itself is the
 * "don't reprocess" mechanism. If this fails partway through, the database
 * dedup layer (messageId/contentHash) keeps a retry on the next poll safe:
 * it will simply re-attempt the move and skip re-writing data.
 */
export async function moveMessage(
  client: ImapFlow,
  sourceFolder: string,
  uid: number,
  destination: AstreaTriageDestination,
  folders: AstreaFolders
): Promise<string> {
  const destPath =
    destination === 'processed' ? folders.processed : destination === 'orphan' ? folders.orphan : folders.error

  const lock = await client.getMailboxLock(sourceFolder)
  try {
    await client.messageMove(uid, destPath, { uid: true })
    return destPath
  } finally {
    lock.release()
  }
}
