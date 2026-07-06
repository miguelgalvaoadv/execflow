'use client'

import { DashboardPageHeader } from '@/components/dashboard'
import { useState, useEffect } from 'react'
import { authClient } from '@/lib/auth-client'

interface Member {
  id: string
  userId: string
  role: 'owner' | 'admin' | 'lawyer' | 'assistant'
  status: string
  email: string
  displayName: string | null
  joinedAt: string
}

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'lawyer' | 'assistant'>('lawyer')
  const [inviting, setInviting] = useState(false)

  useEffect(() => {
    fetchMembers()
  }, [])

  const fetchMembers = async () => {
    try {
      const res = await authClient.$fetch('/api/v1/orgs/members')
      if (res.data) setMembers(res.data as unknown as Member[])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviting(true)
    try {
      await authClient.$fetch('/api/v1/orgs/invites', {
        method: 'POST',
        body: JSON.stringify({ email, role })
      })
      alert('Membro adicionado com sucesso!')
      setEmail('')
      fetchMembers()
    } catch (err: any) {
      alert(err.message || 'Erro ao adicionar. O usuário precisa ter uma conta no sistema.')
    } finally {
      setInviting(false)
    }
  }

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await authClient.$fetch(`/api/v1/orgs/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: newRole })
      })
      fetchMembers()
      alert('Permissão atualizada!')
    } catch (err: any) {
      alert(err.message)
    }
  }

  const handleRemove = async (userId: string) => {
    if (!confirm('Remover este membro?')) return
    try {
      await authClient.$fetch(`/api/v1/orgs/members/${userId}`, {
        method: 'DELETE'
      })
      fetchMembers()
      alert('Membro removido!')
    } catch (err: any) {
      alert(err.message)
    }
  }

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Organização"
        title="Equipe & Permissões"
        description="Gerencie os advogados e assistentes que têm acesso a este escritório."
      />

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
            <h3 className="font-semibold text-gray-900 mb-4">Adicionar Membro</h3>
            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email do usuário</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="advogado@escritorio.com"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-600"
                />
                <p className="text-xs text-gray-500 mt-1">O usuário deve estar cadastrado no sistema.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nível de Permissão</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-600"
                >
                  <option value="lawyer">Advogado (Pode criar processos)</option>
                  <option value="admin">Administrador (Acesso total)</option>
                  <option value="assistant">Assistente (Visualização e revisão)</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={inviting || !email}
                className="w-full px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {inviting ? 'Adicionando...' : 'Adicionar Membro'}
              </button>
            </form>
          </div>
        </div>

        <div className="md:col-span-2">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">Membros Ativos</h3>
            </div>
            
            {loading ? (
              <div className="p-6 text-center text-gray-500">Carregando equipe...</div>
            ) : members.length === 0 ? (
              <div className="p-6 text-center text-gray-500">Nenhum membro encontrado.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {members.map(member => (
                  <li key={member.id} className="p-6 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{member.displayName || member.email}</p>
                      <p className="text-sm text-gray-500">{member.email}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      {member.role === 'owner' ? (
                        <span className="text-xs font-medium bg-purple-100 text-purple-700 px-2 py-1 rounded">Dono</span>
                      ) : (
                        <select
                          value={member.role}
                          onChange={(e) => handleRoleChange(member.userId, e.target.value)}
                          className="text-sm border-gray-300 rounded focus:ring-blue-600"
                        >
                          <option value="admin">Admin</option>
                          <option value="lawyer">Advogado</option>
                          <option value="assistant">Assistente</option>
                        </select>
                      )}
                      
                      {member.role !== 'owner' && (
                        <button
                          onClick={() => handleRemove(member.userId)}
                          className="text-red-600 hover:text-red-800 text-sm font-medium"
                        >
                          Remover
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
