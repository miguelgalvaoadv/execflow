/**
 * TESTE LOCAL — Claude lendo autos reais (sem Escavador, sem certificado).
 *
 * Alimenta um PDF de autos de execução penal direto no Claude e:
 *   1. ANÁLISE   — extrai pena, regime, data-base, remição, marcos, oportunidades e prazos.
 *   2. PEÇA      — redige uma petição (a mais promissora, ou a que você pedir).
 *   3. WORD      — salva a peça em .docx editável ao lado do PDF.
 *
 * É o mesmo fluxo do produto (PDF como bloco `document` + prompt jurídico,
 * modelo claude-sonnet-4-6), só que isolado para validar o coração do sistema.
 *
 * Uso (dentro de apps/api, com ANTHROPIC_API_KEY no .env.local):
 *   pnpm tsx --env-file=.env.local scripts/testar-autos.ts "C:/caminho/autos.pdf" ["tipo da peça"]
 *
 * Ex.: ...scripts/testar-autos.ts "../../0001565-58.2026.8.26.0496.pdf" "progressão de regime"
 *
 * ⚠️ Custo: um PDF grande (dezenas de páginas) consome tokens — estime ~US$1–3.
 */
import fs from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { markdownToDocx } from '../src/services/docx-exporter.ts'

const MODEL = 'claude-sonnet-4-6'

const pdfPath = process.argv[2]
const pecaPedida = process.argv[3] // opcional

if (!pdfPath) {
  console.error('Uso: tsx --env-file=.env.local scripts/testar-autos.ts <caminho/autos.pdf> ["tipo da peça"]')
  process.exit(1)
}
if (!fs.existsSync(pdfPath)) {
  console.error(`Arquivo não encontrado: ${pdfPath}`)
  process.exit(1)
}

const apiKey = process.env['ANTHROPIC_API_KEY']
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY não está no ambiente. Coloque no apps/api/.env.local.')
  process.exit(1)
}

const client = new Anthropic({ apiKey })

const pdfBuffer = fs.readFileSync(pdfPath)
const pdfBase64 = pdfBuffer.toString('base64')
console.log(`\n📄 Autos: ${path.basename(pdfPath)} (${(pdfBuffer.length / 1024 / 1024).toFixed(1)} MB)`)
console.log(`🤖 Modelo: ${MODEL}\n`)

const pdfBlock = {
  type: 'document' as const,
  source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: pdfBase64 },
}

const SYSTEM_ANALISE = `Você é um advogado criminalista brasileiro experiente, especialista em Execução Penal (LEP).
Leia os autos do processo de execução e produza uma análise técnica objetiva, em português, com:
1. QUALIFICAÇÃO: nome do executado, nº do processo, vara/comarca.
2. PENA: pena total imposta, crimes/artigos, regime inicial e atual.
3. DATA-BASE e tempo cumprido (se constar), dias remidos, detração.
4. MARCOS: datas/frações estimadas para progressão de regime, livramento condicional, saídas temporárias.
5. INTERCORRÊNCIAS: faltas graves, fugas, novas condenações (impactam o cálculo).
6. OPORTUNIDADES: liste benefícios cabíveis agora ou em breve (progressão, livramento, remição, comutação/indulto, etc.).
7. PRAZOS: qualquer prazo em aberto (ex.: agravo em execução, manifestação).
8. DADOS FALTANTES: o que não foi possível extrair dos autos.
Se um dado não estiver nos autos, escreva "não consta". Não invente.`

const SYSTEM_PECA = `Você é um advogado criminalista brasileiro experiente na fase de Execução Penal (LEP).
Redija uma petição clara, fundamentada e elegante ao Juízo da Execução, em Markdown limpo.
Regras: linguagem formal mas objetiva; fundamente na CF, LEP e jurisprudência do STF/STJ;
não invente dados — use [INSERIR DADO] quando faltar; estruture em DOS FATOS, DO DIREITO, DOS PEDIDOS;
finalize com "Termos em que, pede deferimento. [Local], [Data]. Advogado".`

async function main() {
  // ── FASE 1: ANÁLISE ──────────────────────────────────────────────
  console.log('⏳ Analisando os autos...\n')
  const analiseResp = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: SYSTEM_ANALISE,
    messages: [
      {
        role: 'user',
        content: [pdfBlock as any, { type: 'text', text: 'Analise estes autos de execução penal conforme as instruções.' }],
      },
    ],
  })
  const analise = analiseResp.content.filter((c) => c.type === 'text').map((c: any) => c.text).join('\n')
  console.log('================ ANÁLISE DA EXECUÇÃO ================\n')
  console.log(analise)
  console.log('\n====================================================\n')

  // ── FASE 2: PEÇA (reaproveita a leitura, sem reenviar o PDF) ──────
  const pedido = pecaPedida
    ? `Com base nos autos e na sua análise, redija a peça: "${pecaPedida}".`
    : `Com base nos autos e na sua análise, redija a PEÇA MAIS PROMISSORA agora (a oportunidade de maior impacto que você identificou).`

  console.log('⏳ Redigindo a peça...\n')
  const pecaResp = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PECA,
    messages: [
      { role: 'user', content: [pdfBlock as any, { type: 'text', text: 'Estes são os autos da execução penal.' }] },
      { role: 'assistant', content: analise },
      { role: 'user', content: pedido },
    ],
  })
  const pecaMd = pecaResp.content.filter((c) => c.type === 'text').map((c: any) => c.text).join('\n')
  console.log('==================== PEÇA GERADA ====================\n')
  console.log(pecaMd)
  console.log('\n====================================================\n')

  // ── FASE 3: SALVAR EM .docx E .md ────────────────────────────────
  const base = pdfPath.replace(/\.pdf$/i, '')
  fs.writeFileSync(`${base}-analise.txt`, analise, 'utf8')
  fs.writeFileSync(`${base}-peca.md`, pecaMd, 'utf8')
  const docx = await markdownToDocx(pecaMd, { title: 'Petição de Execução Penal' })
  fs.writeFileSync(`${base}-peca.docx`, docx)

  console.log('💾 Salvos ao lado do PDF:')
  console.log(`   • ${path.basename(base)}-analise.txt`)
  console.log(`   • ${path.basename(base)}-peca.md`)
  console.log(`   • ${path.basename(base)}-peca.docx  (abra no Word)\n`)
  console.log('✅ Teste concluído — o Claude leu os autos reais, analisou e redigiu a peça.')
}

main().catch((err) => {
  console.error('\n❌ Erro:', err instanceof Error ? err.message : err)
  process.exit(1)
})
