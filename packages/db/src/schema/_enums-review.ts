/**
 * Human review decision enums.
 */

import { pgEnum } from 'drizzle-orm/pg-core'

export const reviewSubjectTypeEnum = pgEnum('review_subject_type', ['extraction', 'snapshot'])

export const reviewDecisionEnum = pgEnum('review_decision', ['approved', 'rejected'])

export type ReviewSubjectType = (typeof reviewSubjectTypeEnum.enumValues)[number]
export type ReviewDecision = (typeof reviewDecisionEnum.enumValues)[number]
