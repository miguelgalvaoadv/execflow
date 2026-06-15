import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Readable } from 'node:stream'
import type {
  ObjectVerificationRequest,
  ObjectVerificationResult,
  PresignedUploadRequest,
  PresignedUploadResult,
  StorageProvider,
} from './types.ts'
import { StorageVerificationError } from './types.ts'
import { normalizeChecksumSha256, sha256Hex } from './checksum.ts'

export type S3StorageProviderOptions = {
  bucket: string
  region: string
  endpoint?: string | undefined
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle?: boolean | undefined
}

/**
 * S3-compatible provider (Cloudflare R2, AWS S3, MinIO).
 * Objects are immutable — presigned PUT uses a unique key per upload.
 */
export function createS3StorageProvider(options: S3StorageProviderOptions): StorageProvider {
  const client = new S3Client({
    region: options.region,
    ...(options.endpoint !== undefined ? { endpoint: options.endpoint } : {}),
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
    ...(options.forcePathStyle === true ? { forcePathStyle: true } : {}),
  })

  return {
    id: 's3',

    async createPresignedUpload(request: PresignedUploadRequest): Promise<PresignedUploadResult> {
      const command = new PutObjectCommand({
        Bucket: options.bucket,
        Key: request.storageKey,
        ContentType: request.mimeType,
        ContentLength: request.byteSize,
      })

      const uploadUrl = await getSignedUrl(client, command, {
        expiresIn: request.expiresInSeconds,
      })

      return {
        uploadUrl,
        method: 'PUT',
        headers: {
          'Content-Type': request.mimeType,
          'Content-Length': String(request.byteSize),
        },
      }
    },

    async verifyObject(request: ObjectVerificationRequest): Promise<ObjectVerificationResult> {
      try {
        const head = await client.send(
          new HeadObjectCommand({
            Bucket: options.bucket,
            Key: request.storageKey,
          })
        )

        const size = head.ContentLength ?? 0
        if (size !== request.expectedByteSize) {
          throw new StorageVerificationError(
            'SIZE_MISMATCH',
            `Expected ${request.expectedByteSize} bytes, found ${size}.`
          )
        }

        const get = await client.send(
          new GetObjectCommand({
            Bucket: options.bucket,
            Key: request.storageKey,
          })
        )

        const body = await streamToBuffer(get.Body)
        const checksumSha256 = sha256Hex(body)
        const expected = normalizeChecksumSha256(request.expectedChecksumSha256)

        if (checksumSha256 !== expected) {
          throw new StorageVerificationError(
            'CHECKSUM_MISMATCH',
            'Stored object checksum does not match declared checksumSha256.'
          )
        }

        return {
          storageKey: request.storageKey,
          byteSize: body.byteLength,
          checksumSha256,
          mimeType: request.expectedMimeType,
        }
      } catch (err) {
        if (err instanceof StorageVerificationError) throw err
        throw new StorageVerificationError('NOT_FOUND', 'Uploaded object not found in storage.')
      }
    },

    async getObject(storageKey: string): Promise<Buffer> {
      try {
        const get = await client.send(
          new GetObjectCommand({
            Bucket: options.bucket,
            Key: storageKey,
          })
        )
        return streamToBuffer(get.Body)
      } catch (err) {
        throw new StorageVerificationError('NOT_FOUND', 'Object not found in S3.')
      }
    },
  }
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (body === undefined || body === null) {
    throw new StorageVerificationError('NOT_FOUND', 'Empty object body.')
  }

  if (Buffer.isBuffer(body)) return body
  if (body instanceof Uint8Array) return Buffer.from(body)

  if (typeof body === 'object' && body !== null && 'transformToByteArray' in body) {
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray()
    return Buffer.from(bytes)
  }

  const stream = body as Readable
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
