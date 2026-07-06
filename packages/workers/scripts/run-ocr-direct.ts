/**
 * Executa o OCR de um documento DIRETAMENTE (sem fila) com o provider real.
 * Uso: pnpm --filter @execflow/workers exec tsx --env-file=.env.local scripts/run-ocr-direct.ts <documentId> <orgId>
 *
 * Útil quando a fila compartilhada está sendo consumida por outro processo
 * (ex.: worker antigo no Render) ou para reprocessar um documento pontual.
 */
import { randomUUID } from 'node:crypto'
import { createWorkersDb } from '../src/lib/db.ts'
import { scheduleOcrForDocument, executeOcrRun } from '../src/ocr/runner.ts'
import { createOcrProvider, resolveOcrMaxAttempts } from '@execflow/ocr'
import { createStorageProviderFromEnv } from '@execflow/storage'

const [documentId, organizationId] = process.argv.slice(2)
if (!documentId || !organizationId) {
  console.error('Uso: run-ocr-direct.ts <documentId> <orgId>')
  process.exit(1)
}

const db = createWorkersDb(process.env['DATABASE_URL']!)
const storage = createStorageProviderFromEnv()
const provider = createOcrProvider(process.env, {
  getObject: (key) => storage.getObject(key),
})
console.log('Provider:', provider.id)

const triggerEventId = randomUUID()
const ocrRunId = await scheduleOcrForDocument(db, {
  organizationId,
  documentId,
  triggerEventId,
  correlationId: triggerEventId,
  providerId: provider.id,
  maxAttempts: resolveOcrMaxAttempts(),
})
console.log('Run agendado:', ocrRunId)

const t0 = Date.now()
await executeOcrRun(db, provider, {
  ocrRunId: ocrRunId!,
  organizationId,
  correlationId: triggerEventId,
  causationEventId: triggerEventId,
})
console.log(`Execução concluída em ${((Date.now() - t0) / 1000).toFixed(1)}s`)
process.exit(0)
