'use client'

/**
 * Aba "Observações" do workspace do caso — bloquinho de lembretes do
 * advogado sobre o processo, separado por nota, editável/excluível só pelo
 * autor. Vinculado à execução (não ao cliente): um cliente pode ter mais de
 * um processo, e a observação é sobre o processo específico.
 */

import { useState } from 'react'
import { useSession } from '@/lib/hooks/use-session'
import {
  useCaseNotes,
  useCreateCaseNote,
  useUpdateCaseNote,
  useDeleteCaseNote,
  type CaseNote,
} from '@/lib/hooks/use-case-notes'
import { Button } from '@/components/ui'
import { borders, text } from '@/components/dashboard/surfaces'

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function CaseNotesSection({ caseId }: { caseId: string }) {
  const { data: session } = useSession()
  const orgId = session?.organization.id ?? ''
  const currentUserId = session?.user.id ?? ''

  const notesQuery = useCaseNotes(orgId, caseId)
  const createMutation = useCreateCaseNote(orgId, caseId)
  const updateMutation = useUpdateCaseNote(orgId, caseId)
  const deleteMutation = useDeleteCaseNote(orgId, caseId)

  const [newBody, setNewBody] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingBody, setEditingBody] = useState('')

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = newBody.trim()
    if (trimmed === '') return
    await createMutation.mutateAsync(trimmed)
    setNewBody('')
  }

  const startEdit = (note: CaseNote) => {
    setEditingId(note.id)
    setEditingBody(note.body)
  }
  const cancelEdit = () => {
    setEditingId(null)
    setEditingBody('')
  }
  const saveEdit = async (noteId: string) => {
    const trimmed = editingBody.trim()
    if (trimmed === '') return
    await updateMutation.mutateAsync({ noteId, body: trimmed })
    setEditingId(null)
  }
  const handleDelete = async (noteId: string) => {
    if (!window.confirm('Excluir esta observação? Essa ação não pode ser desfeita.')) return
    await deleteMutation.mutateAsync(noteId)
  }

  const notes = notesQuery.data?.data ?? []
  const textareaClass = `w-full rounded border ${borders.default} p-2 text-[13px] leading-relaxed focus:outline-none focus:border-blue-600`

  return (
    <div>
      <form onSubmit={(e) => void handleAdd(e)} className="mb-4 space-y-2">
        <textarea
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          placeholder="Escreva uma observação sobre este processo para lembrar depois…"
          rows={3}
          maxLength={5000}
          className={textareaClass}
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={newBody.trim() === '' || createMutation.isPending}
        >
          {createMutation.isPending ? 'Salvando…' : '+ Adicionar observação'}
        </Button>
      </form>

      {notesQuery.isLoading ? (
        <p className={`text-[12px] ${text.faint}`}>Carregando observações…</p>
      ) : notes.length === 0 ? (
        <p className={`text-[12px] ${text.faint}`}>Nenhuma observação ainda.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id} className={`rounded border ${borders.subtle} bg-slate-50 p-2.5`}>
              {editingId === note.id ? (
                <div className="space-y-2">
                  <textarea
                    value={editingBody}
                    onChange={(e) => setEditingBody(e.target.value)}
                    rows={3}
                    maxLength={5000}
                    className={textareaClass}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => void saveEdit(note.id)}
                      disabled={editingBody.trim() === '' || updateMutation.isPending}
                    >
                      {updateMutation.isPending ? 'Salvando…' : 'Salvar'}
                    </Button>
                    <Button variant="ghost" onClick={cancelEdit}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className={`text-[13px] ${text.secondary} whitespace-pre-wrap`}>{note.body}</p>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <span className={`text-[11px] ${text.faint}`}>
                      {formatDateTime(note.createdAt)}
                      {note.updatedAt !== note.createdAt ? ' (editada)' : ''}
                    </span>
                    {note.createdByUserId === currentUserId && (
                      <div className="flex shrink-0 gap-3">
                        <button
                          type="button"
                          onClick={() => startEdit(note)}
                          className="text-[11px] font-medium text-blue-600 hover:underline"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(note.id)}
                          className="text-[11px] font-medium text-red-600 hover:underline"
                        >
                          Excluir
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
