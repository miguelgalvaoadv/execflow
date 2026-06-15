/**
 * Promotion rules — maps extractionType + documentClass to snapshot kind.
 *
 * Deterministic-first: explicit rules only; no LLM inference.
 */

import type { SnapshotKind } from '@execflow/db/types'

export type PromotionRule = {
  extractionTypes: readonly string[]
  documentClasses?: readonly string[] | undefined
  snapshotKind: SnapshotKind
}

/** Ordered rules — first match wins. */
export const PROMOTION_RULES: readonly PromotionRule[] = [
  {
    extractionTypes: ['sentence', 'sentenca'],
    snapshotKind: 'sentence',
  },
  {
    extractionTypes: ['custody', 'certidao_carceraria'],
    snapshotKind: 'custody',
  },
  {
    extractionTypes: ['generic'],
    documentClasses: ['sentenca', 'acordao', 'despacho'],
    snapshotKind: 'sentence',
  },
  {
    extractionTypes: ['generic'],
    documentClasses: ['certidao_carceraria', 'guia_de_execucao'],
    snapshotKind: 'custody',
  },
] as const

export function resolvePromotionKind(params: {
  extractionType: string
  documentClass: string | null
}): SnapshotKind | null {
  for (const rule of PROMOTION_RULES) {
    if (!rule.extractionTypes.includes(params.extractionType)) continue
    if (rule.documentClasses !== undefined) {
      if (params.documentClass === null) continue
      if (!rule.documentClasses.includes(params.documentClass)) continue
    }
    return rule.snapshotKind
  }
  return null
}
