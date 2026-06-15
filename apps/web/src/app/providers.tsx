'use client'

/**
 * Root client-side providers.
 *
 * Wraps the application in:
 * - TanStack QueryClient (server state, API data)
 * - ReactQueryDevtools (development only)
 *
 * QueryClient defaults:
 * - staleTime: 0 (always re-fetch on mount unless overridden per-query)
 * - retry: 1 for network errors; 0 for 4xx (auth/permission errors don't retry)
 * - refetchOnWindowFocus: true (live operational data)
 *
 * No business logic lives here.
 */

import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { ApiError } from '@/lib/api-client'

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 0,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
            return false
          }
          return failureCount < 1
        },
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}
