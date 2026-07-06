'use client'

/**
 * CreateClientModal — Formulário modal para cadastro de novo cliente.
 *
 * Campos: Nome completo (obrigatório), CPF, RG, data de nascimento,
 *         apelido, referência interna, observações.
 *
 * Chama: POST /api/v1/clients
 * Invalida: queryKeys.clients (lista atualiza automaticamente).
 */

import { useState, type FormEvent, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiPatch } from '@/lib/api-client'
import { useSession } from '@/lib/hooks/use-session'
import { Button } from '@/components/ui'
import { borders, surfaces, text } from '@/components/dashboard/surfaces'

type EditClientModalProps = {
  open: boolean
  onClose: () => void
  client: {
    id: string
    fullName: string
    cpf?: string | null
    rg?: string | null
    birthDate?: string | null
    displayName?: string | null
    internalRef?: string | null
    notes?: string | null
  }
}

type UpdateClientInput = {
  fullName: string
  cpf?: string
  rg?: string
  birthDate?: string
  displayName?: string
  internalRef?: string
  notes?: string
}

const inputClassName = [
  'w-full rounded-lg border px-3 py-2.5 text-[13px] outline-none transition-colors',
  `${borders.default} bg-white shadow-sm ${text.primary}`,
  'placeholder:text-slate-700',
  'focus:border-blue-600 focus:ring-1 focus:ring-blue-600',
].join(' ')

const labelClassName = `mb-1.5 block text-[11px] font-medium uppercase tracking-[0.1em] ${text.muted}`

export function EditClientModal({ open, onClose, client }: EditClientModalProps) {
  const { data: session } = useSession()
  const queryClient = useQueryClient()

  const [fullName, setFullName] = useState(client.fullName)
  const [cpf, setCpf] = useState(client.cpf || '')
  const [rg, setRg] = useState(client.rg || '')
  const [birthDate, setBirthDate] = useState(client.birthDate || '')
  const [displayName, setDisplayName] = useState(client.displayName || '')
  const [internalRef, setInternalRef] = useState(client.internalRef || '')
  const [notes, setNotes] = useState(client.notes || '')

  useEffect(() => {
    if (open) {
      setFullName(client.fullName)
      setCpf(client.cpf || '')
      setRg(client.rg || '')
      setBirthDate(client.birthDate || '')
      setDisplayName(client.displayName || '')
      setInternalRef(client.internalRef || '')
      setNotes(client.notes || '')
    }
  }, [client, open])

  const mutation = useMutation({
    mutationFn: (data: UpdateClientInput) =>
      apiPatch<{ data: unknown }>(`/api/v1/clients/${client.id}`, data, {
        organizationId: session?.organization.id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      queryClient.invalidateQueries({ queryKey: ['client', client.id] })
      resetForm()
      onClose()
    },
  })

  function resetForm() {
    setFullName('')
    setCpf('')
    setRg('')
    setBirthDate('')
    setDisplayName('')
    setInternalRef('')
    setNotes('')
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const body: UpdateClientInput = {
      fullName: fullName.trim(),
      ...(cpf.trim() ? { cpf: cpf.trim() } : {}),
      ...(rg.trim() ? { rg: rg.trim() } : {}),
      ...(birthDate ? { birthDate } : {}),
      ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      ...(internalRef.trim() ? { internalRef: internalRef.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
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
          'relative z-10 w-full max-w-[520px] rounded-2xl border p-8',
          surfaces.panelRaised,
        ].join(' ')}
      >
        <h2 className={`text-[20px] font-semibold tracking-[-0.01em] mb-1 ${text.primary}`}>
          Editar Cliente
        </h2>
        <p className={`text-[13px] mb-6 ${text.muted}`}>
          Atualize as informações do cliente de execução penal.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Nome completo */}
          <div>
            <label htmlFor="client-fullname" className={labelClassName}>
              Nome completo *
            </label>
            <input
              id="client-fullname"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={inputClassName}
              placeholder="Ex: João da Silva Santos"
              disabled={mutation.isPending}
            />
          </div>

          {/* CPF + RG lado a lado */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="client-cpf" className={labelClassName}>
                CPF
              </label>
              <input
                id="client-cpf"
                type="text"
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
                className={inputClassName}
                placeholder="000.000.000-00"
                disabled={mutation.isPending}
              />
            </div>
            <div>
              <label htmlFor="client-rg" className={labelClassName}>
                RG
              </label>
              <input
                id="client-rg"
                type="text"
                value={rg}
                onChange={(e) => setRg(e.target.value)}
                className={inputClassName}
                placeholder="00.000.000-0"
                disabled={mutation.isPending}
              />
            </div>
          </div>

          {/* Data de nascimento + Apelido */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="client-birth" className={labelClassName}>
                Data de nascimento
              </label>
              <input
                id="client-birth"
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className={inputClassName}
                disabled={mutation.isPending}
              />
            </div>
            <div>
              <label htmlFor="client-display" className={labelClassName}>
                Apelido / Nome curto
              </label>
              <input
                id="client-display"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={inputClassName}
                placeholder="Ex: João"
                disabled={mutation.isPending}
              />
            </div>
          </div>

          {/* Referência interna */}
          <div>
            <label htmlFor="client-ref" className={labelClassName}>
              Referência interna
            </label>
            <input
              id="client-ref"
              type="text"
              value={internalRef}
              onChange={(e) => setInternalRef(e.target.value)}
              className={inputClassName}
              placeholder="Ex: PROC-2024-001"
              disabled={mutation.isPending}
            />
          </div>

          {/* Observações */}
          <div>
            <label htmlFor="client-notes" className={labelClassName}>
              Observações
            </label>
            <textarea
              id="client-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={`${inputClassName} resize-none`}
              rows={3}
              placeholder="Informações adicionais sobre o cliente…"
              disabled={mutation.isPending}
            />
          </div>

          {/* Erro */}
          {mutation.isError && (
            <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-[13px] text-red-700">
              {mutation.error?.message ?? 'Erro ao salvar cliente.'}
            </p>
          )}

          {/* Sucesso rápido */}
          {mutation.isSuccess && (
            <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-[13px] text-emerald-700">
              Cliente atualizado com sucesso!
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
              disabled={mutation.isPending || fullName.trim() === ''}
            >
              {mutation.isPending ? 'Salvando…' : 'Salvar Alterações'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
