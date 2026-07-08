'use client'

/**
 * Client profile — read-only client view.
 *
 * Route: /clients/[clientId]
 * Data: GET /api/v1/clients/:id (LGPD fields filtered server-side by role).
 */

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useSession } from '@/lib/hooks/use-session'
import { useClient } from '@/lib/hooks/use-client'
import { DashboardPageHeader } from '@/components/dashboard'
import { EditClientModal } from '@/components/modals/EditClientModal'
import {
  ErrorState,
  FieldRow,
  LoadingState,
  ProfileSection,
  Button,
} from '@/components/ui'
import { text, borders } from '@/components/dashboard/surfaces'

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
  merged: 'Fundido',
  archived: 'Arquivado',
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso))
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export default function ClientProfilePage() {
  const params = useParams()
  const clientId = typeof params['clientId'] === 'string' ? params['clientId'] : ''

  const { data: session, isLoading: sessionLoading } = useSession()
  const orgId = session?.organization.id ?? ''

  const clientQuery = useClient(orgId, clientId, session !== null && clientId !== '')
  const client = clientQuery.data?.data

  const headerTitle = client?.displayName ?? client?.fullName ?? 'Cliente'
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)

  return (
    <div>
      {sessionLoading ? (
        <LoadingState label="Carregando sessão…" />
      ) : session === null ? (
        <ErrorState message="Sessão não encontrada. Faça login novamente." />
      ) : clientId === '' ? (
        <ErrorState message="Identificador de cliente inválido." />
      ) : clientQuery.isLoading ? (
        <LoadingState label="Carregando cliente…" />
      ) : clientQuery.isError ? (
        <ErrorState
          message={clientQuery.error.message ?? 'Erro ao carregar cliente.'}
          onRetry={() => { void clientQuery.refetch() }}
        />
      ) : client === undefined ? (
        <ErrorState message="Cliente não encontrado." />
      ) : (
        <>
        <div className="mb-5">
            <Link
              href="/clients"
              className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${text.muted} hover:text-slate-700 transition-colors`}
            >
              ← Clientes
            </Link>
          </div>

          <DashboardPageHeader
            eyebrow="Cliente"
            title={headerTitle}
            actions={
              <Button variant="secondary" onClick={() => setIsEditModalOpen(true)}>
                Editar Cliente
              </Button>
            }
            description={[
              client.internalRef !== null ? `Ref. ${client.internalRef}` : null,
              `Status: ${STATUS_LABELS[client.status] ?? client.status}`,
              `Atualizado em ${formatDateTime(client.updatedAt)}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          />

          <EditClientModal
            open={isEditModalOpen}
            onClose={() => setIsEditModalOpen(false)}
            client={client}
          />

          <div className="mt-6 space-y-4">
            <ProfileSection title="Identificação">
              <dl>
                <FieldRow labelWidth="40" label="Nome completo" value={client.fullName} />
                {client.displayName !== null && (
                  <FieldRow labelWidth="40" label="Nome de exibição" value={client.displayName} />
                )}
                {client.internalRef !== null && (
                  <FieldRow labelWidth="40" label="Ref. interna" value={client.internalRef} />
                )}
                {client.aliases.length > 0 && (
                  <FieldRow labelWidth="40" label="Aliases" value={client.aliases.join(', ')} />
                )}
              </dl>
            </ProfileSection>

            {client.notes !== null && client.notes.trim() !== '' && (
              <ProfileSection title="Notas (cadastro)">
                <p className={`text-[13px] ${text.secondary} whitespace-pre-wrap`}>{client.notes}</p>
              </ProfileSection>
            )}

            {client.responsibleLawyerUserId !== null && (
              <ProfileSection title="Advogado responsável">
                <p className={`text-[13px] font-mono ${text.secondary}`}>
                  {client.responsibleLawyerUserId}
                </p>
              </ProfileSection>
            )}

            {(client.cpf !== undefined ||
              client.rg !== undefined ||
              client.matricula !== undefined ||
              client.birthDate !== undefined ||
              (client.contactChannels !== undefined && client.contactChannels.length > 0)) && (
              <ProfileSection title="Dados sensíveis (LGPD)">
                <dl>
                  {client.cpf !== undefined && client.cpf !== null && (
                    <FieldRow labelWidth="40" label="CPF" value={client.cpf} />
                  )}
                  {client.rg !== undefined && client.rg !== null && (
                    <FieldRow labelWidth="40" label="RG" value={client.rg} />
                  )}
                  {client.matricula !== undefined && client.matricula !== null && (
                    <FieldRow labelWidth="40" label="Matrícula (réu)" value={client.matricula} />
                  )}
                  {client.birthDate !== undefined && client.birthDate !== null && (
                    <FieldRow labelWidth="40" label="Data de nascimento" value={formatDate(client.birthDate)} />
                  )}
                  {client.contactChannels !== undefined && client.contactChannels.length > 0 && (
                    <FieldRow
                      labelWidth="40"
                      label="Contatos"
                      value={
                        <ul className="space-y-1">
                          {client.contactChannels.map((ch, i) => (
                            <li key={`${ch.type}-${ch.value}-${i}`}>
                              <span className={text.faint}>{ch.type}: </span>
                              {ch.value}
                              {ch.notes !== undefined && ch.notes !== '' && (
                                <span className={` ${text.faint}`}> ({ch.notes})</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      }
                    />
                  )}
                </dl>
              </ProfileSection>
            )}

            <ProfileSection title="Datas">
              <dl>
                <FieldRow labelWidth="40" label="Criado em" value={formatDateTime(client.createdAt)} />
                <FieldRow labelWidth="40" label="Atualizado em" value={formatDateTime(client.updatedAt)} />
              </dl>
            </ProfileSection>
          </div>
        </>
      )}
    </div>
  )
}
