'use client'

import { borders, text } from '@/components/dashboard/surfaces'

export type CaseTabId =
  | 'trabalho'
  | 'timeline'
  | 'documentos'
  | 'oportunidades'
  | 'prazos'
  | 'motor'
  | 'calculos'

export const CASE_TABS: { id: CaseTabId; label: string }[] = [
  { id: 'trabalho', label: 'Resumo' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'documentos', label: 'Documentos' },
  { id: 'oportunidades', label: 'Oportunidades' },
  { id: 'prazos', label: 'Prazos' },
  { id: 'motor', label: 'Motor' },
  { id: 'calculos', label: 'Cálculos' },
]

type CaseTabBarProps = {
  activeTab: CaseTabId
  onTabChange: (tab: CaseTabId) => void
}

export function CaseTabBar({ activeTab, onTabChange }: CaseTabBarProps) {
  return (
    <div
      className={`flex border-b ${borders.subtle} mb-6 overflow-x-auto`}
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
              'relative shrink-0 px-4 py-2.5 text-[12px] font-medium transition-colors',
              isActive
                ? `${text.primary}`
                : `${text.faint} hover:text-zinc-400`,
            ].join(' ')}
          >
            {tab.label}
            {/* Underline indicator */}
            {isActive && (
              <span
                className="absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full bg-zinc-200"
                aria-hidden
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
