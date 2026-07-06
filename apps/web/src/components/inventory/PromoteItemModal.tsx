'use client'

/**
 * PromoteItemModal — promove um item do inventário a caso operacional.
 *
 * Ação explícita e humana (spec §5): o usuário escolhe vincular a um cliente
 * existente ou criar um novo — nunca automático. O backend reaproveita o
 * serviço canônico de criação de caso (timeline + auditoria + evento).
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'
import { useSession } from '@/lib/hooks/use-session'
import { usePromoteInventoryItem, type InventoryItem } from '@/lib/hooks/use-inventory'
import { Button } from '@/components/ui'
import { borders, surfaces, text } from '@/components/dashboard/surfaces'

type ClientListItem = {
  id: string
  fullName: string
  displayName: string | null
}

type PromoteItemModalProps = {
  item: InventoryItem | null
  onClose: () => void
}

const inputClassName = [
  'w-full rounded-lg border px-3 py-2.5 text-[13px] outline-none transition-colors',
  `${borders.default} bg-white shadow-sm ${text.primary}`,
  'placeholder:text-slate-400',
  'focus:border-blue-600 focus:ring-1 focus:ring-blue-600',
].join(' ')

const labelClassName = `mb-1.5 block text-[11px] font-medium uppercase tracking-[0.1em] ${text.muted}`

export function PromoteItemModal({ item, onClose }: PromoteItemModalProps) {
  const { data: session } = useSession()
  const orgId = session?.organization.id ?? ''
  const promote = usePromoteInventoryItem(orgId)

  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [clientId, setClientId] = useState('')
  const [newClientName, setNewClientName] = useState('')
  const [newClientCpf, setNewClientCpf] = useState('')
  const [successInfo, setSuccessInfo] = useState<{ internalRef: string; warning: string | null } | null>(null)

  const clientsQuery = useQuery<{ data: ClientListItem[] }>({
    queryKey: queryKeys.clients(orgId),
    queryFn: ({ signal }) =>
      apiGet('/api/v1/clients', { organizationId: orgId, signal, params: { limit: 200 } }),
    enabled: orgId !== '' && item !== null,
    staleTime: 60 * 1000,
  })

  function handleClose() {
    setMode('existing')
    setClientId('')
    setNewClientName('')
    setNewClientCpf('')
    setSuccessInfo(null)
    promote.reset()
    onClose()
  }

  function handlePromote() {
    if (!item) return
    const body =
      mode === 'existing'
        ? { itemId: item.id, clientId }
        : {
            itemId: item.id,
            newClient: {
              fullName: newClientName.trim(),
              ...(newClientCpf.trim() ? { cpf: newClientCpf.trim() } : {}),
            },
          }
    promote.mutate(body, {
      onSuccess: (res) =>
        setSuccessInfo({ internalRef: res.data.internalRef, warning: res.data.warning }),
    })
  }

  if (item === null) return null

  const canSubmit =
    mode === 'existing' ? clientId !== '' : newClientName.trim().length > 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-100 backdrop-blur-sm" onClick={handleClose} />

      <div
        className={[
          'relative z-10 w-full max-w-[520px] rounded-2xl border p-8',
          surfaces.panelRaised,
        ].join(' ')}
      >
        <h2 className={`mb-1 text-[20px] font-semibold tracking-[-0.01em] ${text.primary}`}>
          Promover a caso
        </h2>
        <p className={`mb-5 text-[13px] ${text.muted}`}>
          Processo <span className="font-medium">{item.processNumber}</span>
          {item.vara ? ` — ${item.vara}` : ''}
        </p>

        {successInfo === null ? (
          <>
            {/* Escolha do cliente */}
            <div className="mb-4 flex gap-2">
              <button
                type="button"
                onClick={() => setMode('existing')}
                className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  mode === 'existing'
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                Cliente existente
              </button>
              <button
                type="button"
                onClick={() => setMode('new')}
                className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  mode === 'new'
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                Criar novo cliente
              </button>
            </div>

            {mode === 'existing' ? (
              <div>
                <label className={labelClassName}>Cliente *</label>
                <select
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className={inputClassName}
                >
                  <option value="">— selecionar —</option>
                  {(clientsQuery.data?.data ?? []).map((cl) => (
                    <option key={cl.id} value={cl.id}>
                      {cl.displayName ?? cl.fullName}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className={labelClassName}>Nome completo *</label>
                  <input
                    type="text"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    className={inputClassName}
                    placeholder="Ex: João da Silva Santos"
                  />
                </div>
                <div>
                  <label className={labelClassName}>CPF (opcional)</label>
                  <input
                    type="text"
                    value={newClientCpf}
                    onChange={(e) => setNewClientCpf(e.target.value)}
                    className={inputClassName}
                    placeholder="000.000.000-00"
                  />
                </div>
              </div>
            )}

            {promote.isError && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                {promote.error?.message ?? 'Erro ao promover.'}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <Button onClick={handleClose}>Cancelar</Button>
              <Button
                variant="primary"
                onClick={handlePromote}
                disabled={!canSubmit || promote.isPending}
              >
                {promote.isPending ? 'Promovendo…' : 'Promover a caso'}
              </Button>
            </div>
          </>
        ) : (
          <div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-[14px] font-semibold text-emerald-800">
                Caso criado: {successInfo.internalRef}
              </p>
              {successInfo.warning !== null && (
                <p className="mt-1 text-[12px] text-amber-700">⚠ {successInfo.warning}</p>
              )}
            </div>
            <div className="mt-6 flex justify-end">
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
