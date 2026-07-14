'use client'

/**
 * FinanceTab — ledger financeiro manual de UM cliente.
 *
 * Componente compartilhado entre:
 *   - a aba "Financeiro" dentro do cadastro do cliente (clients/[clientId])
 *   - a página geral /finance (depois de selecionar o cliente)
 * Mesmo hook, mesmo endpoint — sem duplicar dado, mesmo padrão já usado em
 * Tarefas/Prazos/Oportunidades nesta sessão.
 */

import { useState } from 'react'
import {
  useFinancialEntries,
  useUpdateFinancialEntry,
  type FinancialEntry,
} from '@/lib/hooks/use-finance'
import { Button, EmptyState, ErrorState, LoadingState } from '@/components/ui'
import { borders, surfaces, text } from '@/components/dashboard/surfaces'
import { FinancialEntryModal } from './FinancialEntryModal'

type FinanceTabProps = {
  organizationId: string
  clientId: string
}

const STATUS_BADGES: Record<string, string> = {
  pending: 'text-amber-700 bg-amber-50 border-amber-200',
  paid: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  cancelled: 'text-slate-500 bg-slate-100 border-slate-200',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  paid: 'Pago',
  cancelled: 'Cancelado',
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: 'PIX',
  dinheiro: 'Dinheiro',
  transferencia: 'Transferência',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
  boleto: 'Boleto',
  cheque: 'Cheque',
  outro: 'Outro',
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(`${iso}T00:00:00`)
  )
}

export function FinanceTab({ organizationId, clientId }: FinanceTabProps) {
  const [modalEntry, setModalEntry] = useState<FinancialEntry | undefined | 'new'>(undefined)

  const query = useFinancialEntries(organizationId, clientId)
  const updateMutation = useUpdateFinancialEntry(organizationId, clientId)

  const items = query.data?.data ?? []
  const summary = query.data?.summary

  function markPaid(entry: FinancialEntry) {
    updateMutation.mutate({ id: entry.id, status: 'paid' })
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <p className={`text-[13px] ${text.muted}`}>
          Lançamentos manuais de honorários, pagamentos e despesas deste cliente.
        </p>
        <Button variant="primary" onClick={() => setModalEntry('new')}>
          <span className="text-[15px] leading-none">+</span> Novo lançamento
        </Button>
      </div>

      {query.isLoading ? (
        <LoadingState label="Carregando financeiro…" />
      ) : query.isError ? (
        <ErrorState
          message={query.error?.message ?? 'Erro ao carregar financeiro.'}
          onRetry={() => { void query.refetch() }}
        />
      ) : (
        <>
          {summary !== undefined && (
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryCard label="A receber" value={summary.receivablePending} tone="amber" />
              <SummaryCard label="Recebido" value={summary.receivablePaid} tone="emerald" />
              <SummaryCard label="Atrasado" value={summary.receivableOverdue} tone="red" />
              <SummaryCard
                label="Despesas (pend./pagas)"
                value={summary.expensePending + summary.expensePaid}
                tone="slate"
              />
            </div>
          )}

          {items.length === 0 ? (
            <EmptyState
              title="Nenhum lançamento"
              description="Registre o primeiro honorário, parcela ou despesa deste cliente."
            />
          ) : (
            <ul className="space-y-2">
              {items.map((entry) => (
                <li
                  key={entry.id}
                  className={[
                    'rounded-xl border p-4',
                    entry.isOverdue ? 'border-red-200 bg-red-50' : `${borders.subtle} ${surfaces.panelInset}`,
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGES[entry.status] ?? ''}`}
                        >
                          {entry.isOverdue ? 'Atrasado' : STATUS_LABELS[entry.status] ?? entry.status}
                        </span>
                        <span className={`text-[11px] ${text.faint}`}>{entry.category}</span>
                      </div>
                      <p className={`text-[13px] font-medium ${text.secondary}`}>{entry.description}</p>
                      <p className={`mt-0.5 text-[11px] ${text.faint}`}>
                        {[
                          entry.dueDate !== null ? `Vence ${formatDate(entry.dueDate)}` : null,
                          entry.paidAt !== null
                            ? `Pago em ${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(entry.paidAt))}`
                            : null,
                          entry.paymentMethod !== null ? PAYMENT_METHOD_LABELS[entry.paymentMethod] ?? entry.paymentMethod : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {entry.notes !== null && entry.notes.trim() !== '' && (
                        <p className={`mt-2 text-[12px] ${text.muted} whitespace-pre-wrap`}>
                          {entry.notes}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={`text-[15px] font-semibold tabular-nums ${entry.direction === 'expense' ? 'text-red-600' : 'text-emerald-700'}`}
                      >
                        {entry.direction === 'expense' ? '− ' : ''}
                        {formatCurrency(Number(entry.amount))}
                      </p>
                      <div className="mt-2 flex justify-end gap-2">
                        {entry.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => markPaid(entry)}
                            disabled={updateMutation.isPending}
                            className="text-[11px] font-medium text-emerald-700 hover:underline"
                          >
                            Marcar como pago
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setModalEntry(entry)}
                          className={`text-[11px] font-medium ${text.muted} hover:underline`}
                        >
                          Editar
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <FinancialEntryModal
        open={modalEntry !== undefined}
        onClose={() => setModalEntry(undefined)}
        organizationId={organizationId}
        clientId={clientId}
        entry={modalEntry === 'new' || modalEntry === undefined ? undefined : modalEntry}
      />
    </div>
  )
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'amber' | 'emerald' | 'red' | 'slate'
}) {
  const toneClass = {
    amber: 'text-amber-700',
    emerald: 'text-emerald-700',
    red: 'text-red-600',
    slate: text.secondary,
  }[tone]

  return (
    <div className={`rounded-xl border p-3.5 ${borders.subtle} ${surfaces.panelInset}`}>
      <p className={`text-[11px] font-medium uppercase tracking-[0.08em] ${text.faint} mb-1`}>{label}</p>
      <p className={`text-[16px] font-semibold tabular-nums ${toneClass}`}>{formatCurrency(value)}</p>
    </div>
  )
}
