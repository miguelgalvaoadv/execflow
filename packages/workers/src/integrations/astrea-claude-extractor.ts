/**
 * Astrea e-mail parser — layer 2 (fallback). Only invoked when the regex
 * layer (astrea-email-parser.ts) finds no CNJ, or finds one with no
 * surrounding labeled context ('low' confidence).
 *
 * Uses Claude Haiku — a structured-extraction task, not legal reasoning, so
 * the cheaper/faster model is the right fit (the legal reasoning step,
 * detectOpportunitiesFromMovements, still runs on Sonnet afterward).
 *
 * CONTRACT: this function NEVER throws. Any failure (missing API key,
 * timeout, malformed JSON, network error) resolves to `{ movements: [] }`,
 * which the caller treats as "let this email fall through to parse_failed /
 * manual triage" — never as a crash, never as invented data.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { ExtractedMovement } from './astrea-email-parser.ts'

const EXTRACTION_TIMEOUT_MS = 15_000

const SYSTEM_PROMPT = `Você é um extrator de dados estruturados. NÃO interprete o conteúdo jurídico, apenas extraia os campos pedidos do texto literal do e-mail. Se um campo não estiver presente, retorne null. NUNCA invente número de processo (CNJ), data ou conteúdo que não esteja explicitamente no texto. Retorne APENAS o JSON, sem markdown, sem texto adicional.`

function buildUserPrompt(subject: string | null, body: string): string {
  return `Assunto do e-mail: ${subject ?? '(sem assunto)'}

Corpo do e-mail:
"""
${body.slice(0, 8000)}
"""

Extraia todas as movimentações processuais mencionadas neste e-mail. Retorne neste formato exato:
{
  "andamentos": [
    {
      "cnj": "string no formato NNNNNNN-DD.AAAA.J.TT.OOOO ou null",
      "data": "YYYY-MM-DD ou null",
      "tipo": "string ou null",
      "descricao": "string ou null",
      "confianca_extracao": "high" | "medium" | "low"
    }
  ]
}`
}

function parseJsonLoose(text: string): unknown {
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1]!.trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) t = t.slice(start, end + 1)
  return JSON.parse(t)
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout após ${ms}ms`)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

/**
 * Asks Claude Haiku to extract CNJ/data/tipo/descricao from a raw e-mail
 * body. Always resolves — never rejects. Empty array means "could not
 * extract", to be handled by the caller as parse_failed, not as a crash.
 */
export async function extractMovementsViaClaude(
  subject: string | null,
  body: string
): Promise<ExtractedMovement[]> {
  try {
    const apiKey = process.env['ANTHROPIC_API_KEY']
    if (!apiKey) return []
    if (!body || body.trim() === '') return []

    const client = new Anthropic({ apiKey })
    const model = process.env['ASTREA_EMAIL_EXTRACTION_MODEL'] || 'claude-haiku-4-5'

    const response = await withTimeout(
      client.messages.create({
        // @ts-ignore — id de modelo validado no servidor
        model,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(subject, body) }],
      }),
      EXTRACTION_TIMEOUT_MS
    )

    const textBlocks = response.content.filter((b: any) => b.type === 'text').map((b: any) => b.text)
    const raw = textBlocks.join('\n')
    const parsed = parseJsonLoose(raw) as { andamentos?: unknown[] }

    if (!Array.isArray(parsed.andamentos)) return []

    const movements: ExtractedMovement[] = []
    for (const item of parsed.andamentos) {
      if (!item || typeof item !== 'object') continue
      const a = item as Record<string, unknown>
      const cnj = typeof a['cnj'] === 'string' ? a['cnj'] : null
      if (!cnj) continue // no CNJ → cannot match to a case, not usable
      movements.push({
        cnj,
        data: typeof a['data'] === 'string' ? a['data'] : null,
        tipo: typeof a['tipo'] === 'string' ? a['tipo'] : null,
        descricao: typeof a['descricao'] === 'string' ? a['descricao'] : null,
        confidence:
          a['confianca_extracao'] === 'high' || a['confianca_extracao'] === 'medium' || a['confianca_extracao'] === 'low'
            ? (a['confianca_extracao'] as 'high' | 'medium' | 'low')
            : 'medium',
      })
    }
    return movements
  } catch (err) {
    console.warn('[Astrea Claude Extractor] Falha na extração via IA (caindo para parse_failed):', err)
    return []
  }
}
