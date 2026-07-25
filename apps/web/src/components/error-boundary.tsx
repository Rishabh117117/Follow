'use client'

import { Component, type ReactNode, type ErrorInfo } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo })
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Caught:', error, errorInfo)
  }

  handleReload = (): void => {
    window.location.reload()
  }

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }

    if (this.props.fallback) {
      return this.props.fallback
    }

    const isDev = process.env.NODE_ENV !== 'production'
    const { error, errorInfo } = this.state

    return (
      <div
        className="flex min-h-screen items-center justify-center px-4"
        style={{ backgroundColor: 'var(--n100)' }}
      >
        <div className="w-full max-w-[500px]">
          {/* Brand */}
          <div className="mb-8 flex items-center justify-center gap-2.5">
            <div
              className="flex h-5 w-5 items-center justify-center rounded-[3px]"
              style={{ backgroundColor: 'var(--n950)' }}
            >
              <span className="text-[11px] font-bold leading-none text-white">F</span>
            </div>
            <span
              className="text-[22px] leading-none"
              style={{
                fontFamily: 'Newsreader, Georgia, serif',
                color: 'var(--n950)',
                fontWeight: 500,
              }}
            >
              Follow
            </span>
          </div>

          <div
            className="rounded-xl border bg-white p-8 text-center shadow-sm"
            style={{ borderColor: 'var(--n200)' }}
          >
            <h1
              className="mb-2 text-[22px] leading-tight"
              style={{
                fontFamily: 'Newsreader, Georgia, serif',
                color: 'var(--n950)',
                fontWeight: 500,
              }}
            >
              Something went wrong
            </h1>
            <p
              className="mb-6 text-[13px]"
              style={{ color: 'var(--n500)' }}
            >
              An unexpected error occurred. Reloading usually fixes it.
            </p>

            <button
              onClick={this.handleReload}
              className="rounded-lg px-5 py-2.5 text-[13px] font-medium text-white transition-colors"
              style={{ backgroundColor: 'var(--n950)' }}
            >
              Reload page
            </button>

            {isDev && error && (
              <details
                className="mt-6 text-left"
                style={{ color: 'var(--n700)' }}
              >
                <summary
                  className="cursor-pointer text-[11px] font-medium"
                  style={{ color: 'var(--n500)' }}
                >
                  Error details
                </summary>
                <pre
                  className="mt-3 max-h-64 overflow-auto rounded-md border p-3 text-[10px] leading-snug"
                  style={{
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    backgroundColor: 'var(--n50)',
                    borderColor: 'var(--n200)',
                    color: 'var(--n800)',
                  }}
                >
                  {error.message}
                  {'\n\n'}
                  {error.stack}
                  {errorInfo?.componentStack && (
                    <>
                      {'\n\n'}
                      {errorInfo.componentStack}
                    </>
                  )}
                </pre>
              </details>
            )}
          </div>
        </div>
      </div>
    )
  }
}
