/**
 * Storage provider singleton for apps/api.
 */

import {
  createStorageProviderFromEnv,
  resolveStorageConfigFromEnv,
  type StorageConfig,
  type StorageProvider,
} from '@execflow/storage'

let provider: StorageProvider | undefined
let config: StorageConfig | undefined

export function getStorageConfig(): StorageConfig {
  if (config === undefined) {
    config = resolveStorageConfigFromEnv()
  }
  return config
}

export function getStorageProvider(): StorageProvider {
  if (provider === undefined) {
    provider = createStorageProviderFromEnv()
  }
  return provider
}

/** Integration tests — re-read env and rebuild provider. */
export function resetStorageProviderForTests(): void {
  provider = undefined
  config = undefined
}

export function setStorageProviderForTests(next: StorageProvider, nextConfig?: StorageConfig): void {
  provider = next
  if (nextConfig !== undefined) {
    config = nextConfig
  }
}
