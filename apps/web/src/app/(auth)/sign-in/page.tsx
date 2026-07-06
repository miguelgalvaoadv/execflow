'use client'

/**
 * Sign-in page — authenticates the user via Better Auth email/password.
 *
 * On success: redirects to the page they came from (via `from` param),
 * or to /queues (the primary operational surface).
 *
 * No magic links, no OAuth — direct credential auth via the API.
 * Session cookie is set by the API (HttpOnly); this page never touches it.
 */

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import { borders, surfaces, text } from '@/components/dashboard/surfaces'
import { Button } from '@/components/ui'

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className={`w-full max-w-[400px] rounded-2xl border ${borders.subtle} ${surfaces.panel} p-10`}>
          <p className={`text-[13px] ${text.muted}`}>Carregando…</p>
        </div>
      }
    >
      <SignInForm />
    </Suspense>
  )
}

function SignInForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const from = searchParams.get('from') ?? '/queues'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)

    try {
      const result = await authClient.signIn.email({
        email,
        password,
        fetchOptions: { credentials: 'include' },
      })

      if (result.error != null) {
        setError(result.error.message ?? 'Credenciais inválidas.')
        return
      }

      router.push(from.startsWith('/') ? from : '/queues')
    } catch {
      setError('Não foi possível conectar ao servidor.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      className={[
        'w-full max-w-[400px] rounded-2xl border p-10',
        borders.default,
        'bg-white shadow-xl',
      ].join(' ')}
    >
      {/* Marca EXECFLOW — mesmo logótipo do SidebarBrand */}
      <div className="mb-8 flex items-center gap-3">
        <svg
          width="32"
          height="32"
          viewBox="0 0 32 32"
          fill="none"
          aria-hidden="true"
          className="shrink-0"
        >
          <rect x="7" y="7" width="3" height="18" rx="1.5" fill="#0f172a" />
          <rect x="7" y="7" width="14" height="3" rx="1.5" fill="#0f172a" />
          <rect x="7" y="14.5" width="11" height="3" rx="1.5" fill="#0f172a" />
          <rect x="7" y="22" width="14" height="3" rx="1.5" fill="#0f172a" />
          <rect x="22" y="7" width="3" height="3" rx="1.5" fill="#2563eb" />
        </svg>
        <div>
          <p className="text-[13px] font-semibold tracking-[-0.02em] text-slate-900">
            EXECFLOW
          </p>
          <p className={`text-[11px] ${text.faint}`}>
            Execução penal
          </p>
        </div>
      </div>

      <div className="mb-7">
        <h1
          className={`text-[28px] font-semibold leading-[1.2] tracking-[-0.02em] ${text.primary}`}
        >
          Entrar
        </h1>
        <p className={`mt-1.5 text-[13px] leading-relaxed ${text.secondary}`}>
          Sistema operacional de execução penal
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.10em] ${text.muted}`}
          >
            E-mail
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={[
              'w-full rounded-lg border px-3 py-2.5 text-[13px] outline-none transition-colors',
              `${borders.default} bg-white ${text.primary}`,
              'placeholder:text-slate-400',
              'focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20',
            ].join(' ')}
            placeholder="advogado@escritorio.com"
            disabled={pending}
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className={`mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.10em] ${text.muted}`}
          >
            Senha
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={[
              'w-full rounded-lg border px-3 py-2.5 text-[13px] outline-none transition-colors',
              `${borders.default} bg-white ${text.primary}`,
              'placeholder:text-slate-400',
              'focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20',
            ].join(' ')}
            placeholder="••••••••"
            disabled={pending}
          />
        </div>

        {error !== null && (
          <p
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-700"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="pt-1">
          <Button
            type="submit"
            variant="primary"
            fullWidth
            disabled={pending || email === '' || password === ''}
          >
            {pending ? 'Entrando…' : 'Entrar'}
          </Button>
        </div>
      </form>
    </div>
  )
}
