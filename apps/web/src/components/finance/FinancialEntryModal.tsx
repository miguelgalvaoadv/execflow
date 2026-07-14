'use client'

/**
 * FinancialEntryModal — criar ou editar um lançamento financeiro do cliente.
 *
 * Sempre tem: valor, categoria, vencimento, status, forma de pagamento e um
 * campo de observação livre (requisito explícito do módulo Financeiro).
 * Mesmo modal serve para criação (entry=undefined) e edição (entry preenchido)
 * — "sempre a opção de editar" fica garantida reabrindo este componente.
 */

import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui'
import { borders, surfaces, text } from '@/components/dashboard/surfaces'
import {
  useCreateFinancialEntry,
  useUpdateFinancialEntry,
  type FinancialEntry,
  type FinancialEntryDirection,
  type FinancialEntryStatus,
} from '@/lib/hooks/use-finance'

type FinancialEntryModalProps = {
  open: boolean
  onClose: () => void
  organizationId: string
  clientId: string
  entry?: FinancialEntry
}

const CATEGORY_SUGGESTIONS: Record<FinancialEntryDirection, string[]> = {
  receivable: [
    'Honorário contratado',
    'Parcela de honorário',
    'Pagamento avulso',
    'Honorário de êxito',
    'Consulta',
  ],
  expense: [
    'Custas processuais',
    'Diligência',
    'Cópias e certidões',
    'Deslocamento',
    'Postagem/Correios',
  ],
}

const PAYMENT_METHODS = [
  { value: '', label: 'Não informado' },
  { value: 'pix', label: 'PIX' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'cartao_credito', label: 'Cartão de crédito' },
  { value: 'cartao_debito', label: 'Cartão de débito' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'outro', label: 'Outro' },
]

const inputClassName = [
  'w-full rounded-lg border px-3 py-2.5 text-[13px] outline-none transition-colors',
  `${borders.default} bg-white shadow-sm ${text.primary}`,
  'placeholder:text-slate-700',
  'focus:border-blue-600 focus:ring-1 focus:ring-blue-600',
].join(' ')

const labelClassName = `mb-1.5 block text-[11px] font-medium uppercase tracking-[0.1em] ${text.muted}`

export function FinancialEntryModal({
  open,
  onClose,
  organizationId,
  clientId,
  entry,
}: FinancialEntryModalProps) {
  const isEdit = entry !== undefined

  const [direction, setDirection] = useState<FinancialEntryDirection>('receivable')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [status, setStatus] = useState<FinancialEntryStatus>('pending')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!open) return
    setDirection(entry?.direction ?? 'receivable')
    setCategory(entry?.category ?? '')
    setDescription(entry?.description ?? '')
    setAmount(entry?.amount ?? '')
    setDueDate(entry?.dueDate ?? '')
    setPaymentMethod(entry?.paymentMethod ?? '')
    setStatus(entry?.status ?? 'pending')
    setNotes(entry?.notes ?? '')
  }, [open, entry])

  const createMutation = useCreateFinancialEntry(organizationId, clientId)
  const updateMutation = useUpdateFinancialEntry(organizationId, clientId)
  const mutation = isEdit ? updateMutation : createMutation

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const parsedAmount = Number(amount.replace(',', '.'))
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return

    if (isEdit && entry) {
      updateMutation.mutate(
        {
          id: entry.id,
          direction,
          category: category.trim(),
          description: description.trim(),
          amount: parsedAmount,
          dueDate: dueDate === '' ? null : dueDate,
          paymentMethod: paymentMethod === '' ? null : paymentMethod,
          status,
          notes: notes.trim() === '' ? null : notes.trim(),
        },
        { onSuccess: onClose }
      )
    } else {
      createMutation.mutate(
        {
          clientId,
          direction,
          category: category.trim(),
          description: description.trim(),
          amount: parsedAmount,
          ...(dueDate !== '' ? { dueDate } : {}),
          ...(paymentMethod !== '' ? { paymentMethod } : {}),
          status,
          ...(notes.trim() !== '' ? { notes: notes.trim() } : {}),
        },
        { onSuccess: onClose }
      )
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-100 backdrop-blur-sm" onClick={onClose} />

      <div
        className={[
          'relative z-10 max-h-[90vh] w-full max-w-[560px] overflow-y-auto rounded-2xl border p-8',
          surfaces.panelRaised,
        ].join(' ')}
      >
        <h2 className={`text-[20px] font-semibold tracking-[-0.01em] mb-1 ${text.primary}`}>
          {isEdit ? 'Editar lançamento' : 'Novo lançamento financeiro'}
        </h2>
        <p className={`text-[13px] mb-6 ${text.muted}`}>
          {isEdit ? 'Atualize os dados deste lançamento.' : 'Registre um honorário, parcela, pagamento ou despesa do cliente.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Direção */}
          <div>
            <label className={labelClassName}>Tipo *</label>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de lançamento">
              <button
                type="button"
                onClick={() => setDirection('receivable')}
                className={[
                  'rounded-lg border px-3 py-2.5 text-[13px] font-medium transition-colors',
                  direction === 'receivable'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : `${borders.default} bg-white ${text.secondary} hover:bg-slate-50`,
                ].join(' ')}
              >
                A receber (honorário/pagamento)
              </button>
              <button
                type="button"
                onClick={() => setDirection('expense')}
                className={[
                  'rounded-lg border px-3 py-2.5 text-[13px] font-medium transition-colors',
                  direction === 'expense'
                    ? 'border-red-500 bg-red-50 text-red-700'
                    : `${borders.default} bg-white ${text.secondary} hover:bg-slate-50`,
                ].join(' ')}
              >
                Despesa do processo
              </button>
            </div>
          </div>

          {/* Categoria */}
          <div>
            <label htmlFor="fin-category" className={labelClassName}>
              Categoria *
            </label>
            <input
              id="fin-category"
              type="text"
              required
              list="fin-category-suggestions"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputClassName}
              placeholder="Ex: Honorário contratado"
              disabled={mutation.isPending}
            />
            <datalist id="fin-category-suggestions">
              {CATEGORY_SUGGESTIONS[direction].map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          {/* Descrição */}
          <div>
            <label htmlFor="fin-description" className={labelClassName}>
              Descrição *
            </label>
            <input
              id="fin-description"
              type="text"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClassName}
              placeholder="Ex: 1ª parcela do contrato de honorários"
              disabled={mutation.isPending}
            />
          </div>

          {/* Valor + Vencimento */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="fin-amount" className={labelClassName}>
                Valor (R$) *
              </label>
              <input
                id="fin-amount"
                type="text"
                inputMode="decimal"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={inputClassName}
                placeholder="0,00"
                disabled={mutation.isPending}
              />
            </div>
            <div>
              <label htmlFor="fin-due" className={labelClassName}>
                Vencimento
              </label>
              <input
                id="fin-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={inputClassName}
                disabled={mutation.isPending}
              />
            </div>
          </div>

          {/* Status + Forma de pagamento */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="fin-status" className={labelClassName}>
                Status
              </label>
              <select
                id="fin-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as FinancialEntryStatus)}
                className={inputClassName}
                disabled={mutation.isPending}
              >
                <option value="pending">Pendente</option>
                <option value="paid">Pago/Recebido</option>
                <option value="cancelled">Cancelado</option>
              </select>
            </div>
            <div>
              <label htmlFor="fin-method" className={labelClassName}>
                Forma de pagamento
              </label>
              <select
                id="fin-method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className={inputClassName}
                disabled={mutation.isPending}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Observação — sempre presente */}
          <div>
            <label htmlFor="fin-notes" className={labelClassName}>
              Observação
            </label>
            <textarea
              id="fin-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={`${inputClassName} resize-none`}
              rows={3}
              placeholder="Ex: combinado por WhatsApp em 10/07, aguardando repasse…"
              disabled={mutation.isPending}
            />
          </div>

          {mutation.isError && (
            <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-[13px] text-red-700">
              {mutation.error?.message ?? 'Erro ao salvar lançamento.'}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={mutation.isPending}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={
                mutation.isPending ||
                category.trim() === '' ||
                description.trim() === '' ||
                amount.trim() === ''
              }
            >
              {mutation.isPending ? 'Salvando…' : isEdit ? 'Salvar alterações' : 'Criar lançamento'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
