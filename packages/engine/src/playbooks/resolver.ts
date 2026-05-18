/**
 * Playbook resolver — selects the applicable PlaybookVersion at a given instant.
 *
 * Resolution algorithm (playbook-system.md §1.4):
 * For instant T, select the published version where:
 *   effective_from <= T AND (effective_to IS NULL OR effective_to > T)
 *   AND scope matches the case's jurisdiction
 *
 * For org-scoped overlays, the same algorithm applies to the overlay family.
 *
 * REPLAY SAFETY: pass the historical evaluatedAt instant to get the version
 * that was active at that time — never the current version for past evaluations.
 *
 * Architecture ref: playbook-system.md §1.4, §4.3.
 */

import { eq, and, isNull, or, lte, gt } from '@execflow/db/client'
import type { AnyDbClient } from '@execflow/db/client'
import { playbookVersions, playbookFamilies, orgPlaybookConfigs } from '@execflow/db/schema'

export type PlaybookResolutionInput = {
  organizationId: string
  jurisdictionScope: string
  evaluatedAt: Date
}

export type PlaybookResolutionResult =
  | {
      found: true
      baseVersionId: string
      overlayVersionId: string | null
      strategyProfile: 'conservative' | 'standard' | 'aggressive'
    }
  | { found: false; reason: string }

/**
 * Resolves the applicable playbook version(s) for a case at the given instant.
 *
 * Returns both the base version and the org overlay (if any).
 * The engine merger then combines them using rule_id precedence.
 */
export async function resolvePlaybookVersions(
  db: AnyDbClient,
  input: PlaybookResolutionInput
): Promise<PlaybookResolutionResult> {
  const { organizationId, jurisdictionScope, evaluatedAt } = input

  // Step 1: Find the base platform family for this jurisdiction
  const [baseFamily] = await db
    .select({ id: playbookFamilies.id })
    .from(playbookFamilies)
    .where(
      and(
        isNull(playbookFamilies.organizationId),
        eq(playbookFamilies.jurisdictionScope, jurisdictionScope),
        eq(playbookFamilies.isOverlay, false)
      )
    )
    .limit(1)

  if (baseFamily === undefined) {
    return {
      found: false,
      reason: `No base playbook family found for jurisdiction '${jurisdictionScope}'`,
    }
  }

  // Step 2: Find the published version of the base family active at evaluatedAt
  const [baseVersion] = await db
    .select({ id: playbookVersions.id })
    .from(playbookVersions)
    .where(
      and(
        eq(playbookVersions.familyId, baseFamily.id),
        eq(playbookVersions.status, 'published'),
        lte(playbookVersions.effectiveFrom, evaluatedAt),
        or(isNull(playbookVersions.effectiveTo), gt(playbookVersions.effectiveTo, evaluatedAt))
      )
    )
    .orderBy(playbookVersions.effectiveFrom)
    .limit(1)

  if (baseVersion === undefined) {
    return {
      found: false,
      reason: `No published base playbook version found for jurisdiction '${jurisdictionScope}' at ${evaluatedAt.toISOString()}`,
    }
  }

  // Step 3: Find org overlay family and version (if any)
  let overlayVersionId: string | null = null

  const [overlayFamily] = await db
    .select({ id: playbookFamilies.id })
    .from(playbookFamilies)
    .where(
      and(
        eq(playbookFamilies.organizationId, organizationId),
        eq(playbookFamilies.isOverlay, true)
      )
    )
    .limit(1)

  if (overlayFamily !== undefined) {
    const [overlayVersion] = await db
      .select({ id: playbookVersions.id })
      .from(playbookVersions)
      .where(
        and(
          eq(playbookVersions.familyId, overlayFamily.id),
          eq(playbookVersions.status, 'published'),
          lte(playbookVersions.effectiveFrom, evaluatedAt),
          or(isNull(playbookVersions.effectiveTo), gt(playbookVersions.effectiveTo, evaluatedAt))
        )
      )
      .orderBy(playbookVersions.effectiveFrom)
      .limit(1)

    if (overlayVersion !== undefined) {
      overlayVersionId = overlayVersion.id
    }
  }

  // Step 4: Resolve org strategy profile
  const [orgConfig] = await db
    .select({ strategyProfile: orgPlaybookConfigs.strategyProfile })
    .from(orgPlaybookConfigs)
    .where(
      and(
        eq(orgPlaybookConfigs.organizationId, organizationId),
        eq(orgPlaybookConfigs.familyId, baseFamily.id)
      )
    )
    .limit(1)

  const strategyProfile = orgConfig?.strategyProfile ?? 'standard'

  return {
    found: true,
    baseVersionId: baseVersion.id,
    overlayVersionId,
    strategyProfile,
  }
}
