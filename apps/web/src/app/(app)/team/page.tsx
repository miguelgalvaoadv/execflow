'use client'

/**
 * Equipe & Acessos — provisionamento de logins pelo admin do escritório.
 *
 * O admin cria o acesso direto (nome, e-mail, papel, senha), o sistema cria a
 * conta real + vínculo, e mostra as credenciais UMA vez para repassar. Também:
 * redefinir senha, suspender/reativar e trocar papel. Ver routes/orgs.ts.
 */

import { useState } from 'react'
import { useSession } from '@/lib/hooks/use-session'
import {
  useTeamMembers,
  useCreateMember,
  useUpdateMemberRole,
  useUpdateMemberStatus,
  useResetMemberPassword,
  type TeamMember,
  type TeamRole,
} from '@/lib/hooks/use-team'
import { DashboardPageHeader } from '@/components/dashboard'
import { Button, EmptyState, ErrorState, LoadingState } from '@/components/ui'
import { borders, surfaces, text } from '@/components/dashboard/surfaces'

// ---------------------------------------------------------------------------
// Metadados de papéis (rótulo + descrição do que cada um pode fazer)
// ---------------------------------------------------------------------------

const ROLE_META: Record<TeamRole, { label: string; short: string; description: string; badge: string }> = {
  admin: {
    label: 'Administrador',
    short: 'Admin',
    description: 'Acesso total: gerencia a equipe e acessos, vê dados sensíveis (CPF, contatos), aprova, configura e faz tudo que os demais fazem.',
    badge: 'text-purple-700 bg-purple-50 border-purple-200',
  },
  lawyer: {
    label: 'Advogado',
    short: 'Advogado',
    description: 'Cria e edita processos, aprova peças, confirma cálculos, qualifica oportunidades e vê dados sensíveis. Não gerencia a equipe.',
    badge: 'text-blue-700 bg-blue-50 border-blue-200',
  },
  assistant: {
    label: 'Assistente',
    short: 'Assistente',
    description: 'Prepara e organiza: cria notas e tarefas, anexa documentos, revisa. Não aprova nada e não vê dados sensíveis (CPF, contatos).',
    badge: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  },
  client: {
    label: 'Cliente (portal)',
    short: 'Cliente',
    description: 'Acesso apenas ao portal do cliente. Não entra na área interna do escritório.',
    badge: 'text-slate-600 bg-slate-100 border-slate-200',
  },
}

const STAFF_ROLES: Array<'admin' | 'lawyer' | 'assistant'> = ['admin', 'lawyer', 'assistant']

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default function TeamPage() {
  const { data: session, isLoading: sessionLoading } = useSession()
  const orgId = session?.organization.id ?? ''
  const myUserId = session?.user.id ?? ''

  const membersQuery = useTeamMembers(orgId, session !== null)
  const updateRole = useUpdateMemberRole(orgId)
  const updateStatus = useUpdateMemberStatus(orgId)
  const resetPassword = useResetMemberPassword(orgId)

  const [showCreate, setShowCreate] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [credential, setCredential] = useState<{ title: string; email: string; password: string } | null>(null)
  const [confirmReset, setConfirmReset] = useState<TeamMember | null>(null)

  const members = membersQuery.data?.data ?? []

  function handleRoleChange(m: TeamMember, role: 'admin' | 'lawyer' | 'assistant') {
    setActionError(null)
    updateRole.mutate(
      { userId: m.userId, role },
      { onError: (e) => setActionError(e.message) }
    )
  }

  function handleStatusChange(m: TeamMember, status: 'active' | 'suspended') {
    setActionError(null)
    updateStatus.mutate(
      { userId: m.userId, status },
      { onError: (e) => setActionError(e.message) }
    )
  }

  function doResetPassword(m: TeamMember) {
    setActionError(null)
    resetPassword.mutate(
      { userId: m.userId },
      {
        onSuccess: (res) => {
          setConfirmReset(null)
          if (res.password) {
            setCredential({
              title: `Nova senha de ${m.displayName ?? m.email}`,
              email: m.email,
              password: res.password,
            })
          }
        },
        onError: (e) => { setActionError(e.message); setConfirmReset(null) },
      }
    )
  }

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Organização"
        title="Equipe & Acessos"
        description="Crie e gerencie os logins de quem trabalha neste escritório — advogados, assistentes e administradores."
        actions={
          <Button variant="primary" onClick={() => { setActionError(null); setShowCreate(true) }}>
            <span className="text-[15px] leading-none">+</span> Criar acesso
          </Button>
        }
      />

      {/* Credenciais recém-geradas (mostradas uma única vez) */}
      {credential !== null && (
        <div className="mt-6">
          <CredentialReveal
            title={credential.title}
            email={credential.email}
            password={credential.password}
            onDismiss={() => setCredential(null)}
          />
        </div>
      )}

      {actionError !== null && (
        <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-700">
          {actionError}
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Explicação dos papéis */}
        <aside className="lg:col-span-1">
          <div className={`rounded-xl border p-5 ${borders.subtle} ${surfaces.panelInset}`}>
            <h3 className={`text-[13px] font-semibold ${text.primary} mb-3`}>O que cada papel pode fazer</h3>
            <ul className="space-y-3">
              {STAFF_ROLES.map((r) => (
                <li key={r}>
                  <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${ROLE_META[r].badge} mb-1`}>
                    {ROLE_META[r].label}
                  </span>
                  <p className={`text-[12px] leading-relaxed ${text.muted}`}>{ROLE_META[r].description}</p>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Lista de membros */}
        <div className="lg:col-span-2">
          {sessionLoading ? (
            <LoadingState label="Carregando sessão…" />
          ) : session === null ? (
            <ErrorState message="Sessão não encontrada. Faça login novamente." />
          ) : membersQuery.isLoading ? (
            <LoadingState label="Carregando equipe…" />
          ) : membersQuery.isError ? (
            <ErrorState
              message={membersQuery.error?.message ?? 'Erro ao carregar equipe.'}
              onRetry={() => { void membersQuery.refetch() }}
            />
          ) : members.length === 0 ? (
            <EmptyState title="Nenhum membro" description="Crie o primeiro acesso para começar." />
          ) : (
            <ul className={`divide-y rounded-xl border ${borders.subtle} ${surfaces.panel} overflow-hidden`}>
              {members.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  isSelf={m.userId === myUserId}
                  busy={updateRole.isPending || updateStatus.isPending}
                  onRoleChange={(role) => handleRoleChange(m, role)}
                  onStatusChange={(status) => handleStatusChange(m, status)}
                  onResetPassword={() => setConfirmReset(m)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateAccessModal
          organizationId={orgId}
          onClose={() => setShowCreate(false)}
          onCreated={(cred) => {
            setShowCreate(false)
            if (cred) setCredential(cred)
          }}
        />
      )}

      {confirmReset !== null && (
        <ConfirmModal
          title="Redefinir senha"
          message={`Gerar uma nova senha temporária para ${confirmReset.displayName ?? confirmReset.email}? A senha atual deixará de funcionar imediatamente.`}
          confirmLabel={resetPassword.isPending ? 'Gerando…' : 'Gerar nova senha'}
          busy={resetPassword.isPending}
          onCancel={() => setConfirmReset(null)}
          onConfirm={() => doResetPassword(confirmReset)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Linha de membro
// ---------------------------------------------------------------------------

function MemberRow({
  member,
  isSelf,
  busy,
  onRoleChange,
  onStatusChange,
  onResetPassword,
}: {
  member: TeamMember
  isSelf: boolean
  busy: boolean
  onRoleChange: (role: 'admin' | 'lawyer' | 'assistant') => void
  onStatusChange: (status: 'active' | 'suspended') => void
  onResetPassword: () => void
}) {
  const suspended = member.status === 'suspended'
  const isClient = member.role === 'client'

  return (
    <li className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between ${suspended ? 'opacity-60' : ''}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className={`text-[13px] font-medium ${text.primary} truncate`}>
            {member.displayName ?? member.email}
          </p>
          {isSelf && <span className={`text-[10px] ${text.faint}`}>(você)</span>}
          {suspended && (
            <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              Suspenso
            </span>
          )}
        </div>
        <p className={`text-[12px] ${text.faint} truncate`}>{member.email}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {isClient ? (
          <span className={`rounded-md border px-2 py-1 text-[11px] font-medium ${ROLE_META.client.badge}`}>
            {ROLE_META.client.label}
          </span>
        ) : (
          <select
            value={member.role}
            disabled={isSelf || busy}
            onChange={(e) => onRoleChange(e.target.value as 'admin' | 'lawyer' | 'assistant')}
            className={`rounded-lg border px-2 py-1.5 text-[12px] ${borders.default} bg-white ${text.primary} disabled:opacity-50 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none`}
            title={isSelf ? 'Você não pode alterar a própria permissão' : 'Alterar papel'}
          >
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_META[r].label}</option>
            ))}
          </select>
        )}

        {!isClient && !isSelf && (
          <>
            <button
              type="button"
              onClick={onResetPassword}
              className={`text-[11px] font-medium ${text.muted} hover:underline`}
            >
              Redefinir senha
            </button>
            {suspended ? (
              <button
                type="button"
                onClick={() => onStatusChange('active')}
                disabled={busy}
                className="text-[11px] font-medium text-emerald-700 hover:underline disabled:opacity-50"
              >
                Reativar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onStatusChange('suspended')}
                disabled={busy}
                className="text-[11px] font-medium text-red-600 hover:underline disabled:opacity-50"
              >
                Suspender
              </button>
            )}
          </>
        )}
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Modal: criar acesso
// ---------------------------------------------------------------------------

const inputClass = [
  'w-full rounded-lg border px-3 py-2.5 text-[13px] outline-none transition-colors',
  `${borders.default} bg-white shadow-sm ${text.primary}`,
  'placeholder:text-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-600',
].join(' ')

const labelClass = `mb-1.5 block text-[11px] font-medium uppercase tracking-[0.1em] ${text.muted}`

/** Gera senha forte no cliente (espelha o gerador do servidor). */
function genPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const digits = '23456789'
  const symbols = '!@#$%&*?'
  const all = upper + lower + digits + symbols
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)]
  const arr = [pick(upper), pick(lower), pick(digits), pick(symbols)]
  for (let i = arr.length; i < 16; i++) arr.push(pick(all))
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
  }
  return arr.join('')
}

function CreateAccessModal({
  organizationId,
  onClose,
  onCreated,
}: {
  organizationId: string
  onClose: () => void
  onCreated: (cred: { title: string; email: string; password: string } | null) => void
}) {
  const createMember = useCreateMember(organizationId)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'lawyer' | 'assistant'>('assistant')
  const [password, setPassword] = useState(() => genPassword())

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    createMember.mutate(
      { name: name.trim(), email: email.trim(), role, password },
      {
        onSuccess: (res) => {
          // Se a conta foi criada, mostramos a senha usada. Se apenas vinculamos
          // uma conta que já existia, não há senha a revelar.
          if (res.created) {
            onCreated({ title: `Acesso criado para ${name.trim()}`, email: email.trim(), password })
          } else {
            onCreated(null)
          }
        },
      }
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative z-10 max-h-[90vh] w-full max-w-[480px] overflow-y-auto rounded-2xl border p-8 ${surfaces.panelRaised}`}>
        <h2 className={`text-[20px] font-semibold tracking-[-0.01em] mb-1 ${text.primary}`}>Criar acesso</h2>
        <p className={`text-[13px] mb-6 ${text.muted}`}>
          Cria um login funcional na hora. Depois, repasse o e-mail e a senha para a pessoa.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="m-name" className={labelClass}>Nome completo</label>
            <input id="m-name" type="text" required value={name} onChange={(e) => setName(e.target.value)}
              className={inputClass} placeholder="Ex: Dra. Ana Ribeiro" disabled={createMember.isPending} />
          </div>

          <div>
            <label htmlFor="m-email" className={labelClass}>E-mail (será o login)</label>
            <input id="m-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className={inputClass} placeholder="ana@escritorio.com" disabled={createMember.isPending} />
          </div>

          <div>
            <label htmlFor="m-role" className={labelClass}>Papel</label>
            <select id="m-role" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'lawyer' | 'assistant')}
              className={inputClass} disabled={createMember.isPending}>
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_META[r].label}</option>
              ))}
            </select>
            <p className={`mt-1.5 text-[11px] leading-relaxed ${text.faint}`}>{ROLE_META[role].description}</p>
          </div>

          <div>
            <label htmlFor="m-pass" className={labelClass}>Senha temporária</label>
            <div className="flex gap-2">
              <input id="m-pass" type="text" required minLength={12} value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputClass} font-mono`} disabled={createMember.isPending} />
              <button type="button" onClick={() => setPassword(genPassword())}
                className={`shrink-0 rounded-lg border px-3 text-[12px] font-medium ${borders.default} ${text.secondary} hover:bg-slate-50`}
                disabled={createMember.isPending}>
                Gerar
              </button>
            </div>
            <p className={`mt-1.5 text-[11px] ${text.faint}`}>Mínimo 12 caracteres. Você poderá copiá-la na próxima tela.</p>
          </div>

          {createMember.isError && (
            <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-[13px] text-red-700">
              {createMember.error?.message ?? 'Erro ao criar acesso.'}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={createMember.isPending}>Cancelar</Button>
            <Button type="submit" variant="primary"
              disabled={createMember.isPending || name.trim() === '' || email.trim() === '' || password.length < 12}>
              {createMember.isPending ? 'Criando…' : 'Criar acesso'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Painel de credenciais (mostrado uma vez)
// ---------------------------------------------------------------------------

function CredentialReveal({
  title,
  email,
  password,
  onDismiss,
}: {
  title: string
  email: string
  password: string
  onDismiss: () => void
}) {
  const [copied, setCopied] = useState<string | null>(null)

  function copy(label: string, value: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(label)
      window.setTimeout(() => setCopied(null), 1500)
    })
  }

  const both = `E-mail: ${email}\nSenha: ${password}`

  return (
    <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-emerald-900">{title}</p>
          <p className="mt-0.5 text-[12px] text-emerald-800">
            Envie estas credenciais para a pessoa (WhatsApp, pessoalmente…). A senha <strong>não</strong> aparecerá de novo.
          </p>
        </div>
        <button type="button" onClick={onDismiss} className="shrink-0 text-[12px] font-medium text-emerald-700 hover:underline">
          Fechar
        </button>
      </div>

      <div className="mt-4 space-y-2">
        <CredRow label="E-mail" value={email} copied={copied === 'E-mail'} onCopy={() => copy('E-mail', email)} />
        <CredRow label="Senha" value={password} mono copied={copied === 'Senha'} onCopy={() => copy('Senha', password)} />
      </div>

      <button type="button" onClick={() => copy('Ambos', both)}
        className="mt-3 rounded-lg bg-emerald-700 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-emerald-800">
        {copied === 'Ambos' ? 'Copiado!' : 'Copiar e-mail + senha'}
      </button>
    </div>
  )
}

function CredRow({ label, value, mono, copied, onCopy }: { label: string; value: string; mono?: boolean; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-white px-3 py-2">
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-emerald-700">{label}</p>
        <p className={`text-[13px] text-slate-900 truncate ${mono ? 'font-mono' : ''}`}>{value}</p>
      </div>
      <button type="button" onClick={onCopy} className="shrink-0 text-[11px] font-medium text-emerald-700 hover:underline">
        {copied ? 'Copiado!' : 'Copiar'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal de confirmação genérico
// ---------------------------------------------------------------------------

function ConfirmModal({
  title,
  message,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string
  message: string
  confirmLabel: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm" onClick={onCancel} />
      <div className={`relative z-10 w-full max-w-[420px] rounded-2xl border p-7 ${surfaces.panelRaised}`}>
        <h2 className={`text-[17px] font-semibold mb-2 ${text.primary}`}>{title}</h2>
        <p className={`text-[13px] mb-6 ${text.secondary}`}>{message}</p>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancelar</Button>
          <Button type="button" variant="primary" onClick={onConfirm} disabled={busy}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}
