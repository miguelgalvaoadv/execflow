/**
 * AuditLog repository — append-only write interface.
 *
 * The AuditLog is the most critical table in the system (see schema/audit-log.ts).
 * This repository exposes ONLY an insert function. There are no read operations
 * here — reads are performed by compliance/admin routes with dedicated authorization.
 *
 * TRANSACTION REQUIREMENT:
 * writeAuditLog() MUST be called inside a transaction alongside the business
 * entity write it records. Never write an audit log outside a transaction.
 * Architecture ref: AuditLog schema "WRITE CONTRACT" note.
 */

import { auditLogs } from '@execflow/db/schema'
import type { NewAuditLog, AuditLog } from '@execflow/db/schema'
import type { DbTransaction } from '../lib/db.ts'
import type { RepositoryResult } from '@execflow/db/repositories'

/**
 * Append one immutable audit log entry inside a transaction.
 * The caller is responsible for being inside a transaction (tx parameter enforces this).
 *
 * @param tx   - Active database transaction. NEVER pass a plain DbClient here.
 * @param data - The audit log entry to append.
 * @returns    RepositoryResult containing the created entry.
 */
export async function writeAuditLog(
  tx: DbTransaction,
  data: NewAuditLog
): Promise<RepositoryResult<AuditLog>> {
  try {
    const [row] = await tx.insert(auditLogs).values(data).returning()
    if (!row) {
      return {
        success: false,
        error: { code: 'UNKNOWN', message: 'Audit log insert returned no rows.' },
      }
    }
    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: {
        code: 'UNKNOWN',
        message: 'Failed to write audit log entry.',
        cause: err,
      },
    }
  }
}
