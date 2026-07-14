'use client'

/**
 * Agenda — calendário do escritório (pedido do Miguel 13/07/2026).
 *
 * Duas visões: Mês (grid de 42 quadradinhos) e Semana (7 colunas, mais
 * espaço por dia, mostra horário quando não é dia inteiro). Navegação ‹ ›
 * + "Hoje" funciona nas duas. Mescla três camadas: eventos manuais + prazos
 * + oportunidades, cada uma ligável/desligável. Clicar num dia cria evento;
 * clicar num evento manual edita; clicar num prazo/oportunidade abre o caso
 * de origem.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Plus, X, Trash2, CalendarDays } from 'lucide-react'
import { useSession } from '@/lib/hooks/use-session'
import {
  useCalendar,
  useCreateCalendarEvent,
  useUpdateCalendarEvent,
  useDeleteCalendarEvent,
  type CalendarItem,
  type CalendarLayer,
} from '@/lib/hooks/use-calendar'
import { DashboardPageHeader } from '@/components/dashboard'
import { Button, ErrorState, LoadingState } from '@/components/ui'

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const EVENT_KIND_OPTIONS = [
  { value: 'manual', label: 'Geral' },
  { value: 'hearing', label: 'Audiência' },
  { value: 'meeting', label: 'Reunião' },
  { value: 'reminder', label: 'Lembrete' },
  { value: 'internal', label: 'Interno' },
]

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
function localDayKeyFromIso(iso: string): string {
  return dayKey(new Date(iso))
}
function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b)
}
function isoForDayNoon(y: number, m: number, d: number): string {
  return new Date(y, m, d, 12, 0, 0).toISOString()
}

function chipClass(item: CalendarItem): string {
  if (item.kind === 'deadline') {
    if (item.deadlineStatus === 'overdue') return 'bg-red-100 text-red-800 border-red-200'
    if (item.deadlinePriority === 'critical' || item.deadlinePriority === 'high')
      return 'bg-red-50 text-red-700 border-red-200'
    return 'bg-rose-50 text-rose-700 border-rose-200'
  }
  if (item.kind === 'opportunity') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  switch (item.eventKind) {
    case 'hearing': return 'bg-purple-50 text-purple-700 border-purple-200'
    case 'meeting': return 'bg-indigo-50 text-indigo-700 border-indigo-200'
    case 'reminder': return 'bg-amber-50 text-amber-700 border-amber-200'
    case 'deadline_link': return 'bg-red-50 text-red-700 border-red-200'
    case 'opportunity_link': return 'bg-emerald-50 text-emerald-700 border-emerald-200'
    default: return 'bg-blue-50 text-blue-700 border-blue-200'
  }
}

type EditorState = {
  id: string | null
  title: string
  date: string // YYYY-MM-DD
  allDay: boolean
  time: string // HH:mm
  eventKind: string
  location: string
  description: string
} | null

function toDateInput(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function CalendarPage() {
  const { data: session, isLoading: sessionLoading } = useSession()
  const orgId = session?.organization.id ?? ''
  const router = useRouter()

  const today = useMemo(() => new Date(), [])
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month')
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [weekAnchor, setWeekAnchor] = useState(today)
  const [layers, setLayers] = useState<CalendarLayer[]>(['manual', 'deadlines', 'opportunities'])
  const [editor, setEditor] = useState<EditorState>(null)

  // Grid: 42 células (6 semanas), começando no domingo antes do dia 1.
  const gridStart = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1)
    const start = new Date(first)
    start.setDate(first.getDate() - first.getDay()) // volta pro domingo
    start.setHours(0, 0, 0, 0)
    return start
  }, [viewYear, viewMonth])

  const gridDays = useMemo(() => {
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart)
      d.setDate(gridStart.getDate() + i)
      return d
    })
  }, [gridStart])

  // Semana: 7 dias a partir do domingo da semana que contém weekAnchor.
  const weekStart = useMemo(() => {
    const start = new Date(weekAnchor)
    start.setDate(weekAnchor.getDate() - weekAnchor.getDay())
    start.setHours(0, 0, 0, 0)
    return start
  }, [weekAnchor])

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart)
      d.setDate(weekStart.getDate() + i)
      return d
    })
  }, [weekStart])

  const rangeFrom = useMemo(() => {
    const base = viewMode === 'week' ? weekStart : gridStart
    const d = new Date(base)
    d.setHours(0, 0, 0, 0)
    return d.toISOString()
  }, [viewMode, weekStart, gridStart])
  const rangeTo = useMemo(() => {
    const base = viewMode === 'week' ? weekStart : gridStart
    const d = new Date(base)
    d.setDate(d.getDate() + (viewMode === 'week' ? 6 : 41))
    d.setHours(23, 59, 59, 999)
    return d.toISOString()
  }, [viewMode, weekStart, gridStart])

  const query = useCalendar(orgId, rangeFrom, rangeTo, layers, session != null)
  const createMutation = useCreateCalendarEvent(orgId)
  const updateMutation = useUpdateCalendarEvent(orgId)
  const deleteMutation = useDeleteCalendarEvent(orgId)

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>()
    for (const item of query.data?.data ?? []) {
      const k = localDayKeyFromIso(item.startsAt)
      const arr = map.get(k) ?? []
      arr.push(item)
      map.set(k, arr)
    }
    return map
  }, [query.data])

  function toggleLayer(layer: CalendarLayer) {
    setLayers((prev) => (prev.includes(layer) ? prev.filter((l) => l !== layer) : [...prev, layer]))
  }

  function goToday() {
    setViewYear(today.getFullYear())
    setViewMonth(today.getMonth())
    setWeekAnchor(today)
  }
  function goPrev() {
    if (viewMode === 'week') {
      const d = new Date(weekAnchor)
      d.setDate(d.getDate() - 7)
      setWeekAnchor(d)
      return
    }
    const d = new Date(viewYear, viewMonth - 1, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }
  function goNext() {
    if (viewMode === 'week') {
      const d = new Date(weekAnchor)
      d.setDate(d.getDate() + 7)
      setWeekAnchor(d)
      return
    }
    const d = new Date(viewYear, viewMonth + 1, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }

  const weekRangeLabel = useMemo(() => {
    const end = weekDays[6]!
    const start = weekDays[0]!
    const sameMonth = start.getMonth() === end.getMonth()
    const startLabel = `${start.getDate()}${sameMonth ? '' : ' ' + MONTHS[start.getMonth()]!.slice(0, 3)}`
    const endLabel = `${end.getDate()} ${MONTHS[end.getMonth()]!.slice(0, 3)} ${end.getFullYear()}`
    return `${startLabel} – ${endLabel}`
  }, [weekDays])

  function openCreate(date: Date) {
    setEditor({
      id: null,
      title: '',
      date: toDateInput(date),
      allDay: true,
      time: '09:00',
      eventKind: 'manual',
      location: '',
      description: '',
    })
  }

  function openItem(item: CalendarItem) {
    if (item.kind === 'deadline') {
      router.push(item.executionCaseId ? `/cases/${item.executionCaseId}?tab=prazos` : `/deadlines/${item.id}`)
      return
    }
    if (item.kind === 'opportunity') {
      if (item.executionCaseId) router.push(`/cases/${item.executionCaseId}?tab=oportunidades`)
      return
    }
    // manual → editar
    const d = new Date(item.startsAt)
    setEditor({
      id: item.id,
      title: item.title,
      date: toDateInput(d),
      allDay: item.allDay,
      time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      eventKind: item.eventKind ?? 'manual',
      location: item.location ?? '',
      description: item.description ?? '',
    })
  }

  function saveEditor() {
    if (!editor || editor.title.trim() === '') return
    const [y, m, d] = editor.date.split('-').map(Number)
    let startsAt: string
    if (editor.allDay) {
      startsAt = isoForDayNoon(y!, m! - 1, d!)
    } else {
      const [hh, mm] = editor.time.split(':').map(Number)
      startsAt = new Date(y!, m! - 1, d!, hh ?? 9, mm ?? 0, 0).toISOString()
    }
    const payload = {
      title: editor.title.trim(),
      startsAt,
      allDay: editor.allDay,
      eventKind: editor.eventKind,
      location: editor.location.trim() || null,
      description: editor.description.trim() || null,
    }
    if (editor.id) {
      updateMutation.mutate({ id: editor.id, input: payload }, { onSuccess: () => setEditor(null) })
    } else {
      createMutation.mutate(payload, { onSuccess: () => setEditor(null) })
    }
  }

  function deleteEditor() {
    if (!editor?.id) return
    deleteMutation.mutate(editor.id, { onSuccess: () => setEditor(null) })
  }

  const busy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Operacional"
        title="Agenda"
        description="Calendário do escritório — eventos manuais, prazos e oportunidades num só lugar."
      />

      {/* Barra de controle */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goPrev}
            className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
            aria-label={viewMode === 'week' ? 'Semana anterior' : 'Mês anterior'}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[170px] text-center text-[15px] font-semibold text-slate-800">
            {viewMode === 'week' ? weekRangeLabel : `${MONTHS[viewMonth]} ${viewYear}`}
          </span>
          <button
            type="button"
            onClick={goNext}
            className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
            aria-label={viewMode === 'week' ? 'Próxima semana' : 'Próximo mês'}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="ml-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
          >
            Hoje
          </button>
          <div className="ml-1 flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('month')}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${viewMode === 'month' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
            >
              Mês
            </button>
            <button
              type="button"
              onClick={() => setViewMode('week')}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${viewMode === 'week' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
            >
              Semana
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <LayerToggle label="Prazos" color="bg-red-500" active={layers.includes('deadlines')} onClick={() => toggleLayer('deadlines')} />
          <LayerToggle label="Oportunidades" color="bg-emerald-500" active={layers.includes('opportunities')} onClick={() => toggleLayer('opportunities')} />
          <LayerToggle label="Eventos" color="bg-blue-500" active={layers.includes('manual')} onClick={() => toggleLayer('manual')} />
          <Button variant="primary" size="md" onClick={() => openCreate(viewMode === 'week' ? weekAnchor : new Date(viewYear, viewMonth, today.getDate()))}>
            <Plus className="h-4 w-4" /> Novo evento
          </Button>
        </div>
      </div>

      {sessionLoading ? (
        <div className="mt-6"><LoadingState label="Carregando…" /></div>
      ) : session === null ? (
        <div className="mt-6"><ErrorState message="Sessão não encontrada." /></div>
      ) : viewMode === 'week' ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {/* Cabeçalho dos dias da semana */}
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
            {weekDays.map((day, i) => {
              const isToday = isSameDay(day, today)
              return (
                <div key={i} className="px-2 py-2 text-center">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{WEEKDAYS[i]}</p>
                  <span
                    className={[
                      'mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px]',
                      isToday ? 'bg-blue-600 font-semibold text-white' : 'text-slate-700',
                    ].join(' ')}
                  >
                    {day.getDate()}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Colunas dos 7 dias — mais espaço vertical que a visão mês */}
          <div className="grid grid-cols-7">
            {weekDays.map((day, idx) => {
              const items = (itemsByDay.get(dayKey(day)) ?? []).slice().sort((a, b) => a.startsAt.localeCompare(b.startsAt))
              return (
                <div
                  key={idx}
                  className={[
                    'min-h-[420px] border-r border-slate-100 p-2 last:border-r-0',
                    isSameDay(day, today) ? 'bg-blue-50/30' : 'bg-white',
                  ].join(' ')}
                  onClick={() => openCreate(day)}
                  role="button"
                  tabIndex={-1}
                >
                  <div className="space-y-1.5">
                    {items.map((item) => (
                      <button
                        key={`${item.kind}-${item.id}`}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openItem(item) }}
                        className={`block w-full rounded border px-2 py-1.5 text-left text-[11px] font-medium ${chipClass(item)}`}
                        title={`${item.clientName ? item.clientName + ' — ' : ''}${item.title}`}
                      >
                        {!item.allDay && (
                          <span className="mb-0.5 block text-[10px] font-normal opacity-70">
                            {new Date(item.startsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                        {item.clientName && <span className="block truncate">{item.clientName}</span>}
                        <span className="block truncate font-normal opacity-90">{item.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {/* Cabeçalho dos dias da semana */}
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
            {WEEKDAYS.map((w) => (
              <div key={w} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {w}
              </div>
            ))}
          </div>

          {/* Grid de 6 semanas */}
          <div className="grid grid-cols-7">
            {gridDays.map((day, idx) => {
              const inMonth = day.getMonth() === viewMonth
              const isToday = isSameDay(day, today)
              const items = itemsByDay.get(dayKey(day)) ?? []
              const shown = items.slice(0, 3)
              const extra = items.length - shown.length
              return (
                <div
                  key={idx}
                  className={[
                    'min-h-[104px] border-b border-r border-slate-100 p-1.5 last:border-r-0',
                    inMonth ? 'bg-white' : 'bg-slate-50/60',
                    (idx + 1) % 7 === 0 ? 'border-r-0' : '',
                  ].join(' ')}
                  onClick={() => openCreate(day)}
                  role="button"
                  tabIndex={-1}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={[
                        'inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px]',
                        isToday ? 'bg-blue-600 font-semibold text-white' : inMonth ? 'text-slate-700' : 'text-slate-400',
                      ].join(' ')}
                    >
                      {day.getDate()}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {shown.map((item) => (
                      <button
                        key={`${item.kind}-${item.id}`}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openItem(item) }}
                        className={`block w-full truncate rounded border px-1.5 py-0.5 text-left text-[11px] font-medium ${chipClass(item)}`}
                        title={`${item.clientName ? item.clientName + ' — ' : ''}${item.title}`}
                      >
                        {item.clientName ? `${item.clientName.split(' ')[0]}: ` : ''}{item.title}
                      </button>
                    ))}
                    {extra > 0 && (
                      <span className="block px-1.5 text-[10px] text-slate-500">+{extra} mais</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {query.isError && (
        <p className="mt-2 text-[12px] text-red-600">Erro ao carregar a agenda: {query.error?.message}</p>
      )}

      {/* Legenda */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <LegendDot color="bg-red-400" label="Prazo" />
        <LegendDot color="bg-emerald-400" label="Oportunidade" />
        <LegendDot color="bg-purple-400" label="Audiência" />
        <LegendDot color="bg-indigo-400" label="Reunião" />
        <LegendDot color="bg-amber-400" label="Lembrete" />
        <LegendDot color="bg-blue-400" label="Evento geral" />
        <span className="text-slate-400">· Clique num dia para adicionar um evento.</span>
      </div>

      {/* Modal criar/editar */}
      {editor !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setEditor(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-800">
                <CalendarDays className="h-4 w-4 text-blue-600" />
                {editor.id ? 'Editar evento' : 'Novo evento'}
              </h2>
              <button type="button" onClick={() => setEditor(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Título</label>
                <input
                  type="text"
                  value={editor.title}
                  autoFocus
                  onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                  placeholder="Ex.: Audiência de justificação"
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">Data</label>
                  <input
                    type="date"
                    value={editor.date}
                    onChange={(e) => setEditor({ ...editor, date: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">Tipo</label>
                  <select
                    value={editor.eventKind}
                    onChange={(e) => setEditor({ ...editor, eventKind: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-blue-600"
                  >
                    {EVENT_KIND_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="allday"
                  type="checkbox"
                  checked={editor.allDay}
                  onChange={(e) => setEditor({ ...editor, allDay: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <label htmlFor="allday" className="text-[12px] text-slate-600">Dia inteiro</label>
                {!editor.allDay && (
                  <input
                    type="time"
                    value={editor.time}
                    onChange={(e) => setEditor({ ...editor, time: e.target.value })}
                    className="ml-2 rounded-lg border border-slate-200 px-2 py-1 text-[13px] outline-none focus:border-blue-600"
                  />
                )}
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Local (opcional)</label>
                <input
                  type="text"
                  value={editor.location}
                  onChange={(e) => setEditor({ ...editor, location: e.target.value })}
                  placeholder="Ex.: Fórum de Bauru, sala 3"
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-600">Observações (opcional)</label>
                <textarea
                  value={editor.description}
                  onChange={(e) => setEditor({ ...editor, description: e.target.value })}
                  rows={3}
                  className="w-full resize-none rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-blue-600"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              {editor.id ? (
                <button
                  type="button"
                  onClick={deleteEditor}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[12px] font-medium text-red-700 hover:bg-red-100"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Excluir
                </button>
              ) : <span />}
              <div className="flex items-center gap-2">
                <Button size="md" onClick={() => setEditor(null)}>Cancelar</Button>
                <Button variant="primary" size="md" onClick={saveEditor} disabled={busy || editor.title.trim() === ''}>
                  {busy ? 'Salvando…' : 'Salvar'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function LayerToggle({ label, color, active, onClick }: { label: string; color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors',
        active ? 'border-slate-300 bg-white text-slate-700' : 'border-slate-200 bg-slate-50 text-slate-400',
      ].join(' ')}
    >
      <span className={`h-2.5 w-2.5 rounded-full ${active ? color : 'bg-slate-300'}`} />
      {label}
    </button>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </span>
  )
}
