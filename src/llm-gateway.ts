import flashNewsPrompt from '../prompts/flash_news.md?raw'
import appsoPrompt from '../prompts/appso_headline.md?raw'
import ifanrPrompt from '../prompts/ifanr_headline.md?raw'
import type { Issue } from './types'

export type LLMProvider = 'gemini' | 'openai'
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'max'

export type ThinkingLevelInfo = {
  id: ThinkingLevel
  label: string
  shortLabel: string
  budget: number
  desc: string
}

export const THINKING_LEVEL_MAP: Record<ThinkingLevel, ThinkingLevelInfo> = {
  off: { id: 'off', label: 'Off (关闭思考)', shortLabel: 'Off', budget: 0, desc: '0 token · 极速直出' },
  low: { id: 'low', label: 'Low (轻度 1k)', shortLabel: 'Low', budget: 1024, desc: '1024 token · 轻微推理' },
  medium: { id: 'medium', label: 'Medium (标准 2k)', shortLabel: 'Medium', budget: 2048, desc: '2048 token · 平衡' },
  high: { id: 'high', label: 'High (深度 4k)', shortLabel: 'High', budget: 4096, desc: '4096 token · 深度推理（推荐）' },
  max: { id: 'max', label: 'Max (超深 8k)', shortLabel: 'Max', budget: 8192, desc: '8192 token · 复杂推演' },
}

export const THINKING_LEVELS: ThinkingLevelInfo[] = [
  THINKING_LEVEL_MAP.off,
  THINKING_LEVEL_MAP.low,
  THINKING_LEVEL_MAP.medium,
  THINKING_LEVEL_MAP.high,
  THINKING_LEVEL_MAP.max,
]

export type LLMConfig = {
  provider: LLMProvider
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

const STORAGE_KEYS = {
  provider: 'editorial-llm-provider',
  geminiKey: 'editorial-gemini-api-key',
  geminiModel: 'editorial-gemini-model',
  openaiBaseUrl: 'editorial-openai-base-url',
  openaiKey: 'editorial-openai-api-key',
  openaiModel: 'editorial-openai-model',
  thinkingLevel: 'editorial-thinking-level',
} as const

export const defaultGeminiModel = 'gemini-3.7-flash-high'
export const defaultOpenaiModel = '3.7-flash-high'
export const defaultOpenaiBaseUrl = 'https://api.openai.com/v1'

export function getLLMConfig(): LLMConfig {
  const provider = (localStorage.getItem(STORAGE_KEYS.provider) as LLMProvider) || 'gemini'
  const geminiKey = localStorage.getItem(STORAGE_KEYS.geminiKey)?.trim() || ''
  const geminiModel = localStorage.getItem(STORAGE_KEYS.geminiModel)?.trim() || defaultGeminiModel
  const openaiBaseUrl = localStorage.getItem(STORAGE_KEYS.openaiBaseUrl)?.trim() || defaultOpenaiBaseUrl
  const openaiKey = localStorage.getItem(STORAGE_KEYS.openaiKey)?.trim() || ''
  const openaiModel = localStorage.getItem(STORAGE_KEYS.openaiModel)?.trim() || defaultOpenaiModel
  const rawThinking = localStorage.getItem(STORAGE_KEYS.thinkingLevel) as ThinkingLevel
  const thinkingLevel: ThinkingLevel = rawThinking && rawThinking in THINKING_LEVEL_MAP ? rawThinking : 'high'

  return {
    provider,
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
  }
  if (patch.openaiKey !== undefined) {
    localStorage.setItem(STORAGE_KEYS.openaiKey, patch.openaiKey.trim())
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

  const response = await fetch(`${baseUrl}/models`, { headers })
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
    const baseUrl = (config.openaiBaseUrl || defaultOpenaiBaseUrl).trim().replace(/\/+$/, '')
    const headers: Record<string, string> = {}
    if (config.openaiKey) headers['Authorization'] = `Bearer ${config.openaiKey.trim()}`
    const res = await fetch(`${baseUrl}/models`, { headers })
    const latencyMs = Math.round(performance.now() - start)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error?.message || `连接失败（HTTP ${res.status}）`)
    }
    return { ok: true, message: `连接成功！已连通 OpenAI 兼容端点（延迟 ${latencyMs}ms）`, latencyMs }
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

/**
 * 生成即时快讯
 */
export async function generateFlashNews(input: FlashNewsInput): Promise<FlashNewsResult> {
  const config = getLLMConfig()
  const today = input.date || new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }).replace('/', ' 月 ') + ' 日'

  const userContent = `【参考新闻素材】
标题：${input.title || '（未命名）'}
分类：${input.category || '科技'}
信息来源/链接：${input.url || '公开报道'}
今日参考日期：${today}

正文/详情内容：
${input.content}
`

  if (config.provider === 'gemini') {
    const modelName = config.geminiModel || defaultGeminiModel
    let apiModel = modelName
    if (modelName === 'gemini-3.7-flash-high' || modelName === '3.7-flash-high' || modelName.includes('flash-high')) {
      apiModel = 'gemini-3.7-flash'
    } else if (modelName === '3.7-flash') {
      apiModel = 'gemini-3.7-flash'
    }

    const currentBudget = THINKING_LEVEL_MAP[config.thinkingLevel || 'high']?.budget ?? 4096
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
    const baseUrl = config.openaiBaseUrl || defaultOpenaiBaseUrl
    const apiKey = config.openaiKey
    const modelName = config.openaiModel || defaultOpenaiModel

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    const isReasoning = modelName.includes('thinking') || modelName.includes('r1') || modelName.includes('o1') || modelName.includes('o3') || modelName.includes('reason')

    const requestPayload: Record<string, unknown> = {
      model: modelName,
      max_tokens: 4096,
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
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers,
        body: JSON.stringify(requestPayload),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: { message: response.statusText } }))
        throw new Error(payload?.error?.message || `API 请求失败（HTTP ${response.status}）`)
      }
      const payload = await response.json()
      const text = payload?.choices?.[0]?.message?.content
      if (!text) throw new Error('模型没有返回内容')

      const parsed = JSON.parse(cleanJsonOutput(text)) as FlashNewsResult
      return {
        titles: Array.isArray(parsed.titles) ? parsed.titles.map(String) : [parsed.selected_title || input.title || '快讯标题'],
        selected_title: parsed.selected_title || (Array.isArray(parsed.titles) && parsed.titles[0]) || '快讯标题',
        summary: parsed.summary || '',
        key_points: Array.isArray(parsed.key_points) ? parsed.key_points.map(String) : [],
        body: parsed.body || '',
        model: modelName,
        provider: 'openai',
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
    const baseUrl = config.openaiBaseUrl || defaultOpenaiBaseUrl
    const apiKey = config.openaiKey
    const modelName = config.openaiModel || defaultOpenaiModel

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 90_000)
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers,
        body: JSON.stringify({
          model: modelName,
          temperature: 0.7,
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
  modelOverride?: string
): Promise<string> {
  const config = getLLMConfig()
  const systemInstruction = `你是爱范儿（ifanr）科技快讯的资深副主编兼智能采编助手。
你的任务是协助主编针对当前正在撰写的快讯草稿进行润色、改写段落、拟定新标题、精简字数、核对事实或补充背景。

【爱范儿快讯写作核心原则】
1. 标题：12~28 字，强反差、强信息增量与具象比喻主体（如「80 亿美元！『美国支付宝』买下全球最大 AI 中转站」）。
2. 首段：加粗电头起始（**爱范儿 M 月 D 日消息，**），1~2 句话直接交代核心事实与关键数字。
3. 结构：呼吸感短段落（1~3 句话成段），使用 ### 三级小标题分层（如「### 这究竟是一门什么生意？」），核心原话使用 > 引用块。
4. 标点：中文直角引号「」、中英文与中数字间半角空格，事实数据严格核对。
5. 结尾：直击本质的行业前瞻发问或有力收束，不做套路总结。

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

    const currentBudget = THINKING_LEVEL_MAP[config.thinkingLevel || 'high']?.budget ?? 4096
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
    const baseUrl = config.openaiBaseUrl || defaultOpenaiBaseUrl
    const apiKey = config.openaiKey
    const modelName = modelOverride || config.openaiModel || defaultOpenaiModel

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

    const messages = [
      { role: 'system', content: systemInstruction },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMessage },
    ]

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 90_000)
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers,
        body: JSON.stringify({
          model: modelName,
          messages,
          temperature: 0.7,
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: { message: response.statusText } }))
        throw new Error(payload?.error?.message || `API 请求失败（${response.status}）`)
      }
      const payload = await response.json()
      const text = payload?.choices?.[0]?.message?.content
      if (!text) throw new Error('模型没有返回回答')
      return text
    } finally {
      window.clearTimeout(timeout)
    }
  }
}
