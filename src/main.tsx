import React, { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Editorial Console Uncaught Exception:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: 'var(--canvas, #1a1a1a)',
          color: 'var(--ink, #ffffff)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          textAlign: 'center'
        }}>
          <div style={{
            maxWidth: '520px',
            padding: '32px',
            background: 'var(--panel, #242424)',
            border: '1px solid var(--line, #333333)',
            borderRadius: '12px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.3)'
          }}>
            <h2 style={{ margin: '0 0 12px 0', fontSize: '18px', color: 'var(--amber, #f59e0b)' }}>页面遇到异常</h2>
            <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: 'var(--muted, #9ca3af)', lineHeight: 1.6 }}>
              {this.state.error?.message || '渲染过程中发生未预期的错误。已保护当前本地数据。'}
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  padding: '8px 18px',
                  background: 'var(--brand, #0070f3)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '13px'
                }}
              >
                刷新页面
              </button>
              <button
                type="button"
                onClick={() => {
                  this.setState({ hasError: false, error: null })
                  window.location.hash = ''
                }}
                style={{
                  padding: '8px 18px',
                  background: 'transparent',
                  color: 'var(--ink, #ffffff)',
                  border: '1px solid var(--line, #444444)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '13px'
                }}
              >
                尝试恢复
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
)
