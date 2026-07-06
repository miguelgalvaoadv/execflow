/**
 * Parser CSV client-side — sem dependência externa.
 *
 * Suporta: campos entre aspas (com vírgulas e quebras de linha internas),
 * aspas escapadas (""), separador vírgula OU ponto-e-vírgula (auto-detectado —
 * exportações brasileiras de Excel usam ';'), BOM UTF-8.
 *
 * Usado pela importação do Inventário por OAB: o arquivo é parseado no
 * navegador, o mapeamento de colunas é mostrado ao usuário ANTES de enviar
 * (regra do spec §5), e só as linhas canônicas seguem para a API.
 */

export type ParsedCsv = {
  headers: string[]
  rows: string[][]
  delimiter: ',' | ';'
}

export function parseCsv(raw: string): ParsedCsv {
  // Remove BOM
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw

  // Auto-detecta separador pela primeira linha fora de aspas
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'))
  const commas = (firstLine.match(/,/g) ?? []).length
  const semis = (firstLine.match(/;/g) ?? []).length
  const delimiter: ',' | ';' = semis > commas ? ';' : ','

  const rows: string[][] = []
  let current: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      current.push(field.trim())
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      current.push(field.trim())
      field = ''
      // Ignora linhas totalmente vazias
      if (current.some((c) => c !== '')) rows.push(current)
      current = []
    } else {
      field += ch
    }
  }
  // Última linha sem \n final
  if (field !== '' || current.length > 0) {
    current.push(field.trim())
    if (current.some((c) => c !== '')) rows.push(current)
  }

  const headers = rows.length > 0 ? rows[0]! : []
  return { headers, rows: rows.slice(1), delimiter }
}

// ---------------------------------------------------------------------------
// Mapeamento automático de colunas → campos canônicos do inventário
// ---------------------------------------------------------------------------

export type CanonicalField =
  | 'processNumber'
  | 'tribunal'
  | 'degree'
  | 'system'
  | 'comarca'
  | 'vara'
  | 'courtClass'
  | 'area'
  | 'situation'
  | 'partiesText'
  | 'link'
  | 'lastMovementText'
  | 'lastMovementAt'
  | 'notes'
  | 'ignore'

export const CANONICAL_FIELD_LABELS: Record<CanonicalField, string> = {
  processNumber: 'Número do processo',
  tribunal: 'Tribunal',
  degree: 'Grau/Instância',
  system: 'Sistema (e-SAJ, PJe…)',
  comarca: 'Comarca',
  vara: 'Vara',
  courtClass: 'Classe',
  area: 'Área',
  situation: 'Situação',
  partiesText: 'Partes',
  link: 'Link',
  lastMovementText: 'Última movimentação',
  lastMovementAt: 'Data da última movimentação',
  notes: 'Observações',
  ignore: '— ignorar coluna —',
}

/** Normaliza nome de coluna para matching aproximado. */
function normHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

const HEADER_PATTERNS: Array<{ field: CanonicalField; patterns: string[] }> = [
  { field: 'processNumber', patterns: ['numeroprocesso', 'numprocesso', 'processo', 'cnj', 'numero'] },
  { field: 'tribunal', patterns: ['tribunal', 'orgao'] },
  { field: 'degree', patterns: ['grau', 'instancia'] },
  { field: 'system', patterns: ['sistema'] },
  { field: 'comarca', patterns: ['comarca', 'foro'] },
  { field: 'vara', patterns: ['vara', 'juizo'] },
  { field: 'courtClass', patterns: ['classe', 'tipoacao', 'natureza'] },
  { field: 'area', patterns: ['area', 'materia'] },
  { field: 'situation', patterns: ['situacao', 'status', 'estado'] },
  { field: 'partiesText', patterns: ['partes', 'parte', 'reu', 'cliente', 'autor'] },
  { field: 'link', patterns: ['link', 'url', 'endereco'] },
  { field: 'lastMovementText', patterns: ['ultimamovimentacao', 'movimentacao', 'ultimoandamento', 'andamento'] },
  { field: 'lastMovementAt', patterns: ['datamovimentacao', 'dataandamento', 'dataultimamovimentacao', 'data'] },
  { field: 'notes', patterns: ['observacoes', 'observacao', 'obs', 'notas'] },
]

/**
 * Detecta o campo canônico de cada coluna pelo nome aproximado.
 * O usuário SEMPRE revisa o mapeamento antes de aplicar (spec §5).
 */
export function autoMapHeaders(headers: string[]): CanonicalField[] {
  const used = new Set<CanonicalField>()
  return headers.map((h) => {
    const n = normHeader(h)
    if (n === '') return 'ignore'
    for (const { field, patterns } of HEADER_PATTERNS) {
      if (used.has(field)) continue
      if (patterns.some((p) => n === p || n.includes(p))) {
        used.add(field)
        return field
      }
    }
    return 'ignore'
  })
}
