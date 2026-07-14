'use client'

/**
 * ChangePasswordModal — troca da própria senha (self-service).
 *
 * Usa o Better Auth (/api/auth/change-password): exige a senha atual +
 * a nova. Nenhuma senha passa pelo nosso backend de domínio — vai direto
 * para o Better Auth, que valida a atual e regrava o hash.
 */

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui'
import { borders, surfaces, text } from '@/components/dashboard/surfaces'

const inputClass = [
  'w-full rounded-lg border px-3 py-2.5 text-[13px] outline-none transition-colors',
  `${borders.default} bg-white shadow-sm ${text.primary}`,
  'placeholder:text-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-600',
].join(' ')

const labelClass = `mb-1.5 block text-[11px] font-medium uppercase tracking-[0.1em] ${text.muted}`

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  function reset() {
    setCurrent(''); setNext(''); setConfirm(''); setError(null); setSuccess(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (next.length < 12) { setError('A nova senha deve ter ao menos 12 caracteres.'); return }
    if (next !== confirm) { setError('A confirmação não bate com a nova senha.'); return }
    setPending(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next, revokeOtherSessions: false }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.message ?? 'Não foi possível trocar a senha. Confira a senha atual.')
        return
      }
      setSuccess(true)
      setCurrent(''); setNext(''); setConfirm('')
    } catch {
      setError('Falha de conexão ao trocar a senha.')
    } finally {
      setPending(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm" onClick={() => { reset(); onClose() }} />
      <div className={`relative z-10 w-full max-w-[440px] rounded-2xl border p-8 ${surfaces.panelRaised}`}>
        <h2 className={`text-[20px] font-semibold tracking-[-0.01em] mb-1 ${text.primary}`}>Alterar minha senha</h2>
        <p className={`text-[13px] mb-6 ${text.muted}`}>
          Informe a senha atual e escolha uma nova (mínimo 12 caracteres).
        </p>

        {success ? (
          <div>
            <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-[13px] text-emerald-700">
              Senha alterada com sucesso.
            </p>
            <div className="mt-5 flex justify-end">
              <Button type="button" variant="primary" onClick={() => { reset(); onClose() }}>Fechar</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="cp-cur" className={labelClass}>Senha atual</label>
              <input id="cp-cur" type="password" autoComplete="current-password" required value={current}
                onChange={(e) => setCurrent(e.target.value)} className={inputClass} disabled={pending} />
            </div>
            <div>
              <label htmlFor="cp-new" className={labelClass}>Nova senha</label>
              <input id="cp-new" type="password" autoComplete="new-password" required value={next}
                onChange={(e) => setNext(e.target.value)} className={inputClass} placeholder="Mínimo 12 caracteres" disabled={pending} />
            </div>
            <div>
              <label htmlFor="cp-conf" className={labelClass}>Confirmar nova senha</label>
              <input id="cp-conf" type="password" autoComplete="new-password" required value={confirm}
                onChange={(e) => setConfirm(e.target.value)} className={inputClass} disabled={pending} />
            </div>

            {error !== null && (
              <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-[13px] text-red-700">{error}</p>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <Button type="button" variant="ghost" onClick={() => { reset(); onClose() }} disabled={pending}>Cancelar</Button>
              <Button type="submit" variant="primary"
                disabled={pending || current === '' || next.length < 12 || confirm === ''}>
                {pending ? 'Salvando…' : 'Alterar senha'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
