/**
 * Canonical actor attribution for deadline_history writes.
 *
 * Matches opportunity_status_history and domain_events semantics.
 * No system-user UUIDs, no coercion, no nullable-only attribution.
 */

export const DEADLINE_HISTORY_SYSTEM_ACTOR_OVERDUE_SWEEP = 'sla-monitor.overdue-sweep'

export type DeadlineHistoryUserActor = {
  changedByActorType: 'user'
  changedByActorId: string
  changedByUserId: string
}

export type DeadlineHistorySystemActor = {
  changedByActorType: 'system'
  changedByActorId: string
  changedByUserId: null
}

export function deadlineHistoryUserActor(userId: string): DeadlineHistoryUserActor {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new Error('[execflow/db] deadline_history user actor requires non-empty userId')
  }
  return {
    changedByActorType: 'user',
    changedByActorId: userId,
    changedByUserId: userId,
  }
}

export function deadlineHistorySystemActor(actorId: string): DeadlineHistorySystemActor {
  if (typeof actorId !== 'string' || actorId.trim() === '') {
    throw new Error('[execflow/db] deadline_history system actor requires non-empty actorId')
  }
  return {
    changedByActorType: 'system',
    changedByActorId: actorId,
    changedByUserId: null,
  }
}

export function assertDeadlineHistoryActorAttribution(row: {
  changedByActorType: unknown
  changedByActorId: unknown
  changedByUserId?: unknown
}): void {
  if (typeof row.changedByActorType !== 'string' || row.changedByActorType.trim() === '') {
    throw new Error(
      `[execflow/db] deadline_history.changed_by_actor_type must be non-empty string, received ${typeof row.changedByActorType}`
    )
  }
  if (typeof row.changedByActorId !== 'string' || row.changedByActorId.trim() === '') {
    throw new Error(
      `[execflow/db] deadline_history.changed_by_actor_id must be non-empty string, received ${typeof row.changedByActorId}`
    )
  }
  if (row.changedByActorType === 'user') {
    if (typeof row.changedByUserId !== 'string' || row.changedByUserId.trim() === '') {
      throw new Error('[execflow/db] deadline_history.changed_by_user_id required when actor_type=user')
    }
    if (row.changedByUserId !== row.changedByActorId) {
      throw new Error(
        '[execflow/db] deadline_history.changed_by_user_id must match changed_by_actor_id for user actors'
      )
    }
  } else if (row.changedByUserId !== null && row.changedByUserId !== undefined) {
    throw new Error(
      `[execflow/db] deadline_history.changed_by_user_id must be null for actor_type=${row.changedByActorType}`
    )
  }
}
