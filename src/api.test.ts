import { describe, expect, it } from 'vitest'
import { apiUrlProblem, normalizeApiUrl } from './api'


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
})
