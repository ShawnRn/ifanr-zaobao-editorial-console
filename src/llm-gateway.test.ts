import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultIfanrModel, generateFlashNews, generateWeiboPosts, getLLMConfig, legacyIfanrHubBaseUrl, listAvailableModels, openAIReasoningFields, saveLLMConfig, thinkingLevelsForModel } from './llm-gateway'
import type { Story } from './types'

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) || null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
})

describe('ifanr built-in LLM provider', () => {
  beforeEach(() => storage.clear())

  it('is the default provider without browser-side credentials', () => {
    const config = getLLMConfig()
    expect(config.provider).toBe('ifanr')
    expect(config.ifanrModel).toBe(defaultIfanrModel)
    expect(config.openaiKey).toBe('')
  })

  it('loads the real model list from the Worker and stores an independent selection', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ data: [{ id: 'gpt-5.6-sol' }, { id: 'gpt-5.5' }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(listAvailableModels('ifanr')).resolves.toEqual([
      { name: 'gpt-5.5', displayName: 'gpt-5.5' },
      { name: 'gpt-5.6-sol', displayName: 'gpt-5.6-sol' },
    ])
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/llm/openai/v1/models')
    saveLLMConfig({ provider: 'ifanr', ifanrModel: 'gpt-5.5' })
    expect(getLLMConfig().ifanrModel).toBe('gpt-5.5')
  })

  it('moves an existing browser to ifanr once, then respects later choices', () => {
    localStorage.setItem('editorial-llm-provider', 'openai')
    expect(getLLMConfig().provider).toBe('ifanr')
    saveLLMConfig({ provider: 'openai' })
    expect(getLLMConfig().provider).toBe('openai')
  })

  it('migrates the legacy direct Hub setup and removes its browser key', () => {
    localStorage.setItem('editorial-llm-provider', 'openai')
    localStorage.setItem('editorial-openai-base-url', legacyIfanrHubBaseUrl)
    localStorage.setItem('editorial-openai-api-key', 'legacy-browser-key')

    const config = getLLMConfig()

    expect(config.provider).toBe('ifanr')
    expect(config.openaiBaseUrl).toContain('/api/llm/openai/v1')
    expect(config.openaiKey).toBe('')
    expect(localStorage.getItem('editorial-openai-api-key')).toBeNull()
  })

  it('keeps explicit Gemini and OpenAI-compatible choices independent', () => {
    saveLLMConfig({ provider: 'openai', openaiBaseUrl: 'https://api.example.com/v1', openaiKey: 'custom-key' })
    expect(getLLMConfig().provider).toBe('openai')
    expect(getLLMConfig().openaiKey).toBe('custom-key')
    saveLLMConfig({ provider: 'gemini', geminiKey: 'gemini-key' })
    expect(getLLMConfig().provider).toBe('gemini')
  })

  it('matches GPT-5.6 official reasoning efforts and migrates legacy off to none', () => {
    expect(thinkingLevelsForModel('gpt-5.6-sol').map((level) => level.id)).toEqual([
      'none', 'low', 'medium', 'high', 'xhigh', 'max',
    ])
    expect(openAIReasoningFields('gpt-5.6-sol', 'max')).toEqual({ reasoning_effort: 'max' })
    localStorage.setItem('editorial-thinking-level', 'off')
    expect(getLLMConfig().thinkingLevel).toBe('none')
  })

  it('streams reasoning and formal output while generating with the selected effort', async () => {
    saveLLMConfig({ provider: 'ifanr', ifanrModel: 'gpt-5.6-sol', thinkingLevel: 'xhigh' })
    const finalJson = JSON.stringify({
      titles: ['标题一', '标题二', '标题三'], selected_title: '标题一', summary: '摘要', key_points: ['要点'], body: '正式正文',
    })
    const sse = [
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '核对信源。' } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: finalJson.slice(0, 30) } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: finalJson.slice(30) } }] })}\n\n`,
      'data: [DONE]\n\n',
    ].join('')
    const fetchMock = vi.fn(async () => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    const updates: Array<{ content: string; reasoning: string }> = []

    const result = await generateFlashNews({ title: '测试新闻', content: '完整信源正文' }, (update) => updates.push(update))

    expect(result.body).toBe('正式正文')
    expect(updates.at(-1)).toEqual({ content: finalJson, reasoning: '核对信源。', contentDelta: finalJson.slice(30), reasoningDelta: '' })
    const requestPayload = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(requestPayload.stream).toBe(true)
    expect(requestPayload.reasoning_effort).toBe('xhigh')
    expect(requestPayload.temperature).toBeUndefined()
  })

  it('sends the current Weibo draft and optional feedback as a fact-bound revision task', async () => {
    const story = {
      id: 'story-1', category: '大公司', title: '测试新闻', body: '已核验新闻事实。', source_name: '官方', source_url: 'https://example.com', fact_status: 'verified',
    } as Story
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ posts: [{ story_id: story.id, content: '修改后正文', interaction: '', tags: [], suggested_time: '10:00' }] }) } }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await generateWeiboPosts([story], '2026-08-28', {
      currentPost: { content: '原微博正文', interaction: '原互动', tags: ['原话题'], suggested_time: '10:00' },
      instruction: '把开头写得更直接',
    })

    const requestPayload = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    const userPrompt = requestPayload.messages.at(-1).content as string
    expect(userPrompt).toContain('当前微博草稿')
    expect(userPrompt).toContain('原微博正文')
    expect(userPrompt).toContain('把开头写得更直接')
    expect(userPrompt).toContain('不得添加来源材料中没有的事实')
  })
})
