'use client'

/**
 * Guarda de papel no shell interno: usuário com role 'client' é redirecionado
 * para o portal restrito. A SEGURANÇA REAL é do backend (toda rota
 * operacional exige ≥ assistant) — isto aqui é só UX para o cliente nunca
 * ver o esqueleto do painel interno.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/hooks/use-session'

export function ClientRoleGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { data: session } = useSession()

  useEffect(() => {
    if (session?.role === 'client') {
      router.replace('/portal')
    }
  }, [session?.role, router])

  if (session?.role === 'client') {
    return (
      <p className="py-16 text-center text-[13px] text-slate-500">
        Redirecionando para o seu portal…
      </p>
    )
  }
  return <>{children}</>
}
