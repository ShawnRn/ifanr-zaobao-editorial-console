import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateBrandHeadlines, hasGeminiKey, saveGeminiKey } from './gemini'
import type { Issue } from './types'

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) || null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
})

const issue = {
  id: 'issue-1', publication_date: '2026-07-22', status: 'editing', revision: 1,
  selected_count: 1, ready_count: 1, review_count: 0, brand_packages: {
    appso: { headline_options: [], selected_headline: '', cover_candidates: [], selected_cover: '' },
    ifanr: { headline_options: [], selected_headline: '', cover_candidates: [], selected_cover: '' },
  },
  stories: [{
    id: 'story-1', issue_id: 'issue-1', fingerprint: 'fp', title: '模型发布', body: '正文',
    category: 'AI/开发者', status: 'ready', selected: true, position: 0, score: 100,
    source_url: '', source_name: '', source_type: '', source_quality: 'primary', confidence: 1,
    cross_day_status: '', rumor: false, fact_status: 'verified', changed_since_review: false,
    image_url: '', image_path: '', image_token: '', editorial_reason: '', metadata: {}, sources: [], claims: [],
  }],
} as unknown as Issue

describe('Gemini headline generation', () => {
  beforeEach(() => storage.clear())

  it('keeps the key in browser storage and sends the request from the page', async () => {
    saveGeminiKey('AIzaSyExampleKey123456789')
    expect(hasGeminiKey()).toBe(true)
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ headline_options: [
        '消息一 / 消息二 / 消息三', '消息四 / 消息五 / 消息六', '消息七 / 消息八 / 消息九',
      ] }) }] } }] }),
      status: 200,
      statusText: 'OK',
      requestInit: init,
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateBrandHeadlines(issue, 'appso')

    expect(result.headline_options).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'x-goog-api-key': 'AIzaSyExampleKey123456789' })
    expect(String(fetchMock.mock.calls[0][0])).toContain('gemini-3.5-flash')
  })
})
