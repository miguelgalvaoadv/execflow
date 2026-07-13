'use client'

import React, { useState } from 'react'
import { useAnalysisPackage, useImportAnalysis } from '@/lib/hooks/use-case-crawlers'
import { Button } from '@/components/ui/Button'
import { ClipboardCopy, Download, Check, Loader2, X } from 'lucide-react'

type Props = {
  organizationId: string
  caseId: string
}

/**
 * Modo híbrido ChatGPT (Direção 2): dois botões que deixam o advogado usar a
 * assinatura fixa do ChatGPT dele pra analisar os autos, em vez de gastar a API
 * do Claude. "Preparar" gera o texto pra colar no chatgpt.com (com o PDF);
 * "Importar" recebe a resposta e a joga na fila de revisão normal.
 */
export function ChatGptHybridButtons({ organizationId, caseId }: Props) {
  const [prepOpen, setPrepOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setPrepOpen(true)}
        title="Gera o texto pra você colar no ChatGPT (com o PDF dos autos) e analisar sem gastar a API"
      >
        <ClipboardCopy className="mr-2 h-4 w-4" />
        Preparar p/ ChatGPT
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setImportOpen(true)}
        title="Cole aqui o relatório que o ChatGPT devolveu para importar como oportunidades/prazos/cálculo"
      >
        <Download className="mr-2 h-4 w-4" />
        Importar do ChatGPT
      </Button>

      {prepOpen && (
        <PreparePackageModal
          organizationId={organizationId}
          caseId={caseId}
          onClose={() => setPrepOpen(false)}
        />
      )}
      {importOpen && (
        <ImportReportModal
          organizationId={organizationId}
          caseId={caseId}
          onClose={() => setImportOpen(false)}
        />
      )}
    </>
  )
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function PreparePackageModal({ organizationId, caseId, onClose }: Props & { onClose: () => void }) {
  const pkg = useAnalysisPackage(organizationId, caseId)
  const [copied, setCopied] = useState(false)

  // Busca o pacote assim que o modal abre.
  React.useEffect(() => {
    pkg.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const promptText = pkg.data?.data.prompt ?? ''

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(promptText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      /* clipboard pode falhar em contexto inseguro — o texto fica selecionável no textarea */
    }
  }

  return (
    <ModalShell title="Preparar pacote pro ChatGPT" onClose={onClose}>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-[12px] text-slate-600">
        <li>Copie o texto abaixo.</li>
        <li>Abra o chatgpt.com, cole o texto e <strong>anexe o PDF dos autos</strong> na mesma mensagem.</li>
        <li>Copie a resposta do ChatGPT e traga de volta no botão <strong>&quot;Importar do ChatGPT&quot;</strong>.</li>
      </ol>

      {pkg.isPending ? (
        <div className="flex items-center gap-2 py-8 text-[13px] text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Montando o pacote do caso…
        </div>
      ) : pkg.isError ? (
        <p className="py-4 text-[13px] text-red-600">{pkg.error?.message ?? 'Falha ao montar o pacote.'}</p>
      ) : (
        <>
          <textarea
            readOnly
            value={promptText}
            className="h-64 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-800 outline-none"
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="mt-3 flex justify-end">
            <Button variant="primary" size="sm" onClick={handleCopy}>
              {copied ? <Check className="mr-2 h-4 w-4" /> : <ClipboardCopy className="mr-2 h-4 w-4" />}
              {copied ? 'Copiado!' : 'Copiar texto'}
            </Button>
          </div>
        </>
      )}
    </ModalShell>
  )
}

function ImportReportModal({ organizationId, caseId, onClose }: Props & { onClose: () => void }) {
  const importMut = useImportAnalysis(organizationId, caseId)
  const [text, setText] = useState('')

  const handleImport = () => {
    if (!text.trim()) return
    importMut.mutate({ report: text })
  }

  const result = importMut.data?.data.result

  return (
    <ModalShell title="Importar relatório do ChatGPT" onClose={onClose}>
      {result ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800">
            <Check className="h-4 w-4 shrink-0" />
            <span>
              Importado: {result.oportunidadesCriadas} oportunidade(s), {result.prazosCriados} prazo(s)
              {result.alertas?.length ? `, ${result.alertas.length} alerta(s)` : ''}
              {result.fatos?.length ? `, ${result.fatos.length} fato(s)` : ''}
              {result.snapshotId ? ', + cálculo de pena' : ''}. Confira nas abas Oportunidades, Prazos e Cálculos.
            </span>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" size="sm" onClick={onClose}>Fechar</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-2 text-[12px] text-slate-600">
            Cole aqui a resposta que o ChatGPT devolveu (pode colar o texto inteiro — eu acho o bloco JSON
            sozinho). Ele entra na fila de revisão como oportunidades sugeridas, prazos, alertas e cálculo.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='Cole aqui o relatório do ChatGPT (o bloco que começa com { "pena": ... })'
            className="h-56 w-full resize-none rounded-lg border border-slate-200 bg-white p-3 font-mono text-[11px] text-slate-800 outline-none focus:border-blue-500"
          />
          {importMut.isError && (
            <p className="mt-2 text-[12px] text-red-600">{importMut.error?.message ?? 'Falha ao importar.'}</p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
            <Button variant="primary" size="sm" onClick={handleImport} disabled={importMut.isPending || !text.trim()}>
              {importMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              {importMut.isPending ? 'Importando…' : 'Importar'}
            </Button>
          </div>
        </>
      )}
    </ModalShell>
  )
}
