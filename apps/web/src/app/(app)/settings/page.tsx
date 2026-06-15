'use client'

import { DashboardPageHeader } from '@/components/dashboard'
import { useState } from 'react'

type IntegrationStatus = 'connected' | 'disconnected' | 'partial'

interface IntegrationCard {
  id: string
  name: string
  description: string
  icon: string
  status: IntegrationStatus
  statusLabel: string
  fields: Array<{
    key: string
    label: string
    placeholder: string
    type: 'text' | 'password'
    value: string
    helpText?: string
  }>
  docs?: string
  cost?: string
}

export default function SettingsPage() {
  const [integrations, setIntegrations] = useState<IntegrationCard[]>([
    {
      id: 'anthropic',
      name: 'Claude (Anthropic)',
      description: 'IA para redação automática de petições e análise de documentos.',
      icon: '🤖',
      status: 'connected',
      statusLabel: 'Conectado',
      fields: [
        {
          key: 'ANTHROPIC_API_KEY',
          label: 'API Key',
          placeholder: 'sk-ant-...',
          type: 'password',
          value: '••••••••••••••••',
          helpText: 'Obtenha em console.anthropic.com',
        },
      ],
      docs: 'https://console.anthropic.com/',
      cost: '~US$3/1M tokens de entrada',
    },
    {
      id: 'judit',
      name: 'JUDIT API',
      description: 'Monitoramento automatizado de processos nos tribunais brasileiros. Recebe webhooks com novas movimentações.',
      icon: '🏛️',
      status: 'disconnected',
      statusLabel: 'Não configurado',
      fields: [
        {
          key: 'JUDIT_API_KEY',
          label: 'API Key',
          placeholder: 'Sua chave de API da JUDIT',
          type: 'password',
          value: '',
          helpText: 'Solicite via WhatsApp: +55 21 98528-4143',
        },
      ],
      docs: 'https://docs.judit.io',
      cost: 'A partir de R$249/mês ou pay-as-you-go',
    },
    {
      id: 'whatsapp',
      name: 'WhatsApp Business (Meta)',
      description: 'Notificações automáticas para o escritório via WhatsApp Business API.',
      icon: '📱',
      status: 'disconnected',
      statusLabel: 'Não configurado',
      fields: [
        {
          key: 'WHATSAPP_API_TOKEN',
          label: 'Access Token',
          placeholder: 'Token do System User (Meta Business)',
          type: 'password',
          value: '',
          helpText: 'Configure no Meta for Developers',
        },
        {
          key: 'WHATSAPP_PHONE_NUMBER_ID',
          label: 'Phone Number ID',
          placeholder: 'ID do número registrado no WhatsApp Business',
          type: 'text',
          value: '',
          helpText: 'Encontre no painel do WhatsApp Manager',
        },
        {
          key: 'OFFICE_PHONE_NUMBER',
          label: 'Telefone do Escritório',
          placeholder: '+5511999999999',
          type: 'text',
          value: '',
          helpText: 'Número que receberá as notificações',
        },
      ],
      docs: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
      cost: 'Grátis (serviço 24h) / ~R$0,25/msg template',
    },
  ])

  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  const handleFieldChange = (integrationId: string, fieldKey: string, value: string) => {
    setIntegrations((prev) =>
      prev.map((integration) => {
        if (integration.id !== integrationId) return integration
        return {
          ...integration,
          fields: integration.fields.map((f) => (f.key === fieldKey ? { ...f, value } : f)),
        }
      })
    )
  }

  const handleSave = async (integrationId: string) => {
    setSavingId(integrationId)
    // Simula salvamento (em produção, salvaria via API no banco)
    await new Promise((resolve) => setTimeout(resolve, 1000))

    setIntegrations((prev) =>
      prev.map((integration) => {
        if (integration.id !== integrationId) return integration
        const hasValues = integration.fields.every((f) => f.value.trim() !== '' && f.value !== '••••••••••••••••')
        return {
          ...integration,
          status: hasValues ? ('connected' as IntegrationStatus) : ('disconnected' as IntegrationStatus),
          statusLabel: hasValues ? 'Conectado' : 'Não configurado',
        }
      })
    )

    setSavingId(null)
    setSavedId(integrationId)
    setTimeout(() => setSavedId(null), 3000)
  }

  const statusColors: Record<IntegrationStatus, string> = {
    connected: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    disconnected: 'bg-gray-100 text-gray-500 border-gray-200',
    partial: 'bg-amber-100 text-amber-700 border-amber-200',
  }

  const statusDot: Record<IntegrationStatus, string> = {
    connected: 'bg-emerald-500',
    disconnected: 'bg-gray-400',
    partial: 'bg-amber-500',
  }

  return (
    <div>
      <DashboardPageHeader
        eyebrow="Sistema"
        title="Configurações & Integrações"
        description="Configure as APIs externas que o ExecFlow utiliza para monitorar tribunais, enviar notificações e redigir petições."
      />

      <div className="mt-8 space-y-6">
        {/* Status geral */}
        <div className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 rounded-xl border border-indigo-200/50 p-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚡</span>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Status das Integrações</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {integrations.filter((i) => i.status === 'connected').length} de{' '}
                {integrations.length} integrações configuradas
              </p>
            </div>
          </div>
        </div>

        {/* Cards de integração */}
        {integrations.map((integration) => (
          <div
            key={integration.id}
            className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow"
          >
            {/* Card header */}
            <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{integration.icon}</span>
                <div>
                  <h3 className="font-semibold text-gray-900">{integration.name}</h3>
                  <p className="text-sm text-gray-500">{integration.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {integration.cost && (
                  <span className="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded-md">
                    💰 {integration.cost}
                  </span>
                )}
                <span
                  className={`px-3 py-1 text-xs font-medium rounded-full border flex items-center gap-1.5 ${statusColors[integration.status]}`}
                >
                  <span className={`w-2 h-2 rounded-full ${statusDot[integration.status]}`} />
                  {integration.statusLabel}
                </span>
              </div>
            </div>

            {/* Card body - fields */}
            <div className="px-6 py-4 space-y-4">
              {integration.fields.map((field) => (
                <div key={field.key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {field.label}
                  </label>
                  <input
                    type={field.type}
                    value={field.value}
                    onChange={(e) => handleFieldChange(integration.id, field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors bg-gray-50 focus:bg-white"
                  />
                  {field.helpText && (
                    <p className="text-xs text-gray-400 mt-1">{field.helpText}</p>
                  )}
                </div>
              ))}
            </div>

            {/* Card footer */}
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
              <div>
                {integration.docs && (
                  <a
                    href={integration.docs}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo-600 hover:text-indigo-700 underline"
                  >
                    📄 Ver documentação
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2">
                {savedId === integration.id && (
                  <span className="text-xs text-emerald-600 flex items-center gap-1">
                    ✅ Salvo com sucesso
                  </span>
                )}
                <button
                  onClick={() => handleSave(integration.id)}
                  disabled={savingId === integration.id}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {savingId === integration.id ? 'Salvando...' : 'Salvar Configuração'}
                </button>
              </div>
            </div>
          </div>
        ))}

        {/* Instruções */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mt-6">
          <h4 className="text-sm font-semibold text-amber-800 flex items-center gap-2">
            ⚠️ Importante
          </h4>
          <ul className="text-sm text-amber-700 mt-2 space-y-1 list-disc list-inside">
            <li>
              As configurações salvas aqui são armazenadas localmente. Para produção, configure as variáveis de ambiente no servidor.
            </li>
            <li>
              A JUDIT API requer contrato comercial. Entre em contato via WhatsApp para solicitar.
            </li>
            <li>
              O WhatsApp Business API requer verificação de empresa no Meta Business Manager.
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}
