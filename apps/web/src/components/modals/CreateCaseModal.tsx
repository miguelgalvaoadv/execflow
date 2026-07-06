'use client'

/**
 * CreateCaseModal — Formulário modal para criação de novo caso de execução penal.
 *
 * Campos: Cliente (select), referência interna, nº processo de execução,
 *         nº processo de origem, vara, jurisdição, tipo, data de abertura, resumo sentença.
 *
 * Chama: POST /api/v1/cases
 * Invalida: queryKeys.cases (lista atualiza automaticamente).
 */

import { useState, useEffect, type FormEvent } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { apiPost, apiGet } from '@/lib/api-client'
import { useSession } from '@/lib/hooks/use-session'
import { Button } from '@/components/ui'
import { borders, surfaces, text } from '@/components/dashboard/surfaces'

type CreateCaseModalProps = {
  open: boolean
  onClose: () => void
  /** Pre-select a client when opening from client detail page */
  preselectedClientId?: string
}

type ClientOption = {
  id: string
  fullName: string
  displayName: string | null
}

type CreateCaseInput = {
  clientId: string
  internalRef: string
  openedAt: string
  executionProcessNumber?: string
  originProcessNumber?: string
  courtName?: string
  courtJurisdiction?: string
  caseKind?: 'primary' | 'apenso' | 'incident' | 'parallel'
  sentenceSummary?: string
}

const inputClassName = [
  'w-full rounded-lg border px-3 py-2.5 text-[13px] outline-none transition-colors',
  `${borders.default} bg-white shadow-sm ${text.primary}`,
  'placeholder:text-slate-700',
  'focus:border-blue-600 focus:ring-1 focus:ring-blue-600',
].join(' ')

const selectClassName = [
  'w-full rounded-lg border px-3 py-2.5 text-[13px] outline-none transition-colors appearance-none',
  `${borders.default} bg-white shadow-sm ${text.primary}`,
  'focus:border-blue-600 focus:ring-1 focus:ring-blue-600',
  '[&>option]:bg-white [&>option]:text-slate-900',
].join(' ')

const labelClassName = `mb-1.5 block text-[11px] font-medium uppercase tracking-[0.1em] ${text.muted}`

const CASE_KIND_OPTIONS = [
  { value: 'primary', label: 'Principal' },
  { value: 'apenso', label: 'Apenso' },
  { value: 'incident', label: 'Incidente' },
  { value: 'parallel', label: 'Paralelo' },
] as const

export function CreateCaseModal({ open, onClose, preselectedClientId }: CreateCaseModalProps) {
  const { data: session } = useSession()
  const queryClient = useQueryClient()

  const [clientId, setClientId] = useState(preselectedClientId ?? '')
  const [internalRef, setInternalRef] = useState('')
  const [openedAt, setOpenedAt] = useState(new Date().toISOString().split('T')[0])
  const [executionProcessNumber, setExecutionProcessNumber] = useState('')
  const [originProcessNumber, setOriginProcessNumber] = useState('')
  const [courtName, setCourtName] = useState('')
  const [courtJurisdiction, setCourtJurisdiction] = useState('')
  const [caseKind, setCaseKind] = useState<string>('primary')
  const [sentenceSummary, setSentenceSummary] = useState('')

  // Fetch clients for dropdown
  const { data: clientsData } = useQuery<{ data: ClientOption[] }>({
    queryKey: ['clients-select', session?.organization.id],
    queryFn: ({ signal }) =>
      apiGet<{ data: ClientOption[] }>('/api/v1/clients', {
        organizationId: session?.organization.id,
        signal,
        params: { limit: 200 },
      }),
    enabled: open && !!session?.organization.id,
    staleTime: 30_000,
  })

  const clients = clientsData?.data ?? []

  useEffect(() => {
    if (preselectedClientId) setClientId(preselectedClientId)
  }, [preselectedClientId])

  const mutation = useMutation({
    mutationFn: (data: CreateCaseInput) =>
      apiPost<{ data: unknown }>('/api/v1/cases', data, {
        organizationId: session?.organization.id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cases'] })
      resetForm()
      onClose()
    },
  })

  function resetForm() {
    setClientId(preselectedClientId ?? '')
    setInternalRef('')
    setOpenedAt(new Date().toISOString().split('T')[0])
    setExecutionProcessNumber('')
    setOriginProcessNumber('')
    setCourtName('')
    setCourtJurisdiction('')
    setCaseKind('primary')
    setSentenceSummary('')
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const body: CreateCaseInput = {
      clientId,
      internalRef: internalRef.trim(),
      openedAt: new Date(openedAt).toISOString(),
      ...(executionProcessNumber.trim() ? { executionProcessNumber: executionProcessNumber.trim() } : {}),
      ...(originProcessNumber.trim() ? { originProcessNumber: originProcessNumber.trim() } : {}),
      ...(courtName.trim() ? { courtName: courtName.trim() } : {}),
      ...(courtJurisdiction.trim() ? { courtJurisdiction: courtJurisdiction.trim() } : {}),
      ...(caseKind ? { caseKind: caseKind as CreateCaseInput['caseKind'] } : {}),
      ...(sentenceSummary.trim() ? { sentenceSummary: sentenceSummary.trim() } : {}),
    }
    mutation.mutate(body)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-100 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className={[
          'relative z-10 w-full max-w-[600px] max-h-[90vh] overflow-y-auto rounded-2xl border p-8',
          surfaces.panelRaised,
        ].join(' ')}
      >
        <h2 className={`text-[20px] font-semibold tracking-[-0.01em] mb-1 ${text.primary}`}>
          Novo Caso de Execução Penal
        </h2>
        <p className={`text-[13px] mb-6 ${text.muted}`}>
          Cadastre um novo processo de execução penal no sistema.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Cliente */}
          <div>
            <label htmlFor="case-client" className={labelClassName}>
              Cliente *
            </label>
            <select
              id="case-client"
              required
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className={selectClassName}
              disabled={mutation.isPending}
            >
              <option value="">Selecione um cliente…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName ?? c.fullName}
                </option>
              ))}
            </select>
            {clients.length === 0 && (
              <p className={`mt-1 text-[11px] ${text.faint}`}>
                Nenhum cliente cadastrado. Cadastre um cliente antes.
              </p>
            )}
          </div>

          {/* Referência interna + Data de abertura */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="case-ref" className={labelClassName}>
                Referência interna *
              </label>
              <input
                id="case-ref"
                type="text"
                required
                value={internalRef}
                onChange={(e) => setInternalRef(e.target.value)}
                className={inputClassName}
                placeholder="Ex: EP-2024-001"
                disabled={mutation.isPending}
              />
            </div>
            <div>
              <label htmlFor="case-opened" className={labelClassName}>
                Data de abertura *
              </label>
              <input
                id="case-opened"
                type="date"
                required
                value={openedAt}
                onChange={(e) => setOpenedAt(e.target.value)}
                className={inputClassName}
                disabled={mutation.isPending}
              />
            </div>
          </div>

          {/* Nº Processo de Execução + Nº Processo Origem */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="case-exec-number" className={labelClassName}>
                Nº Processo de Execução
              </label>
              <input
                id="case-exec-number"
                type="text"
                value={executionProcessNumber}
                onChange={(e) => setExecutionProcessNumber(e.target.value)}
                className={inputClassName}
                placeholder="0000000-00.0000.0.00.0000"
                disabled={mutation.isPending}
              />
            </div>
            <div>
              <label htmlFor="case-origin-number" className={labelClassName}>
                Nº Processo de Origem
              </label>
              <input
                id="case-origin-number"
                type="text"
                value={originProcessNumber}
                onChange={(e) => setOriginProcessNumber(e.target.value)}
                className={inputClassName}
                placeholder="0000000-00.0000.0.00.0000"
                disabled={mutation.isPending}
              />
            </div>
          </div>

          {/* Vara + Jurisdição */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="case-court" className={labelClassName}>
                Vara
              </label>
              <input
                id="case-court"
                type="text"
                value={courtName}
                onChange={(e) => setCourtName(e.target.value)}
                className={inputClassName}
                placeholder="Ex: 1ª VEP de São Paulo"
                disabled={mutation.isPending}
              />
            </div>
            <div>
              <label htmlFor="case-jurisdiction" className={labelClassName}>
                Jurisdição
              </label>
              <input
                id="case-jurisdiction"
                type="text"
                value={courtJurisdiction}
                onChange={(e) => setCourtJurisdiction(e.target.value)}
                className={inputClassName}
                placeholder="Ex: TJSP"
                disabled={mutation.isPending}
              />
            </div>
          </div>

          {/* Tipo do caso */}
          <div>
            <label htmlFor="case-kind" className={labelClassName}>
              Tipo do caso
            </label>
            <select
              id="case-kind"
              value={caseKind}
              onChange={(e) => setCaseKind(e.target.value)}
              className={selectClassName}
              disabled={mutation.isPending}
            >
              {CASE_KIND_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Resumo da sentença */}
          <div>
            <label htmlFor="case-summary" className={labelClassName}>
              Resumo da sentença
            </label>
            <textarea
              id="case-summary"
              value={sentenceSummary}
              onChange={(e) => setSentenceSummary(e.target.value)}
              className={`${inputClassName} resize-none`}
              rows={3}
              placeholder="Breve resumo do delito, pena aplicada, regime inicial…"
              disabled={mutation.isPending}
            />
          </div>

          {/* Erro */}
          {mutation.isError && (
            <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-[13px] text-red-700">
              {mutation.error?.message ?? 'Erro ao cadastrar caso.'}
            </p>
          )}

          {/* Botões */}
          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => { resetForm(); onClose() }}
              disabled={mutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={mutation.isPending || clientId === '' || internalRef.trim() === ''}
            >
              {mutation.isPending ? 'Salvando…' : 'Criar Caso'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
