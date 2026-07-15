/**
 * Transactional outbox relay worker.
 *
 * WHAT THIS DOES:
 * Reads DomainEvent records with processing_status = 'pending' from the
 * domain_events table and publishes them as pg-boss jobs. This decouples
 * the HTTP request (which writes the event) from async consumers (queue
 * projections, notifications, engine triggers).
 *
 * DESIGN:
 * The relay runs as a setInterval loop (every 2 seconds). It does NOT use
 * pg-boss to schedule itself — that would create a circular dependency
 * (relay publishes to pg-boss, but is also managed by pg-boss).
 *
 * CONCURRENCY SAFETY:
 * The relay uses SELECT FOR UPDATE SKIP LOCKED to safely handle multiple
 * relay instances (e.g., two worker process replicas). Each relay locks the
 * rows it's processing, preventing double-publication.
 *
 * IDEMPOTENCY:
 * Events are published with `singletonKey = event.id` so that pg-boss
 * deduplicates if the same event is accidentally published twice (e.g., relay
 * crashes after publish but before marking as published).
 *
 * ERROR HANDLING:
 * Failed publications increment retry_count on the event. After MAX_RETRIES,
 * the event is marked 'dead_lettered' and admin alert should fire (future).
 *
 * Architecture ref: event-state-architecture.md §2.7 (transactional outbox),
 *                   event-state-architecture.md §2.11 (failure tolerance).
 */

import { sql } from '@execflow/db/client'
import type { PgBoss } from 'pg-boss'
import type { WorkersDb } from '../lib/db.ts'
import { DOMAIN_EVENT_SEND_OPTIONS } from '../queues/config.ts'
import * as QUEUE_NAMES from '../queues/names.ts'

const BATCH_SIZE = 50
const MAX_RETRIES = 5
const LOCK_DURATION_MINUTES = 5

/**
 * Filas que realmente existem no pg-boss (criadas no boot pelo worker-registry
 * a partir de queues/names.ts). Evento cujo event_type NÃO está aqui é
 * "só-registro" (notificação/auditoria sem consumidor) — ex.:
 * case.movements.received, ocr.running, client.created. Antes desta guarda,
 * cada um desses era enviado ao pg-boss, estourava "Queue does not exist",
 * era retentado 5x e virava lixo permanente com status 'failed' — foram
 * 15.440 eventos assim entre 21/06 e 13/07/2026, poluindo o sinal de saúde
 * do outbox. Agora: marca 'published' direto (o registro em domain_events É
 * o produto final desses eventos), sem tentativa de publicação.
 */
const KNOWN_QUEUES: ReadonlySet<string> = new Set(
  Object.values(QUEUE_NAMES as Record<string, unknown>).filter(
    (v): v is string => typeof v === 'string'
  )
)

/**
 * Runs one relay cycle: picks up pending events and publishes them.
 * Called by the interval loop. Returns the count of events published.
 */
async function relayOnce(db: WorkersDb, boss: PgBoss): Promise<number> {
  const now = new Date()
  const lockUntil = new Date(now.getTime() + LOCK_DURATION_MINUTES * 60 * 1000)

  return db.transaction(async (tx) => {
    const { domainEvents } = await import('@execflow/db/schema')

    // -------------------------------------------------------------------------
    // 1. Fetch and lock a batch of pending events
    //    Using raw SQL for SELECT FOR UPDATE SKIP LOCKED — Drizzle doesn't
    //    have a typed API for this PostgreSQL-specific locking clause.
    // -------------------------------------------------------------------------
    type OutboxRow = {
      id: string
      event_type: string
      payload: Record<string, unknown>
      occurred_at: string
      organization_id: string | null
      correlation_id: string
      causation_id: string | null
      retry_count: number
    }

    const queryResult = await tx.execute<OutboxRow>(sql`
      SELECT
        id,
        event_type,
        payload,
        occurred_at,
        organization_id,
        correlation_id,
        causation_id,
        retry_count
      FROM domain_events
      WHERE
        processing_status = 'pending'
        AND (locked_until IS NULL OR locked_until < ${now.toISOString()})
        AND retry_count < ${MAX_RETRIES}
      ORDER BY recorded_at ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `)

    // Pool-based execute returns QueryResult<T>; rows are in .rows (pg standard).
    // If the result is already array-like (HTTP driver), fall back gracefully.
    const rows: OutboxRow[] = Array.isArray(queryResult)
      ? (queryResult as OutboxRow[])
      : ((queryResult as { rows?: OutboxRow[] }).rows ?? [])

    if (rows.length === 0) {
      return 0
    }

    // -------------------------------------------------------------------------
    // 2. Lock all fetched rows atomically (within the same transaction)
    // -------------------------------------------------------------------------
    const ids = rows.map((r) => r.id)
    await tx
      .update(domainEvents)
      .set({ lockedUntil: lockUntil })
      .where(
        sql`id = ANY(${sql.raw(`ARRAY[${ids.map((id) => `'${id}'`).join(',')}]::uuid[]`)})`
      )

    // -------------------------------------------------------------------------
    // 3. Publish each event to pg-boss OUTSIDE the transaction
    //    (pg-boss jobs are committed to its own tables independently)
    // -------------------------------------------------------------------------
    const published: string[] = []
    const failed: Array<{ id: string; error: string }> = []
    let notificationOnly = 0

    for (const row of rows) {
      // Evento sem fila/consumidor: o registro em domain_events já é o
      // produto final — marca como publicado sem tentar enviar ao pg-boss.
      if (!KNOWN_QUEUES.has(row.event_type)) {
        published.push(row.id)
        notificationOnly++
        continue
      }
      try {
        await boss.send(
          row.event_type,
          {
            eventId: row.id,
            eventType: row.event_type,
            payload: row.payload,
            occurredAt: row.occurred_at,
            organizationId: row.organization_id,
            correlationId: row.correlation_id,
            causationId: row.causation_id,
          },
          {
            ...DOMAIN_EVENT_SEND_OPTIONS,
            singletonKey: row.id,
          }
        )
        published.push(row.id)
      } catch (err) {
        failed.push({
          id: row.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // -------------------------------------------------------------------------
    // 4. Mark published events and handle failures
    //    These updates are in separate statements (not part of the lock tx)
    //    because pg-boss send already committed above.
    // -------------------------------------------------------------------------
    const publishedAt = new Date()

    if (published.length > 0) {
      await tx.execute(sql`
        UPDATE domain_events
        SET
          processing_status = 'published',
          published_at = ${publishedAt.toISOString()},
          locked_until = NULL
        WHERE id = ANY(${sql.raw(`ARRAY[${published.map((id) => `'${id}'`).join(',')}]::uuid[]`)})
      `)
    }

    for (const { id, error } of failed) {
      await tx.execute(sql`
        UPDATE domain_events
        SET
          retry_count = retry_count + 1,
          failed_at = ${publishedAt.toISOString()},
          last_error_message = ${error},
          locked_until = NULL,
          processing_status = CASE
            WHEN retry_count + 1 >= ${MAX_RETRIES} THEN 'failed'
            ELSE processing_status
          END
        WHERE id = ${id}::uuid
      `)
    }

    if (failed.length > 0) {
      console.error(`[outbox-relay] ${failed.length} events failed to publish`)
    }
    if (notificationOnly > 0) {
      console.info(`[outbox-relay] ${notificationOnly} evento(s) só-registro (sem consumidor) marcados como published sem envio`)
    }

    return published.length
  })
}

/**
 * Starts the outbox relay as a recurring interval.
 * Returns a cleanup function that stops the relay.
 *
 * @param db - Drizzle workers database client
 * @param boss - pg-boss instance
 * @param intervalMs - How often to check for pending events (default: 2000ms)
 */
export function startOutboxRelay(
  db: WorkersDb,
  boss: PgBoss,
  intervalMs = 2000
): () => void {
  let running = false

  const tick = async () => {
    if (running) return
    running = true
    try {
      const count = await relayOnce(db, boss)
      if (count > 0) {
        console.info(`[outbox-relay] Published ${count} events`)
      }
    } catch (err) {
      console.error('[outbox-relay] Relay cycle failed:', err)
    } finally {
      running = false
    }
  }

  const handle = setInterval(() => { void tick() }, intervalMs)
  console.info(`[outbox-relay] Started (interval: ${intervalMs}ms)`)

  return () => {
    clearInterval(handle)
    console.info('[outbox-relay] Stopped')
  }
}
