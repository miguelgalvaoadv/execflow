/**
 * Signed upload tokens — stateless upload session contract between request and complete.
 *
 * Tokens bind organization, actor, storage key, and declared checksum.
 * Verified on blob PUT (local) and on upload complete before document registration.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IntakeSourceChannel } from '@execflow/db/types'

export type UploadTokenPayload = {
  v: 1
  uploadId: string
  organizationId: string
  userId: string
  storageKey: string
  fileName: string
  mimeType: string
  byteSize: number
  checksumSha256: string
  sourceChannel: IntakeSourceChannel
  expiresAt: number
}

export type SignUploadTokenInput = Omit<UploadTokenPayload, 'v' | 'expiresAt'> & {
  expiresAt: Date
}

function resolveUploadTokenSecret(): string {
  const secret =
    process.env['UPLOAD_TOKEN_SECRET']?.trim() ||
    process.env['BETTER_AUTH_SECRET']?.trim()

  if (secret === undefined || secret.length < 32) {
    throw new Error(
      '[upload-token] UPLOAD_TOKEN_SECRET or BETTER_AUTH_SECRET (32+ chars) is required.'
    )
  }
  return secret
}

export function signUploadToken(input: SignUploadTokenInput): string {
  const payload: UploadTokenPayload = {
    v: 1,
    uploadId: input.uploadId,
    organizationId: input.organizationId,
    userId: input.userId,
    storageKey: input.storageKey,
    fileName: input.fileName,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    checksumSha256: input.checksumSha256.toLowerCase(),
    sourceChannel: input.sourceChannel,
    expiresAt: input.expiresAt.getTime(),
  }

  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = createHmac('sha256', resolveUploadTokenSecret())
    .update(body)
    .digest('base64url')

  return `${body}.${sig}`
}

export function verifyUploadToken(token: string): UploadTokenPayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null

  const body = parts[0]
  const sig = parts[1]
  if (body === undefined || sig === undefined) return null

  const expected = createHmac('sha256', resolveUploadTokenSecret())
    .update(body)
    .digest('base64url')

  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as UploadTokenPayload
    if (parsed.v !== 1) return null
    if (Date.now() > parsed.expiresAt) return null
    return parsed
  } catch {
    return null
  }
}

/** Test-only: override secret resolution by setting env before calls. */
export function resetUploadTokenSecretForTests(): void {
  // no-op — tests set process.env.UPLOAD_TOKEN_SECRET directly
}
