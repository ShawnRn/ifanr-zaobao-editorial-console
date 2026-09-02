import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, apiUrlProblem, describeWorkerError, normalizeApiUrl, workerFetchOptions } from './api'

afterEach(() => vi.unstubAllGlobals())


describe('Worker URL handling', () => {
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

  it('explains browser local-network blocking', () => {
    expect(describeWorkerError(new TypeError('Failed to fetch'))).toContain('本地网络')
  })

  it('turns an HTML Pages fallback into a useful connection error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!doctype html><title>Vite</title>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })))

    await expect(api.staticIssue()).rejects.toThrow('Pages 快照返回了网页而不是 JSON')
  })
})
