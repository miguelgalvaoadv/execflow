'use client'

import React from 'react'
import {
  useCrawlerSyncStatus,
  useTriggerCrawlerSync,
} from '@/lib/hooks/use-case-crawlers'
import { Button } from '@/components/ui/Button'
import { RefreshCw, CheckCircle2, AlertCircle, Clock } from 'lucide-react'

type CrawlerSyncButtonProps = {
  organizationId: string
  caseId: string
}

export function CrawlerSyncButton({ organizationId, caseId }: CrawlerSyncButtonProps) {
  const { data: statusData, isLoading: isLoadingStatus } = useCrawlerSyncStatus(organizationId, caseId)
  const syncMutation = useTriggerCrawlerSync(organizationId, caseId)

  const log = statusData?.data

  const handleSync = () => {
    syncMutation.mutate()
  }

  const isRunning = log?.status === 'running' || log?.status === 'pending' || syncMutation.isPending

  if (isLoadingStatus) {
    return (
      <Button variant="secondary" size="sm" disabled>
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
        Carregando...
      </Button>
    )
  }

  if (isRunning) {
    return (
      <Button variant="secondary" size="sm" disabled className="border-blue-500/50 bg-blue-500/10 text-blue-700">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
        Robô Sincronizando...
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-3">
      {log?.status === 'success' && (
        <span className="flex items-center text-xs text-emerald-700 gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Sincronizado {new Date(log.completedAt!).toLocaleDateString('pt-BR')}
        </span>
      )}
      {log?.status === 'failed' && (
        <span className="flex items-center text-xs text-red-700 gap-1.5" title={log.errorDetails ?? 'Erro interno'}>
          <AlertCircle className="h-3.5 w-3.5" />
          Falha na última busca
        </span>
      )}

      <Button
        variant="secondary"
        size="sm"
        onClick={handleSync}
        className="hover:border-blue-500 hover:text-blue-700 transition-colors"
      >
        <RefreshCw className="mr-2 h-4 w-4" />
        Sincronizar Tribunal
      </Button>
    </div>
  )
}
