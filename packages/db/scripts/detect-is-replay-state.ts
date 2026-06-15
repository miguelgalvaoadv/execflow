/**
 * Detect engine_runs.is_replay column type and invalid JSONB values.
 *
 * Usage: pnpm --filter @execflow/db db:detect-is-replay
 */

import pg from 'pg'

const url = process.env['DATABASE_URL']
if (!url) {
  console.error('[detect-is-replay] DATABASE_URL is required')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: url })

try {
  const col = await pool.query<{ data_type: string; column_default: string | null }>(`
    SELECT data_type, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'engine_runs'
      AND column_name = 'is_replay'
  `)

  if (col.rows.length === 0) {
    console.log(JSON.stringify({ status: 'no_column', recommendation: 'run db:migrate' }))
    process.exit(0)
  }

  const dataType = col.rows[0]!.data_type
  let invalidCount = 0
  let invalidSample: unknown[] = []

  if (dataType === 'jsonb') {
    const invalid = await pool.query<{ id: string; is_replay: string }>(`
      SELECT id::text, is_replay::text
      FROM engine_runs
      WHERE is_replay IS NOT NULL
        AND is_replay NOT IN ('true'::jsonb, 'false'::jsonb)
    `)
    invalidCount = invalid.rows.length
    invalidSample = invalid.rows.slice(0, 5)
  }

  const strategy =
    dataType === 'boolean'
      ? 'aligned'
      : dataType === 'jsonb'
        ? invalidCount > 0
          ? 'blocked_0007_invalid_data'
          : 'apply_0007'
        : 'manual_intervention'

  console.log(
    JSON.stringify(
      {
        dataType,
        columnDefault: col.rows[0]!.column_default,
        invalidCount,
        invalidSample,
        strategy,
      },
      null,
      2
    )
  )

  if (dataType === 'jsonb' && invalidCount > 0) {
    process.exit(2)
  }
} catch (e) {
  console.error('[detect-is-replay] failed:', e instanceof Error ? e.message : e)
  process.exit(1)
} finally {
  await pool.end()
}
