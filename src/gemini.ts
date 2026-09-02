/**
 * 向后兼容的 Gemini 模块适配层（代理到统一的 llm-gateway）
 */
export {
  defaultGeminiModel,
  getLLMConfig,
  saveLLMConfig,
  listGeminiModels,
  normalizeGeneratedHeadline,
  validateGeneratedHeadline,
  generateBrandHeadlines,
  generateFlashNews,
} from './llm-gateway'

import {
  getLLMConfig,
  saveLLMConfig,
  defaultGeminiModel,
} from './llm-gateway'

export type GeminiModel = {
  name: string
  displayName: string
}

export const hasGeminiKey = () => Boolean(getLLMConfig().geminiKey.trim())
export const getGeminiModel = () => getLLMConfig().geminiModel.trim() || defaultGeminiModel

export const saveGeminiKey = (value: string) => {
  const key = value.trim()
  if (key.length < 16) throw new Error('Gemini API Key 格式不正确')
  saveLLMConfig({ provider: 'gemini', geminiKey: key })
}

export const clearGeminiKey = () => saveLLMConfig({ geminiKey: '' })

export const saveGeminiModel = (value: string) => {
  const model = value.trim().replace(/^models\//, '')
  if (!model) throw new Error('请输入 Gemini 模型名称')
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Gemini 模型名称格式不正确')
  saveLLMConfig({ geminiModel: model })
}
