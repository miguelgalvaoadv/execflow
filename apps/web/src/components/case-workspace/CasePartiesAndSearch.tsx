'use client'

/**
 * Aba "Partes & Busca" do workspace do caso.
 * - Partes: réu, corréu, vítima, MP, advogado, testemunha… (spec §14)
 * - Busca nos autos: cada resultado cita documento + página + trecho +
 *   confiança (spec §19). A busca é feita no backend sobre o texto OCR.
 */

import { useState, type FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Search, Trash2, CircleCheck } from 'lucide-react'
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '@/lib/api-client'
import { useSession } from '@/lib/hooks/use-session'
import { Button } from '@/components/ui'
import { borders, text } from '@/components/dashboard/surfaces'

type CaseParty = {
  id: string
  name: string
  participationType: string
  cpf: string | null
  oab: string | null
  confidence: 'suggested' | 'confirmed'
  sourceReference: string | null
  notes: string | null
}

type SearchResult = {
  documentId: string
  documentName: string
  documentClass: string | null
  page: number | null
  snippet: string
  confidence: 'exata' | 'aproximada'
}

const PARTICIPATION_LABELS: Record<string, string> = {
  reu: 'Réu',
  correu: 'Corréu',
  autor: 'Autor',
  vitima: 'Vítima',
  ministerio_publico: 'Ministério Público',
  advogado: 'Advogado',
  assistente: 'Assistente',
  testemunha: 'Testemunha',
  familiar: 'Familiar',
  outro: 'Outro',
}

const inputClassName = [
  'rounded-lg border px-3 py-2 text-[13px] outline-none transition-colors',
  `${borders.default} bg-white shadow-sm ${text.primary}`,
  'placeholder:text-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-600',
].join(' ')

export function CasePartiesAndSearch({ caseId }: { caseId: string }) {
  const { data: session } = useSession()
  const orgId = session?.organization.id ?? ''
  const queryClient = useQueryClient()

  // ── Partes
  const partiesQuery = useQuery<{ data: CaseParty[] }, ApiError>({
    queryKey: ['case-parties', orgId, caseId],
    queryFn: ({ signal }) =>
      apiGet(`/api/v1/cases/${caseId}/parties`, { organizationId: orgId, signal }),
    enabled: orgId !== '',
    staleTime: 30 * 1000,
  })

  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('reu')

  const invalidateParties = () =>
    queryClient.invalidateQueries({ queryKey: ['case-parties', orgId, caseId] })

  const addParty = useMutation<unknown, ApiError, { name: string; participationType: string }>({
    mutationFn: (body) =>
      apiPost(`/api/v1/cases/${caseId}/parties`, body, { organizationId: orgId }),
    onSuccess: () => {
      setNewName('')
      void invalidateParties()
    },
  })

  const confirmParty = useMutation<unknown, ApiError, string>({
    mutationFn: (partyId) =>
      apiPatch(`/api/v1/cases/${caseId}/parties/${partyId}`, { confidence: 'confirmed' }, { organizationId: orgId }),
    onSuccess: () => void invalidateParties(),
  })

  const removeParty = useMutation<unknown, ApiError, string>({
    mutationFn: (partyId) =>
      apiDelete(`/api/v1/cases/${caseId}/parties/${partyId}`, { organizationId: orgId }),
    onSuccess: () => void invalidateParties(),
  })

  // ── Busca nos autos
  const [searchQuery, setSearchQuery] = useState('')
  const search = useMutation<
    { data: { results: SearchResult[]; documentsSearched: number; note: string | null } },
    ApiError,
    string
  >({
    mutationFn: (query) =>
      apiPost(`/api/v1/cases/${caseId}/search-autos`, { query }, { organizationId: orgId }),
  })

  function handleAddParty(e: FormEvent) {
    e.preventDefault()
    if (newName.trim().length < 2) return
    addParty.mutate({ name: newName.trim(), participationType: newType })
  }

  function handleSearch(e: FormEvent) {
    e.preventDefault()
    if (searchQuery.trim().length >= 2) search.mutate(searchQuery.trim())
  }

  const parties = partiesQuery.data?.data ?? []

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* ── Partes ── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className={`mb-3 inline-flex items-center gap-2 text-[14px] font-semibold ${text.primary}`}>
          <Users className="h-4 w-4 text-slate-400" /> Partes do processo
        </h3>

        <form onSubmit={handleAddParty} className="mb-4 flex flex-wrap gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome da parte"
            className={`${inputClassName} min-w-[180px] flex-1`}
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            className={inputClassName}
          >
            {Object.entries(PARTICIPATION_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <Button variant="primary" type="submit" disabled={addParty.isPending || newName.trim().length < 2}>
            {addParty.isPending ? 'Adicionando…' : 'Adicionar'}
          </Button>
        </form>
        {addParty.isError && (
          <p className="mb-2 text-[12px] text-red-600">{addParty.error?.message}</p>
        )}

        {partiesQuery.isLoading ? (
          <p className={`text-[12px] ${text.faint}`}>Carregando…</p>
        ) : parties.length === 0 ? (
          <p className={`text-[12px] ${text.faint}`}>
            Nenhuma parte cadastrada. Adicione réu, corréus, vítimas, MP e advogados —
            em processo criminal a distinção evita confundir cliente com corréu ou testemunha.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {parties.map((party) => (
              <li
                key={party.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className={`truncate text-[13px] font-medium ${text.primary}`}>{party.name}</p>
                  <p className={`text-[11px] ${text.faint}`}>
                    {PARTICIPATION_LABELS[party.participationType] ?? party.participationType}
                    {party.oab ? ` · OAB ${party.oab}` : ''}
                    {party.sourceReference ? ` · ${party.sourceReference}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {party.confidence === 'suggested' ? (
                    <button
                      type="button"
                      title="Sugerida pela IA — confirmar"
                      onClick={() => confirmParty.mutate(party.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100"
                    >
                      Sugerida — confirmar
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                      <CircleCheck className="h-3.5 w-3.5" /> confirmada
                    </span>
                  )}
                  <button
                    type="button"
                    title="Remover"
                    onClick={() => removeParty.mutate(party.id)}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Busca nos autos ── */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className={`mb-3 inline-flex items-center gap-2 text-[14px] font-semibold ${text.primary}`}>
          <Search className="h-4 w-4 text-slate-400" /> Buscar nos autos
        </h3>

        <form onSubmit={handleSearch} className="mb-4 flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Nome, data, decisão, fundamento…"
            className={`${inputClassName} flex-1`}
          />
          <Button variant="primary" type="submit" disabled={search.isPending || searchQuery.trim().length < 2}>
            {search.isPending ? 'Buscando…' : 'Buscar'}
          </Button>
        </form>

        {search.isError && (
          <p className="text-[12px] text-red-600">{search.error?.message}</p>
        )}

        {search.data && (
          <div className="space-y-2">
            <p className={`text-[11px] ${text.faint}`}>
              {search.data.data.documentsSearched} documento(s) pesquisado(s) ·{' '}
              {search.data.data.results.length} resultado(s)
            </p>
            {search.data.data.note !== null && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
                {search.data.data.note}
              </p>
            )}
            {search.data.data.results.map((r, i) => (
              <div key={i} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                <p className={`text-[12px] font-medium ${text.secondary}`}>
                  {r.documentName}
                  {r.page !== null ? ` — página ${r.page}` : ' — página não identificada'}
                  <span
                    className={`ml-2 inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      r.confidence === 'exata'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    citação {r.confidence}
                  </span>
                </p>
                <p className={`mt-1 text-[12px] leading-relaxed ${text.muted}`}>&ldquo;{r.snippet}&rdquo;</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
