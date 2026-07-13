'use client'

import Link from 'next/link'
import { DashboardPageHeader } from '@/components/dashboard'
import {
  Bot,
  Landmark,
  FolderArchive,
  Mail,
  CheckCircle2,
  CircleDashed,
  ListChecks,
  Lock,
  type LucideIcon,
} from 'lucide-react'

type Integration = {
  id: string
  name: string
  description: string
  Icon: LucideIcon
  required: boolean
  envVar: string
  note: string
}

const INTEGRATIONS: Integration[] = [
  {
    id: 'claude',
    name: 'Claude (Anthropic)',
    description: 'Inteligência que lê os autos, detecta oportunidades e redige as peças.',
    Icon: Bot,
    required: true,
    envVar: 'ANTHROPIC_API_KEY',
    note: 'Obtida em console.anthropic.com. Configurada no servidor (Render) e no .env.local.',
  },
  {
    id: 'astrea',
    name: 'Astrea (tribunais, por e-mail)',
    description: 'Monitora os processos públicos do escritório no Astrea e lê os alertas de andamento por e-mail (IMAP) a cada 10 minutos. Segredo de justiça exige cadastro manual de credencial por tribunal dentro do Astrea.',
    Icon: Landmark,
    required: true,
    envVar: 'ASTREA_IMAP_HOST / USER / PASS',
    note: 'Conta de Gmail dedicada com senha de app. Configurada no servidor (Render → execflow-workers).',
  },
  {
    id: 'storage',
    name: 'Armazenamento de documentos',
    description: 'Guarda os autos em PDF e as peças geradas, com download seguro.',
    Icon: FolderArchive,
    required: true,
    envVar: 'STORAGE_S3_*',
    note: 'Cloudflare R2 / S3 em produção; armazenamento local em desenvolvimento.',
  },
  {
    id: 'email',
    name: 'E-mail de alertas',
    description: 'Avisa o escritório sobre novas movimentações, prazos e oportunidades.',
    Icon: Mail,
    required: false,
    envVar: 'SMTP_USER / SMTP_PASS',
    note: 'Use uma "senha de app" do Gmail. Opcional.',
  },
]

export default function SettingsPage() {
  return (
    <div>
      <DashboardPageHeader
        eyebrow="Sistema"
        title="Configurações e integrações"
        description="As integrações do ExecFlow são configuradas com segurança no servidor (variáveis de ambiente). Esta tela mostra o que o sistema usa."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {INTEGRATIONS.map((it) => (
          <div
            key={it.id}
            className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <it.Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-slate-900">{it.name}</p>
                  <p className="text-[11px] text-slate-500">
                    {it.required ? 'Essencial' : 'Opcional'}
                  </p>
                </div>
              </div>
              {it.required ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Em uso
                </span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  <CircleDashed className="h-3.5 w-3.5" /> Opcional
                </span>
              )}
            </div>

            <p className="mt-3 text-[13px] leading-relaxed text-slate-600">{it.description}</p>

            <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400">
                Variável de ambiente
              </p>
              <p className="mt-0.5 font-mono text-[12px] text-slate-800">{it.envVar}</p>
              <p className="mt-1.5 text-[11px] text-slate-500">{it.note}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
        <p className="text-[13px] text-blue-800">
          As chaves são guardadas com segurança nas variáveis de ambiente do servidor (Render) — nunca
          no navegador. Para alterá-las, edite o serviço no Render ou o arquivo <code className="font-mono">.env.local</code> em
          desenvolvimento.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Link
          href="/settings/astrea-triage"
          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
            <ListChecks className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[13px] font-semibold text-slate-900">Movimentações não identificadas</p>
            <p className="text-[12px] text-slate-500">E-mails do Astrea que precisam de triagem manual.</p>
          </div>
        </Link>
        <Link
          href="/settings/astrea-sigilosos"
          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Lock className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[13px] font-semibold text-slate-900">Processos em segredo de justiça</p>
            <p className="text-[12px] text-slate-500">Lembrete de revisão de credenciais por tribunal.</p>
          </div>
        </Link>
        <Link
          href="/settings/integracoes"
          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <ListChecks className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[13px] font-semibold text-slate-900">Integrações</p>
            <p className="text-[12px] text-slate-500">Estado real de cada fonte: DJEN, InfoSimples, DataJud, e-mail.</p>
          </div>
        </Link>
        <Link
          href="/settings/ia-historico"
          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
            <ListChecks className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[13px] font-semibold text-slate-900">Histórico da IA</p>
            <p className="text-[12px] text-slate-500">Auditoria: prompt, resposta, modelo, tokens e custo por chamada.</p>
          </div>
        </Link>
      </div>
    </div>
  )
}
