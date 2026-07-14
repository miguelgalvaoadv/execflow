'use client'

/**
 * Configurações — visão organizada do que importa para o usuário do ExecFlow:
 * sua conta, o escritório, o uso e custo da IA (Claude), as fontes de dados
 * (tribunais) e onde cada credencial mora — sem NUNCA expor segredos.
 *
 * Segredos (chaves/senhas) vivem em variáveis de ambiente no servidor e nunca
 * chegam ao navegador. Esta tela mostra quais existem e como trocá-las.
 */

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  User, Building2, Bot, Radio, KeyRound, ScrollText, Info,
  ExternalLink, CheckCircle2, CircleDashed, ChevronRight,
} from 'lucide-react'
import { apiGet, ApiError } from '@/lib/api-client'
import { useSession } from '@/lib/hooks/use-session'
import { DashboardPageHeader } from '@/components/dashboard'
import { Button } from '@/components/ui'
import { borders, surfaces, text } from '@/components/dashboard/surfaces'
import { ChangePasswordModal } from '@/components/settings/ChangePasswordModal'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador', lawyer: 'Advogado', assistant: 'Assistente', client: 'Cliente',
}

type AiSummary = {
  month: { calls: number; errors: number; inputTokens: number; outputTokens: number; costUsd: string; lastAt: string | null } | null
  allTime: { calls: number; costUsd: string } | null
  hasCredential: boolean
}

/** Credenciais do sistema — onde cada uma mora e como trocar. NUNCA o valor. */
const CREDENTIALS: Array<{ name: string; envVar: string; where: string; rotate: string }> = [
  {
    name: 'Claude (Anthropic)',
    envVar: 'ANTHROPIC_API_KEY',
    where: 'console.anthropic.com → API Keys',
    rotate: 'Gere uma nova chave no console, atualize no Render (execflow-api e execflow-workers) e no .env.local em desenvolvimento.',
  },
  {
    name: 'InfoSimples (TJSP e-SAJ por OAB)',
    envVar: 'INFOSIMPLES_TOKEN',
    where: 'Painel InfoSimples',
    rotate: 'Token vive no serviço de workers (Render). Substitua lá em caso de troca.',
  },
  {
    name: 'DataJud (CNJ)',
    envVar: 'DATAJUD_API_KEY',
    where: 'Chave pública do CNJ',
    rotate: 'Vive no serviço de workers (Render).',
  },
  {
    name: 'Armazenamento de documentos',
    envVar: 'STORAGE_S3_*',
    where: 'Cloudflare R2 / S3',
    rotate: 'Credenciais no Render. Em dev, armazenamento local.',
  },
  {
    name: 'E-mail de alertas (opcional)',
    envVar: 'SMTP_USER / SMTP_PASS',
    where: 'Senha de app do Gmail',
    rotate: 'Opcional. Gere uma "senha de app" no Google e configure no Render.',
  },
  {
    name: 'Sessões e login',
    envVar: 'BETTER_AUTH_SECRET',
    where: 'Segredo interno de sessão',
    rotate: 'Gere com "openssl rand -base64 32". Trocar invalida todas as sessões (todos precisam relogar).',
  },
  {
    name: 'Banco de dados',
    envVar: 'DATABASE_URL',
    where: 'Pooler do Postgres (Supabase)',
    rotate: 'String de conexão no Render e no .env.local. Contém a senha do banco — trate como segredo máximo.',
  },
]

function Section({ icon: Icon, title, description, children }: {
  icon: typeof User; title: string; description?: string; children: React.ReactNode
}) {
  return (
    <section className={`rounded-2xl border p-5 sm:p-6 ${borders.subtle} ${surfaces.panel}`}>
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div>
          <h2 className={`text-[15px] font-semibold ${text.primary}`}>{title}</h2>
          {description && <p className={`text-[12px] ${text.muted}`}>{description}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-slate-100 last:border-0">
      <span className={`text-[12px] ${text.faint}`}>{label}</span>
      <span className={`text-[13px] ${text.secondary} text-right`}>{value}</span>
    </div>
  )
}

function formatCurrencyUsd(v: string | number): string {
  return `US$ ${Number(v).toFixed(4)}`
}
function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

export default function SettingsPage() {
  const { data: session } = useSession()
  const orgId = session?.organization.id ?? ''
  const role = session?.role ?? ''
  const canSeeAiCost = role === 'admin' || role === 'lawyer'
  const [showPassword, setShowPassword] = useState(false)

  const aiSummary = useQuery<AiSummary, ApiError>({
    queryKey: ['ai-summary', orgId],
    queryFn: ({ signal }) => apiGet('/api/v1/ai-logs/summary', { organizationId: orgId, signal }),
    enabled: orgId !== '' && canSeeAiCost,
    staleTime: 60 * 1000,
  })

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Sistema"
        title="Configurações"
        description="Sua conta, o escritório, o uso da inteligência e as fontes de dados — o que importa, em um lugar só."
      />

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Minha conta */}
        <Section icon={User} title="Minha conta" description="Seus dados de acesso a este escritório.">
          <div>
            <InfoRow label="Nome" value={session?.user.name ?? '—'} />
            <InfoRow label="E-mail (login)" value={session?.user.email ?? '—'} />
            <InfoRow label="Papel" value={ROLE_LABELS[role] ?? role ?? '—'} />
          </div>
          <div className="mt-4">
            <Button variant="secondary" onClick={() => setShowPassword(true)}>Alterar minha senha</Button>
          </div>
        </Section>

        {/* Escritório */}
        <Section icon={Building2} title="Escritório" description="Identificação e fuso horário da organização.">
          <div>
            <InfoRow label="Nome do escritório" value={session?.organization.name ?? '—'} />
            <InfoRow label="Identificador" value={<span className="font-mono text-[12px]">{session?.organization.slug ?? '—'}</span>} />
            <InfoRow label="Fuso horário" value="America/Sao_Paulo" />
          </div>
          <p className={`mt-3 text-[11px] ${text.faint}`}>
            Para gerenciar quem tem acesso, use <Link href="/team" className="text-blue-600 hover:underline">Equipe</Link>.
          </p>
        </Section>

        {/* Inteligência (Claude) */}
        <Section icon={Bot} title="Inteligência (Claude)" description="A IA que lê os autos, detecta oportunidades e redige peças.">
          <div className="mb-3 flex items-center gap-2">
            {aiSummary.data?.hasCredential !== false ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> Chave configurada
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                <CircleDashed className="h-3.5 w-3.5" /> Sem chave
              </span>
            )}
            <span className={`font-mono text-[11px] ${text.faint}`}>ANTHROPIC_API_KEY</span>
          </div>

          {canSeeAiCost ? (
            aiSummary.isLoading ? (
              <p className={`text-[12px] ${text.faint}`}>Carregando uso…</p>
            ) : aiSummary.data ? (
              <div>
                <div className="grid grid-cols-3 gap-2">
                  <div className={`rounded-lg border p-2.5 ${borders.subtle} ${surfaces.panelInset}`}>
                    <p className={`text-[15px] font-semibold ${text.primary}`}>{formatCurrencyUsd(aiSummary.data.month?.costUsd ?? 0)}</p>
                    <p className={`text-[10px] ${text.faint}`}>Custo no mês</p>
                  </div>
                  <div className={`rounded-lg border p-2.5 ${borders.subtle} ${surfaces.panelInset}`}>
                    <p className={`text-[15px] font-semibold ${text.primary}`}>{aiSummary.data.month?.calls ?? 0}</p>
                    <p className={`text-[10px] ${text.faint}`}>Chamadas no mês</p>
                  </div>
                  <div className={`rounded-lg border p-2.5 ${borders.subtle} ${surfaces.panelInset}`}>
                    <p className={`text-[15px] font-semibold ${text.primary}`}>{formatCurrencyUsd(aiSummary.data.allTime?.costUsd ?? 0)}</p>
                    <p className={`text-[10px] ${text.faint}`}>Custo total</p>
                  </div>
                </div>
                <p className={`mt-2 text-[11px] ${text.faint}`}>
                  Última chamada: {formatDateTime(aiSummary.data.month?.lastAt ?? null)}
                </p>
              </div>
            ) : (
              <p className={`text-[12px] ${text.faint}`}>Sem uso registrado ainda.</p>
            )
          ) : (
            <p className={`text-[12px] ${text.faint}`}>Custos visíveis para advogado/administrador.</p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener noreferrer"
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium ${borders.default} ${text.secondary} hover:bg-slate-50`}>
              Verificar saldo <ExternalLink className="h-3 w-3" />
            </a>
            <Link href="/settings/ia-historico"
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium ${borders.default} ${text.secondary} hover:bg-slate-50`}>
              Histórico detalhado <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <p className={`mt-2 text-[11px] ${text.faint}`}>
            Se a IA parar de responder, quase sempre é saldo/crédito zerado — confira o saldo antes de qualquer coisa.
          </p>
        </Section>

        {/* Fontes de dados */}
        <Section icon={Radio} title="Fontes de dados (tribunais)" description="De onde vêm intimações e movimentações dos processos.">
          <p className={`text-[12px] leading-relaxed ${text.muted}`}>
            O monitoramento hoje usa <strong>DJEN</strong> (intimações por OAB, grátis), <strong>InfoSimples</strong>{' '}
            (descoberta e acompanhamento no TJSP e-SAJ por OAB) e <strong>DataJud</strong> (metadados do CNJ). O estado real
            de cada fonte — credencial verificada e última execução — fica na tela de integrações.
          </p>
          <div className="mt-4">
            <Link href="/settings/integracoes"
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium ${borders.default} ${text.secondary} hover:bg-slate-50`}>
              Ver estado das integrações <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
        </Section>

        {/* Credenciais & segurança */}
        <Section icon={KeyRound} title="Credenciais & segurança" description="Onde cada chave/senha vive e como trocá-la. Os valores nunca aparecem aqui." >
          <div className="overflow-x-auto">
            <ul className="divide-y divide-slate-100">
              {CREDENTIALS.map((cred) => (
                <li key={cred.envVar} className="py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`text-[13px] font-medium ${text.secondary}`}>{cred.name}</span>
                    <span className={`font-mono text-[11px] ${text.faint}`}>{cred.envVar}</span>
                  </div>
                  <p className={`mt-0.5 text-[11px] ${text.faint}`}>{cred.where} · {cred.rotate}</p>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-[12px] text-blue-800">
            As chaves ficam em variáveis de ambiente no servidor (Render) — nunca no navegador nem no banco. Para
            alterá-las, edite o serviço no Render (produção) ou o arquivo <code className="font-mono">.env.local</code> (desenvolvimento).
          </p>
        </Section>

        {/* Auditoria & sistema */}
        <Section icon={ScrollText} title="Auditoria & sistema" description="Rastreabilidade e informações do ambiente.">
          <div>
            <Link href="/settings/ia-historico"
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 hover:bg-slate-50">
              <span>
                <span className={`block text-[13px] font-medium ${text.primary}`}>Histórico da IA</span>
                <span className={`block text-[11px] ${text.faint}`}>Prompt, resposta, modelo, tokens e custo por chamada.</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
            </Link>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-400">
            <Info className="h-3.5 w-3.5" />
            <span>ExecFlow · execução penal · ambiente de produção</span>
          </div>
        </Section>
      </div>

      <ChangePasswordModal open={showPassword} onClose={() => setShowPassword(false)} />
    </div>
  )
}
