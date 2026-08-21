import {
  ArrowLeft,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  Globe,
  HelpCircle,
  Home,
  Image as ImageIcon,
  Info,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Save,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Wand2,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import {
  chatFlashNewsAssistant,
  defaultGeminiModel,
  defaultOpenaiModel,
  generateFlashNews,
  getLLMConfig,
  isLLMConfigured,
  listAvailableModels,
  PRESET_MODELS,
  saveLLMConfig,
  THINKING_LEVEL_MAP,
  THINKING_LEVELS,
  type ChatMessage,
  type FlashNewsResult,
  type LLMModelOption,
  type LLMProvider,
  type ThinkingLevel,
} from './llm-gateway'
import type { Issue, Story } from './types'
import type { FlashDraftItem } from './WelcomeWorkspace'

export type FlashWorkspaceProps = {
  issue: Issue | null
  initialStory?: Story | null
  initialDraft?: FlashDraftItem | null
  onSaveDraft?: (draft: FlashDraftItem) => void
  onSwitchToDraft?: () => void
  onSwitchToHome?: () => void
  onOpenSettings?: () => void
}

const QUICK_PROMPTS = [
  { label: '🎯 拟 3 个更吸睛标题', prompt: '请参考爱范儿快讯的标题原则（具象比喻、核心动作、强反差），为当前素材重新拟定 3 组更吸睛、更有信息增量的备选标题。' },
  { label: '✂️ 精简压缩至 300 字', prompt: '请在严格保留核心事实、关键数字与主要原话的前提下，将当前快讯正文精简压缩至 300 字左右，保持呼吸感短句。' },
  { label: '💡 增加通俗具象比喻', prompt: '请尝试在正文中加入 1~2 个通俗易懂的具象比喻（如将复杂的架构比作交易所或自来水管道），帮助普通读者快速理解。' },
  { label: '🔍 检查事实与标点规范', prompt: '请严格对照爱范儿编辑规范，检查当前草稿：是否使用直角引号「」、中英文是否留半角空格、数字单位换算是否严谨、有无内部采编废话。' },
  { label: '➕ 结尾增加前瞻反问', prompt: '请优化当前正文的结尾段落，去掉八股套路总结，改为一段有力、留有余味的行业前瞻观察或直击本质的反问。' },
]

export function FlashWorkspace({
  issue,
  initialStory,
  initialDraft,
  onSaveDraft,
  onSwitchToDraft,
  onSwitchToHome,
  onOpenSettings,
}: FlashWorkspaceProps) {
  const [draftId, setDraftId] = useState<string>(() => initialDraft?.id || `draft_${Date.now()}`)
  const [selectedStoryId, setSelectedStoryId] = useState<string>(initialStory?.id || '')
  const [title, setTitle] = useState(initialDraft?.title || initialStory?.title || '')
  const [category, setCategory] = useState(initialDraft?.category || initialStory?.category || '大公司')
  const [sourceUrl, setSourceUrl] = useState(initialDraft?.sourceUrl || initialStory?.source_url || '')
  const [content, setContent] = useState(initialDraft?.content || initialStory?.body || initialStory?.editorial_reason || '')
  const [imageUrl, setImageUrl] = useState(initialDraft?.imageUrl || initialStory?.image_url || (initialStory?.image_path ? api.storyImageUrl(initialStory.id) : ''))

  const [generating, setGenerating] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [extractingUrls, setExtractingUrls] = useState(false)
  const [result, setResult] = useState<FlashNewsResult | null>(null)
  const [activeTitle, setActiveTitle] = useState(initialDraft?.title || '')
  const [body, setBody] = useState(initialDraft?.body || '')
  const [summary, setSummary] = useState('')
  const [keyPoints, setKeyPoints] = useState<string[]>(initialDraft?.keyPoints || [])
  const [publishedDoc, setPublishedDoc] = useState<{ document_url: string; document_title: string } | null>(
    initialDraft?.publishedDoc || null,
  )
  const [editorTab, setEditorTab] = useState<'edit' | 'preview'>('edit')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showLeaveModal, setShowLeaveModal] = useState<(() => void) | null>(null)
  const [statusMessage, setStatusMessageState] = useState<string | null>(null)
  const [statusClosing, setStatusClosing] = useState(false)
  const statusTimerRef = useRef<number | null>(null)
  const [copyNote, setCopyNote] = useState<string | null>(null)

  // 自动保存草稿至会话管理器
  useEffect(() => {
    if (!activeTitle.trim() && !body.trim() && !content.trim()) return
    const timer = setTimeout(() => {
      onSaveDraft?.({
        id: draftId,
        title: activeTitle.trim() || title.trim() || '未命名快讯草稿',
        body,
        category,
        sourceUrl,
        imageUrl,
        content,
        keyPoints,
        publishedDoc: publishedDoc || undefined,
        updatedAt: Date.now(),
      })
    }, 600)
    return () => clearTimeout(timer)
  }, [draftId, activeTitle, title, body, category, sourceUrl, imageUrl, content, keyPoints, publishedDoc, onSaveDraft])

  const handleSafeLeave = (targetAction: () => void) => {
    if ((body.trim() || content.trim()) && !publishedDoc) {
      setShowLeaveModal(() => targetAction)
    } else {
      targetAction()
    }
  }

  const setStatusMessage = (msg: string | null) => {
    if (statusTimerRef.current) window.clearTimeout(statusTimerRef.current)
    if (!msg) {
      setStatusMessageState(null)
      setStatusClosing(false)
      return
    }
    setStatusMessageState(msg)
    setStatusClosing(false)
    statusTimerRef.current = window.setTimeout(() => {
      setStatusClosing(true)
      statusTimerRef.current = window.setTimeout(() => {
        setStatusMessageState(null)
        setStatusClosing(false)
      }, 240)
    }, 4500)
  }

  // 模型配置与动态拉取状态
  const [llmConfig, setLlmConfig] = useState(getLLMConfig())
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [modelPickerClosing, setModelPickerClosing] = useState(false)
  const [hoveredModel, setHoveredModel] = useState<{
    name: string
    top: number
    displayName: string
    placement: 'right' | 'left'
  } | null>(null)
  const hoverTimerRef = useRef<number | null>(null)
  const modelPickerRef = useRef<HTMLDivElement>(null)
  const modelPickerTriggerRef = useRef<HTMLButtonElement>(null)

  const cancelHoverTimer = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }

  const scheduleClearHoveredModel = (delayMs = 240) => {
    cancelHoverTimer()
    hoverTimerRef.current = window.setTimeout(() => {
      setHoveredModel(null)
      hoverTimerRef.current = null
    }, delayMs)
  }

  const setHoveredModelImmediate = (modelData: typeof hoveredModel) => {
    cancelHoverTimer()
    setHoveredModel(modelData)
  }

  const [modelTab, setModelTab] = useState<LLMProvider>(getLLMConfig().provider)
  const [availableModels, setAvailableModels] = useState<LLMModelOption[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelFilter, setModelFilter] = useState('')
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [customModelInput, setCustomModelInput] = useState('')

  const openModelPicker = () => {
    cancelHoverTimer()
    setShowModelPicker(true)
    setModelPickerClosing(false)
    setHoveredModel(null)
  }

  const closeModelPicker = () => {
    cancelHoverTimer()
    if (showModelPicker && !modelPickerClosing) {
      setModelPickerClosing(true)
      setTimeout(() => {
        setShowModelPicker(false)
        setModelPickerClosing(false)
        setHoveredModel(null)
      }, 160)
    }
  }

  const toggleModelPicker = () => {
    if (showModelPicker && !modelPickerClosing) closeModelPicker()
    else openModelPicker()
  }

  useEffect(() => {
    if (!showModelPicker) return
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (modelPickerRef.current?.contains(target) || modelPickerTriggerRef.current?.contains(target)) return
      closeModelPicker()
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModelPicker()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showModelPicker, modelPickerClosing])

  const fetchModels = async (provider: LLMProvider) => {
    setLoadingModels(true)
    setModelsError(null)
    try {
      const models = await listAvailableModels(provider)
      setAvailableModels(models)
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : '读取模型列表失败')
      setAvailableModels([])
    } finally {
      setLoadingModels(false)
    }
  }

  useEffect(() => {
    if (showModelPicker) {
      setHoveredModel(null)
      void fetchModels(modelTab)
    }
  }, [showModelPicker, modelTab])

  // AI 侧边栏 Chatbot 状态
  const [showCopilot, setShowCopilot] = useState(true)
  const [copilotClosing, setCopilotClosing] = useState(false)

  const toggleCopilot = () => {
    if (showCopilot && !copilotClosing) {
      setCopilotClosing(true)
      setTimeout(() => {
        setShowCopilot(false)
        setCopilotClosing(false)
      }, 240)
    } else if (!showCopilot) {
      setShowCopilot(true)
      setCopilotClosing(false)
    }
  }

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: '你好！我是爱范儿快讯的 AI 智能采编助手。你可以直接用自然语言告诉我你想怎么修改当前这篇快讯（例如：帮我把第二段改写得更有张力、再拟几个标题、精简字数或增加原话引用）。',
      timestamp: Date.now(),
    },
  ])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const chatContainerRef = useRef<HTMLDivElement>(null)

  const configured = isLLMConfigured()

  useEffect(() => {
    if (initialStory) {
      setSelectedStoryId(initialStory.id)
      setTitle(initialStory.title)
      setCategory(initialStory.category || '大公司')
      setSourceUrl(initialStory.source_url || '')
      setContent(initialStory.body || initialStory.editorial_reason || '')
      setImageUrl(initialStory.image_url || (initialStory.image_path ? api.storyImageUrl(initialStory.id) : ''))
    }
  }, [initialStory])

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
    }
  }, [chatMessages])

  const handleSelectStory = (storyId: string) => {
    setSelectedStoryId(storyId)
    if (!storyId) return
    const target = issue?.stories.find((s) => s.id === storyId)
    if (target) {
      setTitle(target.title)
      setCategory(target.category || '大公司')
      setSourceUrl(target.source_url || '')
      setContent(target.body || target.editorial_reason || '')
      setImageUrl(target.image_url || (target.image_path ? api.storyImageUrl(target.id) : ''))
      setResult(null)
      setPublishedDoc(null)
      setStatusMessage(`已载入选题素材：「${target.title}」`)
    }
  }

  const isThinkingCapable = (modelName: string) => {
    const lower = modelName.toLowerCase()
    return lower.includes('3.7') || lower.includes('2.5') || lower.includes('thinking') || lower.includes('claude') || lower.includes('r1') || lower.includes('o1') || lower.includes('o3') || lower.includes('gemini') || lower.includes('flash') || lower.includes('pro')
  }

  const handleSwitchModel = (provider: LLMProvider, modelName: string) => {
    saveLLMConfig({
      provider,
      ...(provider === 'gemini' ? { geminiModel: modelName } : { openaiModel: modelName }),
    })
    setLlmConfig(getLLMConfig())
    closeModelPicker()
    setStatusMessage(`已切换模型引擎至：${modelName}`)
  }

  const handleSwitchModelAndThinking = (provider: LLMProvider, modelName: string, level: ThinkingLevel) => {
    saveLLMConfig({
      provider,
      ...(provider === 'gemini' ? { geminiModel: modelName } : { openaiModel: modelName }),
      thinkingLevel: level,
    })
    setLlmConfig(getLLMConfig())
    closeModelPicker()
    const lvlItem = THINKING_LEVEL_MAP[level]
    setStatusMessage(`已选用模型：${modelName} · 思考强度：${lvlItem.label}`)
  }

  const handleExtractUrls = async () => {
    const raw = `${content}\n${sourceUrl}`.trim()
    const urlMatches = raw.match(/https?:\/\/[^\s<>"')]+/g)
    if (!urlMatches || !urlMatches.length) {
      setStatusMessage('未在素材输入框中检测到有效的 HTTP/HTTPS 链接')
      return
    }
    setExtractingUrls(true)
    setStatusMessage(`正在通过工作流智能抓取 ${urlMatches.length} 个网页正文与配图…`)
    try {
      const res = await api.extractUrlsContent({ raw_text: raw })
      if (res.ok) {
        setContent(res.merged_content)
        if (res.merged_title && (!title.trim() || title === '新闻素材')) {
          setTitle(res.merged_title)
        }
        if (res.primary_image_url && !imageUrl.trim()) {
          setImageUrl(res.primary_image_url)
        }
        if (res.primary_source_url && !sourceUrl.trim()) {
          setSourceUrl(res.primary_source_url)
        }
        setStatusMessage(`✅ 成功提取 ${res.items.length} 篇网页报道正文与配图！`)
      }
    } catch (err) {
      setStatusMessage(`网页抓取失败：${err instanceof Error ? err.message : '请检查网络或链接'}`)
    } finally {
      setExtractingUrls(false)
    }
  }

  useEffect(() => {
    if (!isFullscreen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isFullscreen])

  const handleFormatMarkdown = () => {
    if (!body.trim()) return
    const formatted = body
      // 规范中文标点与直角引号
      .replace(/[“”"]/g, '「')
      .replace(/[’']/g, '「')
      .replace(/[』]/g, '」')
      .replace(/『/g, '「')
      // 中英文与中数字半角空格
      .replace(/([\u4e00-\u9fa5])([A-Za-z0-9])/g, '$1 $2')
      .replace(/([A-Za-z0-9])([\u4e00-\u9fa5])/g, '$1 $2')
      // 规范多余换行
      .replace(/\n{3,}/g, '\n\n')
    setBody(formatted)
    setCopyNote('✨ 已自动规范直角引号与中英文空格')
    setTimeout(() => setCopyNote(null), 3000)
  }

  const handleGenerate = async () => {
    if (!content.trim() && !title.trim()) {
      setStatusMessage('请先输入新闻素材内容或标题')
      return
    }
    if (!configured) {
      setStatusMessage('请先在右上角「设置」中配置 Gemini 或 OpenAI 兼容模型')
      onOpenSettings?.()
      return
    }

    setGenerating(true)
    setPublishedDoc(null)

    let finalContent = content
    let finalTitle = title
    let finalSourceUrl = sourceUrl
    let finalImageUrl = imageUrl

    // 如果素材框内全是 URL 链接，自动先行抓取解析全文
    const raw = `${content}\n${sourceUrl}`.trim()
    const urlMatches = raw.match(/https?:\/\/[^\s<>"')]+/g)
    const isPureUrls = raw.split(/\s+/).every((token) => /^https?:\/\//.test(token))
    if (isPureUrls && urlMatches && urlMatches.length > 0) {
      setStatusMessage(`检测到纯新闻链接，正在智能抓取 ${urlMatches.length} 篇报道全文…`)
      try {
        const ext = await api.extractUrlsContent({ raw_text: raw })
        if (ext.ok) {
          finalContent = ext.merged_content
          setContent(ext.merged_content)
          if (!finalTitle.trim() || finalTitle === '新闻素材') {
            finalTitle = ext.merged_title
            setTitle(ext.merged_title)
          }
          if (!finalImageUrl && ext.primary_image_url) {
            finalImageUrl = ext.primary_image_url
            setImageUrl(ext.primary_image_url)
          }
          if (!finalSourceUrl && ext.primary_source_url) {
            finalSourceUrl = ext.primary_source_url
            setSourceUrl(ext.primary_source_url)
          }
        }
      } catch (err) {
        console.warn('URL 自动抓取失败，回退直接传值:', err)
      }
    }

    // 联动右侧 AI 助手对话窗口
    setShowCopilot(true)
    const userPromptText = `📝 请求根据素材撰写快讯：《${finalTitle || '突发新闻'}》`
    const userMsg: ChatMessage = {
      id: String(Date.now()),
      role: 'user',
      content: userPromptText,
      timestamp: Date.now(),
    }
    setChatMessages((prev) => [...prev, userMsg])
    setChatBusy(true)
    setStatusMessage('正在调用 AI 引擎，根据爱范儿快讯规范撰写中…')

    try {
      const generated = await generateFlashNews({
        title: finalTitle,
        content: finalContent || finalTitle,
        url: finalSourceUrl,
        category,
      })
      setResult(generated)
      setActiveTitle(generated.selected_title || generated.titles[0] || title)
      setBody(generated.body)
      setSummary(generated.summary)
      setKeyPoints(generated.key_points)
      setStatusMessage(`快讯生成完成（引擎：${generated.provider === 'gemini' ? 'Gemini' : 'OpenAI 兼容'} · ${generated.model}）`)

      // 在右侧 AI 助手窗口中展示结构化建议与正文初稿
      const titlesFormatted = (generated.titles || []).map((t, i) => `${i + 1}. ${t}`).join('\n')
      const keyPointsFormatted = (generated.key_points || []).map((p) => `• ${p}`).join('\n')
      const assistantMsg: ChatMessage = {
        id: String(Date.now() + 1),
        role: 'assistant',
        content: `✅ **快讯初稿已撰写完成！**

**【备选标题矩阵】**
${titlesFormatted}

**【核心采编要点】**
${keyPointsFormatted}

**【快讯正文初稿】**
\`\`\`markdown
${generated.body}
\`\`\`

您可以点击「一键应用到正文」，或在下方输入框告诉我如何进一步修改（如精简到 300 字、换个更吸睛的角度等）！`,
        timestamp: Date.now(),
      }
      setChatMessages((prev) => [...prev, assistantMsg])
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '快讯生成失败'
      setStatusMessage(errMsg)
      const assistantErrMsg: ChatMessage = {
        id: String(Date.now() + 1),
        role: 'assistant',
        content: `⚠️ **快讯生成遇到异常**：${errMsg}

💡 **排查建议**：
1. 请检查右上角「设置」中的 API Key 或端点配置；
2. 若输入的是纯新闻链接，可先点击「智能提取正文」抓取网页内容；
3. 您也可以直接在下方输入框告诉我您的需求，我将直接协助您撰写。`,
        timestamp: Date.now(),
      }
      setChatMessages((prev) => [...prev, assistantErrMsg])
    } finally {
      setGenerating(false)
      setChatBusy(false)
    }
  }

  const handlePublishToLark = async () => {
    if (!activeTitle.trim() || !body.trim()) {
      setStatusMessage('请先生成并完善快讯标题与正文')
      return
    }
    setPublishing(true)
    setStatusMessage('正在调用 lark-cli 创建独立飞书快讯云文档…')
    try {
      const res = await api.publishFlashNewsToLark({
        title: activeTitle,
        body,
        image_url: imageUrl || undefined,
        source_url: sourceUrl || undefined,
      })
      setPublishedDoc(res)
      setStatusMessage(`🎉 飞书快讯文档创建成功：${res.document_title}`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '创建飞书文档失败')
    } finally {
      setPublishing(false)
    }
  }

  const handleCopyMarkdown = async () => {
    const md = `# ${activeTitle}\n\n${imageUrl ? `![](${imageUrl})\n\n` : ''}${body}\n\n${sourceUrl ? `🔗 信息来源：${sourceUrl}\n` : ''}`
    await navigator.clipboard.writeText(md)
    setCopyNote('已复制 Markdown 到剪贴板')
    setTimeout(() => setCopyNote(null), 3000)
  }

  const handleCopyText = async () => {
    const cleanBody = body.replace(/\*\*(.*?)\*\*/g, '$1').replace(/###?\s+/g, '')
    const plain = `${activeTitle}\n\n${cleanBody}\n\n${sourceUrl ? `来源：${sourceUrl}` : ''}`
    await navigator.clipboard.writeText(plain)
    setCopyNote('已复制纯文本到剪贴板')
    setTimeout(() => setCopyNote(null), 3000)
  }

  // 发送 Chat 消息
  const handleSendChat = async (promptText?: string) => {
    const text = (promptText || chatInput).trim()
    if (!text || chatBusy) return

    if (!configured) {
      setStatusMessage('请先配置 API Key 或模型连接')
      onOpenSettings?.()
      return
    }

    const userMsg: ChatMessage = {
      id: String(Date.now()),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }

    setChatMessages((prev) => [...prev, userMsg])
    if (!promptText) setChatInput('')
    setChatBusy(true)

    try {
      const replyText = await chatFlashNewsAssistant(
        [...chatMessages, userMsg],
        {
          title: activeTitle || title,
          body: body || content,
          rawMaterial: content,
          sourceUrl,
          category,
        },
        text
      )

      const assistantMsg: ChatMessage = {
        id: String(Date.now() + 1),
        role: 'assistant',
        content: replyText,
        timestamp: Date.now(),
      }
      setChatMessages((prev) => [...prev, assistantMsg])
    } catch (err) {
      const errMsg: ChatMessage = {
        id: String(Date.now() + 1),
        role: 'assistant',
        content: `⚠️ 请求失败：${err instanceof Error ? err.message : '网络或模型异常'}`,
        timestamp: Date.now(),
      }
      setChatMessages((prev) => [...prev, errMsg])
    } finally {
      setChatBusy(false)
    }
  }

  // 从 AI 回复中提取 Markdown 正文并一键应用
  const extractAndApplyMarkdown = (msgContent: string) => {
    const match = msgContent.match(/```(?:markdown)?\s*([\s\S]*?)```/)
    if (match && match[1].trim()) {
      setBody(match[1].trim())
      setCopyNote('✨ 已将 AI 修改后的正文应用到编辑器')
      setTimeout(() => setCopyNote(null), 3000)
    } else {
      setBody(msgContent.trim())
      setCopyNote('✨ 已将建议内容更新到正文')
      setTimeout(() => setCopyNote(null), 3000)
    }
  }

  const currentModelName = llmConfig.provider === 'gemini'
    ? (llmConfig.geminiModel || defaultGeminiModel)
    : (llmConfig.openaiModel || defaultOpenaiModel)

  const activeModelDisplay = llmConfig.provider === 'gemini'
    ? `Gemini · ${currentModelName}`
    : `OpenAI 兼容 · ${currentModelName}`

  return (
    <div className="flash-workspace-shell">
      <div className={`flash-workspace ${showCopilot ? 'has-copilot' : ''}`}>
        {/* 左侧：素材与突发线索录入 */}
        <section className="flash-panel flash-input-panel">
          <div className="flash-panel-header">
            <h2><Zap size={17} style={{ color: 'var(--brand)' }} />突发素材录入</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                className="flash-btn-primary"
                style={{ padding: '6px 14px', fontSize: '13px' }}
                disabled={generating || (!content.trim() && !title.trim())}
                onClick={handleGenerate}
              >
                {generating ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
                {generating ? '撰写中…' : '⚡️ 开始生成快讯'}
              </button>
            </div>
          </div>

          {issue?.stories?.length ? (
            <div className="flash-field">
              <label>从当前刊期选题中快速载入</label>
              <select
                aria-label="从当前刊期选题载入"
                value={selectedStoryId}
                onChange={(e) => handleSelectStory(e.target.value)}
              >
                <option value="">-- 手动输入外部突发新闻 --</option>
                {issue.stories.map((story) => (
                  <option key={story.id} value={story.id}>
                    [{story.category}] {story.title}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="flash-field">
            <label>新闻标题 / 核心事件</label>
            <input
              type="text"
              value={title}
              placeholder="例如：苹果「带摄像头的 AirPods」意外曝光 / Stripe 80 亿美元买下 OpenRouter"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div className="flash-field">
              <label>分类</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="大公司">大公司</option>
                <option value="新产品">新产品 / 硬件</option>
                <option value="AI / 开发者">AI / 开发者</option>
                <option value="新消费">新消费</option>
                <option value="好看的">好看的 / 影视</option>
              </select>
            </div>
            <div className="flash-field">
              <label>一手来源 / 报道链接</label>
              <input
                type="text"
                value={sourceUrl}
                placeholder="https://..."
                onChange={(e) => setSourceUrl(e.target.value)}
              />
            </div>
          </div>

          <div className="flash-field">
            <label>配图 URL（可选）</label>
            <input
              type="text"
              value={imageUrl}
              placeholder="https://... 或本地图片"
              onChange={(e) => setImageUrl(e.target.value)}
            />
            {imageUrl ? (
              <div style={{ marginTop: '8px', maxHeight: '140px', overflow: 'hidden', borderRadius: '6px' }}>
                <img src={imageUrl} alt="配图预览" style={{ width: '100%', height: 'auto', objectFit: 'cover' }} />
              </div>
            ) : null}
          </div>

          <div className="flash-field" style={{ flex: 1, minHeight: '180px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
              <label style={{ marginBottom: 0, whiteSpace: 'nowrap', flexShrink: 0 }}>原始素材 / 新闻线索</label>
              <button
                type="button"
                className="flash-extract-btn"
                disabled={extractingUrls}
                onClick={handleExtractUrls}
                title="自动识别文本框中的链接并抓取解析新闻正文与配图"
              >
                {extractingUrls ? <LoaderCircle size={12} className="spin" /> : <Globe size={12} />}
                <span>{extractingUrls ? '抓取中…' : '智能提取正文'}</span>
              </button>
            </div>
            <textarea
              style={{ minHeight: '180px', resize: 'vertical' }}
              value={content}
              placeholder="可直接粘贴外媒/公众号/新闻报道链接（支持多链接，一行一个），点击「智能提取正文」或直接开始生成；亦可直接粘贴原文..."
              onChange={(e) => setContent(e.target.value)}
            />
          </div>

          {/* 标题备选矩阵（生成后在左侧展示供快速选用） */}
          {result?.titles?.length ? (
            <div className="flash-field">
              <label>备选标题矩阵（点击选用）</label>
              <div className="flash-title-matrix">
                {result.titles.map((optTitle, idx) => {
                  const isSelected = activeTitle === optTitle
                  return (
                    <button
                      key={idx}
                      type="button"
                      className={`flash-title-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => setActiveTitle(optTitle)}
                    >
                      <span className="title-index-badge">{String(idx + 1).padStart(2, '0')}</span>
                      <span className="title-text">{optTitle}</span>
                      {isSelected ? <Check size={15} className="title-check-icon" /> : null}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          {/* 核心要点标签 */}
          {keyPoints.length ? (
            <div className="flash-field">
              <label>核心要点速览</label>
              <div className="flash-keypoints">
                {keyPoints.map((point, idx) => (
                  <span key={idx} className="flash-keypoint-tag">
                    • {point}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
            <button
              type="button"
              className="flash-btn-primary"
              disabled={generating || (!content.trim() && !title.trim())}
              onClick={handleGenerate}
            >
              {generating ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
              {generating ? '正在智能撰写快讯…' : '⚡️ 开始生成快讯'}
            </button>

            {onSwitchToDraft ? (
              <button type="button" className="flash-btn-secondary" onClick={onSwitchToDraft}>
                返回早报大盘
              </button>
            ) : null}
          </div>
        </section>

        {/* 中间：快讯正文与 Markdown 所见即所得编辑焦点 */}
        <section className={`flash-panel flash-output-panel ${isFullscreen ? 'is-fullscreen' : ''}`}>
          <div className="flash-panel-header">
            <h2 className="flash-panel-title">
              <FileText size={18} style={{ color: 'var(--blue)' }} />正文工坊
            </h2>
            <div className="flash-header-actions">
              {/* 快捷模型切换控件 */}
              <div style={{ position: 'relative', minWidth: 0, flexShrink: 1 }}>
                <button
                  ref={modelPickerTriggerRef}
                  type="button"
                  className={`flash-engine-badge ${configured ? 'active' : ''}`}
                  onClick={toggleModelPicker}
                  title={`当前引擎：${llmConfig.provider === 'gemini' ? 'Google Gemini' : 'OpenAI 兼容'} · 模型：${currentModelName} · 思考强度：${THINKING_LEVEL_MAP[llmConfig.thinkingLevel || 'high']?.label || 'High'}`}
                >
                  <span className="badge-brand-tag">⚡️ {llmConfig.provider === 'gemini' ? 'Gemini' : 'OpenAI'}</span>
                  <span className="badge-model-name">{currentModelName}</span>
                  {isThinkingCapable(currentModelName) ? (
                    <span className="badge-thinking-pill">{THINKING_LEVEL_MAP[llmConfig.thinkingLevel || 'high']?.shortLabel || 'High'}</span>
                  ) : null}
                  <ChevronDown size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
                </button>

                {showModelPicker ? (
                  <div
                    ref={modelPickerRef}
                    className={`flash-model-dropdown ${modelPickerClosing ? 'is-closing' : ''}`}
                    onMouseEnter={cancelHoverTimer}
                    onMouseLeave={(e) => {
                      const related = e.relatedTarget as HTMLElement | null
                      if (!related?.closest('.thinking-flyout-submenu')) {
                        scheduleClearHoveredModel(220)
                      }
                    }}
                  >
                    <div className="dropdown-tabs">
                      <button
                        type="button"
                        className={`dropdown-tab ${modelTab === 'gemini' ? 'active' : ''}`}
                        onClick={() => { setModelTab('gemini'); setHoveredModel(null) }}
                      >
                        Google Gemini
                      </button>
                      <button
                        type="button"
                        className={`dropdown-tab ${modelTab === 'openai' ? 'active' : ''}`}
                        onClick={() => { setModelTab('openai'); setHoveredModel(null) }}
                      >
                        OpenAI 兼容
                      </button>
                    </div>

                    <div className="dropdown-search-box">
                      <Search size={13} />
                      <input
                        type="text"
                        value={modelFilter}
                        placeholder="搜索 API 返回的模型..."
                        onChange={(e) => { setModelFilter(e.target.value); setHoveredModel(null) }}
                        autoFocus
                      />
                      {loadingModels ? <LoaderCircle size={13} className="spin" /> : (
                        <button type="button" className="refresh-models-btn" title="从 API 重新读取可用模型" onClick={() => void fetchModels(modelTab)}>
                          <RefreshCw size={12} />
                        </button>
                      )}
                    </div>

                    <div className="dropdown-model-list">
                      {loadingModels ? (
                        <div className="dropdown-state-row">
                          <LoaderCircle size={14} className="spin" />
                          <span>正在从 API 获取模型列表…</span>
                        </div>
                      ) : modelsError ? (
                        <div className="dropdown-state-row error">
                          <span>{modelsError}</span>
                          <button type="button" onClick={() => void fetchModels(modelTab)}>重试</button>
                        </div>
                      ) : availableModels.length ? (
                        availableModels
                          .filter((m) => !modelFilter.trim() || m.name.toLowerCase().includes(modelFilter.toLowerCase()) || m.displayName.toLowerCase().includes(modelFilter.toLowerCase()))
                          .map((m) => {
                            const isSelected = llmConfig.provider === modelTab && currentModelName === m.name
                            const supportsThinking = isThinkingCapable(m.name)
                            const currentThinkingLabel = THINKING_LEVEL_MAP[llmConfig.thinkingLevel || 'high']?.shortLabel || 'High'

                            return (
                              <div
                                key={m.name}
                                className={`model-item-wrapper ${hoveredModel?.name === m.name ? 'is-hovered' : ''}`}
                                onMouseEnter={(e) => {
                                  if (supportsThinking) {
                                    const rect = e.currentTarget.getBoundingClientRect()
                                    const parentRect = modelPickerRef.current?.getBoundingClientRect()
                                    const top = parentRect ? rect.top - parentRect.top : 0
                                    const spaceOnRight = window.innerWidth - (parentRect?.right ?? 0)
                                    const placement: 'right' | 'left' = spaceOnRight > 185 ? 'right' : 'left'
                                    setHoveredModelImmediate({
                                      name: m.name,
                                      top: Math.max(8, top),
                                      displayName: m.displayName || m.name,
                                      placement,
                                    })
                                  } else {
                                    scheduleClearHoveredModel(160)
                                  }
                                }}
                              >
                                <button
                                  type="button"
                                  className={`dropdown-item ${isSelected ? 'selected' : ''}`}
                                  onClick={() => handleSwitchModel(modelTab, m.name)}
                                >
                                  <span className="model-name-text">{m.displayName || m.name}</span>
                                  <div className="model-item-meta">
                                    {isSelected && supportsThinking ? (
                                      <span className="model-thinking-tag">{currentThinkingLabel}</span>
                                    ) : null}
                                    {supportsThinking ? (
                                      <ChevronRight size={13} className="model-chevron" />
                                    ) : isSelected ? (
                                      <Check size={14} />
                                    ) : null}
                                  </div>
                                </button>
                              </div>
                            )
                          })
                      ) : (
                        <div className="dropdown-state-row">
                          <span>未读取到模型，可直接在下方输入</span>
                        </div>
                      )}
                    </div>

                    {/* 级联思考强度二级菜单 (Cursor 风格，自适应左右方向与过渡动画) */}
                    {hoveredModel ? (
                      <div
                        className={`thinking-flyout-submenu ${hoveredModel.placement === 'right' ? 'placement-right' : 'placement-left'}`}
                        style={{ top: `${hoveredModel.top}px` }}
                        onMouseEnter={cancelHoverTimer}
                        onMouseLeave={() => scheduleClearHoveredModel(180)}
                      >
                        <div className="flyout-header">Reasoning 强度</div>
                        {THINKING_LEVELS.map((lvl) => {
                          const isSelected = llmConfig.provider === modelTab && currentModelName === hoveredModel.name
                          const isLevelActive = isSelected && (llmConfig.thinkingLevel || 'high') === lvl.id
                          return (
                            <button
                              key={lvl.id}
                              type="button"
                              className={`flyout-item ${isLevelActive ? 'selected' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleSwitchModelAndThinking(modelTab, hoveredModel.name, lvl.id)
                                setHoveredModel(null)
                              }}
                            >
                              <div className="flyout-item-label">
                                <strong>{lvl.label}</strong>
                                <small>{lvl.desc}</small>
                              </div>
                              {isLevelActive ? <Check size={14} /> : null}
                            </button>
                          )
                        })}
                      </div>
                    ) : null}

                    <div className="dropdown-custom-input">
                      <input
                        type="text"
                        value={customModelInput}
                        placeholder="输入自定义模型名称并回车..."
                        onChange={(e) => setCustomModelInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && customModelInput.trim()) {
                            e.preventDefault()
                            handleSwitchModel(modelTab, customModelInput.trim())
                            setCustomModelInput('')
                          }
                        }}
                      />
                      {customModelInput.trim() ? (
                        <button
                          type="button"
                          className="apply-custom-btn"
                          onClick={() => {
                            handleSwitchModel(modelTab, customModelInput.trim())
                            setCustomModelInput('')
                          }}
                        >
                          选用
                        </button>
                      ) : null}
                    </div>

                    <div className="dropdown-footer">
                      <button type="button" onClick={() => { closeModelPicker(); onOpenSettings?.() }}>
                        <SlidersHorizontal size={13} /> 完整配置 Key & Base URL
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* 展开/收起 AI 侧边栏按钮 */}
              <button
                type="button"
                className={`icon-button ${showCopilot && !copilotClosing ? 'active' : ''}`}
                title={showCopilot ? '收起 AI 修改助手' : '展开 AI 修改助手'}
                onClick={toggleCopilot}
              >
                {showCopilot && !copilotClosing ? <PanelRightClose size={16} /> : <Bot size={16} />}
              </button>
            </div>
          </div>

          {statusMessage ? (
            <div className={`flash-status-banner ${statusClosing ? 'is-closing' : ''} ${statusMessage.includes('失败') || statusMessage.includes('错误') || statusMessage.includes('Error') || statusMessage.includes('未能') || statusMessage.includes('无法') ? 'error' : ''}`}>
              <div className="status-banner-content">
                <Info size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span className="status-banner-text">{statusMessage}</span>
              </div>
              <button type="button" className="close-status-btn" onClick={() => setStatusMessage(null)} title="关闭提示">
                <X size={13} />
              </button>
            </div>
          ) : null}

          {/* 当前选用标题 */}
          <div className="flash-field">
            <label>快讯标题（可直接编辑微调）</label>
            <input
              type="text"
              value={activeTitle}
              placeholder="快讯标题..."
              style={{ fontSize: '14.5px', fontWeight: 600 }}
              onChange={(e) => setActiveTitle(e.target.value)}
            />
          </div>

          {/* 正文编辑与排版 (ChatGPT 风格卡片：含统计、格式化、复制与全屏预览) */}
          <div className="flash-field" style={{ flex: 1, minHeight: '320px', display: 'flex', flexDirection: 'column' }}>
            <div className="flash-editor-card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div className="flash-editor-toolbar">
                <div className="editor-tab-group">
                  <button
                    type="button"
                    className={`editor-tab-btn ${editorTab === 'edit' ? 'active' : ''}`}
                    onClick={() => setEditorTab('edit')}
                  >
                    <FileText size={13} /> 编辑 Markdown
                  </button>
                  <button
                    type="button"
                    className={`editor-tab-btn ${editorTab === 'preview' ? 'active' : ''}`}
                    onClick={() => setEditorTab('preview')}
                  >
                    <Eye size={13} /> 排版预览
                  </button>
                </div>

                <div className="editor-tools-group">
                  <span className="editor-stat-badge">
                    {body.replace(/\s+/g, '').length} 字 · 约 {Math.max(1, Math.ceil(body.replace(/\s+/g, '').length / 350))} 分钟
                  </span>
                  <button
                    type="button"
                    className="editor-tool-btn"
                    onClick={handleFormatMarkdown}
                    title="自动规范直角引号「」与中英文空格"
                  >
                    <Wand2 size={12} /> 格式化
                  </button>
                  <button
                    type="button"
                    className="editor-tool-btn"
                    onClick={handleCopyMarkdown}
                    title="复制 Markdown 原文"
                  >
                    <Copy size={12} /> 复制
                  </button>
                  <button
                    type="button"
                    className={`editor-tool-btn ${isFullscreen ? 'active' : ''}`}
                    onClick={() => setIsFullscreen(!isFullscreen)}
                    title={isFullscreen ? '退出全屏 (Esc)' : '全屏专注模式'}
                  >
                    {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                    {isFullscreen ? '退出全屏' : '全屏'}
                  </button>
                </div>
              </div>

              {editorTab === 'edit' ? (
                <textarea
                  className="flash-editor-textarea"
                  style={{ flex: 1, minHeight: '340px' }}
                  value={body}
                  placeholder="快讯正文将在此处生成，支持实时编辑..."
                  onChange={(e) => setBody(e.target.value)}
                />
              ) : (
                <div className="flash-editor-preview" style={{ flex: 1, minHeight: '340px' }}>
                  {renderPreviewHtml(body)}
                </div>
              )}
            </div>
          </div>

          {/* 独立飞书文档创建成功提示卡 */}
          {publishedDoc ? (
            <div className="flash-doc-success-card">
              <div>
                <strong style={{ display: 'block', fontSize: '13px', color: '#176b88' }}>
                  🎉 独立飞书快讯文档已成功创建
                </strong>
                <small style={{ color: 'var(--muted)' }}>{publishedDoc.document_title}</small>
              </div>
              <a
                href={publishedDoc.document_url}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={15} /> 立即在飞书打开
              </a>
            </div>
          ) : null}

          {/* 操作栏 */}
          <div className="flash-action-bar">
            <button
              type="button"
              className="flash-btn-feishu"
              disabled={publishing || !activeTitle.trim() || !body.trim()}
              onClick={handlePublishToLark}
            >
              {publishing ? <LoaderCircle size={16} className="spin" /> : <ExternalLink size={16} />}
              {publishing ? '正在创建飞书文档…' : '🚀 创建独立飞书快讯文档'}
            </button>

            <button
              type="button"
              className="flash-btn-secondary"
              disabled={!activeTitle.trim() || !body.trim()}
              onClick={handleCopyMarkdown}
            >
              <Copy size={15} /> 复制 Markdown
            </button>

            <button
              type="button"
              className="flash-btn-secondary"
              disabled={!activeTitle.trim() || !body.trim()}
              onClick={handleCopyText}
            >
              <Copy size={15} /> 复制纯文本
            </button>

            {copyNote ? (
              <span style={{ fontSize: '12px', color: 'var(--green)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Check size={14} /> {copyNote}
              </span>
            ) : null}
          </div>
        </section>

        {/* 右侧：AI Copilot 智能对话修改助手 */}
        {showCopilot ? (
          <section className={`flash-panel flash-copilot-panel ${copilotClosing ? 'is-closing' : ''}`}>
            <div className="flash-panel-header">
              <h2><Bot size={18} style={{ color: 'var(--brand)' }} />AI 修改助手</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  className="icon-button"
                  title="关闭侧边栏"
                  onClick={toggleCopilot}
                >
                  <PanelRightClose size={15} />
                </button>
              </div>
            </div>

            {/* 对话上下文提示条 */}
            <div className="copilot-context-bar">
              <FileText size={13} />
              <span>当前上下文：<strong>{activeTitle || title || '未命名草稿'}</strong></span>
            </div>

            {/* 快捷指令胶囊 */}
            <div className="copilot-quick-pills">
              {QUICK_PROMPTS.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="copilot-pill"
                  disabled={chatBusy}
                  onClick={() => void handleSendChat(p.prompt)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* 消息历史滚动区 */}
            <div className="copilot-messages-container" ref={chatContainerRef}>
              {chatMessages.map((msg) => (
                <div key={msg.id} className={`copilot-msg-bubble ${msg.role}`}>
                  <div className="msg-header">
                    <strong>{msg.role === 'user' ? '主编' : 'AI 副主编'}</strong>
                    {msg.timestamp ? <small>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small> : null}
                  </div>
                  <div className="msg-content">{msg.content}</div>

                  {/* 若包含 Markdown 建议，显示一键应用按钮 */}
                  {msg.role === 'assistant' && (msg.content.includes('```') || msg.content.includes('**爱范儿')) ? (
                    <div className="msg-actions">
                      <button
                        type="button"
                        className="apply-text-btn"
                        onClick={() => extractAndApplyMarkdown(msg.content)}
                      >
                        <Wand2 size={13} /> 一键应用到正文
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
              {chatBusy ? (
                <div className="copilot-msg-bubble assistant typing">
                  <LoaderCircle size={15} className="spin" /> AI 副主编正在组织修改建议…
                </div>
              ) : null}
            </div>

            {/* 输入交互区 */}
            <div className="copilot-input-area">
              <textarea
                value={chatInput}
                rows={2}
                placeholder="用自然语言指示修改，例如：把第二段改得更有悬念 / 增加 Stripe 收购对价背景 / 帮我缩写到 200 字..."
                disabled={chatBusy}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void handleSendChat()
                  }
                }}
              />
              <div className="copilot-input-footer">
                <span className="copilot-model-hint">⚡️ {currentModelName}</span>
                <button
                  type="button"
                  className="copilot-send-btn"
                  disabled={chatBusy || !chatInput.trim()}
                  onClick={() => void handleSendChat()}
                >
                  {chatBusy ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />}
                  发送
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {/* 未保存修改离开拦截确认弹窗 */}
        {showLeaveModal ? (
          <div className="modal-backdrop" style={{ zIndex: 1200 }} role="presentation" onMouseDown={() => setShowLeaveModal(null)}>
            <div className="modal-card" style={{ maxWidth: '440px', width: '90%', background: 'var(--paper)', borderRadius: '12px', padding: '22px', border: '1px solid var(--line)' }} onMouseDown={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(234, 88, 12, 0.12)', color: '#ea580c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Save size={18} />
                </div>
                <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--ink)' }}>是否保存当前稿件草稿？</h3>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.6', marginBottom: '18px' }}>
                您有正在编辑的快讯内容或生成结果，离开前可以保存为草稿，后续随时可以在「主页 - 最近使用项」中一键恢复继续编辑。
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button
                  type="button"
                  className="flash-btn-primary"
                  style={{ width: '100%', padding: '9px', fontSize: '13px', justifyContent: 'center' }}
                  onClick={() => {
                    onSaveDraft?.({
                      id: draftId,
                      title: activeTitle.trim() || title.trim() || '未命名快讯草稿',
                      body,
                      category,
                      sourceUrl,
                      imageUrl,
                      content,
                      keyPoints,
                      publishedDoc: publishedDoc || undefined,
                      updatedAt: Date.now(),
                    })
                    const action = showLeaveModal
                    setShowLeaveModal(null)
                    action()
                  }}
                >
                  <Save size={14} /> 💾 保存草稿并离开
                </button>
                <button
                  type="button"
                  className="btn-secondary danger"
                  style={{ width: '100%', padding: '9px', fontSize: '13px', justifyContent: 'center', color: '#ef4444' }}
                  onClick={() => {
                    const action = showLeaveModal
                    setShowLeaveModal(null)
                    action()
                  }}
                >
                  🚪 不保存直接离开
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ width: '100%', padding: '8px', fontSize: '12.5px', justifyContent: 'center' }}
                  onClick={() => setShowLeaveModal(null)}
                >
                  ↩️ 继续留在本页编辑
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function renderPreviewHtml(markdown: string) {
  if (!markdown.trim()) {
    return <div className="preview-placeholder">快讯正文暂为空，生成或输入后将在此处实时排版预览</div>
  }
  const lines = markdown.split('\n')
  return (
    <div className="flash-preview-article">
      {lines.map((line, idx) => {
        const trimmed = line.trim()
        if (!trimmed) return <div key={idx} className="preview-space" />
        if (trimmed.startsWith('### ')) {
          return <h3 key={idx}>{trimmed.replace(/^###\s+/, '')}</h3>
        }
        if (trimmed.startsWith('## ')) {
          return <h2 key={idx}>{trimmed.replace(/^##\s+/, '')}</h2>
        }
        if (trimmed.startsWith('# ')) {
          return <h1 key={idx}>{trimmed.replace(/^#\s+/, '')}</h1>
        }
        if (trimmed.startsWith('> ')) {
          return <blockquote key={idx}>{trimmed.replace(/^>\s+/, '')}</blockquote>
        }
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return <li key={idx}>{renderInlineMarkdown(trimmed.replace(/^[-*]\s+/, ''))}</li>
        }
        return <p key={idx}>{renderInlineMarkdown(line)}</p>
      })}
    </div>
  )
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i}>{part.slice(1, -1)}</code>
    }
    return part
  })
}
