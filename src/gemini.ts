import appsoPrompt from '../prompts/appso_headline.md?raw'
import ifanrPrompt from '../prompts/ifanr_headline.md?raw'
import type { Issue } from './types'

const keyName = 'editorial-gemini-api-key'
const modelName = 'gemini-3.5-flash'

export const hasGeminiKey = () => Boolean(localStorage.getItem(keyName)?.trim())

export const saveGeminiKey = (value: string) => {
  const key = value.trim()
  if (key.length < 16) throw new Error('Gemini API Key 格式不正确')
  localStorage.setItem(keyName, key)
}

export const clearGeminiKey = () => localStorage.removeItem(keyName)

export async function generateBrandHeadlines(issue: Issue, brand: 'appso' | 'ifanr') {
  const apiKey = localStorage.getItem(keyName)?.trim()
  if (!apiKey) throw new Error('请先在设置中填写 Gemini API Key')
  const selected = issue.stories
    .filter((story) => story.selected && story.status !== 'excluded')
    .map((story) => ({
      id: story.id,
      category: story.category,
      title: story.title,
      body: story.body,
      score: story.score,
      fact_status: story.fact_status,
    }))
  const prompt = `${brand === 'appso' ? appsoPrompt : ifanrPrompt}\n\n## 本刊期共享母稿\n\n${JSON.stringify(selected, null, 2)}`
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 90_000)
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              headline_options: {
                type: 'ARRAY',
                minItems: 3,
                maxItems: 3,
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
    const result = JSON.parse(text) as { headline_options?: unknown[] }
    const options = (result.headline_options || []).map(String).map((item) => item.trim())
    if (options.length !== 3 || options.some((item) => item.split(' / ').length !== 3)) {
      throw new Error('Gemini 返回的标题不符合三个消息格式')
    }
    return { headline_options: options, selected_headline: options[0], model: modelName }
  } finally {
    window.clearTimeout(timeout)
  }
}
