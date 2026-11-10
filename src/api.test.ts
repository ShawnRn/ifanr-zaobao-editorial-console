import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, apiUrlProblem, describeWorkerError, getApiUrl, normalizeApiUrl, workerFetchOptions } from './api'

afterEach(() => vi.unstubAllGlobals())


describe('Worker URL handling', () => {
  it('uses the VPS HTTPS origin even when an older Worker URL is saved', () => {
    vi.stubGlobal('window', { location: new URL('https://111.228.56.220/') })
    vi.stubGlobal('localStorage', { getItem: () => 'http://111.228.56.220:8765' })
    expect(getApiUrl()).toBe('https://111.228.56.220')
  })

  it('upgrades the old public Worker URL to HTTPS', () => {
    expect(normalizeApiUrl('http://111.228.56.220:8765/')).toBe('https://111.228.56.220')
  })

  it('normalizes a Tailscale Serve URL to its HTTPS root', () => {
    expect(normalizeApiUrl('http://shawn-rains-macbook-pro.tail42e7aa.ts.net:8765')).toBe(
      'https://shawn-rains-macbook-pro.tail42e7aa.ts.net',
    )
  })

  it('adds HTTPS when a Tailscale hostname is pasted without a scheme', () => {
    expect(normalizeApiUrl('shawn-rains-macbook-pro.tail42e7aa.ts.net/')).toBe(
      'https://shawn-rains-macbook-pro.tail42e7aa.ts.net',
    )
  })

  it('explains mixed-content failures on GitHub Pages', () => {
    expect(apiUrlProblem('http://127.0.0.1:8765', 'https:')).toContain('无法连接 HTTP Worker')
  })

  it('rejects a raw Tailscale IP because it cannot match the HTTPS certificate', () => {
    expect(apiUrlProblem('https://100.103.86.124', 'https:')).toContain('.ts.net')
  })

  it('keeps HTTPS Tailscale Serve requests outside Chrome local-network permission flow', () => {
    expect(workerFetchOptions('https://shawn-rains-macbook-pro.tail42e7aa.ts.net')).toEqual({})
    expect(workerFetchOptions('http://127.0.0.1:8765')).toEqual({})
  })

  it('suggests checking the Worker address on fetch failures', () => {
    expect(describeWorkerError(new TypeError('Failed to fetch'))).toContain('请检查 Worker 地址')
  })

  it('turns an HTML Pages fallback into a useful connection error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!doctype html><title>Vite</title>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })))

    await expect(api.staticIssue()).rejects.toThrow('Pages 快照返回了网页而不是 JSON')
  })
})
