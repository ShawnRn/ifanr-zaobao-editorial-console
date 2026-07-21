import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'

vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: false,
  statusText: 'offline',
  json: async () => ({ detail: 'offline' }),
})))
vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
})

describe('App', () => {
  it('renders the operational shell while the worker is offline', async () => {
    render(<App />)
    expect(screen.getByText('早报编辑台')).toBeInTheDocument()
    expect(screen.getByText('双品牌')).toBeInTheDocument()
    expect((await screen.findAllByText('Worker 未连接')).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: '连接设置' }).length).toBeGreaterThan(0)
  })
})
