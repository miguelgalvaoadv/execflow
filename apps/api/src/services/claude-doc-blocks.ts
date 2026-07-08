/**
 * Montagem de blocos de documento para chamadas ao Claude.
 *
 * LIMITES REAIS DA API ANTHROPIC (confirmados 07/07/2026, doc oficial): 600
 * páginas / 32MB por request PDF nativo — o "~100 páginas" que estava aqui
 * antes só vale pra modelos de contexto 200k; o Sonnet usado neste projeto
 * tem 1M de contexto, então o limite de verdade é 600. Corrigido — antes
 * disso, autos de ~1000 páginas perdiam ~90% do conteúdo (só 90 de 1000
 * páginas chegavam ao Claude). Estratégia em camadas, por documento:
 *
 *   1. PDF pequeno (≤ MAX_PDF_PAGES e ≤ MAX_PDF_BYTES) → anexa o PDF nativo
 *      (Claude lê layout/tabelas/carimbos melhor que texto puro).
 *   2. PDF grande COM texto OCR extraído → Haiku faz uma triagem barata
 *      (varre o texto inteiro em pedaços, aponta quais páginas parecem ter
 *      sentença/cálculo de pena/PAD/atestado/homologação) e só essas páginas
 *      + cabeça/cauda vão pro Sonnet — mais barato E mais completo que o
 *      recorte cego de cabeça+cauda que existia antes. Se a triagem falhar
 *      por qualquer motivo, cai pro recorte cabeça+cauda como rede de
 *      segurança (nunca quebra a análise).
 *   3. PDF grande SEM OCR → pulado com aviso no prompt (nunca silencioso).
 *
 * SEM cache_control DE PROPÓSITO: cache write custa 25% A MAIS que o preço
 * normal e só compensa se o MESMO bloco for reaproveitado em ~5min — hoje
 * cada caso é analisado uma vez só, então cache_control aqui só encarecia
 * (25% a mais, nunca lido de volta) e ainda escondia o custo real do relatório
 * de IA (a API reporta tokens em cache como cache_creation_input_tokens, campo
 * que o log do app não lê — só input_tokens). Removido em 08/07/2026.
 */

import { eq, desc } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '../lib/db.ts'
import { documentOcrResults } from '@execflow/db/schema'
import { createStorageProviderFromEnv } from '@execflow/storage'

const MAX_PDF_PAGES = 600
const MAX_PDF_BYTES = 28 * 1024 * 1024
/** Recorte de segurança (cabeça+cauda) usado se a triagem por Haiku falhar. */
const HEAD_PAGES = 30
const TAIL_PAGES = 60
/** Páginas sempre incluídas mesmo com triagem bem-sucedida (qualificação + andamento mais recente). */
const ALWAYS_HEAD = 10
const ALWAYS_TAIL = 10
/** Tamanho do lote de páginas por chamada de triagem — mantém bem abaixo do contexto do Haiku (200K). */
const TRIAGE_CHUNK_PAGES = 100
const HAIKU_MODEL = 'claude-haiku-4-5'

const TRIAGE_CATEGORIES =
  'sentença condenatória, cálculo de pena/liquidação de pena, decisão de progressão de regime ou livramento condicional, ' +
  'PAD (procedimento administrativo disciplinar) ou falta grave, atestado de pena/carcerário, homologação de cálculo, ' +
  'guia de execução, laudo ou parecer técnico, remição de pena (trabalho/estudo)'

export type DocForBlocks = {
  id: string
  fileName: string
  mimeType: string
  byteSize: number
  storageKey: string
}

export type BuiltDocBlocks = {
  /** Blocos prontos para messages.create (document e/ou text). */
  blocks: Array<Record<string, unknown>>
  /** Descrição do que foi anexado/recortado/pulado — vai no prompt e no log. */
  manifest: string[]
}

async function latestOcrText(documentId: string): Promise<{ text: string; pageCount: number } | null> {
  const [row] = await db
    .select({ rawText: documentOcrResults.rawText, pageCount: documentOcrResults.pageCount })
    .from(documentOcrResults)
    .where(eq(documentOcrResults.documentId, documentId))
    .orderBy(desc(documentOcrResults.extractedAt))
    .limit(1)
  return row ? { text: row.rawText, pageCount: row.pageCount } : null
}

/**
 * Pede ao Haiku (barato) pra apontar, num lote de páginas, quais parecem
 * conter as categorias relevantes. Nunca lança — qualquer falha vira
 * Set vazio, e o chamador decide o que fazer (cai pro recorte cabeça+cauda).
 */
async function triageChunk(
  client: Anthropic,
  pages: string[],
  startIndex: number,
  fileName: string
): Promise<Set<number>> {
  const labeled = pages.map((p, i) => `[página ${startIndex + i + 1}]\n${p.slice(0, 4000)}`).join('\n\n')
  try {
    const resp = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 2000,
      system:
        'Você examina páginas de autos de execução penal brasileira e aponta SÓ os números de página que ' +
        `contêm alguma destas categorias: ${TRIAGE_CATEGORIES}. Não avalie mérito, só classifique presença/ausência. ` +
        'Na dúvida, inclua a página (falso positivo é barato; falso negativo perde conteúdo importante).',
      messages: [
        {
          role: 'user',
          content: `Documento: ${fileName}\n\n${labeled}\n\nResponda APENAS com JSON: {"relevant_pages": [numeros]}`,
        },
      ],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: { relevant_pages: { type: 'array', items: { type: 'integer' } } },
            required: ['relevant_pages'],
            additionalProperties: false,
          },
        },
      },
    } as never)
    const text = (resp as Anthropic.Message).content.find((c) => c.type === 'text')
    const raw = text && 'text' in text ? text.text : '{}'
    const parsed = JSON.parse(raw) as { relevant_pages?: number[] }
    return new Set((parsed.relevant_pages ?? []).filter((n) => Number.isInteger(n)))
  } catch (e) {
    console.warn(`[claude-doc-blocks] Triagem Haiku falhou num lote de ${fileName}:`, e instanceof Error ? e.message : e)
    return new Set()
  }
}

/** Roda a triagem em lotes paralelos sobre o documento inteiro. Nunca lança. */
async function selectRelevantPages(pages: string[], fileName: string): Promise<Set<number> | null> {
  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) return null
  const client = new Anthropic({ apiKey })

  const chunks: Promise<Set<number>>[] = []
  for (let start = 0; start < pages.length; start += TRIAGE_CHUNK_PAGES) {
    const slice = pages.slice(start, start + TRIAGE_CHUNK_PAGES)
    chunks.push(triageChunk(client, slice, start, fileName))
  }

  try {
    const results = await Promise.all(chunks)
    const merged = new Set<number>()
    for (const r of results) for (const p of r) merged.add(p)
    return merged
  } catch {
    return null
  }
}

/** Recorte cabeça+cauda cego — rede de segurança se a triagem falhar. */
function excerptHeadTail(pages: string[], fileName: string): string {
  if (pages.length <= HEAD_PAGES + TAIL_PAGES) {
    return pages.map((p, i) => `[${fileName} — página ${i + 1}]\n${p}`).join('\n\n')
  }
  const head = pages.slice(0, HEAD_PAGES)
  const tail = pages.slice(-TAIL_PAGES)
  const omitted = pages.length - HEAD_PAGES - TAIL_PAGES
  return [
    ...head.map((p, i) => `[${fileName} — página ${i + 1}]\n${p}`),
    `\n⚠️ [${fileName}: ${omitted} páginas intermediárias (${HEAD_PAGES + 1}–${pages.length - TAIL_PAGES}) OMITIDAS por limite de contexto — triagem automática indisponível nesta rodada]\n`,
    ...tail.map((p, i) => `[${fileName} — página ${pages.length - TAIL_PAGES + i + 1}]\n${p}`),
  ].join('\n\n')
}

/** Monta o texto final a partir do conjunto de páginas selecionadas pela triagem. */
function excerptSelected(pages: string[], selected: Set<number>, fileName: string): string {
  for (let i = 0; i < Math.min(ALWAYS_HEAD, pages.length); i++) selected.add(i)
  for (let i = Math.max(0, pages.length - ALWAYS_TAIL); i < pages.length; i++) selected.add(i)

  const sorted = [...selected].filter((i) => i >= 0 && i < pages.length).sort((a, b) => a - b)
  const parts: string[] = []
  let last = -2
  for (const idx of sorted) {
    if (last !== -2 && idx !== last + 1) {
      parts.push(`\n⚠️ [${fileName}: páginas ${last + 2}–${idx} omitidas — triagem automática não as marcou como relevantes]\n`)
    }
    parts.push(`[${fileName} — página ${idx + 1}]\n${pages[idx]}`)
    last = idx
  }
  const omittedTotal = pages.length - sorted.length
  if (omittedTotal > 0) {
    parts.push(
      `\n📋 [${fileName}: triagem automática (Haiku) selecionou ${sorted.length} de ${pages.length} páginas como relevantes — sentença, cálculo de pena, PAD, atestados, homologações e afins. ${omittedTotal} páginas de trâmite/certidões repetitivas foram omitidas.]`
    )
  }
  return parts.join('\n\n')
}

/** Recorta o texto OCR paginado (\f), priorizando páginas relevantes via triagem Haiku. */
async function excerptPagedText(text: string, fileName: string): Promise<string> {
  const pages = text.split('\f')
  if (pages.length <= HEAD_PAGES + TAIL_PAGES) {
    return pages.map((p, i) => `[${fileName} — página ${i + 1}]\n${p}`).join('\n\n')
  }

  const selected = await selectRelevantPages(pages, fileName)
  if (selected && selected.size > 0) {
    return excerptSelected(pages, selected, fileName)
  }
  return excerptHeadTail(pages, fileName)
}

export async function buildDocumentBlocks(docs: DocForBlocks[]): Promise<BuiltDocBlocks> {
  const storage = createStorageProviderFromEnv()
  const blocks: Array<Record<string, unknown>> = []
  const manifest: string[] = []

  for (const doc of docs) {
    if (doc.mimeType !== 'application/pdf') continue

    const ocr = await latestOcrText(doc.id)
    const tooManyPages = (ocr?.pageCount ?? 0) > MAX_PDF_PAGES
    const tooBig = doc.byteSize > MAX_PDF_BYTES

    if (!tooManyPages && !tooBig) {
      try {
        const buffer = await storage.getObject(doc.storageKey)
        blocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') },
        })
        manifest.push(`${doc.fileName}: PDF anexado integral${ocr ? ` (${ocr.pageCount} pág.)` : ''}`)
        continue
      } catch (e) {
        console.error(`[claude-doc-blocks] Falha ao ler ${doc.id} do storage:`, e)
        manifest.push(`${doc.fileName}: FALHA ao ler do storage — não incluído`)
        continue
      }
    }

    // Grande demais para PDF nativo (>600 pág. ou >28MB) → texto OCR com triagem Haiku
    if (ocr && ocr.text.trim().length > 0) {
      const excerpt = await excerptPagedText(ocr.text, doc.fileName)
      blocks.push({
        type: 'text',
        text: `===== CONTEÚDO EXTRAÍDO DE: ${doc.fileName} (${ocr.pageCount} páginas — excede o limite de PDF nativo; texto extraído com triagem por relevância) =====\n\n${excerpt}\n\n===== FIM DE ${doc.fileName} =====`,
      })
      manifest.push(`${doc.fileName}: ${ocr.pageCount} pág. — enviado como TEXTO (triagem Haiku por relevância)`)
    } else {
      manifest.push(
        `${doc.fileName}: ${ocr?.pageCount ?? '?'} pág. — GRANDE DEMAIS e sem texto OCR disponível; NÃO incluído (aguarde o OCR processar)`
      )
    }
  }

  return { blocks, manifest }
}
