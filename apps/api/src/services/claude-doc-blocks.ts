/**
 * Montagem de blocos de documento para chamadas ao Claude.
 *
 * LIMITES DA API ANTHROPIC (por documento PDF): ~100 páginas / 32MB por request.
 * Autos reais de execução penal passam fácil de 300 páginas — anexar o PDF cru
 * falharia. Estratégia em camadas, por documento:
 *
 *   1. PDF pequeno (≤ MAX_PDF_PAGES e ≤ MAX_PDF_BYTES) → anexa o PDF nativo
 *      (Claude lê layout/tabelas/carimbos melhor que texto puro).
 *   2. PDF grande COM texto OCR extraído → envia TEXTO com recorte estratégico:
 *      primeiras páginas (guia de recolhimento, qualificação, penas) + últimas
 *      páginas (decisões/cálculos recentes), com marcador explícito de omissão
 *      e numeração de página preservada — o modelo sabe o que não viu.
 *   3. PDF grande SEM OCR → pulado com aviso no prompt (nunca silencioso).
 */

import { eq, desc } from 'drizzle-orm'
import { db } from '../lib/db.ts'
import { documentOcrResults } from '@execflow/db/schema'
import { createStorageProviderFromEnv } from '@execflow/storage'

const MAX_PDF_PAGES = 95
const MAX_PDF_BYTES = 24 * 1024 * 1024
/** Recorte para PDFs grandes: N páginas do início + M do fim. */
const HEAD_PAGES = 30
const TAIL_PAGES = 60

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

/** Recorta o texto OCR paginado (\f) em cabeça+cauda com numeração preservada. */
function excerptPagedText(text: string, fileName: string): string {
  const pages = text.split('\f')
  if (pages.length <= HEAD_PAGES + TAIL_PAGES) {
    return pages.map((p, i) => `[${fileName} — página ${i + 1}]\n${p}`).join('\n\n')
  }
  const head = pages.slice(0, HEAD_PAGES)
  const tail = pages.slice(-TAIL_PAGES)
  const omitted = pages.length - HEAD_PAGES - TAIL_PAGES
  return [
    ...head.map((p, i) => `[${fileName} — página ${i + 1}]\n${p}`),
    `\n⚠️ [${fileName}: ${omitted} páginas intermediárias (${HEAD_PAGES + 1}–${pages.length - TAIL_PAGES}) OMITIDAS por limite de contexto — o miolo geralmente contém peças processuais intermediárias; as decisões e cálculos recentes estão nas páginas finais abaixo]\n`,
    ...tail.map((p, i) => `[${fileName} — página ${pages.length - TAIL_PAGES + i + 1}]\n${p}`),
  ].join('\n\n')
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

    // Grande demais para PDF nativo → texto OCR recortado
    if (ocr && ocr.text.trim().length > 0) {
      blocks.push({
        type: 'text',
        text: `===== CONTEÚDO EXTRAÍDO DE: ${doc.fileName} (${ocr.pageCount} páginas — excede o limite de PDF nativo; texto extraído por página) =====\n\n${excerptPagedText(ocr.text, doc.fileName)}\n\n===== FIM DE ${doc.fileName} =====`,
      })
      manifest.push(
        `${doc.fileName}: ${ocr.pageCount} pág. — enviado como TEXTO (recorte ${HEAD_PAGES}+${TAIL_PAGES} páginas quando excede)`
      )
    } else {
      manifest.push(
        `${doc.fileName}: ${ocr?.pageCount ?? '?'} pág. — GRANDE DEMAIS e sem texto OCR disponível; NÃO incluído (aguarde o OCR processar)`
      )
    }
  }

  return { blocks, manifest }
}
