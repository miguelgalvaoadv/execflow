import { createHash } from 'node:crypto'

/** SHA-256 hex digest of buffer (lowercase). */
export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function normalizeChecksumSha256(value: string): string {
  return value.trim().toLowerCase()
}

export function isValidChecksumSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value)
}
