import type { StorageConfig, StorageProviderId } from './types.ts'

/** Legal document MIME types allowed at upload (expandable via env). */
export const DEFAULT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const

// 50 MiB → 300 MiB: achado 08/07/2026 (revisão geral pedida pelo Miguel) —
// autos escaneados reais de execução penal passam fácil de 100-200MB (o
// próprio upload/blob PUT já foi reescrito em streaming pra aguentar isso,
// ver services/upload.ts), mas o limite de validação continuava em 50MB e
// rejeitava esses arquivos ANTES de chegar no streaming — o auto real nunca
// nem começava a subir. 300MB dá margem confortável; S3 aceita até 5GB
// numa única PUT, então o teto real não é a AWS, é essa constante.
const DEFAULT_MAX_UPLOAD_BYTES = 314_572_800 // 300 MiB
const DEFAULT_UPLOAD_EXPIRES_SECONDS = 900 // 15 minutes

export function resolveStorageConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): StorageConfig {
  const provider = (env['STORAGE_PROVIDER'] ?? 'local') as StorageProviderId

  const maxUploadBytes = parsePositiveInt(env['STORAGE_MAX_UPLOAD_BYTES'], DEFAULT_MAX_UPLOAD_BYTES)
  const uploadUrlExpiresSeconds = parsePositiveInt(
    env['STORAGE_UPLOAD_EXPIRES_SECONDS'],
    DEFAULT_UPLOAD_EXPIRES_SECONDS
  )

  const allowedMimeTypes =
    env['STORAGE_ALLOWED_MIME_TYPES']?.split(',').map((s) => s.trim()).filter(Boolean) ??
    [...DEFAULT_ALLOWED_MIME_TYPES]

  const base: StorageConfig = {
    provider,
    maxUploadBytes,
    allowedMimeTypes,
    uploadUrlExpiresSeconds,
  }

  if (provider === 'local') {
    return {
      ...base,
      local: {
        basePath: env['STORAGE_LOCAL_PATH'] ?? '.storage',
        apiBaseUrl: env['STORAGE_API_BASE_URL'] ?? env['BETTER_AUTH_URL'] ?? 'http://localhost:3001',
      },
    }
  }

  const bucket = env['STORAGE_S3_BUCKET']
  const accessKeyId = env['STORAGE_S3_ACCESS_KEY_ID']
  const secretAccessKey = env['STORAGE_S3_SECRET_ACCESS_KEY']

  if (bucket === undefined || accessKeyId === undefined || secretAccessKey === undefined) {
    throw new Error(
      '[storage] STORAGE_PROVIDER=s3 requires STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY.'
    )
  }

  return {
    ...base,
    s3: {
      bucket,
      region: env['STORAGE_S3_REGION'] ?? 'auto',
      endpoint: env['STORAGE_S3_ENDPOINT'],
      accessKeyId,
      secretAccessKey,
      forcePathStyle: env['STORAGE_S3_FORCE_PATH_STYLE'] === 'true',
    },
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function buildStorageKey(params: {
  organizationId: string
  uploadId: string
  fileName: string
}): string {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const ext = extractExtension(params.fileName)
  return `${params.organizationId}/${year}/${month}/${params.uploadId}${ext}`
}

function extractExtension(fileName: string): string {
  const base = fileName.trim()
  const idx = base.lastIndexOf('.')
  if (idx <= 0 || idx === base.length - 1) return ''
  const ext = base.slice(idx).toLowerCase()
  if (ext.length > 12) return ''
  if (!/^\.[a-z0-9]+$/.test(ext)) return ''
  return ext
}

export function assertStorageKeyBelongsToOrg(storageKey: string, organizationId: string): void {
  const prefix = `${organizationId}/`
  if (!storageKey.startsWith(prefix)) {
    throw new Error('Storage key is not scoped to the active organization.')
  }
}
