/**
 * Client read service — client profile with LGPD field filtering.
 */

import {
  findClientById,
  listClients as listClientsRepo,
  type ClientListItem,
  type ListClientsFilters,
} from '../repositories/client.ts'
import type { Client } from '@execflow/db/schema'
import {
  ok,
  validationError,
  notFoundError,
  fromRepositoryError,
} from './result.ts'
import {
  canViewCases,
  canAccessSensitiveData,
  resolveMembershipRole,
} from '../lib/permissions.ts'
import type { ReadContext } from '../lib/read-context.ts'
import type { ServiceResult } from './result.ts'

export type ClientListItemResponse = {
  id: string
  fullName: string
  displayName: string | null
  internalRef: string | null
  status: string
  responsibleLawyerUserId: string | null
  updatedAt: string
}

export type PaginatedClientsResponse = {
  items: ClientListItemResponse[]
  nextCursor: string | null
}

function toClientListItemResponse(item: ClientListItem): ClientListItemResponse {
  return {
    id: item.id,
    fullName: item.fullName,
    displayName: item.displayName,
    internalRef: item.internalRef,
    status: item.status,
    responsibleLawyerUserId: item.responsibleLawyerUserId,
    updatedAt: item.updatedAt.toISOString(),
  }
}

export type ClientReadView = {
  id: string
  organizationId: string
  fullName: string
  displayName: string | null
  aliases: string[]
  internalRef: string | null
  responsibleLawyerUserId: string | null
  notes: string | null
  status: string
  createdAt: string
  updatedAt: string
  cpf?: string | null
  rg?: string | null
  matricula?: string | null
  birthDate?: string | null
  contactChannels?: Array<{ type: string; value: string; notes?: string }>
}

function toClientReadView(row: Client, includeSensitive: boolean): ClientReadView {
  const base: ClientReadView = {
    id: row.id,
    organizationId: row.organizationId,
    fullName: row.fullName,
    displayName: row.displayName,
    aliases: (row.aliases as string[]) ?? [],
    internalRef: row.internalRef,
    responsibleLawyerUserId: row.responsibleLawyerUserId,
    notes: row.notes,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }

  if (includeSensitive) {
    base.cpf = row.cpf
    base.rg = row.rg
    base.matricula = row.matricula
    base.birthDate = row.birthDate
    base.contactChannels = (row.contactChannels as ClientReadView['contactChannels']) ?? []
  }

  return base
}

export async function listClients(
  ctx: ReadContext,
  filters: ListClientsFilters,
  params: { limit: number; cursor?: string | undefined }
): Promise<ServiceResult<PaginatedClientsResponse>> {
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !canViewCases(role)) {
    return validationError('Insufficient permissions to view clients.')
  }

  const result = await listClientsRepo(ctx.db, ctx.organizationId, filters, {
    limit: params.limit,
    ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
  })

  if (!result.success) {
    if (result.error.code === 'CONSTRAINT') {
      return validationError(result.error.message)
    }
    return fromRepositoryError(result.error.code, result.error.message, result.error.cause)
  }

  return ok({
    items: result.data.items.map(toClientListItemResponse),
    nextCursor: result.data.nextCursor,
  })
}

export async function getClientDetail(
  ctx: ReadContext,
  clientId: string
): Promise<ServiceResult<ClientReadView>> {
  const role = resolveMembershipRole(ctx.actor.actorRole)
  if (role === null || !canViewCases(role)) {
    return validationError('Insufficient permissions to view clients.')
  }

  const result = await findClientById(ctx.db, ctx.organizationId, clientId)
  if (!result.success) {
    if (result.error.code === 'NOT_FOUND') {
      return notFoundError('Client not found.')
    }
    return fromRepositoryError(result.error.code, result.error.message, result.error.cause)
  }

  const includeSensitive = canAccessSensitiveData(role)
  return ok(toClientReadView(result.data, includeSensitive))
}
