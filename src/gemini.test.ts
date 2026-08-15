import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateBrandHeadlines, getGeminiModel, hasGeminiKey, listGeminiModels, normalizeGeneratedHeadline, saveGeminiKey, saveGeminiModel, validateGeneratedHeadline } from './gemini'
import type { Issue } from './types'

const storage = new Map<string, string>()
const validOptions = [
  '朋友圈编辑被微信否决 / 曝苹果联手阿里训练中国AI / 曝谷歌AI十亿用户后仍裁员',
  '曝苹果联手阿里训练中国AI / 曝谷歌AI十亿用户后仍裁员 / 朋友圈编辑被微信否决',
  '曝谷歌AI十亿用户后仍裁员 / 朋友圈编辑被微信否决 / 曝苹果联手阿里训练中国AI',
]
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

  it('normalizes compact mixed-script boundaries and half-width punctuation', () => {
    expect(normalizeGeneratedHeadline('GPT-5.6 快了 14 倍:长回答不用等 / iPhone 涨价,用户受影响 / Apple Watch 旧表带或淘汰'))
      .toBe('GPT-5.6快了14倍:长回答不用等 / iPhone涨价,用户受影响 / Apple Watch旧表带或淘汰')
  })

  it('enforces the 35-38 character title skill gate', () => {
    expect(validateGeneratedHeadline(validOptions[0])).toBe(validOptions[0])
    expect(() => validateGeneratedHeadline('消息一 / 消息二 / 消息三')).toThrow('标题Skill长度校验失败')
  })

  it('keeps the key in browser storage and sends the request from the page', async () => {
    saveGeminiKey('AIzaSyExampleKey123456789')
    expect(hasGeminiKey()).toBe(true)
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ headline_options: validOptions }) }] } }] }),
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

  it('lists generate-capable models and uses a manually selected model', async () => {
    saveGeminiKey('AIzaSyExampleKey123456789')
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.endsWith('/models')
        ? { models: [
          { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
        ] }
        : { candidates: [{ content: { parts: [{ text: JSON.stringify({ headline_options: validOptions }) }] } }] },
      status: 200,
      statusText: 'OK',
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listGeminiModels()).resolves.toEqual([{ name: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' }])
    saveGeminiModel('models/gemini-2.5-flash')
    expect(getGeminiModel()).toBe('gemini-2.5-flash')
    await generateBrandHeadlines(issue, 'ifanr')
    expect(String(fetchMock.mock.calls[1][0])).toContain('gemini-2.5-flash')
  })
})
