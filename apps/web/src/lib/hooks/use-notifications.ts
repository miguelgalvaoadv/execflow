'use client'

/**
 * Notificações do sininho (pedido do Miguel 13/07/2026): o que precisa de
 * atenção AGORA — itens da agenda de hoje (eventos/prazos/oportunidades) +
 * prazos atrasados (mesmo que a data já tenha passado há dias). Sem tabela
 * própria — recalculado ao vivo a partir do calendário e dos prazos, mesma
 * filosofia de "nada duplicado" do resto da agenda.
 */

import { useMemo } from 'react'
import { useSession } from './use-session'
import { useCalendar } from './use-calendar'
import { useDeadlines } from './use-deadlines'

export type NotificationItem = {
  key: string
  title: string
  clientName: string | null
  overdue: boolean
  href: string | null
  sortKey: string
}

function todayRangeIso(): { from: string; to: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  return { from: start.toISOString(), to: end.toISOString() }
}

export function useNotifications() {
  const { data: session } = useSession()
  const orgId = session?.organization.id ?? ''
  const enabled = session != null
  const { from, to } = useMemo(() => todayRangeIso(), [])

  const calendarQuery = useCalendar(orgId, from, to, ['manual', 'deadlines', 'opportunities'], enabled)
  const overdueQuery = useDeadlines({
    organizationId: orgId,
    filters: { status: 'overdue' },
    limit: 30,
    enabled,
  })

  const items = useMemo<NotificationItem[]>(() => {
    const map = new Map<string, NotificationItem>()

    for (const it of calendarQuery.data?.data ?? []) {
      const overdue = it.kind === 'deadline' && it.deadlineStatus === 'overdue'
      const href =
        it.kind === 'deadline'
          ? it.executionCaseId ? `/cases/${it.executionCaseId}?tab=prazos` : `/deadlines/${it.id}`
          : it.kind === 'opportunity'
            ? it.executionCaseId ? `/cases/${it.executionCaseId}?tab=oportunidades` : null
            : it.executionCaseId
              ? `/cases/${it.executionCaseId}`
              : '/calendar'
      map.set(`${it.kind}-${it.id}`, {
        key: `${it.kind}-${it.id}`,
        title: it.title,
        clientName: it.clientName,
        overdue,
        href,
        sortKey: it.startsAt,
      })
    }

    for (const page of overdueQuery.data?.pages ?? []) {
      for (const dl of page.data) {
        const key = `deadline-${dl.id}`
        map.set(key, {
          key,
          title: dl.title,
          clientName: dl.clientName,
          overdue: true,
          href: dl.executionCaseId ? `/cases/${dl.executionCaseId}?tab=prazos` : `/deadlines/${dl.id}`,
          sortKey: dl.dueAt,
        })
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
      return a.sortKey.localeCompare(b.sortKey)
    })
  }, [calendarQuery.data, overdueQuery.data])

  return {
    items,
    isLoading: calendarQuery.isLoading || overdueQuery.isLoading,
  }
}
