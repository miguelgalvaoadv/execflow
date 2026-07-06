/**
 * Session hook — fetches the authenticated user's session from /api/v1/me.
 *
 * Returns: user identity, active organization, and role within that org.
 * Used by: shell nav (user badge), org-scoped API calls, role-gated UI.
 *
 * Stale time: 2 minutes (sessions rarely change mid-use).
 * On 401: returns null (caller should redirect to /sign-in via middleware).
 */

import { useQuery } from '@tanstack/react-query'
import { apiGet, ApiError } from '../api-client'
import { queryKeys } from '../query-keys'

export type SessionUser = {
  id: string
  name: string
  email: string
}

export type SessionOrg = {
  id: string
  name: string
  slug: string
}

export type UserRole = 'admin' | 'lawyer' | 'assistant' | 'client'

export type SessionData = {
  user: SessionUser
  role: UserRole
  organization: SessionOrg
}

type MeResponse = {
  user: SessionUser
  role: UserRole
  organization: SessionOrg
}

export function useSession() {
  return useQuery<SessionData | null, ApiError>({
    queryKey: queryKeys.session(),
    queryFn: async ({ signal }) => {
      try {
        const res = await apiGet<MeResponse>('/api/v1/me', { signal })
        return res
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          return null
        }
        throw err
      }
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        return false
      }
      return failureCount < 2
    },
  })
}
