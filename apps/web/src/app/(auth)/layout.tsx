/**
 * Auth layout — unauthenticated shell for sign-in and related pages.
 *
 * Centered, minimal. No sidebar, no org context, no session data.
 */

import { surfaces } from '@/components/dashboard/surfaces'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`min-h-screen ${surfaces.canvas} flex items-center justify-center px-4 py-12`}
    >
      {children}
    </div>
  )
}
