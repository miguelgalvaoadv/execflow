/**
 * Storage provider abstraction — provider-agnostic blob upload contract.
 *
 * Implementations: local filesystem (dev/test), S3-compatible (R2, AWS S3, MinIO).
 * Architecture ref: technical-stack-decision.md §6.1.
 */

export type StorageProviderId = 'local' | 's3'

export type PresignedUploadRequest = {
  storageKey: string
  mimeType: string
  byteSize: number
  expiresInSeconds: number
}

export type PresignedUploadResult = {
  uploadUrl: string
  method: 'PUT'
  headers: Record<string, string>
}

export type ObjectVerificationRequest = {
  storageKey: string
  expectedByteSize: number
  expectedChecksumSha256: string
  expectedMimeType: string
}

export type ObjectVerificationResult = {
  storageKey: string
  byteSize: number
  checksumSha256: string
  mimeType: string
}

export class StorageVerificationError extends Error {
  readonly code: 'NOT_FOUND' | 'CHECKSUM_MISMATCH' | 'SIZE_MISMATCH' | 'MIME_MISMATCH'

  constructor(
    code: StorageVerificationError['code'],
    message: string
  ) {
    super(message)
    this.name = 'StorageVerificationError'
    this.code = code
  }
}

export interface StorageProvider {
  readonly id: StorageProviderId

  /** Issue a presigned URL for direct client upload (immutable object key). */
  createPresignedUpload(request: PresignedUploadRequest): Promise<PresignedUploadResult>

  /** Verify stored object matches declared metadata (checksum mandatory). */
  verifyObject(request: ObjectVerificationRequest): Promise<ObjectVerificationResult>

  /** Retrieve stored object bytes. Throws if not found. */
  getObject(storageKey: string): Promise<Buffer>

  /**
   * Write bytes at storageKey — local provider only (dev PUT handler / tests).
   * S3 provider throws — clients upload via presigned URL.
   */
  putObject?(storageKey: string, body: Buffer, contentType: string): Promise<void>

  /**
   * Streams bytes directly to storageKey — never buffers the whole body in
   * memory. Preferred over putObject for the local PUT handler (large scanned
   * autos can be hundreds of MB; buffering risks OOM on small instances).
   * Local provider only — same scope as putObject.
   */
  putObjectStream?(
    storageKey: string,
    body: ReadableStream<Uint8Array>,
    contentType: string
  ): Promise<{ byteSize: number }>
}

export type StorageConfig = {
  provider: StorageProviderId
  local?: {
    basePath: string
    apiBaseUrl: string
  }
  s3?: {
    bucket: string
    region: string
    endpoint?: string | undefined
    accessKeyId: string
    secretAccessKey: string
    forcePathStyle?: boolean | undefined
  }
  maxUploadBytes: number
  allowedMimeTypes: readonly string[]
  uploadUrlExpiresSeconds: number
}
