import React, { useState } from 'react'

interface PromptEditorModalProps {
  opportunityId: string
  opportunityType: string
  summary: string
  onClose: () => void
  onConfirm: (instructions: string) => void
  isGenerating: boolean
}

export function PromptEditorModal({
  opportunityId,
  opportunityType,
  summary,
  onClose,
  onConfirm,
  isGenerating
}: PromptEditorModalProps) {
  const [instructions, setInstructions] = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white border border-slate-200 shadow-2xl rounded-xl w-full max-w-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <span>✨</span> Configurar Diretrizes da Peça
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              O Claude fará a leitura de todos os PDFs do caso (Atestado de Pena, Sentenças) para redigir a peça. Adicione instruções específicas se desejar.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 flex flex-col gap-5 overflow-y-auto max-h-[60vh]">
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Contexto Base que será enviado:</h3>
            <ul className="text-sm text-slate-700 space-y-1">
              <li><span className="text-slate-500">Tipo:</span> {opportunityType}</li>
              <li><span className="text-slate-500">Resumo:</span> {summary}</li>
              <li><span className="text-indigo-600">📄 Arquivos Anexos:</span> Todos os PDFs de Alta Relevância da Execução</li>
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-slate-700">
              Instruções Adicionais <span className="text-slate-400 font-normal">(Opcional)</span>
            </label>
            <textarea
              className="w-full h-32 bg-white border border-slate-200 rounded-lg p-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none shadow-sm"
              placeholder="Ex: Foque na tese de nulidade da falta grave do dia 10/05 por ausência de PAD."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              disabled={isGenerating}
            />
            <p className="text-xs text-slate-500">
              Quanto mais específico você for, melhor a IA redigirá a peça.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-800"
            disabled={isGenerating}
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(instructions)}
            disabled={isGenerating}
            className="px-5 py-2 flex items-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg text-sm font-medium transition shadow-[0_0_15px_rgba(124,58,237,0.3)] disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Gerando Peça e Lendo PDFs...
              </>
            ) : (
              '✨ Gerar Peça com Claude'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
