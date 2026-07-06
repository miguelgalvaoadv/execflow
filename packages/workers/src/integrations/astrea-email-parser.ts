/**
 * Astrea e-mail parser — layer 1 of 2 in the extraction pipeline (see
 * astrea-claude-extractor.ts for the layer-2 fallback).
 *
 * Deterministic, regex-based extraction of CNJ process numbers and the
 * labeled fields ("Tipo:", "Data:", "Descrição:") that system-generated
 * e-mails typically use. A single Astrea e-mail can describe movements for
 * SEVERAL processes (the office subscribed to "all public office
 * processes"), so this always scans the whole body for every CNJ
 * occurrence — never just the first one.
 *
 * NOTE: the exact Astrea e-mail template was not available while building
 * this — the regex below is intentionally generic/label-tolerant. Once real
 * e-mails arrive, compare against astrea_email_logs.raw_body_snapshot and
 * tighten these patterns if needed. Nothing here can silently fail: a
 * non-match always falls through to the Claude Haiku layer or to
 * 'parse_failed' — never to a wrong/invented value.
 */

export const CNJ_REGEX = /\b(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})\b/g

const DATE_REGEX = /\b(\d{2})\/(\d{2})\/(\d{4})\b/

const TIPO_LABEL_REGEX = /(?:Tipo(?:\s+de\s+andamento)?|Andamento|Movimenta[cç][aã]o)\s*:\s*([^\n\r]+)/i
const DATA_LABEL_REGEX = /Data\s*:\s*(\d{2}\/\d{2}\/\d{4})/i
const DESCRICAO_LABEL_REGEX = /Descri[cç][aã]o\s*:\s*([^\n\r]+)/i

const MOVEMENT_KEYWORDS = /andamento|intima[cç][aã]o|movimenta[cç][aã]o|publica[cç][aã]o|despacho|senten[cç]a|decis[aã]o/i

export type ExtractionConfidence = 'high' | 'medium' | 'low'

export type ExtractedMovement = {
  cnj: string
  /** ISO 8601 date (YYYY-MM-DD), or null when not found. */
  data: string | null
  tipo: string | null
  descricao: string | null
  confidence: ExtractionConfidence
}

export type RegexParseResult = {
  movements: ExtractedMovement[]
  /** True when the e-mail has no CNJ and no movement-related keywords — likely an Astrea administrative notice, not a court update. */
  looksAdministrative: boolean
}

function brDateToIso(match: RegExpMatchArray | null): string | null {
  if (!match) return null
  const [, dd, mm, yyyy] = match
  if (!dd || !mm || !yyyy) return null
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Splits the body into one block per CNJ occurrence (from this CNJ to the
 * next one, or to the end of the text) so labeled fields are matched against
 * the right process when an e-mail covers several.
 */
function splitIntoBlocks(text: string, cnjPositions: Array<{ cnj: string; index: number }>): Array<{ cnj: string; block: string }> {
  return cnjPositions.map((entry, i) => {
    const start = entry.index
    const end = i + 1 < cnjPositions.length ? cnjPositions[i + 1]!.index : text.length
    return { cnj: entry.cnj, block: text.slice(start, end) }
  })
}

export function parseAstreaEmailWithRegex(subject: string | null, textBody: string): RegexParseResult {
  const haystack = `${subject ?? ''}\n${textBody}`

  const cnjPositions: Array<{ cnj: string; index: number }> = []
  for (const m of textBody.matchAll(CNJ_REGEX)) {
    if (m.index !== undefined) cnjPositions.push({ cnj: m[1]!, index: m.index })
  }

  if (cnjPositions.length === 0) {
    return {
      movements: [],
      looksAdministrative: !MOVEMENT_KEYWORDS.test(haystack),
    }
  }

  const blocks = splitIntoBlocks(textBody, cnjPositions)
  const movements: ExtractedMovement[] = blocks.map(({ cnj, block }) => {
    const tipoMatch = block.match(TIPO_LABEL_REGEX)
    const dataLabelMatch = block.match(DATA_LABEL_REGEX)
    const dataBareMatch = block.match(DATE_REGEX)
    const descricaoMatch = block.match(DESCRICAO_LABEL_REGEX)

    const tipo = tipoMatch?.[1]?.trim() ?? null
    const data = brDateToIso(dataLabelMatch) ?? brDateToIso(dataBareMatch)
    const descricao = descricaoMatch?.[1]?.trim() ?? null

    const fieldsFound = [tipo, data, descricao].filter(Boolean).length
    const confidence: ExtractionConfidence = fieldsFound >= 2 ? 'high' : fieldsFound === 1 ? 'medium' : 'low'

    return { cnj, data, tipo, descricao, confidence }
  })

  return { movements, looksAdministrative: false }
}
