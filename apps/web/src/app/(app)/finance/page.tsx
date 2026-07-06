'use client'

/**
 * Finance placeholder — module not yet implemented.
 *
 * Route: /finance
 * Status: Planned (Phase 9+)
 */

import { DashboardPageHeader } from '@/components/dashboard'
import { EmptyState } from '@/components/ui'

export default function FinancePage() {
  return (
    <div>
      <DashboardPageHeader
        eyebrow="Sistema"
        title="Financeiro"
        description="Módulo de controle financeiro, honorários e cobranças."
      />

      <div className="mt-8">
        <EmptyState
          title="Módulo em desenvolvimento"
          description="O módulo financeiro estará disponível em uma versão futura do ExecFlow. Aqui você poderá gerenciar honorários, controlar cobranças e vincular receitas às oportunidades realizadas."
        />
      </div>
    </div>
  )
}
