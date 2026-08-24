import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultGeminiModel, generateBrandHeadlines, getGeminiModel, hasGeminiKey, listGeminiModels, normalizeGeneratedHeadline, saveGeminiKey, saveGeminiModel, validateGeneratedHeadline } from './gemini'
import type { Issue } from './types'

const storage = new Map<string, string>()
const validOptions = [
  '苹果摄像头AirPods延期至2027年 / 豆包进入特斯拉车机并支持语音唤醒 / 宇树科技上市首日股价大涨460%',
  'OpenAI为Codex补上防误删保护 / 豆包云电脑可在关闭本机后继续跑任务 / 苹果摄像头AirPods计划2027年推出',
  '特斯拉中国车机正式接入豆包大模型 / OpenAI承认模型失配并放慢训练 / 《GTA6》疑似开发画面和地图外泄',
  '宇树人形机器人演示百米冲刺极速 / 苹果或将为系统重新设计Siri入口 / 特斯拉中国车机全面增加豆包语音交互',
  '《黑神话：钟馗》释出首段实机演示 / OpenAI为Codex增加防误删保护 / 豆包云电脑关机后仍可跑任务',
  'Apple Watch旧表带面临兼容性变化 / 《GTA6》疑似开发画面外泄 / 特斯拉中国车机接入新语音助手',
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

  it('keeps three complete news hooks within the editorial structure gate', () => {
    expect(validateGeneratedHeadline(validOptions[0])).toBe(validOptions[0])
    expect(validateGeneratedHeadline('宇树超人机器人可原地跳高两米并刷新百米冲刺纪录创造行业全新历史 / 苹果新机确认明年春季发布 / 豆包云电脑支持关机后运行'))
      .toContain('创造行业全新历史')
    expect(() => validateGeneratedHeadline('宇树超人机器人可原地跳高两米并刷新百米冲刺纪录创造行业全新历史纪录 / 苹果新机确认明年春季发布 / 豆包云电脑支持关机后运行'))
      .toThrow('标题Skill结构校验失败')
    expect(() => validateGeneratedHeadline('消息一 / 消息二 / 消息三')).toThrow('标题Skill结构校验失败')
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

    expect(result.headline_options).toHaveLength(6)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'x-goog-api-key': 'AIzaSyExampleKey123456789' })
    expect(String(fetchMock.mock.calls[0][0])).toContain('gemini-3.7-flash')
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
