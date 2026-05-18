/**
 * Playbook loader — loads and merges PlaybookVersion rule groups from the database.
 *
 * Implements the resolution order:
 *   Case override > Org overlay > Base version (playbook-system.md §2.4)
 *
 * The loader returns a ResolvedPlaybook — the merged, in-memory rule set
 * for a single engine run. This is loaded ONCE per run and passed immutably
 * to all rule evaluators (deterministic; no re-queries inside evaluation).
 *
 * RULE MERGE SEMANTICS:
 * - Base version provides all rules.
 * - Org overlay overrides rules by rule_id match.
 * - Case context overrides specific branch selections by rule_id.
 * - Missing branch: use playbook default (isDefault=true).
 * - Strategy profile: used to select between equally-valid branches when
 *   no explicit default is marked.
 *
 * Architecture ref: playbook-system.md §7.1, §5.2.
 */

import { eq, and, isNull } from '@execflow/db/client'
import type { AnyDbClient } from '@execflow/db/client'
import {
  playbookVersions,
  casePlaybookContexts,
  orgPlaybookConfigs,
} from '@execflow/db/schema'
import type {
  ResolvedPlaybook,
  PlaybookRuleGroup,
  PlaybookBranch,
  PlaybookRule,
} from '../types/index.ts'

type RawRuleGroups = {
  groups: Array<{
    groupId: string
    label: string
    rules: Array<{
      ruleId: string
      evaluatorId: string
      cautionLevel: 'low' | 'elevated' | 'informational_only'
      requiresPartnerReview: boolean
      branches: Array<{
        branchId: string
        label: string
        isDefault: boolean
        parameters: Record<string, unknown>
        legalReferences: string[]
        riskDisclosureText?: string
        cautionLevel?: 'standard' | 'elevated' | 'prohibited_without_partner_review'
      }>
    }>
  }>
}

export type LoadPlaybookInput = {
  organizationId: string
  baseVersionId: string
  overlayVersionId: string | null
  executionCaseId: string
  strategyProfile: 'conservative' | 'standard' | 'aggressive'
  evaluatedAt: Date
}

/**
 * Loads and merges the full playbook for an engine run.
 * Returns a ResolvedPlaybook with a pre-built ruleMap for O(1) lookup.
 */
export async function loadPlaybook(
  db: AnyDbClient,
  input: LoadPlaybookInput
): Promise<ResolvedPlaybook> {
  const { organizationId, baseVersionId, overlayVersionId, executionCaseId, strategyProfile, evaluatedAt } = input

  // Load base version
  const [baseVersion] = await db
    .select({
      id: playbookVersions.id,
      versionLabel: playbookVersions.versionLabel,
      effectiveFrom: playbookVersions.effectiveFrom,
      ruleGroups: playbookVersions.ruleGroups,
      jurisdictionScope: playbookFamilyJoin,
    })
    .from(playbookVersions)
    .where(eq(playbookVersions.id, baseVersionId))
    .limit(1)

  // Fallback: load directly without join
  const [baseRow] = await db
    .select()
    .from(playbookVersions)
    .where(eq(playbookVersions.id, baseVersionId))
    .limit(1)

  if (baseRow === undefined) {
    throw new Error(`PlaybookVersion not found: ${baseVersionId}`)
  }

  // Parse base rule groups
  const baseGroups = parseRuleGroups(baseRow.ruleGroups as RawRuleGroups)

  // Load and merge overlay if present
  let mergedGroups = baseGroups
  if (overlayVersionId !== null) {
    const [overlayRow] = await db
      .select()
      .from(playbookVersions)
      .where(eq(playbookVersions.id, overlayVersionId))
      .limit(1)

    if (overlayRow !== undefined) {
      const overlayGroups = parseRuleGroups(overlayRow.ruleGroups as RawRuleGroups)
      mergedGroups = mergeRuleGroups(baseGroups, overlayGroups)
    }
  }

  // Load org default branch overrides
  const [orgConfig] = await db
    .select({ defaultBranches: orgPlaybookConfigs.defaultBranches })
    .from(orgPlaybookConfigs)
    .where(eq(orgPlaybookConfigs.organizationId, organizationId))
    .limit(1)

  const orgDefaultBranches = (orgConfig?.defaultBranches ?? {}) as Record<string, string>

  // Load case context overrides (active, not superseded)
  const [caseContext] = await db
    .select({ branchOverrides: casePlaybookContexts.branchOverrides })
    .from(casePlaybookContexts)
    .where(
      and(
        eq(casePlaybookContexts.executionCaseId, executionCaseId),
        isNull(casePlaybookContexts.supersededAt)
      )
    )
    .orderBy(casePlaybookContexts.createdAt)
    .limit(1)

  const caseOverrides = (caseContext?.branchOverrides ?? {}) as Record<string, string>

  // Build ruleMap with resolved branches
  const ruleMap = buildRuleMap(
    mergedGroups,
    orgDefaultBranches,
    caseOverrides,
    strategyProfile
  )

  return {
    playbookVersionId: baseVersionId,
    overlayVersionId,
    caseContextId: caseContext !== undefined ? executionCaseId : null,
    strategyProfile,
    jurisdictionScope: 'BR-FED', // resolved from family; simplified for Phase 7
    effectiveAt: evaluatedAt,
    groups: mergedGroups,
    ruleMap,
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseRuleGroups(raw: unknown): PlaybookRuleGroup[] {
  if (raw === null || raw === undefined || typeof raw !== 'object') return []
  const data = raw as RawRuleGroups
  if (!Array.isArray(data.groups)) return []

  return data.groups.map((g) => ({
    groupId: g.groupId,
    label: g.label,
    rules: (g.rules ?? []).map(
      (r): PlaybookRule => ({
        ruleId: r.ruleId,
        evaluatorId: r.evaluatorId,
        cautionLevel: r.cautionLevel ?? 'low',
        requiresPartnerReview: r.requiresPartnerReview ?? false,
        branches: (r.branches ?? []).map(
          (b): PlaybookBranch => ({
            branchId: b.branchId,
            label: b.label,
            isDefault: b.isDefault,
            parameters: b.parameters,
            legalReferences: b.legalReferences ?? [],
            ...(b.riskDisclosureText !== undefined
              ? { riskDisclosureText: b.riskDisclosureText }
              : {}),
            ...(b.cautionLevel !== undefined ? { cautionLevel: b.cautionLevel } : {}),
          })
        ),
      })
    ),
  }))
}

/**
 * Merges overlay groups on top of base groups.
 * Overlay wins on rule_id match (rule-level replacement, not field-level merge).
 * Architecture ref: playbook-system.md §2.4 (resolution order).
 */
function mergeRuleGroups(
  base: PlaybookRuleGroup[],
  overlay: PlaybookRuleGroup[]
): PlaybookRuleGroup[] {
  const overlayRuleMap = new Map<string, PlaybookRule>()
  for (const group of overlay) {
    for (const rule of group.rules) {
      overlayRuleMap.set(rule.ruleId, rule)
    }
  }

  return base.map((group) => ({
    ...group,
    rules: group.rules.map((rule) => {
      const overlayRule = overlayRuleMap.get(rule.ruleId)
      return overlayRule ?? rule
    }),
  }))
}

/**
 * Builds the O(1) rule lookup map with resolved branch selections.
 * Priority: case override > org default > playbook default > strategy profile.
 */
function buildRuleMap(
  groups: PlaybookRuleGroup[],
  orgDefaults: Record<string, string>,
  caseOverrides: Record<string, string>,
  strategyProfile: 'conservative' | 'standard' | 'aggressive'
): Map<string, { rule: PlaybookRule; branch: PlaybookBranch }> {
  const map = new Map<string, { rule: PlaybookRule; branch: PlaybookBranch }>()

  for (const group of groups) {
    for (const rule of group.rules) {
      const branch = resolveRuleBranch(rule, caseOverrides, orgDefaults, strategyProfile)
      if (branch !== null) {
        map.set(rule.ruleId, { rule, branch })
      }
    }
  }

  return map
}

function resolveRuleBranch(
  rule: PlaybookRule,
  caseOverrides: Record<string, string>,
  orgDefaults: Record<string, string>,
  strategyProfile: 'conservative' | 'standard' | 'aggressive'
): PlaybookBranch | null {
  if (rule.branches.length === 0) return null

  // 1. Case override (highest priority)
  const caseOverrideBranchId = caseOverrides[rule.ruleId]
  if (caseOverrideBranchId !== undefined) {
    const b = rule.branches.find((b) => b.branchId === caseOverrideBranchId)
    if (b !== undefined) return b
  }

  // 2. Org default branch
  const orgDefaultBranchId = orgDefaults[rule.ruleId]
  if (orgDefaultBranchId !== undefined) {
    const b = rule.branches.find((b) => b.branchId === orgDefaultBranchId)
    if (b !== undefined) return b
  }

  // 3. Playbook-marked default
  const playBookDefault = rule.branches.find((b) => b.isDefault)
  if (playBookDefault !== undefined) return playBookDefault

  // 4. Strategy profile: conservative = first branch, aggressive = last
  if (strategyProfile === 'conservative') return rule.branches[0] ?? null
  if (strategyProfile === 'aggressive') return rule.branches[rule.branches.length - 1] ?? null

  // Standard = first branch as fallback
  return rule.branches[0] ?? null
}

// Workaround: playbookFamilyJoin placeholder (loader uses baseRow directly)
const playbookFamilyJoin = playbookVersions.effectiveFrom
