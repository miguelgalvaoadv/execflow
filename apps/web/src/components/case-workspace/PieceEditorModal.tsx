'use client'

import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { usePieceDraft, useUpdatePieceDraft } from '@/lib/hooks/use-case-opportunities'
import { Loader2, Download, Save, CheckCircle2, Sparkles, FileText, X, Edit3 } from 'lucide-react'

export function PieceEditorModal({
  isOpen,
  onClose,
  organizationId,
  draftId,
}: {
  isOpen: boolean
  onClose: () => void
  organizationId: string
  draftId: string | null
}) {
  const { data: draft, isLoading, isError } = usePieceDraft(organizationId, draftId, isOpen)
  const updateDraft = useUpdatePieceDraft(organizationId)

  const [content, setContent] = useState('')
  const [isPreview, setIsPreview] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  useEffect(() => {
    if (draft?.contentMarkdown) {
      setContent(draft.contentMarkdown)
    }
  }, [draft])

  const isGenerating = draft?.status === 'generating'

  const handleSave = () => {
    if (!draftId) return
    updateDraft.mutate({ draftId, contentMarkdown: content, finalize: false })
  }

  const handleFinalize = () => {
    if (!draftId) return
    updateDraft.mutate(
      { draftId, contentMarkdown: content, finalize: true },
      {
        onSuccess: () => {
          onClose()
        },
      }
    )
  }

  const handleExportDocx = async () => {
    if (!draftId) return
    setIsExporting(true)
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
      const response = await fetch(`${apiUrl}/api/v1/piece-drafts/${draftId}/export-docx`, {
        credentials: 'include',
      })
      if (!response.ok) throw new Error('Falha ao exportar')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `peca_${draftId.substring(0, 8)}_${new Date().toISOString().split('T')[0]}.docx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      console.error('Erro ao exportar DOCX:', err)
    } finally {
      setIsExporting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-5xl h-[90vh] flex flex-col bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="border-b bg-gradient-to-r from-indigo-50 to-purple-50 px-6 py-4 flex flex-row items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2 text-gray-900">
              <Sparkles className="h-5 w-5 text-indigo-500" />
              Editor de Peça Processual
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Revise e edite a petição gerada pelo Claude. Exporte como Word ou finalize para protocolo.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {draft?.status === 'finalized' && (
              <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" />
                Finalizada
              </span>
            )}
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        {!isLoading && !isGenerating && !isError && (
          <div className="border-b px-6 py-2 flex items-center gap-2 bg-gray-50">
            <button
              onClick={() => setIsPreview(false)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-1.5 ${
                !isPreview
                  ? 'bg-white shadow-sm border border-gray-200 text-gray-900 font-medium'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              <Edit3 className="h-3.5 w-3.5" />
              Editar
            </button>
            <button
              onClick={() => setIsPreview(true)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-1.5 ${
                isPreview
                  ? 'bg-white shadow-sm border border-gray-200 text-gray-900 font-medium'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              Visualizar
            </button>
            <div className="flex-1" />
            <span className="text-xs text-gray-400">
              {content.length > 0 ? `${content.split('\n').length} linhas · ${content.length} caracteres` : ''}
            </span>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {isLoading || isGenerating ? (
            <div className="flex-1 flex flex-col items-center justify-center space-y-4">
              <div className="relative">
                <Loader2 className="h-12 w-12 animate-spin text-indigo-500" />
                <Sparkles className="h-4 w-4 text-purple-400 absolute top-0 right-0 animate-pulse" />
              </div>
              <p className="text-gray-600 font-medium">O Claude está redigindo a sua petição...</p>
              <p className="text-xs text-gray-400">
                Isso pode levar de 10 a 20 segundos dependendo do tamanho da fundamentação.
              </p>
            </div>
          ) : isError ? (
            <div className="flex-1 flex items-center justify-center text-red-500">
              <div className="text-center">
                <p className="font-medium">Erro ao carregar rascunho da peça.</p>
                <p className="text-sm text-gray-400 mt-1">Verifique a conexão e tente novamente.</p>
              </div>
            </div>
          ) : isPreview ? (
            <div className="flex-1 overflow-auto p-8 bg-white">
              <div
                className="prose prose-lg max-w-none font-serif"
                style={{ fontFamily: "'Times New Roman', serif" }}
              >
                {content.split('\n').map((line, i) => {
                  if (line.startsWith('# '))
                    return (
                      <h1 key={i} className="text-center font-bold text-2xl mt-8 mb-4">
                        {line.replace('# ', '')}
                      </h1>
                    )
                  if (line.startsWith('## '))
                    return (
                      <h2 key={i} className="font-bold text-lg mt-6 mb-3 uppercase tracking-wider">
                        {line.replace('## ', '')}
                      </h2>
                    )
                  if (line.startsWith('### '))
                    return (
                      <h3 key={i} className="font-bold text-base mt-4 mb-2">
                        {line.replace('### ', '')}
                      </h3>
                    )
                  if (line.startsWith('- '))
                    return (
                      <li key={i} className="ml-6 text-base leading-relaxed">
                        {line.replace('- ', '')}
                      </li>
                    )
                  if (line.trim() === '') return <br key={i} />
                  return (
                    <p key={i} className="text-base leading-relaxed text-justify indent-8">
                      {line}
                    </p>
                  )
                })}
              </div>
            </div>
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="flex-1 w-full h-full font-mono text-sm leading-relaxed p-6 bg-gray-50 border-0 focus:outline-none focus:ring-0 resize-none"
              placeholder="A peça gerada aparecerá aqui..."
            />
          )}
        </div>

        {/* Footer */}
        <div className="border-t bg-gray-50 px-6 py-4 flex sm:justify-between items-center">
          <div className="text-xs text-gray-400 flex items-center gap-2">
            {updateDraft.isPending && (
              <span className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Salvando...
              </span>
            )}
            {updateDraft.isSuccess && !updateDraft.isPending && (
              <span className="text-green-500 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Salvo com sucesso.
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={handleExportDocx}
              disabled={isLoading || isGenerating || isExporting || !content}
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Baixar Word
            </Button>
            <Button
              variant="secondary"
              onClick={handleSave}
              disabled={
                isLoading || isGenerating || updateDraft.isPending || draft?.status === 'finalized'
              }
            >
              <Save className="h-4 w-4 mr-2" />
              Salvar Rascunho
            </Button>
            <Button
              onClick={handleFinalize}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              disabled={
                isLoading || isGenerating || updateDraft.isPending || draft?.status === 'finalized'
              }
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Finalizar Peça
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
