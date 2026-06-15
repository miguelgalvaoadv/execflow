import type { StorageConfig, StorageProvider } from './types.ts'
import { resolveStorageConfigFromEnv } from './config.ts'
import { createLocalStorageProvider } from './local-provider.ts'
import { createS3StorageProvider } from './s3-provider.ts'

export function createStorageProvider(config: StorageConfig): StorageProvider {
  if (config.provider === 'local') {
    if (config.local === undefined) {
      throw new Error('[storage] local provider config is missing.')
    }
    return createLocalStorageProvider(config.local)
  }

  if (config.s3 === undefined) {
    throw new Error('[storage] s3 provider config is missing.')
  }

  return createS3StorageProvider(config.s3)
}

export function createStorageProviderFromEnv(
  env: Record<string, string | undefined> = process.env
): StorageProvider {
  return createStorageProvider(resolveStorageConfigFromEnv(env))
}

export { createLocalStorageProvider } from './local-provider.ts'
export { createS3StorageProvider } from './s3-provider.ts'
export {
  resolveStorageConfigFromEnv,
  buildStorageKey,
  assertStorageKeyBelongsToOrg,
  DEFAULT_ALLOWED_MIME_TYPES,
} from './config.ts'
export { sha256Hex, normalizeChecksumSha256, isValidChecksumSha256 } from './checksum.ts'
export { StorageVerificationError } from './types.ts'
export type {
  StorageProvider,
  StorageConfig,
  StorageProviderId,
  PresignedUploadRequest,
  PresignedUploadResult,
  ObjectVerificationRequest,
  ObjectVerificationResult,
} from './types.ts'
