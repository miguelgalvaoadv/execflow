'use client'

import { borders, text } from '@/components/dashboard/surfaces'

export type CaseTabId =
  | 'timeline'
  | 'documentos'
  | 'oportunidades'
  | 'prazos'
  | 'calculos'
  | 'partes'
  | 'observacoes'

export const CASE_TABS: { id: CaseTabId; label: string }[] = [
  { id: 'timeline', label: 'Movimentações' },
  { id: 'documentos', label: 'Documentos' },
  { id: 'oportunidades', label: 'Oportunidades' },
  { id: 'prazos', label: 'Prazos' },
  { id: 'calculos', label: 'Cálculos' },
  { id: 'partes', label: 'Partes & Busca' },
  { id: 'observacoes', label: 'Observações' },
]

type CaseTabBarProps = {
  activeTab: CaseTabId
  onTabChange: (tab: CaseTabId) => void
}

export function CaseTabBar({ activeTab, onTabChange }: CaseTabBarProps) {
  return (
    <div
      className={`flex gap-6 sm:gap-8 border-b ${borders.default} mb-8 overflow-x-auto scrollbar-hide px-2`}
      role="tablist"
      aria-label="Secções do caso"
    >
      {CASE_TABS.map((tab) => {
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.id)}
            className={[
              'relative shrink-0 pb-4 pt-2 text-[14px] font-medium transition-colors',
              isActive
                ? `${text.primary}`
                : `${text.muted} hover:text-slate-700`,
            ].join(' ')}
          >
            {tab.label}
            {/* Underline indicator */}
            {isActive && (
              <span
                className="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full bg-blue-600 shadow-[0_-2px_10px_rgba(99,102,241,0.5)]"
                aria-hidden
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
