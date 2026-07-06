/**
 * Authenticated app layout — wraps all operational routes.
 *
 * Renders the dashboard shell (sidebar + main panel).
 * Session presence is enforced by middleware.ts before reaching here.
 * Session data (user, role, org) is loaded client-side per-page via useSession().
 */

import { DashboardLayout } from '@/components/dashboard'
import { ClientRoleGuard } from '@/components/dashboard/ClientRoleGuard'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClientRoleGuard>
      <DashboardLayout>{children}</DashboardLayout>
    </ClientRoleGuard>
  )
}
