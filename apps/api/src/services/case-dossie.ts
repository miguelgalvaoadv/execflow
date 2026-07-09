/**
 * Dossiê textual do caso — serializa o "boletim explicativo" que
 * case-analysis.ts grava em sentence_snapshots (explanation/crimesBreakdown/
 * missingDataFlags) num texto compacto, reaproveitável por:
 *   - claude-drafter.ts ("Gerar Peça"), pra não reler os PDFs inteiros;
 *   - case-analysis.ts, como baseline de uma reanálise incremental (só os
 *     documentos NOVOS desde a última análise + este dossiê, em vez dos
 *     autos inteiros de novo).
 * Achado 08/07/2026 (pedido do Miguel): sem isso, qualquer mudança pequena
 * nos autos (um documento novo) forçava reler TUDO do zero — caro e sem
 * necessidade, já que o sistema já tinha essa informação salva.
 */
import type { sentenceSnapshots } from '@execflow/db/schema'

export function buildDossieText(snap: typeof sentenceSnapshots.$inferSelect): string {
  const lines: string[] = []
  lines.push(`[DOSSIÊ DO CASO — resultado da última análise de autos, status do cálculo: ${snap.status}]`)
  lines.push(
    `Pena total: ${snap.totalSentenceDays} dias | Cumprida: ${snap.servedDays} dias | Remição: ${snap.remissionDays} dias | Detração: ${snap.detractionDays} dias | Restante: ${snap.remainingDays} dias | Percentual cumprido: ${(Number(snap.percentServed) * 100).toFixed(1)}%`
  )
  if (snap.calculationMethod) lines.push(`Método: ${snap.calculationMethod}`)

  const exp = snap.explanation as
    | { basis?: string; components?: Array<{ name: string; value: unknown; sourceRefs?: string[]; derivationNote?: string }>; assumptions?: string[]; legalCitations?: string[] }
    | null
  if (exp?.basis) lines.push(`\nResumo da análise: ${exp.basis}`)
  if (exp?.components?.length) {
    lines.push('\nComponentes do cálculo (com fonte e conta feita):')
    for (const c of exp.components) {
      lines.push(`- ${c.name}: ${String(c.value ?? '')}${c.sourceRefs?.length ? ` (fonte: ${c.sourceRefs.join(', ')})` : ''}${c.derivationNote ? ` — ${c.derivationNote}` : ''}`)
    }
  }
  const crimes = snap.crimesBreakdown as Array<{ crimeName?: string; article?: string; law?: string; sentenceDate?: string | null; isHediondo?: boolean }> | null
  if (crimes?.length) {
    lines.push('\nCrimes considerados:')
    for (const c of crimes) {
      lines.push(`- ${c.crimeName ?? ''} (${c.article ?? ''} ${c.law ?? ''})${c.sentenceDate ? `, data do fato: ${c.sentenceDate}` : ''}${c.isHediondo ? ' — hediondo/equiparado' : ''}`)
    }
  }
  if (exp?.assumptions?.length) lines.push(`\nPremissas assumidas na análise: ${exp.assumptions.join('; ')}`)
  const missing = snap.missingDataFlags as Array<{ field?: string; description?: string }> | null
  if (missing?.length) {
    lines.push(`\nDados faltantes sinalizados pela análise: ${missing.map((m) => `${m.field}: ${m.description}`).join('; ')}`)
  }
  if (exp?.legalCitations?.length) lines.push(`\nBase legal aplicada: ${exp.legalCitations.join('; ')}`)

  return lines.join('\n')
}
