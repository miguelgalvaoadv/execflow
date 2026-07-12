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
 * Teto de seguranca pro OCR - SEPARADO do limite de upload (que pode ser bem
 * maior, porque o upload em si e streaming e nao usa memoria do processo).
 * Achado 08/07/2026: getObject baixa o arquivo INTEIRO num Buffer e o
 * pdfjs-dist processa isso na memoria - sem streaming nenhum, e no MESMO
 * processo Node do InfoSimples/DJEN/DataJud/SLA (ocr-events.ts). Um PDF
 * gigante pode estourar a memoria da instancia e derrubar o worker inteiro,
 * levando as outras integracoes junto - mesma classe do incidente de
 * crash-loop ja documentado em ocr-events.ts. Na pratica isso quase nunca
 * bloqueia PDF real: um PDF com camada de texto de verdade (o unico tipo que
 * este provider consegue processar) raramente passa de poucos MB mesmo com
 * milhares de paginas - quem costuma passar de 80MB e PDF 100% escaneado
 * como imagem, que ESTE provider ja rejeitaria de qualquer forma (sem
 * camada de texto) - so que hoje so descobre isso DEPOIS de ja ter
 * carregado o arquivo inteiro. Falhar cedo aqui evita o risco sem perder
 * capacidade real nenhuma.
 */
const MAX_OCR_BYTES = 80 * 1024 * 1024

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

      if (document.byteSize > MAX_OCR_BYTES) {
        throw new OcrProviderError(
          `Arquivo (${(document.byteSize / (1024 * 1024)).toFixed(0)}MB) grande demais para OCR automatico neste servidor (limite ${MAX_OCR_BYTES / (1024 * 1024)}MB) - provavelmente e um PDF escaneado como imagem (PDF de texto raramente fica tao grande). OCR visual de imagem ainda nao e suportado; peca a versao digital do documento ao tribunal/e-SAJ, ou divida o arquivo em partes menores.`,
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
