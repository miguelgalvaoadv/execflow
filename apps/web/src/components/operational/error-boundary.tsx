'use client'

/**
 * Operational error boundary — catches render errors and API failures.
 */

import { Component, type ReactNode } from 'react'
import { ErrorState } from '@/components/ui/ErrorState'

export { ErrorState, ErrorState as OperationalErrorState } from '@/components/ui/ErrorState'
export type { ErrorStateVariant } from '@/components/ui/ErrorState'

type Props = {
  children: ReactNode
  fallback?: ReactNode
}

type State = {
  hasError: boolean
  errorMessage: string | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, errorMessage: null }
  }

  static getDerivedStateFromError(error: unknown): State {
    const message =
      error instanceof Error ? error.message : 'Erro inesperado.'
    return { hasError: true, errorMessage: message }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) return this.props.fallback
      return (
        <ErrorState
          message={this.state.errorMessage ?? 'Erro inesperado.'}
          onRetry={() => this.setState({ hasError: false, errorMessage: null })}
        />
      )
    }
    return this.props.children
  }
}
