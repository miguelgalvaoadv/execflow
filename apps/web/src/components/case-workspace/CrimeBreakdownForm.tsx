'use client'

import { useState } from 'react'

export type CrimeBreakdownItem = {
  id: string // apenas para controle de estado no frontend
  crimeCode: string
  crimeName: string
  article: string
  law: string
  sentenceDays: number
  isHediondo: boolean
  isEquiparado: boolean
  hasResultingDeath: boolean
  isAttempted: boolean
  sentenceDate: string
  transitDate: string
}

type Props = {
  crimes: CrimeBreakdownItem[]
  onChange: (crimes: CrimeBreakdownItem[]) => void
}

export function CrimeBreakdownForm({ crimes, onChange }: Props) {
  const [isAdding, setIsAdding] = useState(false)
  const [newItem, setNewItem] = useState<Partial<CrimeBreakdownItem>>({
    isHediondo: false,
    isEquiparado: false,
    hasResultingDeath: false,
    isAttempted: false,
  })

  const handleAddClick = () => {
    setIsAdding(true)
  }

  const handleCancelClick = () => {
    setIsAdding(false)
    setNewItem({
      isHediondo: false,
      isEquiparado: false,
      hasResultingDeath: false,
      isAttempted: false,
    })
  }

  const handleSaveItem = () => {
    if (
      !newItem.crimeCode ||
      !newItem.crimeName ||
      !newItem.article ||
      !newItem.law ||
      !newItem.sentenceDays ||
      !newItem.sentenceDate ||
      !newItem.transitDate
    ) {
      alert('Por favor, preencha todos os campos obrigatórios do crime.')
      return
    }

    const itemToAdd: CrimeBreakdownItem = {
      id: Math.random().toString(36).substring(7),
      crimeCode: newItem.crimeCode,
      crimeName: newItem.crimeName,
      article: newItem.article,
      law: newItem.law,
      sentenceDays: Number(newItem.sentenceDays),
      isHediondo: Boolean(newItem.isHediondo),
      isEquiparado: Boolean(newItem.isEquiparado),
      hasResultingDeath: Boolean(newItem.hasResultingDeath),
      isAttempted: Boolean(newItem.isAttempted),
      sentenceDate: newItem.sentenceDate,
      transitDate: newItem.transitDate,
    }

    onChange([...crimes, itemToAdd])
    handleCancelClick()
  }

  const handleRemoveItem = (id: string) => {
    onChange(crimes.filter((c) => c.id !== id))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-[12px] font-bold uppercase tracking-wider text-slate-600">
          Composição da Pena (Crimes)
        </h4>
        {!isAdding && (
          <button
            type="button"
            onClick={handleAddClick}
            className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-900 font-medium py-1 px-2.5 rounded border border-slate-300 transition-colors"
          >
            + Adicionar Crime
          </button>
        )}
      </div>

      {crimes.length > 0 && (
        <ul className="space-y-2">
          {crimes.map((c) => (
            <li
              key={c.id}
              className="flex flex-col bg-slate-50 border border-slate-200 p-2.5 rounded text-[11px]"
            >
              <div className="flex justify-between items-start">
                <div>
                  <span className="font-semibold text-slate-900">
                    {c.crimeName} ({c.crimeCode})
                  </span>
                  <p className="text-slate-600">
                    Art. {c.article} da Lei {c.law}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveItem(c.id)}
                  className="text-red-700 hover:text-red-700 font-medium"
                >
                  Remover
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-200/60">
                <div className="text-slate-700">
                  <span className="text-slate-500">Pena:</span> {c.sentenceDays} dias
                </div>
                <div className="flex gap-2">
                  {c.isHediondo && (
                    <span className="text-[9px] bg-red-50 border border-red-200 text-red-700 px-1 rounded uppercase">
                      Hediondo
                    </span>
                  )}
                  {c.isEquiparado && (
                    <span className="text-[9px] bg-orange-50 border border-orange-200 text-orange-700 px-1 rounded uppercase">
                      Equiparado
                    </span>
                  )}
                  {c.hasResultingDeath && (
                    <span className="text-[9px] bg-purple-50 border border-purple-200 text-purple-700 px-1 rounded uppercase">
                      Morte
                    </span>
                  )}
                </div>
                <div className="text-slate-600">
                  <span className="text-slate-500">Sentença:</span> {new Date(c.sentenceDate).toLocaleDateString('pt-BR')}
                </div>
                <div className="text-slate-600">
                  <span className="text-slate-500">Trânsito:</span> {new Date(c.transitDate).toLocaleDateString('pt-BR')}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {isAdding && (
        <div className="bg-white border border-slate-300/50 p-3 rounded space-y-3">
          <h5 className="text-[11px] font-semibold text-slate-900">Novo Crime</h5>
          
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-slate-600 mb-1">Código Único *</label>
              <input
                type="text"
                placeholder="Ex: ROUBO_MAJORADO"
                value={newItem.crimeCode || ''}
                onChange={(e) => setNewItem({ ...newItem, crimeCode: e.target.value.toUpperCase() })}
                className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-[11px] text-slate-900 focus:outline-none focus:border-blue-600 uppercase"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-600 mb-1">Nome do Crime *</label>
              <input
                type="text"
                placeholder="Ex: Roubo Majorado"
                value={newItem.crimeName || ''}
                onChange={(e) => setNewItem({ ...newItem, crimeName: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-[11px] text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-600 mb-1">Artigo *</label>
              <input
                type="text"
                placeholder="Ex: 157, § 2º"
                value={newItem.article || ''}
                onChange={(e) => setNewItem({ ...newItem, article: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-[11px] text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-600 mb-1">Lei *</label>
              <input
                type="text"
                placeholder="Ex: CP"
                value={newItem.law || ''}
                onChange={(e) => setNewItem({ ...newItem, law: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-[11px] text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-600 mb-1">Pena (dias) *</label>
              <input
                type="number"
                min={1}
                placeholder="Ex: 1950"
                value={newItem.sentenceDays || ''}
                onChange={(e) => setNewItem({ ...newItem, sentenceDays: Number(e.target.value) })}
                className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-[11px] text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-600 mb-1">Data da Sentença *</label>
              <input
                type="date"
                value={newItem.sentenceDate || ''}
                onChange={(e) => setNewItem({ ...newItem, sentenceDate: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-[11px] text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-600 mb-1">Data do Trânsito *</label>
              <input
                type="date"
                value={newItem.transitDate || ''}
                onChange={(e) => setNewItem({ ...newItem, transitDate: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1.5 text-[11px] text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-4 pt-2">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-700">
              <input
                type="checkbox"
                checked={newItem.isHediondo}
                onChange={(e) => setNewItem({ ...newItem, isHediondo: e.target.checked })}
                className="accent-blue-600"
              />
              Hediondo
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-700">
              <input
                type="checkbox"
                checked={newItem.isEquiparado}
                onChange={(e) => setNewItem({ ...newItem, isEquiparado: e.target.checked })}
                className="accent-blue-600"
              />
              Equiparado
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-700">
              <input
                type="checkbox"
                checked={newItem.hasResultingDeath}
                onChange={(e) => setNewItem({ ...newItem, hasResultingDeath: e.target.checked })}
                className="accent-blue-600"
              />
              Morte (Resultado)
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-700">
              <input
                type="checkbox"
                checked={newItem.isAttempted}
                onChange={(e) => setNewItem({ ...newItem, isAttempted: e.target.checked })}
                className="accent-blue-600"
              />
              Tentado
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={handleCancelClick}
              className="text-[10px] text-slate-600 hover:text-slate-900 px-2 py-1 rounded"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSaveItem}
              className="text-[10px] bg-blue-600 hover:bg-blue-600 text-white font-medium px-3.5 py-1.5 rounded transition-colors"
            >
              Adicionar à Lista
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
