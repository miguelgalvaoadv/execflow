/**
 * Importador de carga inicial — XLSX exportado do Astrea.
 *
 * Uso:
 *   pnpm tsx --env-file=.env.local scripts/import-astrea-backfill.ts <caminho.xlsx> [--apply] [--org=<uuid>]
 *
 * Comportamento:
 *   - DRY-RUN por padrão (mostra o que SERIA feito, não grava nada). Use
 *     --apply para gravar de verdade — proteção contra rodar sem querer em
 *     cima de produção com ~200 casos reais.
 *   - Casamento de processo: por executionProcessNumber (CNJ). Atualiza
 *     courtName/courtJurisdiction de um caso já existente SOMENTE se esses
 *     campos estiverem vazios — nunca sobrescreve dado preenchido manualmente.
 *   - CNJs da planilha sem ExecutionCase correspondente: registrados em
 *     astrea_email_logs (status='orphan') para aparecer na mesma tela de
 *     triagem dos órfãos de e-mail — o script NÃO cria casos novos sozinho
 *     (criar caso exige clientId, responsibleLawyerUserId etc., fora do
 *     escopo de um import de planilha).
 *   - Detecção de colunas: tenta achar CNJ/tribunal/vara pelo nome do
 *     cabeçalho, mas SEMPRE imprime o mapeamento detectado antes de
 *     processar para conferência visual.
 */

import * as XLSX from 'xlsx'
import { randomUUID } from 'crypto'
import { executionCases, organizations, astreaEmailLogs } from '@execflow/db/schema'
import { eq, and } from '@execflow/db/client'
import { createWorkersDb } from '../src/lib/db.ts'

const CNJ_REGEX = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/

function parseArgs() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const orgArg = args.find((a) => a.startsWith('--org='))
  const orgId = orgArg ? orgArg.slice('--org='.length) : undefined
  const filePath = args.find((a) => !a.startsWith('--'))
  return { filePath, apply, orgId }
}

function detectColumn(headers: string[], pattern: RegExp): string | null {
  return headers.find((h) => pattern.test(h)) ?? null
}

async function main() {
  const { filePath, apply, orgId } = parseArgs()

  if (!filePath) {
    console.error('Uso: pnpm tsx --env-file=.env.local scripts/import-astrea-backfill.ts <caminho.xlsx> [--apply] [--org=<uuid>]')
    process.exit(1)
  }

  console.log(`\n${apply ? '⚠️  MODO --apply (vai gravar no banco)' : '🔍 MODO DRY-RUN (nada será gravado — use --apply para gravar)'}`)
  console.log(`Lendo: ${filePath}\n`)

  const workbook = XLSX.readFile(filePath)
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) {
    console.error('❌ Planilha vazia ou sem abas.')
    process.exit(1)
  }
  const sheet = workbook.Sheets[firstSheetName]!
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })

  if (rows.length === 0) {
    console.error('❌ Nenhuma linha encontrada na primeira aba.')
    process.exit(1)
  }

  const headers = Object.keys(rows[0]!)
  const cnjCol = detectColumn(headers, /processo|cnj/i)
  const tribunalCol = detectColumn(headers, /tribunal/i)
  const varaComarcaCol = detectColumn(headers, /vara|comarca/i)

  console.log('Mapeamento de colunas detectado:')
  console.log(`  CNJ/Processo  → ${cnjCol ?? '(não encontrado)'}`)
  console.log(`  Tribunal      → ${tribunalCol ?? '(não encontrado)'}`)
  console.log(`  Vara/Comarca  → ${varaComarcaCol ?? '(não encontrado)'}`)
  console.log(`\nTotal de linhas: ${rows.length}\n`)

  if (!cnjCol) {
    console.error('❌ Não foi possível identificar a coluna de número do processo (CNJ). Abortando.')
    process.exit(1)
  }

  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL não configurada.')
    process.exit(1)
  }
  const db = createWorkersDb(databaseUrl)

  let organizationId = orgId
  if (!organizationId) {
    const orgs = await db.select().from(organizations).limit(1)
    if (!orgs[0]) {
      console.error('❌ Nenhuma organização encontrada no banco. Use --org=<uuid>.')
      process.exit(1)
    }
    organizationId = orgs[0].id
    console.log(`Organização (auto-detectada): ${orgs[0].name} (${organizationId})\n`)
  }

  let matched = 0
  let updated = 0
  let unmatched = 0
  let invalid = 0
  const unmatchedCnjs: string[] = []

  for (const row of rows) {
    const rawCnj = row[cnjCol]
    const cnj = typeof rawCnj === 'string' ? rawCnj.trim() : rawCnj != null ? String(rawCnj).trim() : ''

    if (!CNJ_REGEX.test(cnj)) {
      invalid++
      continue
    }

    const [existing] = await db
      .select()
      .from(executionCases)
      .where(and(eq(executionCases.organizationId, organizationId), eq(executionCases.executionProcessNumber, cnj)))
      .limit(1)

    if (!existing) {
      unmatched++
      unmatchedCnjs.push(cnj)
      if (apply) {
        await db.insert(astreaEmailLogs).values({
          id: randomUUID(),
          organizationId,
          contentHash: `xlsx-backfill-${cnj}`,
          emailSubject: `Importação XLSX backfill — ${filePath}`,
          status: 'orphan',
          extractedCnj: cnj,
          extractedData: [{ cnj, source: 'xlsx_backfill' }],
        })
      }
      continue
    }

    matched++

    const tribunalValue = tribunalCol ? row[tribunalCol] : null
    const varaComarcaValue = varaComarcaCol ? row[varaComarcaCol] : null

    const patch: Partial<typeof executionCases.$inferInsert> = {}
    if (existing.courtName === null && typeof tribunalValue === 'string' && tribunalValue.trim() !== '') {
      patch.courtName = tribunalValue.trim()
    }
    if (existing.courtJurisdiction === null && typeof varaComarcaValue === 'string' && varaComarcaValue.trim() !== '') {
      patch.courtJurisdiction = varaComarcaValue.trim()
    }

    if (Object.keys(patch).length > 0) {
      updated++
      if (apply) {
        await db.update(executionCases).set(patch).where(eq(executionCases.id, existing.id))
      }
    }
  }

  console.log('─'.repeat(60))
  console.log('RESUMO')
  console.log('─'.repeat(60))
  console.log(`Linhas válidas com CNJ reconhecível: ${rows.length - invalid}`)
  console.log(`CNJ inválido/ausente (ignorados):    ${invalid}`)
  console.log(`Casados a um ExecutionCase existente: ${matched}`)
  console.log(`  ...dos quais atualizados (capa):    ${updated}`)
  console.log(`Sem caso correspondente (órfãos):     ${unmatched}`)
  if (unmatchedCnjs.length > 0 && unmatchedCnjs.length <= 30) {
    console.log(`\nCNJs órfãos:\n  ${unmatchedCnjs.join('\n  ')}`)
  }
  console.log(
    apply
      ? '\n✅ Gravado no banco. Órfãos foram registrados na tela de triagem (/settings/astrea-triage).'
      : '\nNada foi gravado (dry-run). Rode de novo com --apply para gravar de fato.'
  )

  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Falha inesperada:', err)
  process.exit(1)
})
