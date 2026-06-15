/**
 * Runtime assertion for engine_runs.is_replay — strict boolean only.
 *
 * No coercion, no fallback. Throws if persistence layer returns a non-boolean.
 * Used at read boundaries (API, smoke validation) to detect type corruption early.
 */

export function assertEngineRunIsReplayBoolean(
  value: unknown,
  context: string
): asserts value is boolean {
  if (typeof value !== 'boolean') {
    throw new Error(
      `[execflow/db] engine_runs.is_replay must be boolean at ${context}, received ${typeof value}`
    )
  }
}

export function assertEngineRunRowIsReplayBoolean(
  row: { isReplay: unknown },
  context: string
): void {
  assertEngineRunIsReplayBoolean(row.isReplay, context)
}
