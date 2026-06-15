/**
 * Serviço de exportação de peças processuais para Microsoft Word (.docx).
 *
 * Converte o Markdown gerado pelo Claude para um documento Word editável,
 * pronto para impressão e protocolo no tribunal.
 */

import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
  Packer,
  Header,
  Footer,
} from 'docx'

/**
 * Converte Markdown da peça processual em um Buffer de .docx.
 */
export async function markdownToDocx(
  markdown: string,
  metadata?: {
    title?: string
    lawyerName?: string
    clientName?: string
    processNumber?: string
  }
): Promise<Buffer> {
  const lines = markdown.split('\n')
  const children: Paragraph[] = []

  // Cabeçalho do documento
  if (metadata?.processNumber) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            text: `Processo nº ${metadata.processNumber}`,
            size: 20,
            color: '666666',
            italics: true,
          }),
        ],
        spacing: { after: 200 },
      })
    )
  }

  // Processa cada linha do Markdown
  for (const line of lines) {
    const trimmed = line.trim()

    // Linha vazia → parágrafo em branco
    if (!trimmed) {
      children.push(new Paragraph({ children: [] }))
      continue
    }

    // Heading 1 (# )
    if (trimmed.startsWith('# ')) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: trimmed.replace(/^#\s+/, ''),
              bold: true,
              size: 28,
              font: 'Times New Roman',
            }),
          ],
          spacing: { before: 400, after: 200 },
        })
      )
      continue
    }

    // Heading 2 (## )
    if (trimmed.startsWith('## ')) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [
            new TextRun({
              text: trimmed.replace(/^##\s+/, ''),
              bold: true,
              size: 24,
              font: 'Times New Roman',
              allCaps: true,
            }),
          ],
          spacing: { before: 300, after: 150 },
        })
      )
      continue
    }

    // Heading 3 (### )
    if (trimmed.startsWith('### ')) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [
            new TextRun({
              text: trimmed.replace(/^###\s+/, ''),
              bold: true,
              size: 22,
              font: 'Times New Roman',
            }),
          ],
          spacing: { before: 200, after: 100 },
        })
      )
      continue
    }

    // Lista com marcador (- item ou * item)
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const content = trimmed.replace(/^[-*]\s+/, '')
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: parseInlineFormatting(content),
          spacing: { before: 50, after: 50 },
        })
      )
      continue
    }

    // Lista numerada
    const numberedMatch = trimmed.match(/^(\d+)\.\s+(.+)/)
    if (numberedMatch) {
      children.push(
        new Paragraph({
          numbering: { reference: 'default-numbering', level: 0 },
          children: parseInlineFormatting(numberedMatch[2] || ''),
          spacing: { before: 50, after: 50 },
        })
      )
      continue
    }

    // Linha horizontal (---)
    if (trimmed === '---' || trimmed === '___' || trimmed === '***') {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: '' })],
          border: {
            bottom: { color: 'auto', space: 1, style: 'single', size: 6 },
          },
          spacing: { before: 200, after: 200 },
        })
      )
      continue
    }

    // Parágrafo normal
    children.push(
      new Paragraph({
        children: parseInlineFormatting(trimmed),
        spacing: { before: 100, after: 100, line: 360 },
        alignment: AlignmentType.JUSTIFIED,
      })
    )
  }

  // Monta o documento
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Times New Roman',
            size: 24, // 12pt
          },
          paragraph: {
            spacing: { line: 360 }, // 1.5 espaçamento
          },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'default-numbering',
          levels: [
            {
              level: 0,
              format: 'decimal',
              text: '%1.',
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: metadata?.title || 'Petição — ExecFlow',
                    size: 16,
                    color: '999999',
                    italics: true,
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: 'Documento gerado pelo ExecFlow — Sistema de Gestão de Execuções Penais',
                    size: 14,
                    color: '999999',
                    italics: true,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  })

  // Serializa para Buffer
  const buffer = await Packer.toBuffer(doc)
  return Buffer.from(buffer)
}

/**
 * Processa formatação inline do Markdown (**bold**, *italic*, etc.)
 */
function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = []
  const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|__(.+?)__|_(.+?)_|`(.+?)`|([^*_`]+))/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    // Bold + Italic (***text***)
    if (match[2]) {
      runs.push(new TextRun({ text: match[2], bold: true, italics: true, font: 'Times New Roman', size: 24 }))
    }
    // Bold (**text**)
    else if (match[3]) {
      runs.push(new TextRun({ text: match[3], bold: true, font: 'Times New Roman', size: 24 }))
    }
    // Italic (*text*)
    else if (match[4]) {
      runs.push(new TextRun({ text: match[4], italics: true, font: 'Times New Roman', size: 24 }))
    }
    // Bold (__text__)
    else if (match[5]) {
      runs.push(new TextRun({ text: match[5], bold: true, font: 'Times New Roman', size: 24 }))
    }
    // Italic (_text_)
    else if (match[6]) {
      runs.push(new TextRun({ text: match[6], italics: true, font: 'Times New Roman', size: 24 }))
    }
    // Code (`text`)
    else if (match[7]) {
      runs.push(new TextRun({ text: match[7], font: 'Courier New', size: 22 }))
    }
    // Plain text
    else if (match[8]) {
      runs.push(new TextRun({ text: match[8], font: 'Times New Roman', size: 24 }))
    }
  }

  // Se nenhum match, retorna o texto bruto
  if (runs.length === 0) {
    runs.push(new TextRun({ text, font: 'Times New Roman', size: 24 }))
  }

  return runs
}
