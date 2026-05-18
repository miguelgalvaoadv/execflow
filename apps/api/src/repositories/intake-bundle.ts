/**
 * IntakeBundle repository — data access layer for intake_bundles table.
 *
 * IntakeBundles are mutable (status transitions happen through the intake workflow).
 * The immutable fields (sourceChannel, receivedAt, uploaderUserId) must not be
 * touched by any update method in this repository.
 *
 * RECOVERY WORKFLOW:
 * The findIncomplete() method supports the recovery workflow:
 * "show me intake bundles that have missing_fields and haven't been completed."
 * This enables staff to resume partial intakes.
 */

import { eq, and, isNotNull } from 'drizzle-orm'
import { intakeBundles } from '@execflow/db/schema'
import type { IntakeBundle, NewIntakeBundle } from '@execflow/db/schema'
import type { IntakeBundleStatus } from '@execflow/db/types'
import type { DbTransaction, AnyTx } from '../lib/db.ts'
import type { RepositoryResult } from '@execflow/db/repositories'

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Find an intake bundle by primary key, scoped to the organization.
 */
export async function findBundleById(
  db: AnyTx,
  organizationId: string,
  id: string
): Promise<RepositoryResult<IntakeBundle>> {
  try {
    const row = await db.query.intakeBundles.findFirst({
      where: and(
        eq(intakeBundles.id, id),
        eq(intakeBundles.organizationId, organizationId)
      ),
    })

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Intake bundle not found.' } }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to query intake bundle.', cause: err },
    }
  }
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/**
 * Insert a new intake bundle.
 * Must be called inside a transaction.
 */
export async function insertBundle(
  tx: DbTransaction,
  data: NewIntakeBundle
): Promise<RepositoryResult<IntakeBundle>> {
  try {
    const [row] = await tx.insert(intakeBundles).values(data).returning()

    if (!row) {
      return {
        success: false,
        error: { code: 'UNKNOWN', message: 'Intake bundle insert returned no rows.' },
      }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to insert intake bundle.', cause: err },
    }
  }
}

/**
 * Transition the status of an intake bundle.
 * Immutable fields (sourceChannel, receivedAt, uploaderUserId) are NOT touched.
 */
export async function updateBundleStatus(
  tx: DbTransaction,
  organizationId: string,
  bundleId: string,
  params: {
    status: IntakeBundleStatus
    missingFields?: unknown
    updatedAt: Date
  }
): Promise<RepositoryResult<IntakeBundle>> {
  try {
    const [row] = await tx
      .update(intakeBundles)
      .set({
        status: params.status,
        missingFields: params.missingFields ?? undefined,
        updatedAt: params.updatedAt,
      })
      .where(
        and(
          eq(intakeBundles.id, bundleId),
          eq(intakeBundles.organizationId, organizationId)
        )
      )
      .returning()

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Intake bundle not found.' } }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to update intake bundle status.', cause: err },
    }
  }
}

/**
 * Set the confirmed association on an intake bundle.
 * Called after a human has reviewed proposed associations and confirmed them.
 * Does NOT use the proposed_ fields — those are AI suggestions.
 */
export async function confirmBundleAssociation(
  tx: DbTransaction,
  organizationId: string,
  bundleId: string,
  params: {
    associatedClientId: string | null
    associatedExecutionCaseId: string | null
    associatedByUserId: string
    associatedAt: Date
    updatedAt: Date
  }
): Promise<RepositoryResult<IntakeBundle>> {
  try {
    const [row] = await tx
      .update(intakeBundles)
      .set({
        associatedClientId: params.associatedClientId,
        associatedExecutionCaseId: params.associatedExecutionCaseId,
        associatedByUserId: params.associatedByUserId,
        associatedAt: params.associatedAt,
        status: 'association_review',
        updatedAt: params.updatedAt,
      })
      .where(
        and(
          eq(intakeBundles.id, bundleId),
          eq(intakeBundles.organizationId, organizationId)
        )
      )
      .returning()

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Intake bundle not found.' } }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: {
        code: 'UNKNOWN',
        message: 'Failed to confirm bundle association.',
        cause: err,
      },
    }
  }
}

/**
 * Increment the file count on an intake bundle.
 * Called when a new Document is linked to the bundle.
 */
export async function incrementBundleFileCount(
  tx: DbTransaction,
  organizationId: string,
  bundleId: string
): Promise<RepositoryResult<IntakeBundle>> {
  try {
    const bundle = await tx.query.intakeBundles.findFirst({
      where: and(
        eq(intakeBundles.id, bundleId),
        eq(intakeBundles.organizationId, organizationId)
      ),
    })

    if (!bundle) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Intake bundle not found.' } }
    }

    const [row] = await tx
      .update(intakeBundles)
      .set({
        fileCount: bundle.fileCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(intakeBundles.id, bundleId))
      .returning()

    if (!row) {
      return { success: false, error: { code: 'NOT_FOUND', message: 'Intake bundle not found.' } }
    }

    return { success: true, data: row }
  } catch (err) {
    return {
      success: false,
      error: { code: 'UNKNOWN', message: 'Failed to increment bundle file count.', cause: err },
    }
  }
}
