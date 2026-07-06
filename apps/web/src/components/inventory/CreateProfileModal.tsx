'use client'

/**
 * CreateProfileModal — cadastro de perfil OAB do advogado (spec §5).
 */

import { useState, type FormEvent } from 'react'
import { useSession } from '@/lib/hooks/use-session'
import { useCreateOabProfile } from '@/lib/hooks/use-inventory'
import { Button } from '@/components/ui'
import { borders, surfaces, text } from '@/components/dashboard/surfaces'

type CreateProfileModalProps = {
  open: boolean
  onClose: () => void
}

const inputClassName = [
  'w-full rounded-lg border px-3 py-2.5 text-[13px] outline-none transition-colors',
  `${borders.default} bg-white shadow-sm ${text.primary}`,
  'placeholder:text-slate-400',
  'focus:border-blue-600 focus:ring-1 focus:ring-blue-600',
].join(' ')

const labelClassName = `mb-1.5 block text-[11px] font-medium uppercase tracking-[0.1em] ${text.muted}`

export function CreateProfileModal({ open, onClose }: CreateProfileModalProps) {
  const { data: session } = useSession()
  const orgId = session?.organization.id ?? ''
  const createProfile = useCreateOabProfile(orgId)

  const [lawyerName, setLawyerName] = useState('')
  const [oabNumber, setOabNumber] = useState('')
  const [oabUf, setOabUf] = useState('SP')
  const [primaryTribunal, setPrimaryTribunal] = useState('TJSP')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    createProfile.mutate(
      {
        lawyerName: lawyerName.trim(),
        oabNumber: oabNumber.trim(),
        oabUf: oabUf.trim().toUpperCase(),
        ...(primaryTribunal.trim() ? { primaryTribunal: primaryTribunal.trim() } : {}),
      },
      {
        onSuccess: () => {
          setLawyerName('')
          setOabNumber('')
          onClose()
        },
      }
    )
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-100 backdrop-blur-sm" onClick={onClose} />

      <div
        className={[
          'relative z-10 w-full max-w-[460px] rounded-2xl border p-8',
          surfaces.panelRaised,
        ].join(' ')}
      >
        <h2 className={`mb-1 text-[20px] font-semibold tracking-[-0.01em] ${text.primary}`}>
          Novo perfil OAB
        </h2>
        <p className={`mb-5 text-[13px] ${text.muted}`}>
          O perfil organiza o inventário de processos vinculados à sua inscrição.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="profile-name" className={labelClassName}>
              Nome do advogado *
            </label>
            <input
              id="profile-name"
              type="text"
              required
              value={lawyerName}
              onChange={(e) => setLawyerName(e.target.value)}
              className={inputClassName}
              placeholder="Como consta na OAB"
              disabled={createProfile.isPending}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label htmlFor="profile-oab" className={labelClassName}>
                Número OAB *
              </label>
              <input
                id="profile-oab"
                type="text"
                required
                value={oabNumber}
                onChange={(e) => setOabNumber(e.target.value)}
                className={inputClassName}
                placeholder="Ex: 123456"
                disabled={createProfile.isPending}
              />
            </div>
            <div>
              <label htmlFor="profile-uf" className={labelClassName}>
                UF *
              </label>
              <input
                id="profile-uf"
                type="text"
                required
                maxLength={2}
                value={oabUf}
                onChange={(e) => setOabUf(e.target.value.toUpperCase())}
                className={inputClassName}
                disabled={createProfile.isPending}
              />
            </div>
          </div>

          <div>
            <label htmlFor="profile-tribunal" className={labelClassName}>
              Tribunal principal
            </label>
            <input
              id="profile-tribunal"
              type="text"
              value={primaryTribunal}
              onChange={(e) => setPrimaryTribunal(e.target.value)}
              className={inputClassName}
              placeholder="Ex: TJSP"
              disabled={createProfile.isPending}
            />
          </div>

          {createProfile.isError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
              {createProfile.error?.message ?? 'Erro ao criar perfil.'}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" type="submit" disabled={createProfile.isPending}>
              {createProfile.isPending ? 'Criando…' : 'Criar perfil'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
