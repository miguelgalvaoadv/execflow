'use client'

/**
 * ImportCsvModal — importação de inventário por CSV/planilha.
 *
 * Fluxo (spec §5): escolher arquivo → parse client-side → MOSTRAR o mapeamento
 * de colunas detectado (editável) + prévia das primeiras linhas → só então
 * aplicar. Nunca importa sem o usuário conferir o mapeamento.
 */

import { useState, useRef } from 'react'
import { useSession } from '@/lib/hooks/use-session'
import { useImportInventory, type ImportRow, type ImportResult, type OabProfile } from '@/lib/hooks/use-inventory'
import {
  parseCsv,
  autoMapHeaders,
  CANONICAL_FIELD_LABELS,
  type CanonicalField,
  type ParsedCsv,
} from '@/lib/csv-parser'
import { Button } from '@/components/ui'
import { borders, surfaces, text } from '@/components/dashboard/surfaces'

type ImportCsvModalProps = {
  open: boolean
  onClose: () => void
  profiles: OabProfile[]
}

const selectClassName = [
  'w-full rounded-lg border px-2 py-1.5 text-[12px] outline-none transition-colors',
  `${borders.default} bg-white shadow-sm ${text.primary}`,
  'focus:border-blue-600 focus:ring-1 focus:ring-blue-600',
].join(' ')

export function ImportCsvModal({ open, onClose, profiles }: ImportCsvModalProps) {
  const { data: session } = useSession()
  const orgId = session?.organization.id ?? ''
  const importMutation = useImportInventory(orgId)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParsedCsv | null>(null)
  const [mapping, setMapping] = useState<CanonicalField[]>([])
  const [profileId, setProfileId] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [parseError, setParseError] = useState('')

  function reset() {
    setFileName('')
    setParsed(null)
    setMapping([])
    setResult(null)
    setParseError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleFile(file: File) {
    setParseError('')
    setResult(null)
    try {
      const content = await file.text()
      const csv = parseCsv(content)
      if (csv.headers.length === 0 || csv.rows.length === 0) {
        setParseError('Arquivo vazio ou sem linhas de dados.')
        return
      }
      setFileName(file.name)
      setParsed(csv)
      setMapping(autoMapHeaders(csv.headers))
    } catch {
      setParseError('Não foi possível ler o arquivo. Exporte como CSV e tente novamente.')
    }
  }

  const hasProcessNumber = mapping.includes('processNumber')

  function buildRows(): ImportRow[] {
    if (!parsed) return []
    const rows: ImportRow[] = []
    for (const raw of parsed.rows) {
      const row: Record<string, string> = {}
      mapping.forEach((field, i) => {
        if (field === 'ignore') return
        const value = raw[i]?.trim() ?? ''
        if (value !== '') row[field] = value
      })
      if (row['processNumber']) rows.push(row as unknown as ImportRow)
    }
    return rows
  }

  function handleImport() {
    const rows = buildRows()
    if (rows.length === 0) {
      setParseError('Nenhuma linha com número de processo válido encontrada.')
      return
    }
    importMutation.mutate(
      {
        rows,
        ...(profileId ? { oabProfileId: profileId } : {}),
        sourceInfo: 'csv_import',
      },
      { onSuccess: (res) => setResult(res.data) }
    )
  }

  if (!open) return null

  const validRowCount = parsed ? buildRows().length : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-100 backdrop-blur-sm" onClick={handleClose} />

      <div
        className={[
          'relative z-10 flex max-h-[90vh] w-full max-w-[860px] flex-col overflow-hidden rounded-2xl border p-8',
          surfaces.panelRaised,
        ].join(' ')}
      >
        <h2 className={`mb-1 text-[20px] font-semibold tracking-[-0.01em] ${text.primary}`}>
          Importar processos (CSV / planilha)
        </h2>
        <p className={`mb-5 text-[13px] ${text.muted}`}>
          Exporte a lista de processos do e-SAJ/PJe/planilha do escritório como CSV. Só os
          metadados entram — os autos completos são baixados depois, apenas dos processos
          prioritários.
        </p>

        {result === null ? (
          <>
            {/* Passo 1 — arquivo */}
            <div className="mb-4 flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleFile(f)
                }}
              />
              <Button variant="primary" onClick={() => fileInputRef.current?.click()}>
                Escolher arquivo CSV
              </Button>
              {fileName !== '' && (
                <span className={`text-[13px] ${text.secondary}`}>
                  {fileName} — {parsed?.rows.length ?? 0} linha(s), separador &quot;{parsed?.delimiter}&quot;
                </span>
              )}
            </div>

            {parseError !== '' && (
              <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                {parseError}
              </p>
            )}

            {parsed !== null && (
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                {/* Perfil OAB opcional */}
                {profiles.length > 0 && (
                  <div className="max-w-[320px]">
                    <label className={`mb-1.5 block text-[11px] font-medium uppercase tracking-[0.1em] ${text.muted}`}>
                      Vincular ao perfil OAB (opcional)
                    </label>
                    <select
                      value={profileId}
                      onChange={(e) => setProfileId(e.target.value)}
                      className={selectClassName}
                    >
                      <option value="">— nenhum —</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.lawyerName} — OAB {p.oabNumber}/{p.oabUf}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Passo 2 — mapeamento de colunas (sempre conferido pelo usuário) */}
                <div>
                  <p className={`mb-2 text-[13px] font-medium ${text.secondary}`}>
                    Mapeamento de colunas detectado — confira antes de importar:
                  </p>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50">
                          {parsed.headers.map((h, i) => (
                            <th key={i} className="min-w-[150px] px-2 py-2 text-left align-top">
                              <p className={`mb-1 truncate font-semibold ${text.secondary}`} title={h}>
                                {h || `(coluna ${i + 1})`}
                              </p>
                              <select
                                value={mapping[i] ?? 'ignore'}
                                onChange={(e) => {
                                  const next = [...mapping]
                                  next[i] = e.target.value as CanonicalField
                                  setMapping(next)
                                }}
                                className={selectClassName}
                              >
                                {(Object.keys(CANONICAL_FIELD_LABELS) as CanonicalField[]).map((f) => (
                                  <option key={f} value={f}>
                                    {CANONICAL_FIELD_LABELS[f]}
                                  </option>
                                ))}
                              </select>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {parsed.rows.slice(0, 5).map((row, ri) => (
                          <tr key={ri} className="border-b border-slate-100 last:border-0">
                            {parsed.headers.map((_, ci) => (
                              <td key={ci} className={`max-w-[220px] truncate px-2 py-1.5 ${text.muted}`} title={row[ci] ?? ''}>
                                {row[ci] ?? ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!hasProcessNumber && (
                    <p className="mt-2 text-[12px] font-medium text-amber-700">
                      ⚠ Nenhuma coluna mapeada como &quot;Número do processo&quot; — obrigatório para importar.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Ações */}
            <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
              <Button onClick={handleClose}>Cancelar</Button>
              <Button
                variant="primary"
                onClick={handleImport}
                disabled={!parsed || !hasProcessNumber || importMutation.isPending}
              >
                {importMutation.isPending
                  ? 'Importando…'
                  : `Importar ${validRowCount} processo(s)`}
              </Button>
            </div>
            {importMutation.isError && (
              <p className="mt-2 text-right text-[12px] text-red-600">
                {importMutation.error?.message ?? 'Erro ao importar.'}
              </p>
            )}
          </>
        ) : (
          /* Resultado */
          <div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-[14px] font-semibold text-emerald-800">Importação concluída</p>
              <ul className="mt-1.5 space-y-0.5 text-[13px] text-emerald-700">
                <li>• {result.created} processo(s) novo(s) criado(s)</li>
                <li>• {result.updated} atualizado(s) (só campos vazios preenchidos)</li>
                <li>• {result.skipped} sem mudança (já existiam)</li>
                <li>• {result.classified} classificado(s) por prioridade automaticamente</li>
              </ul>
            </div>
            {result.errors.length > 0 && (
              <div className="mt-3 max-h-[160px] overflow-y-auto rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-[13px] font-semibold text-red-800">
                  {result.errors.length} linha(s) com erro:
                </p>
                <ul className="mt-1 space-y-0.5 text-[12px] text-red-700">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      Linha {e.row} ({e.processNumber}): {e.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <Button onClick={reset}>Importar outro arquivo</Button>
              <Button variant="primary" onClick={handleClose}>
                Concluir
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
