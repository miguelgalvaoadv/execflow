'use client'

/**
 * Document detail — read-only view for Document Central.
 *
 * Route: /documents/[documentId]
 * Data: GET /api/v1/documents/:id
 */

import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useSession } from '@/lib/hooks/use-session'
import { useDocument } from '@/lib/hooks/use-document'
import { DashboardPageHeader } from '@/components/dashboard'
import {
  ErrorState,
  FieldRow,
  LoadingState,
  ProfileSection,
} from '@/components/ui'
import { borders, text } from '@/components/dashboard/surfaces'
import { downloadBlob, viewBlob } from '@/lib/api-client'
import {
  documentStatusLabel,
  ocrStatusLabel,
  extractionStatusLabel,
  snapshotPromotionStatusLabel,
  reviewDecisionLabel,
} from '@/lib/operational/document-display'

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function clientDisplayName(summary: { displayName: string | null; fullName: string }): string {
  return summary.displayName ?? summary.fullName
}

export default function DocumentDetailPage() {
  const params = useParams()
  const documentId = typeof params['documentId'] === 'string' ? params['documentId'] : ''

  const { data: session, isLoading: sessionLoading } = useSession()
  const orgId = session?.organization.id ?? ''

  const docQuery = useDocument(orgId, documentId, session !== null && documentId !== '')
  const doc = docQuery.data?.data

  return (
    <div>
      {sessionLoading ? (
        <LoadingState label="Carregando sessão…" />
      ) : session === null ? (
        <ErrorState message="Sessão não encontrada. Faça login novamente." />
      ) : documentId === '' ? (
        <ErrorState message="Identificador de documento inválido." />
      ) : docQuery.isLoading ? (
        <LoadingState label="Carregando peça…" />
      ) : docQuery.isError ? (
        <ErrorState
          message={docQuery.error.message ?? 'Erro ao carregar peça.'}
          onRetry={() => { void docQuery.refetch() }}
        />
      ) : doc === undefined ? (
        <ErrorState message="Documento não encontrado." />
      ) : (
        <>
          <div className="mb-5">
            <Link
              href={doc.caseSummary !== null ? `/cases/${doc.caseSummary.id}?tab=documentos` : '/dashboard'}
              className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${text.faint} hover:text-slate-700 transition-colors`}
            >
              {doc.caseSummary !== null ? '← Voltar ao caso' : '← Início'}
            </Link>
          </div>

          <DashboardPageHeader
            eyebrow="Peça processual"
            title={doc.fileName}
            description={[
              doc.documentClass !== null ? `Classe: ${doc.documentClass}` : null,
              documentStatusLabel(doc.status),
              `Enviado em ${formatDateTime(doc.uploadedAt)}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          />

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => { void viewBlob(`/api/v1/documents/${doc.id}/download`, { organizationId: orgId }) }}
              className="inline-flex items-center gap-1.5 py-1.5 px-3 bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 rounded text-[12px] font-medium transition cursor-pointer"
            >
              👁 Visualizar
            </button>
            <button
              onClick={() => { void downloadBlob(`/api/v1/documents/${doc.id}/download?download=true`, { organizationId: orgId, fileName: doc.fileName }) }}
              className="inline-flex items-center gap-1.5 py-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded text-[12px] font-medium transition cursor-pointer"
            >
              📥 Baixar
            </button>
          </div>

          <div className="mt-6 space-y-4">
            <ProfileSection title="Metadados">
              <dl>
                <FieldRow label="Nome do ficheiro" value={doc.fileName} />
                <FieldRow label="Tipo MIME" value={doc.mimeType} />
                <FieldRow label="Tamanho" value={formatBytes(doc.byteSize)} />
                <FieldRow label="Canal de origem" value={doc.sourceChannel} debug={doc.sourceChannel} />
                <FieldRow label="Sensibilidade" value={doc.sensitivityLevel} debug={doc.sensitivityLevel} />
                {doc.confirmedAt !== null && (
                  <FieldRow label="Confirmado em" value={formatDateTime(doc.confirmedAt)} />
                )}
              </dl>
            </ProfileSection>

            <ProfileSection title="Estado documental">
              <dl>
                <FieldRow
                  label="Status"
                  value={documentStatusLabel(doc.status)}
                  debug={doc.status}
                />
                <FieldRow
                  label="OCR"
                  value={ocrStatusLabel(doc.ocrStatus, doc.status)}
                  debug={doc.ocrStatus}
                />
                <FieldRow label="Atualizado em" value={formatDateTime(doc.updatedAt)} />
              </dl>
            </ProfileSection>

            {(doc.caseSummary !== null || doc.clientSummary !== null) && (
              <ProfileSection title="Associações">
                <dl>
                  {doc.caseSummary !== null && (
                    <FieldRow
                      label="Execução"
                      value={
                        <Link
                          href={`/cases/${doc.caseSummary.id}`}
                          className="underline-offset-2 hover:underline"
                        >
                          Ref. {doc.caseSummary.internalRef}
                        </Link>
                      }
                    />
                  )}
                  {doc.clientSummary !== null && (
                    <FieldRow
                      label="Cliente"
                      value={
                        <Link
                          href={`/clients/${doc.clientSummary.id}`}
                          className="underline-offset-2 hover:underline"
                        >
                          {clientDisplayName(doc.clientSummary)}
                        </Link>
                      }
                    />
                  )}
                </dl>
              </ProfileSection>
            )}

            {doc.extraction !== null ? (
              <ProfileSection title="Extração">
                <dl>
                  <FieldRow
                    label="Status"
                    value={extractionStatusLabel(doc.extraction.status)}
                    debug={doc.extraction.status}
                  />
                  <FieldRow label="Tipo" value={doc.extraction.extractionType} />
                  <FieldRow label="Confiança" value={doc.extraction.confidence} />
                  <FieldRow label="Extraído em" value={formatDateTime(doc.extraction.extractedAt)} />
                </dl>
                {doc.extraction.reviewHistory.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <h3 className={`text-[11px] font-medium uppercase tracking-[0.08em] ${text.faint} mb-2`}>
                      Histórico de revisão
                    </h3>
                    <ul className="space-y-2">
                      {doc.extraction.reviewHistory.map((entry, index) => (
                        <li
                          key={`${entry.reviewedAt}-${index}`}
                          className={`rounded-lg border ${borders.subtle} px-3 py-2 text-[12px]`}
                        >
                          <p className={text.secondary}>
                            {reviewDecisionLabel(entry.decision)} — {formatDateTime(entry.reviewedAt)}
                          </p>
                          <p className={`mt-0.5 ${text.faint}`}>{entry.reason}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </ProfileSection>
            ) : (
              <ProfileSection title="Extração">
                <p className={`text-[13px] ${text.faint}`}>
                  Nenhuma extração registada para este documento.
                </p>
              </ProfileSection>
            )}

            {doc.snapshotPromotion !== null ? (
              <ProfileSection title="Promoção de snapshot">
                <dl>
                  <FieldRow
                    label="Status"
                    value={snapshotPromotionStatusLabel(doc.snapshotPromotion.status)}
                    debug={doc.snapshotPromotion.status}
                  />
                  <FieldRow label="Tipo" value={doc.snapshotPromotion.snapshotKind} />
                  {doc.snapshotPromotion.snapshotId !== null && (
                    <FieldRow
                      label="Snapshot"
                      value={
                        <span className="font-mono text-[12px]">{doc.snapshotPromotion.snapshotId}</span>
                      }
                    />
                  )}
                  {doc.snapshotPromotion.promotedAt !== null && (
                    <FieldRow
                      label="Promovido em"
                      value={formatDateTime(doc.snapshotPromotion.promotedAt)}
                    />
                  )}
                </dl>
              </ProfileSection>
            ) : (
              <ProfileSection title="Promoção de snapshot">
                <p className={`text-[13px] ${text.faint}`}>
                  Nenhuma promoção de snapshot associada.
                </p>
              </ProfileSection>
            )}
          </div>
        </>
      )}
    </div>
  )
}
