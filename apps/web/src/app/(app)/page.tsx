/**
 * App root — redirects to the operational dashboard (Início).
 */

import { redirect } from 'next/navigation'

export default function AppRootPage() {
  redirect('/dashboard')
}