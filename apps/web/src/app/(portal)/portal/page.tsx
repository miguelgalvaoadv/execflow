'use client'

/**
 * Portal do cliente (spec §17) — visão simplificada e restrita.
 * Toda a filtragem de dados acontece no BACKEND (whitelist); esta tela
 * apenas exibe o que o endpoint /api/v1/portal/overview devolve.
 */

import { useQuery } from '@tanstack/react-query'
import { FileText, Scale, Clock } from 'lucide-react'
import { apiGet, ApiError } from '@/lib/api-client'
import { useSession } from '@/lib/hooks/use-session'

type PortalOverview = {
  cliente: { nome: string }
  processos: Array<{
    id: string
    processNumber: string | null
    courtName: string | null
    statusSimples: string
    ultimaAtualizacao: { resumo: string; data: string } | null
    documentosEnviados: Array<{ nome: string; classe: string | null; data: string }>
  }>
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(iso)
  )
}

export default function PortalPage() {
  const { data: session, isLoading: sessionLoading } = useSession()
  const orgId = session?.organization.id ?? ''

  const query = useQuery<{ data: PortalOverview }, ApiError>({
    queryKey: ['portal-overview', orgId],
    queryFn: ({ signal }) => apiGet('/api/v1/portal/overview', { organizationId: orgId, signal }),
    staleTime: 60 * 1000,
    enabled: orgId !== '' && session != null,
  })

  if (sessionLoading || query.isLoading) {
    return <p className="py-10 text-center text-[13px] text-slate-500">Carregando…</p>
  }
  if (session == null) {
    return (
      <p className="py-10 text-center text-[13px] text-slate-500">
        Sessão não encontrada. <a href="/sign-in" className="text-blue-600 underline">Entrar novamente</a>
      </p>
    )
  }
  if (query.isError) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
        {query.error?.message ?? 'Não foi possível carregar seus dados agora. Tente novamente mais tarde.'}
      </p>
    )
  }

  const overview = query.data?.data
  if (!overview) return null

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-slate-900">
          Olá, {overview.cliente.nome}
        </h1>
        <p className="text-[13px] text-slate-500">
          Acompanhe abaixo o andamento simplificado do(s) seu(s) processo(s).
        </p>
      </div>

      {overview.processos.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-[13px] text-slate-500">
          Nenhum processo vinculado ao seu acesso ainda.
        </p>
      ) : (
        overview.processos.map((proc) => (
          <div key={proc.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Scale className="h-4 w-4 text-slate-400" />
                <div>
                  <p className="text-[14px] font-semibold text-slate-900">
                    {proc.processNumber ?? 'Processo em cadastramento'}
                  </p>
                  {proc.courtName !== null && (
                    <p className="text-[12px] text-slate-500">{proc.courtName}</p>
                  )}
                </div>
              </div>
              <span className="inline-flex rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[12px] font-medium capitalize text-blue-700">
                {proc.statusSimples}
              </span>
            </div>

            {proc.ultimaAtualizacao !== null && (
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-3">
                <p className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <Clock className="h-3 w-3" /> Última atualização — {formatDate(proc.ultimaAtualizacao.data)}
                </p>
                <p className="text-[13px] text-slate-700">{proc.ultimaAtualizacao.resumo}</p>
              </div>
            )}

            {proc.documentosEnviados.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Documentos no processo
                </p>
                <ul className="space-y-1">
                  {proc.documentosEnviados.map((doc, i) => (
                    <li key={i} className="flex items-center gap-2 text-[12px] text-slate-600">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="truncate">{doc.nome}</span>
                      <span className="shrink-0 text-slate-400">· {formatDate(doc.data)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}
