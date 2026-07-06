/**
 * Importação em LOTE de clientes + processos no ExecFlow.
 *
 * Lê uma planilha CSV com colunas: nome, cnj (número do processo) e matrícula,
 * e para CADA linha:
 *   1. Cria o cliente (POST /api/v1/clients) — com matrícula;
 *   2. Abre o caso (POST /api/v1/cases) com o número do processo — o que dispara
 *      automaticamente a sincronização no Escavador (capa, partes, movimentações,
 *      autos e monitoramento contínuo).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * COMO USAR
 *   1. Salve sua planilha como CSV (no Excel: "Salvar como → CSV UTF-8").
 *      Cabeçalho aceito (em qualquer ordem; acentos/maiúsculas tanto faz):
 *         nome , cnj , matricula
 *      (sinônimos aceitos: nome=cliente | cnj=processo/numero | matricula=matrícula)
 *   2. Garanta a API rodando e as variáveis abaixo (ou use os padrões de dev):
 *         API_URL         (padrão http://localhost:3001)
 *         IMPORT_EMAIL    (login de um usuário advogado/admin)
 *         IMPORT_PASSWORD
 *         IMPORT_ORG_ID   (id da organização)
 *   3. Rode:
 *         pnpm --filter @execflow/api exec tsx scripts/importar-lote.ts ./minha-planilha.csv
 *
 * É seguro rodar de novo: cada linha é independente; erros não param o lote
 * (no fim sai um resumo com sucessos e falhas linha a linha).
 * ────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'node:fs'

const API_URL = (process.env['API_URL'] ?? 'http://localhost:3001').replace(/\/$/, '')
// Padrões apontam para a conta de desenvolvimento semeada. Em produção, defina as
// variáveis IMPORT_* com as credenciais reais.
const EMAIL = process.env['IMPORT_EMAIL'] ?? 'rafael.mendes@execflow.local'
const PASSWORD = process.env['IMPORT_PASSWORD'] ?? 'ExecflowDevSmoke123!'
const ORG_ID = process.env['IMPORT_ORG_ID'] ?? '29fe664a-aae1-488b-b7fd-0ab0b72a9fdf'
// Better Auth exige um Origin confiável (CSRF). Em produção, use o domínio do site
// (que deve estar em BETTER_AUTH_TRUSTED_ORIGINS).
const ORIGIN = process.env['IMPORT_ORIGIN'] ?? 'http://localhost:3000'

type Row = { nome: string; cnj: string; matricula: string; linha: number }

// ── CSV parsing (tolerante a ; ou , e a BOM do Excel) ───────────────────────
function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function normalizeHeader(h: string): string {
  return stripAccents(h).toLowerCase().trim().replace(/^﻿/, '')
}

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === delim && !inQuotes) {
      out.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

function parseCsv(content: string): Row[] {
  const text = content.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  if (lines.length < 2) throw new Error('CSV vazio ou só com cabeçalho.')

  const headerLine = lines[0]!
  const delim = (headerLine.split(';').length > headerLine.split(',').length) ? ';' : ','
  const headers = splitCsvLine(headerLine, delim).map(normalizeHeader)

  const idxNome = headers.findIndex((h) => ['nome', 'cliente', 'nome completo', 'reu', 'réu'].includes(h))
  const idxCnj = headers.findIndex((h) => ['cnj', 'processo', 'numero', 'numero do processo', 'n processo', 'numero cnj'].includes(h))
  const idxMat = headers.findIndex((h) => ['matricula', 'matrícula', 'matricula sap', 'sap'].includes(h))

  if (idxNome < 0) throw new Error(`Coluna "nome" não encontrada. Cabeçalho lido: ${headers.join(' | ')}`)

  const rows: Row[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]!, delim)
    const nome = (cols[idxNome] ?? '').trim()
    if (nome === '') continue
    rows.push({
      nome,
      cnj: idxCnj >= 0 ? (cols[idxCnj] ?? '').trim() : '',
      matricula: idxMat >= 0 ? (cols[idxMat] ?? '').trim() : '',
      linha: i + 1,
    })
  }
  return rows
}

// ── HTTP helpers (cookie de sessão do Better Auth) ──────────────────────────
let cookie = ''

async function signIn(): Promise<void> {
  const res = await fetch(`${API_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': ORIGIN },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  if (!res.ok) {
    throw new Error(`Falha no login (${res.status}). Confira IMPORT_EMAIL/IMPORT_PASSWORD. ${await res.text()}`)
  }
  const setCookies = res.headers.getSetCookie?.() ?? []
  cookie = setCookies.map((c) => c.split(';')[0]).join('; ')
  if (!cookie) throw new Error('Login não retornou cookie de sessão.')
}

async function apiPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookie,
      'X-Organization-Id': ORG_ID,
      'Origin': ORIGIN,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { /* não-JSON */ }
  if (!res.ok) {
    const msg = json?.error?.message || json?.error || text || `HTTP ${res.status}`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return json
}

function slugRef(nome: string, linha: number): string {
  const base = stripAccents(nome).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return `${base || 'CLIENTE'}-${linha}`
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const csvPath = process.argv[2] ?? 'importacao.csv'
  console.log(`\n📄 Lendo planilha: ${csvPath}`)
  const content = readFileSync(csvPath, 'utf8')
  const rows = parseCsv(content)
  console.log(`   ${rows.length} linha(s) válida(s) encontradas.`)

  const semCnj = rows.filter((r) => r.cnj === '').length
  if (semCnj > 0) {
    console.warn(`\n⚠️  ${semCnj} linha(s) SEM número de processo (CNJ). Esses cadastros serão criados,`)
    console.warn('   mas o Escavador NÃO conseguirá buscar nada sem o CNJ (a matrícula não consulta tribunal).')
  }

  console.log(`\n🔑 Autenticando em ${API_URL} como ${EMAIL}…`)
  await signIn()
  console.log('   OK.\n')

  let ok = 0
  const falhas: string[] = []

  for (const r of rows) {
    try {
      const clientRes = await apiPost('/api/v1/clients', {
        fullName: r.nome,
        internalRef: r.matricula || slugRef(r.nome, r.linha),
        ...(r.matricula ? { matricula: r.matricula } : {}),
      })
      const clientId = clientRes?.data?.id
      if (!clientId) throw new Error('cliente criado sem id na resposta')

      await apiPost('/api/v1/cases', {
        clientId,
        internalRef: r.cnj || slugRef(r.nome, r.linha),
        openedAt: new Date().toISOString(),
        ...(r.cnj ? { executionProcessNumber: r.cnj } : {}),
      })

      ok++
      console.log(`✅ [linha ${r.linha}] ${r.nome}${r.cnj ? ` — ${r.cnj}` : ' (sem CNJ)'}`)
    } catch (e: any) {
      const msg = `❌ [linha ${r.linha}] ${r.nome}: ${e.message}`
      falhas.push(msg)
      console.error(msg)
    }
  }

  console.log(`\n──────── RESUMO ────────`)
  console.log(`✅ Cadastrados: ${ok}/${rows.length}`)
  if (falhas.length > 0) {
    console.log(`❌ Falhas: ${falhas.length}`)
    falhas.forEach((f) => console.log(`   ${f}`))
  }
  console.log(`\nDica: os casos com CNJ já dispararam a sincronização no Escavador.`)
  console.log(`Acompanhe no painel (cada caso mostra o status de monitoramento).`)
}

main().catch((err) => {
  console.error('\n💥 Erro fatal:', err.message)
  process.exit(1)
})
