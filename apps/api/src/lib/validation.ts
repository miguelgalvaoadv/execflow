/**
 * Domain validation helpers for EXECFLOW.
 *
 * These validators enforce Brazilian legal domain constraints at the
 * boundary between HTTP input and domain service calls.
 *
 * PHILOSOPHY: Validators return typed results (never throw) so that callers
 * can decide how to surface failures — as API errors, field-level messages, etc.
 *
 * Sensitive data (CPF) is normalized before validation to remove formatting.
 * The normalized form is what gets stored; we never store formatted CPFs.
 */

// ---------------------------------------------------------------------------
// CPF (Cadastro de Pessoa Física)
// ---------------------------------------------------------------------------

/**
 * Remove all non-digit characters from a CPF string.
 * Input: "123.456.789-09" → Output: "12345678909"
 * Input: "12345678909"    → Output: "12345678909"
 */
export function normalizeCpf(cpf: string): string {
  return cpf.replace(/\D/g, '')
}

/**
 * Validate a CPF using the official modulus-11 algorithm.
 * Accepts formatted (XXX.XXX.XXX-XX) or unformatted (11 digits) input.
 *
 * Returns true if the CPF is structurally valid (not just well-formatted).
 * Note: A valid CPF may still be fictitious — only Receita Federal can confirm.
 *
 * LGPD note: CPF is sensitive personal data. Only pass it to this function
 * when it has been received from a trusted source (authenticated form submission).
 */
export function validateCpf(rawCpf: string): boolean {
  const cpf = normalizeCpf(rawCpf)

  if (cpf.length !== 11) return false

  // Reject all-same-digit sequences (e.g., "00000000000", "11111111111")
  if (/^(\d)\1{10}$/.test(cpf)) return false

  // First check digit (modulus-11 on first 9 digits, weight 10 → 2)
  let sum = 0
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cpf[i]!) * (10 - i)
  }
  let remainder = sum % 11
  const firstDigit = remainder < 2 ? 0 : 11 - remainder
  if (firstDigit !== parseInt(cpf[9]!)) return false

  // Second check digit (modulus-11 on first 10 digits, weight 11 → 2)
  sum = 0
  for (let i = 0; i < 10; i++) {
    sum += parseInt(cpf[i]!) * (11 - i)
  }
  remainder = sum % 11
  const secondDigit = remainder < 2 ? 0 : 11 - remainder
  return secondDigit === parseInt(cpf[10]!)
}

/**
 * Result type for CPF validation.
 */
export type CpfValidationResult =
  | { valid: true; normalized: string }
  | { valid: false; reason: 'invalid_format' | 'invalid_checksum' }

/**
 * Validate and normalize a CPF in one call.
 * Use this at the service layer before storing.
 */
export function validateAndNormalizeCpf(rawCpf: string): CpfValidationResult {
  const normalized = normalizeCpf(rawCpf)
  if (normalized.length !== 11 || !/^\d{11}$/.test(normalized)) {
    return { valid: false, reason: 'invalid_format' }
  }
  if (!validateCpf(normalized)) {
    return { valid: false, reason: 'invalid_checksum' }
  }
  return { valid: true, normalized }
}

// ---------------------------------------------------------------------------
// Process number (número do processo)
// ---------------------------------------------------------------------------

/**
 * Brazilian court process number formats:
 * - CNJ standard: NNNNNNN-DD.AAAA.J.TT.OOOO  (20 digits structured)
 * - Legacy:       various state-specific formats
 *
 * We store the normalized form (digits + dashes only, no dots/spaces).
 * This enables consistent lookup regardless of input formatting.
 */

/**
 * Normalize a process number by removing whitespace and standardizing separators.
 * Preserves the semantic structure (dashes) but removes dots and extra spaces.
 * Input: "1234567-89.2023.8.26.0001" → Output: "1234567-89.2023.8.26.0001"
 * (We actually preserve the full string but strip leading/trailing whitespace)
 *
 * Strategy: Trim and collapse internal whitespace. Do not strip dots/dashes
 * as they carry semantic meaning in the CNJ format.
 */
export function normalizeProcessNumber(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

/**
 * Validate that a process number has a plausible format.
 * Accepts CNJ standard and common legacy formats.
 *
 * CNJ: NNNNNNN-DD.AAAA.J.TT.OOOO
 *   Example: 0012345-67.2023.8.26.0050
 *
 * We use a permissive regex to accommodate legacy formats from different tribunais.
 * Strict CNJ validation would reject valid legacy numbers from state systems.
 */
export function validateProcessNumber(raw: string): boolean {
  const normalized = normalizeProcessNumber(raw)

  // Must be at least 15 characters (minimal format)
  if (normalized.length < 15 || normalized.length > 50) return false

  // CNJ format: NNNNNNN-DD.AAAA.J.TT.OOOO
  const cnjPattern = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/
  if (cnjPattern.test(normalized)) return true

  // Legacy: sequences of digits optionally separated by dots, dashes, slashes
  // At minimum: 10+ alphanumeric characters with separators
  const legacyPattern = /^[\d.\-/]{10,40}$/
  return legacyPattern.test(normalized)
}

// ---------------------------------------------------------------------------
// UUID helpers
// ---------------------------------------------------------------------------

/** Regex for a valid UUID v4. */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Check that a string is a valid UUID v4.
 * Use for path parameters and FK references received from clients.
 */
export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value)
}
