/**
 * Provider REAL de extraÃ§Ã£o de texto de PDF (pdfjs-dist, puro JS, sem binÃ¡rio).
 *
 * O que faz: extrai o texto NATIVO de PDFs digitais (a maioria dos autos de
 * tribunal Ã© PDF de texto), pÃ¡gina a pÃ¡gina, juntando as pÃ¡ginas com \f â€”
 * exatamente o marcador que a "busca nos autos" usa para citar a pÃ¡gina exata.
 *
 * O que NÃƒO faz (honestidade): PDFs 100% escaneados (imagem sem camada de
 * texto) nÃ£o tÃªm texto para extrair â€” o provider falha com erro NÃƒO-retryable
 * e mensagem clara, em vez de fingir sucesso com texto vazio. OCR visual de
 * imagem (Textract/Claude vision por pÃ¡gina) Ã© evoluÃ§Ã£o futura e pluga aqui.
 *
 * Storage Ã© INJETADO (getObject) para que este pacote nÃ£o dependa do
 * @execflow/storage â€” o worker fornece a leitura do blob.
 */

import type { OcrDocumentInput, OcrExtractResult, OcrProvider } from './types.ts'
import { OcrProviderError } from './types.ts'

export type PdfTextProviderDeps = {
  /** LÃª o blob do documento no storage (injetado pelo worker/API). */
  getObject: (storageKey: string) => Promise<Buffer>
}

/** Abaixo desta mÃ©dia de caracteres por pÃ¡gina, tratamos como PDF escaneado. */
const MIN_AVG_CHARS_PER_PAGE = 20

/**
 * Remove caracteres que o Postgres rejeita em colunas TEXT.
 * pdfjs emite null bytes ( ) e controles C0/C1 de fontes corrompidas â€”
 * o INSERT falha com "unsupported Unicode escape/invalid byte" sem isto.
 * Preserva \n e \t (normalizados depois pelo \s+).
 */
function sanitizeForPostgres(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    const isC0 = code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d
    const isC1 = code >= 0x7f && code <= 0x9f
    if (!isC0 && !isC1) out += ch
  }
  return out
}

export function createPdfTextOcrProvider(deps: PdfTextProviderDeps): OcrProvider {
  return {
    id: 'pdf-text',

    async extractText(document: OcrDocumentInput): Promise<OcrExtractResult> {
      if (document.mimeType !== 'application/pdf') {
        throw new OcrProviderError(
          `pdf-text sÃ³ processa application/pdf (recebido: ${document.mimeType}).`,
          { retryable: false }
        )
      }

      let buffer: Buffer
      try {
        buffer = await deps.getObject(document.storageKey)
      } catch (err) {
        throw new OcrProviderError(
          `Falha ao ler o blob do storage (${document.storageKey}): ${err instanceof Error ? err.message : String(err)}`,
          { retryable: true }
        )
      }

      // Import dinÃ¢mico: o build legacy do pdfjs funciona em Node sem worker.
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

      let pdf
      try {
        pdf = await pdfjs.getDocument({
          data: new Uint8Array(buffer),
          isEvalSupported: false,
          disableFontFace: true,
          useSystemFonts: true,
        }).promise
      } catch (err) {
        throw new OcrProviderError(
          `PDF invÃ¡lido ou corrompido: ${err instanceof Error ? err.message : String(err)}`,
          { retryable: false }
        )
      }

      const pageTexts: string[] = []
      try {
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum)
          const content = await page.getTextContent()
          const text = sanitizeForPostgres(
            content.items
              .map((item) => ('str' in item ? item.str : ''))
              .join(' ')
          )
            .replace(/\s+/g, ' ')
            .trim()
          pageTexts.push(text)
          page.cleanup()
        }
      } finally {
        await pdf.destroy()
      }

      const rawText = pageTexts.join('\f')
      const totalChars = rawText.replace(/\f/g, '').length
      const avgCharsPerPage = pdf.numPages > 0 ? totalChars / pdf.numPages : 0

      if (avgCharsPerPage < MIN_AVG_CHARS_PER_PAGE) {
        throw new OcrProviderError(
          `PDF sem camada de texto (mÃ©dia ${avgCharsPerPage.toFixed(1)} caracteres/pÃ¡gina em ${pdf.numPages} pÃ¡gina(s)) â€” provavelmente digitalizado como imagem. OCR visual de imagem ainda nÃ£o Ã© suportado; peÃ§a a versÃ£o digital do documento ao tribunal/e-SAJ.`,
          { retryable: false }
        )
      }

      return {
        rawText,
        pageCount: pdf.numPages,
        providerMetadata: {
          provider: 'pdf-text',
          engine: 'pdfjs-dist',
          totalChars,
          avgCharsPerPage: Math.round(avgCharsPerPage),
        },
      }
    },
  }
}
