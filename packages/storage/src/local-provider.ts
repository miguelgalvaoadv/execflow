import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  ObjectVerificationRequest,
  ObjectVerificationResult,
  PresignedUploadRequest,
  PresignedUploadResult,
  StorageProvider,
} from './types.ts'
import { StorageVerificationError } from './types.ts'
import { normalizeChecksumSha256, sha256Hex } from './checksum.ts'

export type LocalStorageProviderOptions = {
  basePath: string
  apiBaseUrl: string
}

/**
 * Local filesystem storage for development and integration tests.
 * Presigned URLs target PUT /api/v1/uploads/blob on the API (token-authenticated).
 */
export function createLocalStorageProvider(
  options: LocalStorageProviderOptions
): StorageProvider {
  const basePath = path.resolve(options.basePath)
  const apiBaseUrl = options.apiBaseUrl.replace(/\/$/, '')

  async function resolvePath(storageKey: string): Promise<string> {
    const normalized = path.normalize(storageKey)
    if (normalized.includes('..') || path.isAbsolute(normalized)) {
      throw new Error('Invalid storage key.')
    }
    return path.join(basePath, normalized)
  }

  return {
    id: 'local',

    async createPresignedUpload(request: PresignedUploadRequest): Promise<PresignedUploadResult> {
      const filePath = await resolvePath(request.storageKey)
      await mkdir(path.dirname(filePath), { recursive: true })

      return {
        uploadUrl: `${apiBaseUrl}/api/v1/uploads/blob`,
        method: 'PUT',
        headers: {
          'Content-Type': request.mimeType,
          'Content-Length': String(request.byteSize),
        },
      }
    },

    async verifyObject(request: ObjectVerificationRequest): Promise<ObjectVerificationResult> {
      const filePath = await resolvePath(request.storageKey)

      let data: Buffer
      try {
        data = await readFile(filePath)
      } catch {
        throw new StorageVerificationError('NOT_FOUND', 'Uploaded object not found in storage.')
      }

      if (data.byteLength !== request.expectedByteSize) {
        throw new StorageVerificationError(
          'SIZE_MISMATCH',
          `Expected ${request.expectedByteSize} bytes, found ${data.byteLength}.`
        )
      }

      const checksumSha256 = sha256Hex(data)
      const expected = normalizeChecksumSha256(request.expectedChecksumSha256)

      if (checksumSha256 !== expected) {
        throw new StorageVerificationError(
          'CHECKSUM_MISMATCH',
          'Stored object checksum does not match declared checksumSha256.'
        )
      }

      return {
        storageKey: request.storageKey,
        byteSize: data.byteLength,
        checksumSha256,
        mimeType: request.expectedMimeType,
      }
    },

    async getObject(storageKey: string): Promise<Buffer> {
      const filePath = await resolvePath(storageKey)
      return readFile(filePath)
    },

    async putObject(storageKey: string, body: Buffer, _contentType: string): Promise<void> {
      const filePath = await resolvePath(storageKey)
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, body)
    },
  }
}
