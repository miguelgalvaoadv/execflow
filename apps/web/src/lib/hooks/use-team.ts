/**
 * Equipe — membros, papéis e acessos da organização.
 *
 * GET   /api/v1/orgs/members
 * POST  /api/v1/orgs/members                        (criar acesso / vincular)
 * PATCH /api/v1/orgs/members/:userId                (trocar papel)
 * PATCH /api/v1/orgs/members/:userId/status         (suspender / reativar)
 * POST  /api/v1/orgs/members/:userId/reset-password (nova senha temporária)
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPatch, apiPost, ApiError } from '../api-client'

export type TeamRole = 'admin' | 'lawyer' | 'assistant' | 'client'
export type MembershipStatus = 'active' | 'suspended' | 'invited'

export type TeamMember = {
  id: string
  userId: string
  role: TeamRole
  status: MembershipStatus
  email: string
  displayName: string | null
  joinedAt: string
}

type MembersResponse = { data: TeamMember[] }

const teamKey = (orgId: string) => ['team-members', orgId] as const

export function useTeamMembers(organizationId: string, enabled = true) {
  return useQuery<MembersResponse, ApiError>({
    queryKey: teamKey(organizationId),
    queryFn: ({ signal }) =>
      apiGet<MembersResponse>('/api/v1/orgs/members', { organizationId, signal }),
    staleTime: 15 * 1000,
    enabled: organizationId !== '' && enabled,
  })
}

export type CreateMemberInput = {
  name: string
  email: string
  role: 'admin' | 'lawyer' | 'assistant'
  password?: string
}

export type CreateMemberResult = {
  data: unknown
  created: boolean
  linked: boolean
  /** Senha para repassar — só presente quando o sistema a gerou. */
  password: string | null
}

export function useCreateMember(organizationId: string) {
  const qc = useQueryClient()
  return useMutation<CreateMemberResult, ApiError, CreateMemberInput>({
    mutationFn: (input) => apiPost('/api/v1/orgs/members', input, { organizationId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamKey(organizationId) })
    },
  })
}

export function useUpdateMemberRole(organizationId: string) {
  const qc = useQueryClient()
  return useMutation<unknown, ApiError, { userId: string; role: 'admin' | 'lawyer' | 'assistant' }>({
    mutationFn: ({ userId, role }) =>
      apiPatch(`/api/v1/orgs/members/${userId}`, { role }, { organizationId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamKey(organizationId) })
    },
  })
}

export function useUpdateMemberStatus(organizationId: string) {
  const qc = useQueryClient()
  return useMutation<
    unknown,
    ApiError,
    { userId: string; status: 'active' | 'suspended'; reason?: string }
  >({
    mutationFn: ({ userId, status, reason }) =>
      apiPatch(`/api/v1/orgs/members/${userId}/status`, { status, reason }, { organizationId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamKey(organizationId) })
    },
  })
}

export type ResetPasswordResult = { success: boolean; password: string | null }

export function useResetMemberPassword(organizationId: string) {
  return useMutation<ResetPasswordResult, ApiError, { userId: string; password?: string }>({
    mutationFn: ({ userId, password }) =>
      apiPost(
        `/api/v1/orgs/members/${userId}/reset-password`,
        password !== undefined ? { password } : {},
        { organizationId }
      ),
  })
}
