import flashNewsPrompt from '../prompts/flash_news.md?raw'
import appsoPrompt from '../prompts/appso_headline.md?raw'
import ifanrPrompt from '../prompts/ifanr_headline.md?raw'
import weiboPostsPrompt from '../prompts/weibo_posts.md?raw'
import { getApiUrl, getAuthToken, workerFetchOptions } from './api'
import type { Issue, Story } from './types'

export type LLMProvider = 'ifanr' | 'gemini' | 'openai'
export type ThinkingLevel = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type ThinkingLevelInfo = {
  id: ThinkingLevel
  label: string
  shortLabel: string
  budget: number
  desc: string
}

export const THINKING_LEVEL_MAP: Record<ThinkingLevel, ThinkingLevelInfo> = {
  none: { id: 'none', label: 'None（关闭）', shortLabel: 'None', budget: 0, desc: '不使用推理 · 最低延迟' },
  low: { id: 'low', label: 'Low（轻度）', shortLabel: 'Low', budget: 1024, desc: '较少推理 · 响应更快' },
  medium: { id: 'medium', label: 'Medium（中）', shortLabel: 'Medium', budget: 2048, desc: '平衡质量与速度（默认）' },
  high: { id: 'high', label: 'High（高）', shortLabel: 'High', budget: 4096, desc: '更充分的分析与核验' },
  xhigh: { id: 'xhigh', label: 'Extra High（极高）', shortLabel: 'XHigh', budget: 8192, desc: '复杂任务 · 更高延迟' },
  max: { id: 'max', label: 'Max（Ultra）', shortLabel: 'Max', budget: 16384, desc: '最难任务 · 质量优先' },
}

export const THINKING_LEVELS: ThinkingLevelInfo[] = [
  THINKING_LEVEL_MAP.none,
  THINKING_LEVEL_MAP.low,
  THINKING_LEVEL_MAP.medium,
  THINKING_LEVEL_MAP.high,
  THINKING_LEVEL_MAP.xhigh,
  THINKING_LEVEL_MAP.max,
]

const CORE_REASONING_LEVELS: ThinkingLevel[] = ['none', 'low', 'medium', 'high', 'xhigh']
const GPT_56_REASONING_LEVELS: ThinkingLevel[] = [...CORE_REASONING_LEVELS, 'max']
const CODEX_REASONING_LEVELS: ThinkingLevel[] = ['low', 'medium', 'high', 'xhigh']

export function thinkingLevelsForModel(modelName: string): ThinkingLevelInfo[] {
  const lower = modelName.trim().toLowerCase()
  let levels: ThinkingLevel[] = []
  if (/^gpt-5\.6(?:-|$)/.test(lower) || lower === 'gpt-5.6') levels = GPT_56_REASONING_LEVELS
  else if (/^gpt-5\.(?:4|5)(?:-|$)/.test(lower)) levels = CORE_REASONING_LEVELS
  else if (/^gpt-5\.3-codex/.test(lower)) levels = CODEX_REASONING_LEVELS
  else if (/^(?:o1|o3)(?:-|$)/.test(lower) || lower.includes('r1') || lower.includes('reasoning')) levels = ['low', 'medium', 'high']
  else if (lower.includes('gemini') || lower.includes('flash') || lower.includes('thinking') || lower.includes('claude')) levels = THINKING_LEVELS.map((level) => level.id)
  return levels.map((level) => THINKING_LEVEL_MAP[level])
}

export function normalizedThinkingLevel(modelName: string, requested: ThinkingLevel): ThinkingLevel | null {
  const supported = thinkingLevelsForModel(modelName).map((level) => level.id)
  if (!supported.length) return null
  if (supported.includes(requested)) return requested
  return supported.includes('medium') ? 'medium' : supported[0]
}

export function openAIReasoningFields(modelName: string, requested: ThinkingLevel): Record<string, string> {
  const effort = normalizedThinkingLevel(modelName, requested)
  return effort ? { reasoning_effort: effort } : {}
}

export type LLMConfig = {
  provider: LLMProvider
  ifanrModel: string
  geminiKey: string
  geminiModel: string
  openaiBaseUrl: string
  openaiKey: string
  openaiModel: string
  thinkingLevel: ThinkingLevel
}

export type LLMModelOption = {
  name: string
  displayName: string
}

export type FlashNewsInput = {
  title?: string
  content: string
  url?: string
  category?: string
  date?: string
}

export type FlashNewsResult = {
  titles: string[]
  selected_title: string
  summary: string
  key_points: string[]
  body: string
  model: string
  provider: LLMProvider
}

export type WeiboPostResult = {
  story_id: string
  content: string
  interaction: string
  tags: string[]
  suggested_time: string
}

export type WeiboRevisionOptions = {
  currentPost: Pick<WeiboPostResult, 'content' | 'interaction' | 'tags' | 'suggested_time'>
  instruction?: string
}

const STORAGE_KEYS = {
  provider: 'editorial-llm-provider',
  geminiKey: 'editorial-gemini-api-key',
  geminiModel: 'editorial-gemini-model',
  openaiBaseUrl: 'editorial-openai-base-url',
  openaiKey: 'editorial-openai-api-key',
  openaiModel: 'editorial-openai-model',
  thinkingLevel: 'editorial-thinking-level',
  ifanrModel: 'editorial-ifanr-model',
} as const
const IFANR_DEFAULT_MIGRATION_KEY = 'editorial-ifanr-provider-default-v1'

export const defaultGeminiModel = 'gemini-3.7-flash-high'
export const defaultOpenaiModel = '3.7-flash-high'
export const defaultIfanrModel = 'gpt-5.6-sol'
export const defaultOpenaiBaseUrl = 'https://api.openai.com/v1'
export const legacyIfanrHubBaseUrl = 'https://llm-gateway.corp.ifanr.com/translate/openai/openai/v1'
export const workerOpenAIBaseUrl = () => `${getApiUrl().replace(/\/+$/, '')}/api/llm/openai/v1`

const isWorkerOpenAIBaseUrl = (value: string) => value.replace(/\/+$/, '') === workerOpenAIBaseUrl()

async function openAIFetch(baseUrl: string, path: string, init: RequestInit = {}) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  if (!isWorkerOpenAIBaseUrl(normalizedBaseUrl)) {
    return fetch(`${normalizedBaseUrl}/${path.replace(/^\/+/, '')}`, init)
  }
  const headers = new Headers(init.headers)
  const token = getAuthToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  else headers.delete('Authorization')
  const workerUrl = getApiUrl()
  return fetch(`${normalizedBaseUrl}/${path.replace(/^\/+/, '')}`, {
    ...workerFetchOptions(workerUrl),
    ...init,
    credentials: 'include',
    headers,
  })
}

export type LLMStreamUpdate = {
  content: string
  reasoning: string
  contentDelta: string
  reasoningDelta: string
}

type StreamListener = (update: LLMStreamUpdate) => void

function deltaText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.map((part) => typeof part === 'string' ? part : String((part as { text?: unknown })?.text || '')).join('')
}

async function readOpenAITextResponse(response: Response, onStream?: StreamListener): Promise<{ content: string; reasoning: string }> {
  const contentType = response.headers.get('Content-Type') || ''
  if (!contentType.includes('text/event-stream') || !response.body) {
    const payload = await response.json()
    const message = payload?.choices?.[0]?.message || {}
    const content = deltaText(message.content)
    const reasoning = deltaText(message.reasoning_content || message.reasoning || message.reasoning_summary)
    if (content || reasoning) onStream?.({ content, reasoning, contentDelta: content, reasoningDelta: reasoning })
    return { content, reasoning }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  const consumeLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const raw = trimmed.slice(5).trim()
    if (!raw || raw === '[DONE]') return
    let payload: any
    try { payload = JSON.parse(raw) } catch { return }
    const delta = payload?.choices?.[0]?.delta || {}
    const contentDelta = deltaText(delta.content)
    const reasoningDelta = deltaText(delta.reasoning_content || delta.reasoning || delta.reasoning_summary)
    if (!contentDelta && !reasoningDelta) return
    content += contentDelta
    reasoning += reasoningDelta
    onStream?.({ content, reasoning, contentDelta, reasoningDelta })
  }

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''
    lines.forEach(consumeLine)
    if (done) break
  }
  if (buffer) consumeLine(buffer)
  return { content, reasoning }
}

const resolveOpenAIConfig = (config: LLMConfig, modelOverride?: string) => config.provider === 'ifanr'
  ? { baseUrl: workerOpenAIBaseUrl(), apiKey: '', modelName: modelOverride || config.ifanrModel || defaultIfanrModel }
  : {
      baseUrl: config.openaiBaseUrl || defaultOpenaiBaseUrl,
      apiKey: config.openaiKey,
      modelName: modelOverride || config.openaiModel || defaultOpenaiModel,
    }

export function getLLMConfig(): LLMConfig {
  let provider = (localStorage.getItem(STORAGE_KEYS.provider) as LLMProvider) || 'ifanr'
  const ifanrModel = localStorage.getItem(STORAGE_KEYS.ifanrModel)?.trim() || defaultIfanrModel
  if (!localStorage.getItem(IFANR_DEFAULT_MIGRATION_KEY)) {
    provider = 'ifanr'
    localStorage.setItem(STORAGE_KEYS.provider, provider)
    localStorage.setItem(IFANR_DEFAULT_MIGRATION_KEY, '1')
  }
  const geminiKey = localStorage.getItem(STORAGE_KEYS.geminiKey)?.trim() || ''
  const geminiModel = localStorage.getItem(STORAGE_KEYS.geminiModel)?.trim() || defaultGeminiModel
  let openaiBaseUrl = localStorage.getItem(STORAGE_KEYS.openaiBaseUrl)?.trim() || defaultOpenaiBaseUrl
  let openaiKey = localStorage.getItem(STORAGE_KEYS.openaiKey)?.trim() || ''
  if (openaiBaseUrl.replace(/\/+$/, '') === legacyIfanrHubBaseUrl) {
    provider = 'ifanr'
    openaiBaseUrl = workerOpenAIBaseUrl()
    openaiKey = ''
    localStorage.setItem(STORAGE_KEYS.provider, provider)
    localStorage.setItem(STORAGE_KEYS.openaiBaseUrl, openaiBaseUrl)
    localStorage.removeItem(STORAGE_KEYS.openaiKey)
  } else if (isWorkerOpenAIBaseUrl(openaiBaseUrl) && openaiKey) {
    openaiKey = ''
    localStorage.removeItem(STORAGE_KEYS.openaiKey)
  }
  const openaiModel = localStorage.getItem(STORAGE_KEYS.openaiModel)?.trim() || defaultOpenaiModel
  const storedThinking = localStorage.getItem(STORAGE_KEYS.thinkingLevel)
  const rawThinking = (storedThinking === 'off' ? 'none' : storedThinking) as ThinkingLevel
  const thinkingLevel: ThinkingLevel = rawThinking && rawThinking in THINKING_LEVEL_MAP ? rawThinking : 'medium'

  return {
    provider,
    ifanrModel,
    geminiKey,
    geminiModel,
    openaiBaseUrl,
    openaiKey,
    openaiModel,
    thinkingLevel,
  }
}

export function saveLLMConfig(patch: Partial<LLMConfig>): void {
  if (patch.provider !== undefined) {
    localStorage.setItem(STORAGE_KEYS.provider, patch.provider)
    localStorage.setItem(IFANR_DEFAULT_MIGRATION_KEY, '1')
  }
  if (patch.ifanrModel !== undefined) {
    const model = patch.ifanrModel.trim()
    if (model) localStorage.setItem(STORAGE_KEYS.ifanrModel, model)
  }
  if (patch.geminiKey !== undefined) {
    localStorage.setItem(STORAGE_KEYS.geminiKey, patch.geminiKey.trim())
  }
  if (patch.geminiModel !== undefined) {
    const model = patch.geminiModel.trim().replace(/^models\//, '')
    if (model) localStorage.setItem(STORAGE_KEYS.geminiModel, model)
  }
  if (patch.openaiBaseUrl !== undefined) {
    const raw = patch.openaiBaseUrl.trim().replace(/\/+$/, '')
    localStorage.setItem(STORAGE_KEYS.openaiBaseUrl, raw || defaultOpenaiBaseUrl)
    if (raw && isWorkerOpenAIBaseUrl(raw)) localStorage.removeItem(STORAGE_KEYS.openaiKey)
  }
  if (patch.openaiKey !== undefined) {
    const baseUrl = patch.openaiBaseUrl?.trim().replace(/\/+$/, '') || getLLMConfig().openaiBaseUrl
    if (isWorkerOpenAIBaseUrl(baseUrl)) localStorage.removeItem(STORAGE_KEYS.openaiKey)
    else localStorage.setItem(STORAGE_KEYS.openaiKey, patch.openaiKey.trim())
  }
  if (patch.openaiModel !== undefined) {
    const model = patch.openaiModel.trim()
    if (model) localStorage.setItem(STORAGE_KEYS.openaiModel, model)
  }
  if (patch.thinkingLevel !== undefined) {
    localStorage.setItem(STORAGE_KEYS.thinkingLevel, patch.thinkingLevel)
  }
}

export function isLLMConfigured(): boolean {
  const config = getLLMConfig()
  if (config.provider === 'ifanr') return true
  if (config.provider === 'gemini') {
    return Boolean(config.geminiKey)
  }
  return Boolean(config.openaiKey || config.openaiBaseUrl.includes('localhost') || config.openaiBaseUrl.includes('127.0.0.1'))
}

export async function listGeminiModels(apiKeyInput?: string): Promise<LLMModelOption[]> {
  const config = getLLMConfig()
  const apiKey = apiKeyInput?.trim() || config.geminiKey
  if (!apiKey) throw new Error('请先填写 Gemini API Key')
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
    headers: { 'x-goog-api-key': apiKey },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: { message: response.statusText } }))
    throw new Error(payload?.error?.message || `无法读取 Gemini 模型列表（${response.status}）`)
  }
  const payload = await response.json() as { models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }> }
  return (payload.models || [])
    .filter((model) => model.name && model.supportedGenerationMethods?.includes('generateContent'))
    .map((model) => ({ name: model.name!.replace(/^models\//, ''), displayName: model.displayName || model.name!.replace(/^models\//, '') }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export async function listOpenAIModels(baseUrlInput?: string, apiKeyInput?: string): Promise<LLMModelOption[]> {
  const config = getLLMConfig()
  const baseUrl = (baseUrlInput || config.openaiBaseUrl || defaultOpenaiBaseUrl).trim().replace(/\/+$/, '')
  const apiKey = apiKeyInput !== undefined ? apiKeyInput.trim() : config.openaiKey.trim()
  const headers: Record<string, string> = {}
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const response = await openAIFetch(baseUrl, 'models', { headers })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: { message: response.statusText } }))
    throw new Error(payload?.error?.message || `无法读取模型列表（${response.status}）`)
  }
  const data = await response.json()
  const rawList: Array<{ id?: string; name?: string }> = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []
  const list: LLMModelOption[] = rawList
    .map((item: { id?: string; name?: string }): LLMModelOption => {
      const id = item.id || item.name || ''
      return { name: id, displayName: id }
    })
    .filter((item: LLMModelOption) => Boolean(item.name))
    .sort((a: LLMModelOption, b: LLMModelOption) => a.name.localeCompare(b.name))
  return list
}

export async function listAvailableModels(provider: LLMProvider): Promise<LLMModelOption[]> {
  if (provider === 'gemini') {
    return listGeminiModels()
  } else if (provider === 'ifanr') {
    return listOpenAIModels(workerOpenAIBaseUrl(), '')
  } else {
    return listOpenAIModels()
  }
}

export async function testLLMConnection(configInput?: Partial<LLMConfig>): Promise<{ ok: boolean; message: string; latencyMs: number }> {
  const current = getLLMConfig()
  const config = { ...current, ...configInput }
  const start = performance.now()

  if (config.provider === 'gemini') {
    const key = config.geminiKey.trim()
    if (!key) throw new Error('请输入 Gemini API Key')
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': key },
    })
    const latencyMs = Math.round(performance.now() - start)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error?.message || `连接失败（HTTP ${res.status}）`)
    }
    return { ok: true, message: `连接成功！已连通 Google Gemini API（延迟 ${latencyMs}ms）`, latencyMs }
  } else {
    const { baseUrl, apiKey } = resolveOpenAIConfig(config)
    const headers: Record<string, string> = {}
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey.trim()}`
    const res = await openAIFetch(baseUrl, 'models', { headers })
    const latencyMs = Math.round(performance.now() - start)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error?.message || `连接失败（HTTP ${res.status}）`)
    }
    return { ok: true, message: config.provider === 'ifanr'
      ? `连接成功！已连通 ifanr 内置引擎（延迟 ${latencyMs}ms）`
      : `连接成功！已连通 OpenAI 兼容端点（延迟 ${latencyMs}ms）`, latencyMs }
  }
}

const headlinePunctuation: Record<string, string> = {
  '，': ',', '。': '.', '、': ',', '：': ':', '；': ';', '！': '!', '？': '?',
  '（': '(', '）': ')', '［': '[', '］': ']', '％': '%', '＋': '+', '＝': '=', '／': '/', '—': '-',
}

export function normalizeGeneratedHeadline(value: string) {
  const halfWidth = value.replace(/[，。、：；！？（）［］％＋＝／—]/g, (character) => headlinePunctuation[character] || character)
  return halfWidth.split(/\s*\/\s*/).map((segment) => segment
    .replace(/\s+([,:;.!?%+)=\]}>-])/g, '$1')
    .replace(/([(\[<{])\s+/g, '$1')
    .replace(/([\u3400-\u9fff])\s+([A-Za-z0-9@#%+&])/g, '$1$2')
    .replace(/([A-Za-z0-9@#%+&])\s+([\u3400-\u9fff])/g, '$1$2')
    .trim()).filter(Boolean).join(' / ')
}

export function validateGeneratedHeadline(value: string) {
  const normalized = normalizeGeneratedHeadline(value)
  const segments = normalized.split(' / ')
  const total = normalized.replace(/\s/g, '').length
  const segmentLengths = segments.map((segment) => segment.replace(/\s/g, '').length)
  if (segments.length !== 3 || total < 44 || total > 84 || segmentLengths.some((length) => length < 12 || length > 32)) {
    throw new Error(`标题Skill结构校验失败:${total}字/${segmentLengths.join('-')}`)
  }
  return normalized
}

// 统一的 JSON 提取与清理
function cleanJsonOutput(text: string): string {
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  }

  // 尝试在混杂文本中寻找最外层的 JSON 结构 { ... }
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1)
  }

  // 如果大模型返回了纯文本拒绝或解释（如无法访问链接）
  if (cleaned.includes('无法') || cleaned.includes('抱歉') || cleaned.includes('sorry') || cleaned.includes('cannot')) {
    const preview = cleaned.slice(0, 150).replace(/\n+/g, ' ')
    throw new Error(`模型回复了纯文本（“${preview}…”）。提示：模型无法直接爬取外部链接，请先点击「🌐 智能提取正文」抓取网页内容后再生成。`)
  }

  return cleaned
}

function normalizeWeiboPost(value: Partial<WeiboPostResult>, fallbackStoryId: string): WeiboPostResult {
  const tags = Array.isArray(value.tags)
    ? value.tags.map(String).map((tag) => tag.replaceAll('#', '').trim()).filter(Boolean).slice(0, 3)
    : []
  const suggestedTime = /^([01]\d|2[0-2]):[0-5]\d$/.test(String(value.suggested_time || ''))
    ? String(value.suggested_time)
    : '10:00'
  return {
    story_id: String(value.story_id || fallbackStoryId),
    content: String(value.content || '').trim(),
    interaction: String(value.interaction || '').trim(),
    tags,
    suggested_time: suggestedTime,
  }
}

export async function generateWeiboPosts(stories: Story[], targetDate: string, revision?: WeiboRevisionOptions): Promise<WeiboPostResult[]> {
  const config = getLLMConfig()
  if (!stories.length) return []
  const sourcePayload = stories.map((story) => ({
    id: story.id,
    category: story.category,
    title: story.title,
    body: story.body,
    source_name: story.source_name,
    source_url: story.source_url,
    fact_status: story.fact_status,
  }))
  const revisionPrompt = revision
    ? `\n\n当前微博草稿：\n${JSON.stringify(revision.currentPost)}\n\n本次修改要求：${revision.instruction?.trim() || '请主动优化表达、节奏和信息层次，保留已核验事实与原意。'}\n请修改当前草稿，不得添加来源材料中没有的事实。返回的 posts 只包含这一条，story_id 必须保持为 ${stories[0]?.id || ''}。`
    : ''
  const taskPrompt = `目标发布日期：${targetDate}\n\n已核验早报条目：\n${JSON.stringify(sourcePayload)}${revisionPrompt}`
  const userPrompt = `${weiboPostsPrompt}\n\n${taskPrompt}`
  let text = ''

  if (config.provider === 'gemini') {
    if (!config.geminiKey) throw new Error('请先在设置中填写 Gemini API Key')
    const modelName = config.geminiModel || defaultGeminiModel
    const apiModel = modelName.includes('flash-high') || modelName === '3.7-flash' ? 'gemini-3.7-flash' : modelName.replace(/^models\//, '')
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 120_000)
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(apiModel)}:generateContent`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.65, responseMimeType: 'application/json' },
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: { message: response.statusText } }))
        throw new Error(payload?.error?.message || `Gemini 请求失败（${response.status}）`)
      }
      const payload = await response.json()
      text = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('') || ''
    } finally {
      window.clearTimeout(timeout)
    }
  } else {
    const { baseUrl, apiKey, modelName } = resolveOpenAIConfig(config)
    const reasoningFields = openAIReasoningFields(modelName, config.thinkingLevel || 'medium')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 120_000)
    try {
      const response = await openAIFetch(baseUrl, 'chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers,
        body: JSON.stringify({
          model: modelName,
          ...reasoningFields,
          ...(Object.keys(reasoningFields).length ? {} : { temperature: 0.65 }),
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: weiboPostsPrompt },
            { role: 'user', content: taskPrompt },
          ],
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: { message: response.statusText } }))
        throw new Error(payload?.error?.message || `API 请求失败（HTTP ${response.status}）`)
      }
      const payload = await response.json()
      text = payload?.choices?.[0]?.message?.content || ''
    } finally {
      window.clearTimeout(timeout)
    }
  }

  if (!text) throw new Error('模型没有返回微博草稿')
  const parsed = JSON.parse(cleanJsonOutput(text)) as { posts?: Array<Partial<WeiboPostResult>> }
  const allowedIds = new Set(stories.map((story) => story.id))
  const results = (parsed.posts || [])
    .map((post, index) => normalizeWeiboPost(post, stories[index]?.id || ''))
    .filter((post) => allowedIds.has(post.story_id) && post.content)
  if (!results.length) throw new Error('模型返回的微博草稿无法匹配当前选题')
  return results
}

/**
 * 生成即时快讯
 */
export async function generateFlashNews(input: FlashNewsInput, onStream?: StreamListener): Promise<FlashNewsResult> {
  const config = getLLMConfig()
  const today = input.date || new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }).replace('/', ' 月 ') + ' 日'

  const userContent = `【参考新闻素材】
标题：${input.title || '（未命名）'}
分类：${input.category || '科技'}
信息来源/链接：${input.url || '公开报道'}
今日参考日期：${today}

正文/详情内容：
${input.content}

材料使用要求：
1. 「早报已有摘要」只作为选题线索，不得据此臆测扩写；
2. 优先依据「原始信源全文」，核对主体、动作、时间、数字与原话；
3. 「联网检索补充材料」仅用于交叉核验和补充背景，冲突时以原始/官方信源为准；
4. 不得写入材料中没有依据的事实，无法确认的内容应省略或明确标注尚未确认。
`

  if (config.provider === 'gemini') {
    const modelName = config.geminiModel || defaultGeminiModel
    let apiModel = modelName
    if (modelName === 'gemini-3.7-flash-high' || modelName === '3.7-flash-high' || modelName.includes('flash-high')) {
      apiModel = 'gemini-3.7-flash'
    } else if (modelName === '3.7-flash') {
      apiModel = 'gemini-3.7-flash'
    }

    const currentBudget = THINKING_LEVEL_MAP[config.thinkingLevel || 'medium']?.budget ?? 2048
    const generationConfig: Record<string, unknown> = {
      temperature: currentBudget > 0 ? 0.6 : 0.4,
      responseMimeType: 'application/json',
    }
    if (apiModel.includes('3.7') || apiModel.includes('2.5')) {
      generationConfig.thinkingConfig = { thinkingBudget: currentBudget }
    } else if (currentBudget > 0) {
      generationConfig.thinkingConfig = { thinkingBudget: currentBudget }
    }

    const systemPrompt = flashNewsPrompt
    const fullPrompt = `${systemPrompt}\n\n${userContent}`

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 90_000)
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(apiModel)}:generateContent`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
          generationConfig: {
            ...generationConfig,
            responseSchema: {
              type: 'OBJECT',
              properties: {
                titles: {
                  type: 'ARRAY',
                  minItems: 3,
                  maxItems: 5,
                  items: { type: 'STRING' },
                },
                selected_title: { type: 'STRING' },
                summary: { type: 'STRING' },
                key_points: {
                  type: 'ARRAY',
                  items: { type: 'STRING' },
                },
                body: { type: 'STRING' },
              },
              required: ['titles', 'selected_title', 'summary', 'key_points', 'body'],
            },
          },
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: { message: response.statusText } }))
        throw new Error(payload?.error?.message || `Gemini 请求失败（${response.status}）`)
      }
      const payload = await response.json()
      const text = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('')
      if (!text) throw new Error('Gemini 没有返回快讯内容')

      const parsed = JSON.parse(cleanJsonOutput(text)) as FlashNewsResult
      return {
        titles: Array.isArray(parsed.titles) ? parsed.titles.map(String) : [parsed.selected_title || input.title || '快讯标题'],
        selected_title: parsed.selected_title || (Array.isArray(parsed.titles) && parsed.titles[0]) || '快讯标题',
        summary: parsed.summary || '',
        key_points: Array.isArray(parsed.key_points) ? parsed.key_points.map(String) : [],
        body: parsed.body || '',
        model: modelName,
        provider: 'gemini',
      }
    } finally {
      window.clearTimeout(timeout)
    }
  } else {
    // OpenAI Compatible Provider (cockpit-tools / LiteLLM / DeepSeek / One-API)
    const { baseUrl, apiKey, modelName } = resolveOpenAIConfig(config)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    const reasoningFields = openAIReasoningFields(modelName, config.thinkingLevel || 'medium')
    const isReasoning = Object.keys(reasoningFields).length > 0

    const requestPayload: Record<string, unknown> = {
      model: modelName,
      max_tokens: 4096,
      stream: Boolean(onStream),
      ...reasoningFields,
      messages: [
        {
          role: 'system',
          content: `${flashNewsPrompt}\n\n请直接输出符合规范的 JSON 字符串（包含 titles, selected_title, summary, key_points, body 字段），不要包含额外的开场白或解释。`,
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
    }

    if (!isReasoning) {
      requestPayload.temperature = 0.5
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 120_000)
    try {
      const response = await openAIFetch(baseUrl, 'chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers,
        body: JSON.stringify(requestPayload),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: { message: response.statusText } }))
        throw new Error(payload?.error?.message || `API 请求失败（HTTP ${response.status}）`)
      }
      const { content: text } = await readOpenAITextResponse(response, onStream)
      if (!text) throw new Error('模型没有返回内容')

      const parsed = JSON.parse(cleanJsonOutput(text)) as FlashNewsResult
      return {
        titles: Array.isArray(parsed.titles) ? parsed.titles.map(String) : [parsed.selected_title || input.title || '快讯标题'],
        selected_title: parsed.selected_title || (Array.isArray(parsed.titles) && parsed.titles[0]) || '快讯标题',
        summary: parsed.summary || '',
        key_points: Array.isArray(parsed.key_points) ? parsed.key_points.map(String) : [],
        body: parsed.body || '',
        model: modelName,
        provider: config.provider,
      }
    } finally {
      window.clearTimeout(timeout)
    }
  }
}

/**
 * 生成早报品牌大标题（支持 Gemini 及 OpenAI-compatible）
 */
export async function generateBrandHeadlines(issue: Issue, brand: 'appso' | 'ifanr') {
  const config = getLLMConfig()
  const selected = issue.stories
    .filter((story) => story.selected && story.status !== 'excluded')
    .map((story) => ({
      id: story.id,
      category: story.category,
      title: story.title,
      body: story.body.slice(0, 800),
      score: story.score,
      fact_status: story.fact_status,
      sources: story.sources.slice(0, 2).map((source) => ({ publisher: source.publisher, authority: source.authority })),
    }))

  const brandPrompt = brand === 'appso' ? appsoPrompt : ifanrPrompt
  const userPrompt = `${brandPrompt}\n\n## 本刊期共享母稿\n\n${JSON.stringify(selected)}`

  if (config.provider === 'gemini') {
    if (!config.geminiKey) throw new Error('请先在设置中填写 Gemini API Key')
    const modelName = config.geminiModel || defaultGeminiModel
    let apiModel = modelName
    let thinkingBudget: number | undefined
    if (modelName === 'gemini-3.7-flash-high' || modelName === '3.7-flash-high' || modelName.includes('flash-high')) {
      apiModel = 'gemini-3.7-flash'
      thinkingBudget = 4096
    } else if (modelName === '3.7-flash' || modelName === 'gemini-3.7-flash') {
      apiModel = 'gemini-3.7-flash'
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 90_000)
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(apiModel)}:generateContent`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: {
            temperature: 0.7,
            responseMimeType: 'application/json',
            ...(thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget } } : {}),
            responseSchema: {
              type: 'OBJECT',
              properties: {
                headline_options: {
                  type: 'ARRAY',
                  minItems: 6,
                  maxItems: 6,
                  items: { type: 'STRING' },
                },
              },
              required: ['headline_options'],
            },
          },
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: { message: response.statusText } }))
        throw new Error(payload?.error?.message || `Gemini 请求失败（${response.status}）`)
      }
      const payload = await response.json()
      const text = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('')
      if (!text) throw new Error('Gemini 没有返回标题')
      const result = JSON.parse(cleanJsonOutput(text)) as { headline_options?: unknown[] }
      const options = (result.headline_options || []).map(String).map(validateGeneratedHeadline)
      if (options.length !== 6) throw new Error('标题Skill必须返回恰好6组候选')
      return { headline_options: options, selected_headline: options[0], model: modelName }
    } finally {
      window.clearTimeout(timeout)
    }
  } else {
    // OpenAI-compatible provider
    const { baseUrl, apiKey, modelName } = resolveOpenAIConfig(config)
    const reasoningFields = openAIReasoningFields(modelName, config.thinkingLevel || 'medium')

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 90_000)
    try {
      const response = await openAIFetch(baseUrl, 'chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers,
        body: JSON.stringify({
          model: modelName,
          ...reasoningFields,
          ...(Object.keys(reasoningFields).length ? {} : { temperature: 0.7 }),
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `${brandPrompt}\n\n请严格返回 JSON: { "headline_options": ["标题1 / 标题2 / 标题3", "...", "...", "...", "...", "..."] }`,
            },
            {
              role: 'user',
              content: `## 本刊期共享母稿\n\n${JSON.stringify(selected)}`,
            },
          ],
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: { message: response.statusText } }))
        throw new Error(payload?.error?.message || `API 请求失败（${response.status}）`)
      }
      const payload = await response.json()
      const text = payload?.choices?.[0]?.message?.content
      if (!text) throw new Error('模型没有返回标题')
      const result = JSON.parse(cleanJsonOutput(text)) as { headline_options?: unknown[] }
      const options = (result.headline_options || []).map(String).map(validateGeneratedHeadline)
      if (options.length !== 6) throw new Error('标题Skill必须返回恰好6组候选')
      return { headline_options: options, selected_headline: options[0], model: modelName }
    } finally {
      window.clearTimeout(timeout)
    }
  }
}

export const PRESET_MODELS: Record<LLMProvider, LLMModelOption[]> = {
  ifanr: [
    { name: defaultIfanrModel, displayName: defaultIfanrModel },
  ],
  gemini: [
    { name: 'gemini-3.7-flash-high', displayName: 'Gemini 3.7 Flash（思考增强）' },
    { name: 'gemini-3.7-flash', displayName: 'Gemini 3.7 Flash' },
    { name: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
    { name: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
  ],
  openai: [
    { name: '3.7-flash-high', displayName: '3.7-flash-high' },
    { name: 'gemini-3.7-flash', displayName: 'gemini-3.7-flash' },
    { name: 'claude-3-7-sonnet', displayName: 'Claude 3.7 Sonnet' },
    { name: 'deepseek-chat', displayName: 'DeepSeek V3' },
    { name: 'deepseek-reasoner', displayName: 'DeepSeek R1' },
    { name: 'gpt-4o', displayName: 'GPT-4o' },
  ],
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  streaming?: boolean
  timestamp?: number
}

export type FlashChatContext = {
  title: string
  body: string
  rawMaterial?: string
  sourceUrl?: string
  category?: string
}

/**
 * 快讯 AI 侧边栏对话助手（支持基于当前稿件与素材的多轮自然语言交互修改）
 */
export async function chatFlashNewsAssistant(
  history: ChatMessage[],
  context: FlashChatContext,
  userMessage: string,
  modelOverride?: string,
  onStream?: StreamListener,
): Promise<string> {
  const config = getLLMConfig()
  const systemInstruction = `你是爱范儿（ifanr）科技快讯的资深副主编兼智能采编助手。
你的任务是协助主编针对当前正在撰写的快讯草稿进行润色、改写段落、拟定新标题、精简字数、核对事实或补充背景。

【爱范儿快讯写作核心原则】
1. 标题：12~28 字，直接写清主体、新闻动作和关键信息增量。只有事实本身形成明显反差时才写反差，不强造比喻或转折。
2. 首段：加粗电头起始（**爱范儿 M 月 D 日消息，**），1~2 句话直接交代核心事实与关键数字。
3. 结构：呼吸感短段落（1~3 句话成段），需要分层时使用能直接提示事实内容的 ### 三级小标题（如「### 交易包括哪些业务和资产？」），核心原话使用 > 引用块。
4. 标点：中文直角引号「」、中英文与中数字间半角空格，事实数据严格核对。
5. 结尾：优先用关键事实、明确待定事项、下一时间节点或当事人原话自然收住。只有材料确实留下具体问题时才追问，不固定追加行业前瞻或「直击本质」的反问。
6. 语言：尽量避开「不是……而是……」「不只……更……」「与其说……不如说……」式刻意对举，以及「真正重要的是」「这意味着」「值得关注的是」「背后的逻辑」式抽象拔高。原始事实确有必要对照时可以自然使用；通常直接写清主体、动作、结果、机制、时间、数字或原话。修订不能只换连接词并保留同一套模板骨架。

【当前快讯草稿实时上下文】
- 当前标题：${context.title || '（暂未设定）'}
- 所属栏目：${context.category || '大公司'}
- 来源链接：${context.sourceUrl || '公开报道'}
- 原始素材摘要：${context.rawMaterial ? context.rawMaterial.slice(0, 1500) : '（无）'}

- 当前正文 Markdown：
\`\`\`markdown
${context.body || '（正文暂为空）'}
\`\`\`

【回复规范】
- 如果主编要求改写整篇正文或某个段落，请务必在回复中包含完整的修改后 Markdown 正文，并用 \`\`\`markdown 代码块包裹，以便主编一键替换正文；
- 如果主编要求拟定标题，请给出 3~5 个编号选项（如 1. 2. 3.）；
- 语气专业、高效、直切要点，直接输出修改方案或修改后的文本。`

  if (config.provider === 'gemini') {
    if (!config.geminiKey) throw new Error('请先在设置中填写 Gemini API Key')
    const modelName = modelOverride || config.geminiModel || defaultGeminiModel
    let apiModel = modelName
    if (modelName === 'gemini-3.7-flash-high' || modelName === '3.7-flash-high' || modelName.includes('flash-high')) {
      apiModel = 'gemini-3.7-flash'
    } else if (modelName === '3.7-flash') {
      apiModel = 'gemini-3.7-flash'
    }

    const currentBudget = THINKING_LEVEL_MAP[config.thinkingLevel || 'medium']?.budget ?? 2048
    const generationConfig: Record<string, unknown> = {
      temperature: currentBudget > 0 ? 0.7 : 0.4,
    }
    if (apiModel.includes('3.7') || apiModel.includes('2.5')) {
      generationConfig.thinkingConfig = { thinkingBudget: currentBudget }
    } else if (currentBudget > 0) {
      generationConfig.thinkingConfig = { thinkingBudget: currentBudget }
    }

    const contents = [
      ...history.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      { role: 'user', parts: [{ text: userMessage }] },
    ]

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 90_000)
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(apiModel)}:generateContent`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig,
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: { message: response.statusText } }))
        throw new Error(payload?.error?.message || `Gemini 请求失败（${response.status}）`)
      }
      const payload = await response.json()
      const text = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('')
      if (!text) throw new Error('Gemini 没有返回回答')
      return text
    } finally {
      window.clearTimeout(timeout)
    }
  } else {
    // OpenAI-compatible provider
    const { baseUrl, apiKey, modelName } = resolveOpenAIConfig(config, modelOverride)

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

    const messages = [
      { role: 'system', content: systemInstruction },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMessage },
    ]

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 90_000)
    const reasoningFields = openAIReasoningFields(modelName, config.thinkingLevel || 'medium')
    try {
      const response = await openAIFetch(baseUrl, 'chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers,
        body: JSON.stringify({
          model: modelName,
          messages,
          stream: Boolean(onStream),
          ...reasoningFields,
          ...(Object.keys(reasoningFields).length ? {} : { temperature: 0.7 }),
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: { message: response.statusText } }))
        throw new Error(payload?.error?.message || `API 请求失败（${response.status}）`)
      }
      const { content: text } = await readOpenAITextResponse(response, onStream)
      if (!text) throw new Error('模型没有返回回答')
      return text
    } finally {
      window.clearTimeout(timeout)
    }
  }
}
