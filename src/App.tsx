import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  ArrowUpDown,
  BookOpen,
  Check,
  ChevronRight,
  CircleDot,
  CloudOff,
  Download,
  ExternalLink,
  Eye,
  FileCheck2,
  Film,
  FolderInput,
  Gamepad2,
  Image,
  Library,
  LoaderCircle,
  Menu,
  Moon,
  PanelRightClose,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEventHandler, type ReactNode } from 'react'
import { api, apiUrlProblem, describeWorkerError, getApiUrl, lanConsoleUrl, normalizeApiUrl, setApiUrl, tailscaleConsoleUrl } from './api'
import { comparePublicationStories, groupPublicationStories, normalizeStoryCategory, publicationCategories, publicationCategoryOrder } from './categories'
import { generateBrandHeadlines, hasGeminiKey, saveGeminiKey as persistGeminiKey } from './gemini'
import { buildReviewExport, downloadText, renderIssueMarkdown } from './review'
import type { EditorialReviewExport } from './review'
import type { AutomationHandoff, BrandPackage, Issue, Job, Source, Story, StoryCreateInput, StoryStatus } from './types'
import ifanrLogoDarkUrl from './assets/ifanr-logo-dark.png'
import ifanrLogoLightUrl from './assets/ifanr-logo-light.png'

const categories = ['全部', ...publicationCategories]
const categoryOrder = publicationCategoryOrder
const weekendDraftCategories = ['周末也值得一看的新闻', 'One Fun Thing', '周末看什么', '买书不读指南', '游戏推荐'] as const
const workerRefreshIntervalMs = 25_000

function isSaturdayPublication(publicationDate?: string) {
  if (!publicationDate) return false
  const [year, month, day] = publicationDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 6
}

function weekendDraftSection(story: Story) {
  const title = story.title.trim()
  if (/^One Fun Thing[｜|]/i.test(title)) return 'One Fun Thing'
  if (/^周末看什么[｜|]/.test(title)) return '周末看什么'
  if (/^买书不读指南[｜|]/.test(title)) return '买书不读指南'
  if (/^游戏推荐[｜|]/.test(title)) return '游戏推荐'
  return '周末也值得一看的新闻'
}

function moveToWeekendDraftSection(story: Story, section: string) {
  const match = story.title.match(/^(One Fun Thing|周末看什么|买书不读指南|游戏推荐)｜(主选|备选)｜(.+)$/i)
  const plainTitle = match ? match[3] : story.title.replace(/^周末也值得一看的新闻｜/, '')
  if (section === '周末也值得一看的新闻') return plainTitle
  const slot = match?.[2] || '主选'
  return `${section}｜${slot}｜${plainTitle}`
}

function groupDraftStories(stories: Story[], isSaturday: boolean): Array<readonly [string, Story[]]> {
  if (!isSaturday) return groupPublicationStories(stories)
  const groups = new Map<string, Story[]>()
  stories.forEach((story) => {
    const section = weekendDraftSection(story)
    groups.set(section, [...(groups.get(section) || []), story])
  })
  return weekendDraftCategories.map((section) => [section, groups.get(section) || []] as const)
}

const statusLabel: Record<string, string> = {
  discovered: '待判断',
  source_chasing: '追源中',
  fulltext_ready: '全文已读',
  fact_checking: '核验中',
  drafting: '写稿中',
  ready: '可用稿',
  needs_review: '待复核',
  excluded: '已排除',
}

const sourceLabel: Record<string, string> = {
  primary: '一手',
  strong: '强来源',
  secondary: '二手',
  lead: '线索',
  unknown: '待追源',
}

type View = 'draft' | 'candidates' | 'trash' | 'brands' | 'weekend'
type WorkerConnection = {
  status: 'checking' | 'connected' | 'pages' | 'failed' | 'invalid'
  detail: string
  url: string
  identity?: string
}

const invisibleEditorialCharacters = /[\u200B-\u200D\u2060\uFEFF]/g

function cleanBodyLine(line: string) {
  return line.replace(invisibleEditorialCharacters, '').trim()
}

function hasMeaningfulBody(body: string) {
  return Boolean(cleanBodyLine(body))
}

function pendingAiEditorRequest(story: Story) {
  const request = story.metadata._ai_editor_request
  return Boolean(
    request
    && typeof request === 'object'
    && !Array.isArray(request)
    && (request as Record<string, unknown>).state === 'pending',
  )
}

function IconButton({
  title,
  onClick,
  children,
  active = false,
  disabled = false,
}: {
  title: string
  onClick?: MouseEventHandler<HTMLButtonElement>
  children: ReactNode
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button
      className={`icon-button ${active ? 'active' : ''}`}
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

function BodyBlocks({ body }: { body: string }) {
  const lines = body.replaceAll('\r\n', '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = cleanBodyLine(lines[index])
    if (!line) {
      index += 1
      continue
    }
    if (line.startsWith('- ')) {
      const items: string[] = []
      while (index < lines.length && cleanBodyLine(lines[index]).startsWith('- ')) {
        items.push(cleanBodyLine(lines[index]).slice(2))
        index += 1
      }
      blocks.push(<ul key={`list-${index}`}>{items.map((item) => <li key={item}>{item}</li>)}</ul>)
      continue
    }
    if (line.startsWith('>')) {
      const quote: string[] = []
      while (index < lines.length && cleanBodyLine(lines[index]).startsWith('>')) {
        quote.push(cleanBodyLine(lines[index]).replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push(<blockquote key={`quote-${index}`}>{quote.join('\n')}</blockquote>)
      continue
    }
    const paragraph = [line]
    index += 1
    while (index < lines.length && cleanBodyLine(lines[index]) && !cleanBodyLine(lines[index]).startsWith('- ') && !cleanBodyLine(lines[index]).startsWith('>')) {
      paragraph.push(cleanBodyLine(lines[index]))
      index += 1
    }
    blocks.push(<p key={`p-${index}`}>{paragraph.join(' ')}</p>)
  }
  return <>{blocks}</>
}

function LinkedSourceLine({ story }: { story: Story }) {
  const stored = typeof story.metadata.source_line === 'string' ? story.metadata.source_line : ''
  const fallback = story.sources.length
    ? `🔗 来源：${story.sources.map((source) => source.url).join('；')}`
    : story.source_url ? `🔗 原文链接：${story.source_url}` : ''
  const line = stored || fallback
  if (!line) return null
  const parts = line.split(/(https?:\/\/[^\s；;）)]+)/g)
  return (
    <p className="source-line">
      {parts.map((part, index) => part.startsWith('http')
        ? <a href={part} target="_blank" rel="noreferrer" key={`${part}-${index}`}>{part}</a>
        : <span key={`${part}-${index}`}>{part}</span>)}
    </p>
  )
}

export function IssueArticle({
  story,
  active,
  onOpen,
  onExclude,
  onDragStart,
  onDrop,
  canMoveUp = false,
  canMoveDown = false,
  onMoveUp,
  onMoveDown,
  onMoveTop,
  onMoveBottom,
  onMoveCategory,
  moveOptions = categories.slice(1),
  currentMoveTarget = story.category,
  moving = false,
}: {
  story: Story
  active: boolean
  onOpen: () => void
  onExclude: () => void
  onDragStart: () => void
  onDrop: () => void
  canMoveUp?: boolean
  canMoveDown?: boolean
  onMoveUp?: () => void
  onMoveDown?: () => void
  onMoveTop?: () => void
  onMoveBottom?: () => void
  onMoveCategory?: (category: string) => void
  moveOptions?: readonly string[]
  currentMoveTarget?: string
  moving?: boolean
}) {
  const image = story.image_path ? api.storyImageUrl(story.id, story.updated_at) : story.image_url
  const awaitingAiEditor = pendingAiEditorRequest(story)
  return (
    <article
      id={`story-${story.id}`}
      className={`issue-article ${active ? 'active' : ''} ${moving ? 'moving' : ''}`}
      onClick={onOpen}
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onDrop()
      }}
    >
      <div className={image ? 'article-layout-with-image' : ''}>
        <div className="article-copy">
          <header>
          <h3>{story.title}</h3>
          {awaitingAiEditor ? <span className="ai-editor-note">待 AI 主编撰写</span> : null}
          {story.changed_since_review ? <span className="changed-note">事实有更新，需复核</span> : null}
          </header>
          {hasMeaningfulBody(story.body)
            ? <div className="article-body"><BodyBlocks body={story.body} /></div>
            : awaitingAiEditor
              ? <p className="pending-editorial-copy">已提交给 AI 主编，等待下一轮追源、核验并按早报 prompt 成稿。</p>
              : null}
          <LinkedSourceLine story={story} />
        </div>
        {image ? <img className="article-side-image" src={image} alt="" /> : null}
      </div>
      <div className="article-hover-tools">
        <label className="category-move-control" title="移动到其他栏目" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
          <FolderInput size={15} />
          <select aria-label="移动到其他栏目" value="" onChange={(event) => { event.stopPropagation(); if (event.target.value) onMoveCategory?.(event.target.value) }}>
            <option value="" disabled>移动到其他栏目</option>
            {moveOptions.filter((category) => category !== currentMoveTarget).map((category) => <option value={category} key={category}>{category}</option>)}
          </select>
        </label>
        {canMoveUp ? <IconButton title="置顶到当前栏目" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onMoveTop?.() }}><ArrowUpToLine size={15} /></IconButton> : null}
        {canMoveUp ? <IconButton title="上移一位" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onMoveUp?.() }}><ArrowUp size={15} /></IconButton> : null}
        {canMoveDown ? <IconButton title="下移一位" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onMoveDown?.() }}><ArrowDown size={15} /></IconButton> : null}
        {canMoveDown ? <IconButton title="置底到当前栏目" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onMoveBottom?.() }}><ArrowDownToLine size={15} /></IconButton> : null}
        {(canMoveUp || canMoveDown) ? <span className="article-tool-divider" /> : null}
        <IconButton title="编辑与核验" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onOpen() }}><FileCheck2 size={15} /></IconButton>
        <IconButton title="移出早报稿" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onExclude() }}><Trash2 size={15} /></IconButton>
      </div>
    </article>
  )
}

function CandidateItem({
  story,
  active,
  onOpen,
  onAdopt,
  onExclude,
}: {
  story: Story
  active: boolean
  onOpen: () => void
  onAdopt: () => void
  onExclude: () => void
}) {
  return (
    <article className={`candidate-row ${active ? 'active' : ''}`} onClick={onOpen}>
      <div className="candidate-main">
        <div className="candidate-overline"><span>{story.category}</span><span>{story.source_name || '待追源'}</span></div>
        <h3>{story.title}</h3>
        <p>{story.editorial_reason || '原始线索尚未按早报 prompt 追源成稿。'}</p>
        <div className="candidate-meta">
          <span className={`status status-${story.status}`}>{statusLabel[story.status]}</span>
          <span className={`quality quality-${story.source_quality}`}>{sourceLabel[story.source_quality] || story.source_quality}</span>
          <span>{story.score.toFixed(1)}</span>
          {story.published_at ? <span>{story.published_at}</span> : null}
        </div>
      </div>
      <div className="candidate-actions">
        <button type="button" className="adopt-button" title="提交给 AI 主编撰写" onClick={(event) => { event.stopPropagation(); onAdopt() }}><Check size={16} /></button>
        <button type="button" className="inline-icon" title="排除" onClick={(event) => { event.stopPropagation(); onExclude() }}><Trash2 size={15} /></button>
        <ChevronRight size={16} />
      </div>
    </article>
  )
}

export function TrashItem({
  story,
  active,
  disabled,
  onOpen,
  onRestore,
}: {
  story: Story
  active: boolean
  disabled: boolean
  onOpen: () => void
  onRestore: () => void
}) {
  return (
    <article className={`candidate-row trash-row ${active ? 'active' : ''}`} onClick={onOpen}>
      <div className="candidate-main">
        <div className="candidate-overline"><span>{story.category}</span><span>{story.source_name || '待追源'}</span></div>
        <h3>{story.title}</h3>
        <p>{story.body || story.editorial_reason || '该条目暂无正文。'}</p>
        <div className="candidate-meta"><span className="status status-excluded">已移入回收站</span><span>{story.category}</span></div>
      </div>
      <div className="candidate-actions">
        <button type="button" className="restore-button" title="恢复到早报稿" aria-label="恢复到早报稿" disabled={disabled} onClick={(event) => { event.stopPropagation(); onRestore() }}><RotateCcw size={16} /></button>
        <ChevronRight size={16} />
      </div>
    </article>
  )
}

function DetailPanel({
  story,
  onPatch,
  onAction,
  onClose,
  activeJob,
  staticMode,
  onImageChange,
  closing = false,
}: {
  story: Story
  onPatch: (patch: Partial<Story>) => Promise<unknown>
  onAction: (action: string, chrome?: boolean) => Promise<void>
  onClose: () => void
  activeJob?: Job
  staticMode: boolean
  onImageChange: (story: Story) => void
  closing?: boolean
}) {
  const [title, setTitle] = useState(story.title)
  const [body, setBody] = useState(story.body)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const titleSaveTimerRef = useRef<number | null>(null)
  const bodySaveTimerRef = useRef<number | null>(null)
  const pendingPatchRef = useRef<Partial<Story>>({})

  useEffect(() => {
    setTitle(story.title)
    setBody(story.body)
    pendingPatchRef.current = {}
    setSaveState('saved')
  }, [story.id])

  const persist = useCallback(async (patch: Partial<Story>) => {
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch }
    setSaveState('saving')
    try {
      await onPatch(patch)
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }, [onPatch])

  const schedulePersist = useCallback((field: 'title' | 'body', value: string, immediate = false) => {
    const timerRef = field === 'title' ? titleSaveTimerRef : bodySaveTimerRef
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    const submit = () => {
      timerRef.current = null
      void persist({ [field]: value })
    }
    if (immediate) submit()
    else timerRef.current = window.setTimeout(submit, 600)
  }, [persist])

  const flushPending = useCallback(() => {
    if (titleSaveTimerRef.current !== null) {
      window.clearTimeout(titleSaveTimerRef.current)
      titleSaveTimerRef.current = null
      if (title !== story.title) void persist({ title })
    }
    if (bodySaveTimerRef.current !== null) {
      window.clearTimeout(bodySaveTimerRef.current)
      bodySaveTimerRef.current = null
      if (body !== story.body) void persist({ body })
    }
  }, [body, persist, story.body, story.title, title])

  useEffect(() => () => {
    if (titleSaveTimerRef.current !== null) window.clearTimeout(titleSaveTimerRef.current)
    if (bodySaveTimerRef.current !== null) window.clearTimeout(bodySaveTimerRef.current)
  }, [])

  return (
    <aside className={`detail-panel ${closing ? 'closing' : ''}`}>
      <div className="detail-toolbar">
        <span className="detail-kicker">稿件与来源</span>
        <span className={`autosave-state ${saveState}`} aria-live="polite">{saveState === 'saving' ? '正在保存' : saveState === 'error' ? '保存失败' : staticMode ? '本地审稿' : '已保存'}</span>
        <IconButton title="关闭详情" onClick={() => { flushPending(); onClose() }}><PanelRightClose size={18} /></IconButton>
      </div>
      <div className="detail-scroll">
        <label className="field-label" htmlFor="story-title">标题</label>
        <textarea id="story-title" className="title-editor" value={title} rows={2} onChange={(event) => { const value = event.target.value; setTitle(value); schedulePersist('title', value) }} onBlur={() => title !== story.title && schedulePersist('title', title, true)} />
        <div className="field-row">
          <label><span className="field-label">分类</span><select value={story.category} onChange={(event) => void onPatch({ category: event.target.value })}>{categories.slice(1).map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span className="field-label">状态</span><select value={story.status} onChange={(event) => void onPatch({ status: event.target.value as StoryStatus })}>{Object.entries(statusLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        </div>
        <div className="time-grid">
          <label><span className="field-label">事件发生日</span><input type="date" value={story.event_date || ''} onChange={(event) => void onPatch({ event_date: event.target.value })} /></label>
          <label><span className="field-label">首次披露</span><input value={story.disclosed_at || ''} onChange={(event) => void onPatch({ disclosed_at: event.target.value })} placeholder="来源首次披露时间" /></label>
        </div>
        <div className="action-strip">
          <button type="button" disabled={staticMode} title={staticMode ? 'AI 操作由主 Mac 的下一轮自动化执行' : ''} onClick={() => void onAction('source-chase')}><Search size={16} />追原始信源</button>
          <button type="button" disabled={staticMode} title={staticMode ? 'Chrome 补读只能在主 Mac 执行' : ''} onClick={() => void onAction('chrome-read', true)}><Eye size={16} />Chrome 补读</button>
          <button type="button" disabled={staticMode} title={staticMode ? '事实核验由主 Mac 的下一轮自动化执行' : ''} onClick={() => void onAction('fact-check')}><ShieldCheck size={16} />事实核验</button>
          <button type="button" disabled={staticMode} title={staticMode ? '可以直接编辑正文，或在审稿单中交给下一轮处理' : ''} onClick={() => void onAction('rewrite')}><WandSparkles size={16} />按早报 prompt 重写</button>
          <button type="button" disabled={staticMode} title={staticMode ? '找图由主 Mac 执行' : ''} onClick={() => void onAction('image-search')}><Image size={16} />找图</button>
        </div>
        {staticMode ? <p className="static-mode-note">当前显示当天 Bot 稿的 Pages 快照。可以在浏览器内审稿并导出审稿单；连接 Worker 后才会把修改直接保存到主 Mac。</p> : null}
        {activeJob ? <div className={`job-banner ${activeJob.state}`}><LoaderCircle size={16} className={activeJob.state === 'running' ? 'spin' : ''} /><span>{activeJob.message || activeJob.action}</span><strong>{activeJob.progress}%</strong></div> : null}
        <label className="field-label" htmlFor="story-body">{story.metadata.content_role === 'lead_only' ? '待成稿（原始抓取材料不会直接进入正文）' : '正文'}</label>
        <textarea id="story-body" className="body-editor" value={body} onChange={(event) => { const value = event.target.value; setBody(value); schedulePersist('body', value) }} onBlur={() => body !== story.body && schedulePersist('body', body, true)} />
        <DetailSources story={story} staticMode={staticMode} onImageChange={onImageChange} />
      </div>
    </aside>
  )
}

export function StoryImageEditor({ story, staticMode, onImageChange }: { story: Story; staticMode: boolean; onImageChange: (story: Story) => void }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<'upload' | 'url' | 'sources' | 'delete' | null>(null)
  const [message, setMessage] = useState('')
  const fileInput = useRef<HTMLInputElement | null>(null)
  const image = story.image_path ? api.storyImageUrl(story.id, story.updated_at) : story.image_url

  useEffect(() => {
    setUrl('')
    setMessage('')
    setBusy(null)
  }, [story.id])

  const run = async (operation: 'upload' | 'url' | 'sources' | 'delete', task: () => Promise<Story>) => {
    setBusy(operation)
    setMessage('')
    try {
      const updated = await task()
      onImageChange(updated)
      setUrl('')
      setMessage(operation === 'delete' ? '配图已删除' : '配图已保存到主 Mac')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '配图操作失败')
    } finally {
      setBusy(null)
    }
  }

  const chooseFile = () => fileInput.current?.click()
  const uploadFile = (file?: File) => {
    if (!file) return
    void run('upload', () => api.uploadStoryImage(story.id, file))
  }
  const useUrl = () => {
    const value = url.trim()
    if (!value) {
      setMessage('请先粘贴图片 URL')
      return
    }
    void run('url', () => api.downloadStoryImage(story.id, value))
  }
  const resolveFromSources = () => void run('sources', () => api.resolveStoryImage(story.id))

  useEffect(() => {
    const pasteImage = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items || []).find((candidate) => candidate.kind === 'file' && candidate.type.startsWith('image/'))
      const file = item?.getAsFile()
      if (!file || busy !== null) return
      event.preventDefault()
      if (staticMode) {
        setMessage('连接 Worker 后才能粘贴配图')
        return
      }
      uploadFile(file)
    }
    window.addEventListener('paste', pasteImage)
    return () => window.removeEventListener('paste', pasteImage)
  }, [story.id, staticMode, busy])

  return (
    <section className="detail-section image-section">
      <div className="section-heading"><Image size={16} /><h4>配图</h4><span>{image ? '已配图' : '未配图'}</span></div>
      <div className={`image-preview ${image ? 'has-image' : ''}`}>
        {image ? <img src={image} alt={story.title} /> : <div className="image-empty"><Image size={22} /><span>尚未添加配图</span></div>}
      </div>
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        disabled={staticMode || busy !== null}
        onChange={(event) => {
          uploadFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <div className="image-actions">
        <button type="button" disabled={staticMode || busy !== null} onClick={chooseFile}>
          {busy === 'upload' ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}
          {image ? '替换本地图' : '上传本地图'}
        </button>
        <button type="button" disabled={staticMode || busy !== null} onClick={resolveFromSources}>
          {busy === 'sources' ? <LoaderCircle size={15} className="spin" /> : <Image size={15} />}从原始来源找图
        </button>
        {image ? <button type="button" className="danger" disabled={staticMode || busy !== null} onClick={() => void run('delete', () => api.deleteStoryImage(story.id))}>
          {busy === 'delete' ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}删除
        </button> : null}
      </div>
      <div className="image-url-editor">
        <input type="url" value={url} disabled={staticMode || busy !== null} placeholder="粘贴原图 URL" onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); useUrl() } }} />
        <button type="button" disabled={staticMode || busy !== null} onClick={useUrl}>{busy === 'url' ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}下载并使用</button>
      </div>
      <p className="image-help">可直接按 <kbd>⌘V</kbd> 粘贴剪贴板图片；微信 CDN 图会跳过，优先从同稿官方／强来源提取配图。</p>
      {staticMode ? <p className="image-message">连接 Worker 后才能粘贴或修改配图。</p> : message ? <p className={`image-message ${message.includes('已') ? 'success' : 'error'}`}>{message}</p> : null}
    </section>
  )
}

function DetailSources({ story, staticMode, onImageChange }: { story: Story; staticMode: boolean; onImageChange: (story: Story) => void }) {
  return (
    <>
      <section className="detail-section">
        <div className="section-heading"><FileCheck2 size={16} /><h4>事实清单</h4><span>{story.claims.length}</span></div>
        <div className="claim-list">{story.claims.length ? story.claims.map((claim) => <div className="claim" key={claim.id || claim.text}><CircleDot size={13} className={`claim-${claim.status}`} /><p>{claim.text}</p></div>) : <div className="empty-line">尚未生成事实清单</div>}</div>
      </section>
      <section className="detail-section">
        <div className="section-heading"><ExternalLink size={16} /><h4>来源链</h4><span>{story.sources.length}</span></div>
        <div className="source-list">{story.sources.map((source: Source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id || source.url}><span className={`source-mark source-${source.authority}`} /><span><strong>{source.publisher || source.title || '来源'}</strong><small>{sourceLabel[source.authority]} · {source.source_type}</small></span><ExternalLink size={14} /></a>)}</div>
      </section>
      <StoryImageEditor story={story} staticMode={staticMode} onImageChange={onImageChange} />
    </>
  )
}

function BrandWorkspace({ issue, onSave, onGenerate, generating }: {
  issue: Issue
  onSave: (brand: 'appso' | 'ifanr', patch: Partial<BrandPackage>) => Promise<void>
  onGenerate: (brand: 'appso' | 'ifanr') => Promise<void>
  generating: 'appso' | 'ifanr' | null
}) {
  return (
    <div className="brand-workspace">
      {(['appso', 'ifanr'] as const).map((brand) => {
        const pack = issue.brand_packages[brand]
        return (
          <section className="brand-section" key={brand}>
            <header><div><span className="brand-code">{brand.toUpperCase()}</span><h2>{brand === 'appso' ? 'AI 与产品入口' : '消费电子与生活方式'}</h2></div><button type="button" className="generate-button" disabled={generating !== null} onClick={() => void onGenerate(brand)}>{generating === brand ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{(pack?.headline_options || []).length ? '重新生成标题' : '生成标题'}</button></header>
            <p className="brand-note">从当前共享母稿生成 3 组「三个消息 / 分隔」标题，两个品牌可使用同一选题，但表达分别调整。</p>
            <div className="headline-options">{(pack?.headline_options || []).map((headline) => <label key={headline} className={pack.selected_headline === headline ? 'selected' : ''}><input type="radio" name={`${brand}-headline`} checked={pack.selected_headline === headline} onChange={() => void onSave(brand, { selected_headline: headline })} /><span>{headline}</span></label>)}</div>
            <label className="field-label" htmlFor={`${brand}-headline-custom`}>最终大标题</label>
            <textarea key={`${brand}-${pack?.selected_headline || ''}`} id={`${brand}-headline-custom`} rows={3} defaultValue={pack?.selected_headline || ''} onBlur={(event) => event.target.value !== pack?.selected_headline && void onSave(brand, { selected_headline: event.target.value })} />
          </section>
        )
      })}
    </div>
  )
}

function WeekendWorkspace({ data }: { data: Record<string, { label: string; candidates: Array<Record<string, unknown>> }> }) {
  const icons = { one_fun_thing: Sparkles, book: BookOpen, watch: Film, game: Gamepad2 }
  return <div className="weekend-workspace">{Object.entries(data).map(([key, pool]) => {
    const Icon = icons[key as keyof typeof icons] || Sparkles
    const candidates = pool.candidates.filter((item) => item.status === 'active')
    return <section key={key} className="weekend-column"><header><Icon size={19} /><h2>{pool.label}</h2><span>{candidates.length}</span></header>{candidates.map((candidate) => <article key={String(candidate.id)}><h3>{String(candidate.title)}</h3><p>{String(candidate.why || '')}</p><div><span>{Number(candidate.score || 0).toFixed(1)}</span><span>{String(candidate.source_date || '')}</span></div></article>)}</section>
  })}</div>
}

function ExportDialog({ issue, handoff, busy, staticMode, operationCount, closing = false, onClose, onMarkdown, onHandoff }: {
  issue: Issue
  handoff: AutomationHandoff | null
  busy: boolean
  staticMode: boolean
  operationCount: number
  closing?: boolean
  onClose: () => void
  onMarkdown: () => void
  onHandoff: () => void
}) {
  return <div className={`modal-backdrop ${closing ? 'closing' : ''}`} role="presentation" onMouseDown={onClose}><div className={`export-dialog ${closing ? 'closing' : ''}`} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header><div><span>结构化导出</span><h2>导出 {issue.selected_count} 条早报稿</h2></div><IconButton title="关闭" onClick={onClose}><X size={18} /></IconButton></header><div className="export-options"><button className="export-option" type="button" onClick={onMarkdown}><Download size={19} /><span><strong>下载 Markdown</strong><small>导出当前标题、正文、分类、排序和来源行</small></span></button><button className="export-option" type="button" disabled={busy || (staticMode && operationCount === 0)} onClick={onHandoff}>{busy ? <LoaderCircle size={19} className="spin" /> : <RefreshCw size={19} />}<span><strong>{staticMode ? '下载飞书审稿单' : '交给下一轮自动化'}</strong><small>{staticMode ? `仅包含 ${operationCount} 个显式修改；下载后发送到早报飞书群` : '写入本机 handoff，定时任务会在同刊期继承并合并新内容'}</small></span></button></div>{staticMode ? <div className="review-safety"><ShieldCheck size={16} /><span>审稿单不会把未列出的新闻视为删除。刊期、版本或故事指纹冲突时，主 Mac 会保留原稿并转为人工复核。</span></div> : null}{handoff ? <div className="handoff-success"><Check size={16} /><span>已写入刊期 {handoff.issue_id} 的 handoff，共 {handoff.selected_count} 条。</span></div> : null}<footer><button type="button" className="secondary-button" onClick={onClose}>完成</button></footer></div></div>
}

function StoryCreateDialog({ busy, closing = false, onClose, onCreate }: {
  busy: boolean
  closing?: boolean
  onClose: () => void
  onCreate: (story: StoryCreateInput) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState('大公司')
  const [sourceUrls, setSourceUrls] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [disclosedAt, setDisclosedAt] = useState('')
  const [selected, setSelected] = useState(true)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!title.trim()) {
      setError('请填写标题')
      return
    }
    setError('')
    try {
      await onCreate({
        title: title.trim(),
        body: body.trim(),
        category,
        selected,
        source_urls: sourceUrls.split(/\r?\n|；/).map((item) => item.trim()).filter(Boolean),
        source_name: '手动添加',
        source_type: 'manual',
        source_quality: 'unknown',
        confidence: 0.8,
        event_date: eventDate || undefined,
        disclosed_at: disclosedAt || undefined,
        rumor: false,
        editorial_reason: '用户在早报编辑台手动添加',
      })
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '添加选题失败')
    }
  }

  return <div className={`modal-backdrop ${closing ? 'closing' : ''}`} role="presentation" onMouseDown={onClose}>
    <form className={`story-create-dialog ${closing ? 'closing' : ''}`} role="dialog" aria-modal="true" onSubmit={(event) => { event.preventDefault(); void submit() }} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><span>人工补充</span><h2>手动添加选题</h2></div><IconButton title="关闭" onClick={onClose}><X size={18} /></IconButton></header>
      <div className="story-create-fields">
        <label className="wide"><span>标题</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="输入正式早报标题" /></label>
        <label><span>栏目</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{publicationCategories.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
        <label><span>事件发生日</span><input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} /></label>
        <label className="wide"><span>正文</span><textarea rows={7} value={body} onChange={(event) => setBody(event.target.value)} placeholder="按早报 prompt 写入正文；也可以只填标题，稍后追源成稿" /></label>
        <label className="wide"><span>来源 URL</span><textarea rows={3} value={sourceUrls} onChange={(event) => setSourceUrls(event.target.value)} placeholder="每行一个 URL，第一条作为主来源" /></label>
        <label className="wide"><span>首次披露时间</span><input value={disclosedAt} onChange={(event) => setDisclosedAt(event.target.value)} placeholder="例如 2026-07-22 09:30" /></label>
        <label className="story-create-check wide"><input type="checkbox" checked={selected} onChange={(event) => setSelected(event.target.checked)} /><span>直接加入当前早报稿</span></label>
        {error ? <p className="story-create-error wide">{error}</p> : null}
      </div>
      <footer><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />}添加选题</button></footer>
    </form>
  </div>
}

function DeleteConfirmDialog({ story, busy, closing = false, onCancel, onConfirm }: {
  story: Story
  busy: boolean
  closing?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return <div className={`modal-backdrop ${closing ? 'closing' : ''}`} role="presentation" onMouseDown={onCancel}>
    <div className={`delete-confirm-dialog ${closing ? 'closing' : ''}`} role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <div><span>移入回收站</span><h2 id="delete-confirm-title">确定删除这个选题？</h2></div>
        <IconButton title="关闭" onClick={onCancel}><X size={18} /></IconButton>
      </header>
      <div className="delete-confirm-copy">
        <strong>「{story.title}」</strong>
        <p>选题会进入当前刊期的回收站。删除后可按 <kbd>⌘Z</kbd> 立即撤回，也可以稍后从回收站恢复。</p>
      </div>
      <footer>
        <button type="button" className="secondary-button" onClick={onCancel}>取消</button>
        <button type="button" className="danger-button" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}移入回收站</button>
      </footer>
    </div>
  </div>
}

function issueWithMetrics(issue: Issue, stories: Story[]): Issue {
  const normalizedStories = stories.map(normalizeStoryCategory).map((story) => {
    if (!story.selected || story.status === 'excluded' || hasMeaningfulBody(story.body)) return story
    return {
      ...story,
      selected: false,
      status: 'needs_review' as StoryStatus,
      changed_since_review: true,
      editorial_reason: story.editorial_reason || '缺少正文，需按早报 prompt 追源并重写',
      metadata: { ...story.metadata, _empty_body_guard: { client_fallback: true } },
    }
  })
  return {
    ...issue,
    stories: normalizedStories,
    selected_count: normalizedStories.filter((story) => story.selected && story.status !== 'excluded').length,
    ready_count: normalizedStories.filter((story) => story.selected && story.status === 'ready').length,
    review_count: normalizedStories.filter((story) => story.status === 'needs_review' || story.changed_since_review).length,
  }
}

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('ifanr-editorial-theme') === 'dark' ? 'dark' : 'light')
  const [issue, setIssue] = useState<Issue | null>(null)
  const [baseIssue, setBaseIssue] = useState<Issue | null>(null)
  const [reviewSessionId, setReviewSessionId] = useState('')
  const [dataMode, setDataMode] = useState<'worker' | 'static' | 'offline'>('offline')
  const [repoRuntimeAccess, setRepoRuntimeAccess] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [operationError, setOperationError] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('全部')
  const [activeDraftSection, setActiveDraftSection] = useState('全部')
  const [candidateStatus, setCandidateStatus] = useState('all')
  const [view, setView] = useState<View>('draft')
  const [outlineCollapsed, setOutlineCollapsed] = useState(() => localStorage.getItem('ifanr-editorial-outline-collapsed') === '1')
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null)
  const [detailClosing, setDetailClosing] = useState(false)
  const [draggedStoryId, setDraggedStoryId] = useState<string | null>(null)
  const [movingStoryId, setMovingStoryId] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Record<string, Job>>({})
  const [weekend, setWeekend] = useState<Record<string, { label: string; candidates: Array<Record<string, unknown>> }>>({})
  const [showExport, setShowExport] = useState(false)
  const [showCreateStory, setShowCreateStory] = useState(false)
  const [closingOverlay, setClosingOverlay] = useState<'create' | 'export' | 'delete' | null>(null)
  const [creatingStory, setCreatingStory] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Story | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deletedStories, setDeletedStories] = useState<Story[]>([])
  const [undoBusy, setUndoBusy] = useState(false)
  const [undoToastVisible, setUndoToastVisible] = useState(false)
  const [undoToastClosing, setUndoToastClosing] = useState(false)
  const [undoToastCycle, setUndoToastCycle] = useState(0)
  const [handoff, setHandoff] = useState<AutomationHandoff | null>(null)
  const [exporting, setExporting] = useState(false)
  const [generatingBrand, setGeneratingBrand] = useState<'appso' | 'ifanr' | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsClosing, setSettingsClosing] = useState(false)
  const [apiUrl, setApiUrlInput] = useState(getApiUrl())
  const [geminiKey, setGeminiKey] = useState('')
  const [geminiConfigured, setGeminiConfigured] = useState(hasGeminiKey())
  const [profileMessage, setProfileMessage] = useState('')
  const [workerConnection, setWorkerConnection] = useState<WorkerConnection>({
    status: 'checking',
    detail: '正在检测主 Mac Worker',
    url: getApiUrl(),
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('ifanr-editorial-theme', theme)
  }, [theme])
  useEffect(() => { localStorage.setItem('ifanr-editorial-outline-collapsed', outlineCollapsed ? '1' : '0') }, [outlineCollapsed])
  const draftScrollRef = useRef<HTMLElement | null>(null)
  const settingsPopoverRef = useRef<HTMLDivElement | null>(null)
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null)
  const connectionTriggerRef = useRef<HTMLButtonElement | null>(null)
  const settingsCloseTimerRef = useRef<number | null>(null)
  const operationErrorTimerRef = useRef<number | null>(null)
  const detailCloseTimerRef = useRef<number | null>(null)
  const overlayCloseTimerRef = useRef<number | null>(null)
  const issueRef = useRef<Issue | null>(null)
  const dataModeRef = useRef(dataMode)
  const workerRefreshInFlightRef = useRef(false)

  useEffect(() => { issueRef.current = issue }, [issue])
  useEffect(() => { dataModeRef.current = dataMode }, [dataMode])

  const showOperationError = useCallback((message: string) => {
    if (operationErrorTimerRef.current !== null) window.clearTimeout(operationErrorTimerRef.current)
    setOperationError(message)
    operationErrorTimerRef.current = window.setTimeout(() => {
      setOperationError('')
      operationErrorTimerRef.current = null
    }, 8000)
  }, [])

  const closeDetail = useCallback(() => {
    if (!selectedStoryId || detailClosing) return
    setDetailClosing(true)
    if (detailCloseTimerRef.current !== null) window.clearTimeout(detailCloseTimerRef.current)
    detailCloseTimerRef.current = window.setTimeout(() => {
      setSelectedStoryId(null)
      setDetailClosing(false)
      detailCloseTimerRef.current = null
    }, 180)
  }, [detailClosing, selectedStoryId])

  const closeOverlay = useCallback((overlay: 'create' | 'export' | 'delete') => {
    if (closingOverlay) return
    setClosingOverlay(overlay)
    if (overlayCloseTimerRef.current !== null) window.clearTimeout(overlayCloseTimerRef.current)
    overlayCloseTimerRef.current = window.setTimeout(() => {
      if (overlay === 'create') setShowCreateStory(false)
      if (overlay === 'export') setShowExport(false)
      if (overlay === 'delete') setPendingDelete(null)
      setClosingOverlay(null)
      overlayCloseTimerRef.current = null
    }, 180)
  }, [closingOverlay])

  const loadIssue = useCallback(async (preferWorker = false) => {
    setLoading(true)
    setError('')
    const workerUrl = getApiUrl()
    const forceStatic = !preferWorker && new URLSearchParams(window.location.search).get('static') === '1'
    const showPagesFallback = async (detail: string) => {
      const snapshot = await api.staticIssue()
      const fallback = issueWithMetrics(snapshot, snapshot.stories)
      const snapshotTime = String(fallback.diagnostics?.snapshot_generated_at || fallback.updated_at || '')
      setWorkerConnection({ status: 'pages', detail: `${detail} · ${fallback.publication_date}${snapshotTime ? ` · 快照 ${snapshotTime}` : ''}`, url: workerUrl })
      setIssue(fallback)
      setBaseIssue(structuredClone(fallback))
      setReviewSessionId('')
      setSelectedStoryId(null)
      setWeekend({})
      setDataMode('static')
      setRepoRuntimeAccess(false)
      setError('')
    }
    if (forceStatic) {
      try {
        await showPagesFallback('当前显示当天 Bot 稿的只读 Pages 快照')
      } catch (snapshotError) {
        setIssue(null)
        setBaseIssue(null)
        setDataMode('offline')
        setWorkerConnection({ status: 'failed', detail: 'Pages 尚未生成当天早报快照', url: workerUrl })
        setError(snapshotError instanceof Error ? snapshotError.message : 'Pages 快照读取失败')
      }
      setLoading(false)
      return
    }
    setWorkerConnection({ status: 'checking', detail: '正在测试 Worker 连接', url: workerUrl })
    try {
      const health = await api.health()
      setDataMode('worker')
      setRepoRuntimeAccess(health.repo_runtime_access)
      let current: Issue
      try { current = await api.currentIssue() } catch { current = await api.importLatest() }
      const normalizedIssue = issueWithMetrics(current, current.stories)
      setIssue(normalizedIssue)
      setBaseIssue(structuredClone(normalizedIssue))
      setReviewSessionId('')
      setSelectedStoryId(null)
      const identity = health.identity || ''
      setWorkerConnection({
        status: 'connected',
        detail: health.access_mode === 'tailscale'
          ? `已通过 Tailscale Serve 连接${identity ? ` · ${identity}` : ''}`
          : '已连接这台 Mac 上的本地 Worker',
        url: workerUrl,
        identity,
      })
      api.weekend().then(setWeekend).catch(() => setWeekend({}))
    } catch (loadError) {
      const workerMessage = describeWorkerError(loadError)
      try {
        await showPagesFallback(`Worker 未连接，当前显示 Pages 快照：${workerMessage}`)
      } catch (snapshotError) {
        setIssue(null)
        setBaseIssue(null)
        setDataMode('offline')
        setWorkerConnection({ status: 'failed', detail: `Worker 与 Pages 快照均不可达：${workerMessage}`, url: workerUrl })
        setError(snapshotError instanceof Error ? snapshotError.message : 'Pages 快照读取失败')
      }
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    void loadIssue(false)
  }, [loadIssue])

  const refreshWorkerIssue = useCallback(async () => {
    const currentIssue = issueRef.current
    if (!currentIssue || dataModeRef.current !== 'worker' || document.hidden || workerRefreshInFlightRef.current) return
    workerRefreshInFlightRef.current = true
    try {
      const latest = await api.currentIssue()
      if (latest.id === currentIssue.id && latest.revision === currentIssue.revision) return
      const refreshed = issueWithMetrics(latest, latest.stories)
      const scrollTop = draftScrollRef.current?.scrollTop
      setIssue(refreshed)
      setBaseIssue(structuredClone(refreshed))
      setReviewSessionId('')
      setSelectedStoryId((selectedId) => refreshed.stories.some((story) => story.id === selectedId) ? selectedId : null)
      api.weekend().then(setWeekend).catch(() => undefined)
      if (typeof scrollTop === 'number') window.requestAnimationFrame(() => {
        if (draftScrollRef.current) draftScrollRef.current.scrollTop = scrollTop
      })
    } catch {
      // 短暂网络抖动不打断正在审稿的页面，下一轮会自动重试。
    } finally {
      workerRefreshInFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    if (dataMode !== 'worker') return
    const refreshWhenVisible = () => { if (!document.hidden) void refreshWorkerIssue() }
    const timer = window.setInterval(refreshWhenVisible, workerRefreshIntervalMs)
    window.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [dataMode, refreshWorkerIssue])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selectedStoryId) {
        event.preventDefault()
        closeDetail()
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [closeDetail, selectedStoryId])

  const openSettings = useCallback(() => {
    if (settingsCloseTimerRef.current !== null) window.clearTimeout(settingsCloseTimerRef.current)
    setSettingsClosing(false)
    setShowSettings(true)
  }, [])

  const finishSettingsClose = useCallback(() => {
    if (settingsCloseTimerRef.current !== null) window.clearTimeout(settingsCloseTimerRef.current)
    settingsCloseTimerRef.current = null
    setShowSettings(false)
    setSettingsClosing(false)
  }, [])

  const closeSettings = useCallback(() => {
    setSettingsClosing(true)
    if (settingsCloseTimerRef.current !== null) window.clearTimeout(settingsCloseTimerRef.current)
    settingsCloseTimerRef.current = window.setTimeout(finishSettingsClose, 180)
  }, [finishSettingsClose])

  const toggleSettings = useCallback(() => {
    if (showSettings && !settingsClosing) closeSettings()
    else openSettings()
  }, [closeSettings, openSettings, settingsClosing, showSettings])

  useEffect(() => {
    if (!showSettings) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (settingsPopoverRef.current?.contains(target) || settingsTriggerRef.current?.contains(target) || connectionTriggerRef.current?.contains(target)) return
      closeSettings()
    }
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeSettings() }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeSettings, showSettings])

  useEffect(() => () => {
    if (settingsCloseTimerRef.current !== null) window.clearTimeout(settingsCloseTimerRef.current)
    if (operationErrorTimerRef.current !== null) window.clearTimeout(operationErrorTimerRef.current)
    if (detailCloseTimerRef.current !== null) window.clearTimeout(detailCloseTimerRef.current)
    if (overlayCloseTimerRef.current !== null) window.clearTimeout(overlayCloseTimerRef.current)
  }, [])

  useEffect(() => {
    if (!undoToastVisible) return
    setUndoToastClosing(false)
    const closeTimer = window.setTimeout(() => setUndoToastClosing(true), 9650)
    const hideTimer = window.setTimeout(() => {
      setUndoToastVisible(false)
      setUndoToastClosing(false)
    }, 10000)
    return () => {
      window.clearTimeout(closeTimer)
      window.clearTimeout(hideTimer)
    }
  }, [undoToastCycle, undoToastVisible])

  const draftStories = useMemo(() => {
    if (!issue) return []
    const normalized = query.trim().toLowerCase()
    return issue.stories.filter((story) => (
      (story.selected && story.status !== 'excluded' && hasMeaningfulBody(story.body))
      || pendingAiEditorRequest(story)
    ))
      .filter((story) => !normalized || `${story.title} ${story.body} ${story.source_name}`.toLowerCase().includes(normalized))
      .sort(comparePublicationStories)
  }, [issue, query])

  const isSaturdayIssue = isSaturdayPublication(issue?.publication_date)

  const groupedDraft = useMemo(() => {
    return groupDraftStories(draftStories, isSaturdayIssue)
  }, [draftStories, isSaturdayIssue])

  const candidates = useMemo(() => {
    if (!issue) return []
    const normalized = query.trim().toLowerCase()
    return issue.stories.filter((story) => !story.selected && !pendingAiEditorRequest(story))
      .filter((story) => category === '全部' || story.category === category)
      .filter((story) => candidateStatus === 'all' ? story.status !== 'excluded' : candidateStatus === 'excluded' ? story.status === 'excluded' : story.status === candidateStatus)
      .filter((story) => !normalized || `${story.title} ${story.body} ${story.source_name}`.toLowerCase().includes(normalized))
      .sort((a, b) => b.score - a.score)
  }, [issue, query, category, candidateStatus])

  const trashStories = useMemo(() => {
    if (!issue) return []
    const normalized = query.trim().toLowerCase()
    return issue.stories
      .filter((story) => story.status === 'excluded')
      .filter((story) => category === '全部' || story.category === category)
      .filter((story) => !normalized || `${story.title} ${story.body} ${story.source_name}`.toLowerCase().includes(normalized))
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')) || b.score - a.score)
  }, [issue, query, category])

  const draftCounts = useMemo(() => {
    const counts: Record<string, number> = { 全部: draftStories.length }
    draftStories.forEach((story) => {
      const section = isSaturdayIssue ? weekendDraftSection(story) : story.category
      counts[section] = (counts[section] || 0) + 1
    })
    return counts
  }, [draftStories, isSaturdayIssue])

  const sidebarCategories = view === 'draft' && isSaturdayIssue
    ? ['全部', ...weekendDraftCategories]
    : categories

  const pendingAiEditorCount = useMemo(
    () => issue?.stories.filter((story) => pendingAiEditorRequest(story)).length || 0,
    [issue],
  )

  const selectedStory = issue?.stories.find((story) => story.id === selectedStoryId) || null
  const selectedJob = selectedStory ? jobs[selectedStory.id] : undefined

  const updateStory = async (storyId: string, patch: Partial<Story>) => {
    const existing = issue?.stories.find((story) => story.id === storyId)
    if (!existing) throw new Error('选题不存在')
    const updated = dataMode === 'static' ? { ...existing, ...patch } : await api.patchStory(storyId, patch)
    setIssue((current) => current ? issueWithMetrics(current, current.stories.map((story) => story.id === storyId ? updated : story)) : current)
    return updated
  }

  const excludeStory = async (story: Story) => {
    await updateStory(story.id, {
      selected: false,
      status: 'excluded',
      metadata: {
        ...story.metadata,
        _trash_previous_status: story.status,
        _trash_previous_position: story.position,
        _trash_deleted_at: new Date().toISOString(),
      },
    })
  }

  const requestDeleteStory = (story: Story) => {
    setClosingOverlay(null)
    setPendingDelete(story)
  }

  const confirmDeleteStory = async () => {
    if (!pendingDelete || deleteBusy) return
    const snapshot = structuredClone(pendingDelete)
    setDeleteBusy(true)
    try {
      await excludeStory(pendingDelete)
      setDeletedStories((current) => [...current, snapshot].slice(-20))
      setUndoToastVisible(true)
      setUndoToastClosing(false)
      setUndoToastCycle((current) => current + 1)
      closeOverlay('delete')
      if (selectedStoryId === pendingDelete.id) setSelectedStoryId(null)
    } catch (deleteError) {
      showOperationError(deleteError instanceof Error ? deleteError.message : '删除选题失败')
    } finally {
      setDeleteBusy(false)
    }
  }

  const undoLastDeletion = useCallback(async () => {
    const snapshot = deletedStories.at(-1)
    if (!snapshot || undoBusy) return
    setUndoBusy(true)
    try {
      await updateStory(snapshot.id, {
        selected: snapshot.selected,
        status: snapshot.status,
        position: snapshot.position,
        category: snapshot.category,
        metadata: snapshot.metadata,
      })
      setDeletedStories((current) => current.slice(0, -1))
      setUndoToastVisible(false)
      setUndoToastClosing(false)
      if (snapshot.selected) {
        setView('draft')
        window.requestAnimationFrame(() => scrollToDraftSection(snapshot.category))
      }
    } catch (undoError) {
      showOperationError(undoError instanceof Error ? undoError.message : '撤回删除失败')
    } finally {
      setUndoBusy(false)
    }
  }, [deletedStories, undoBusy, issue, dataMode])

  useEffect(() => {
    const handleUndo = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== 'z') return
      const target = event.target
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (!deletedStories.length) return
      event.preventDefault()
      void undoLastDeletion()
    }
    document.addEventListener('keydown', handleUndo)
    return () => document.removeEventListener('keydown', handleUndo)
  }, [deletedStories.length, undoLastDeletion])

  const restoreStory = async (story: Story) => {
    if (!issue) return
    const previousStatus = typeof story.metadata._trash_previous_status === 'string' && story.metadata._trash_previous_status !== 'excluded'
      ? story.metadata._trash_previous_status as StoryStatus
      : story.body.trim() ? 'ready' : 'needs_review'
    const targetPosition = issue.stories
      .filter((item) => item.selected && item.status !== 'excluded' && item.category === story.category)
      .reduce((maximum, item) => Math.max(maximum, item.position), -1) + 1
    await updateStory(story.id, {
      selected: true,
      status: previousStatus,
      position: targetPosition,
      metadata: { ...story.metadata, _trash_restored_at: new Date().toISOString() },
    })
    setView('draft')
    setSelectedStoryId(story.id)
    window.requestAnimationFrame(() => scrollToDraftSection(story.category))
  }

  const watchJob = async (storyId: string, job: Job) => {
    setJobs((current) => ({ ...current, [storyId]: job }))
    try {
      job = await api.watchJob(job.id, (update) => setJobs((current) => ({ ...current, [storyId]: update })))
    } catch {
      while (!['completed', 'failed'].includes(job.state)) {
        await new Promise((resolve) => window.setTimeout(resolve, 1200))
        job = await api.job(job.id)
        setJobs((current) => ({ ...current, [storyId]: job }))
      }
    }
    if (job.state === 'failed') throw new Error(job.error || job.message || '任务失败')
    if (issue) setIssue(await api.getIssue(issue.id))
  }

  const handleDrop = async (targetId: string) => {
    if (!issue || !draggedStoryId || draggedStoryId === targetId) return
    const target = issue.stories.find((story) => story.id === targetId)
    const dragged = issue.stories.find((story) => story.id === draggedStoryId)
    if (!target || !dragged || target.category !== dragged.category) return
    const ordered = issue.stories.filter((story) => story.selected && story.category === target.category).sort((a, b) => a.position - b.position)
    const from = ordered.findIndex((story) => story.id === draggedStoryId)
    const to = ordered.findIndex((story) => story.id === targetId)
    ordered.splice(to, 0, ordered.splice(from, 1)[0])
    if (dataMode === 'static') {
      const positions = new Map(ordered.map((story, index) => [story.id, index]))
      setIssue(issueWithMetrics(issue, issue.stories.map((story) => positions.has(story.id) ? { ...story, position: positions.get(story.id) || 0 } : story)))
    } else {
      setIssue(await api.reorder(issue.id, ordered.map((story) => story.id), target.category))
    }
    setDraggedStoryId(null)
  }

  const moveStory = async (storyId: string, target: -1 | 1 | 'first' | 'last') => {
    if (!issue) return
    const story = issue.stories.find((item) => item.id === storyId)
    if (!story) return
    const ordered = issue.stories
      .filter((item) => item.selected && item.status !== 'excluded' && item.category === story.category)
      .sort((a, b) => a.position - b.position)
    const from = ordered.findIndex((item) => item.id === storyId)
    const to = target === 'first' ? 0 : target === 'last' ? ordered.length - 1 : from + target
    if (from < 0 || to < 0 || to >= ordered.length) return
    const [moved] = ordered.splice(from, 1)
    ordered.splice(to, 0, moved)
    const positions = new Map(ordered.map((item, index) => [item.id, index]))
    const optimistic = issueWithMetrics(issue, issue.stories.map((item) => positions.has(item.id) ? { ...item, position: positions.get(item.id) ?? item.position } : item))
    setIssue(optimistic)
    setMovingStoryId(storyId)
    window.setTimeout(() => setMovingStoryId((current) => current === storyId ? null : current), 320)
    if (dataMode === 'static') return
    try {
      setIssue(await api.reorder(issue.id, ordered.map((item) => item.id), story.category))
    } catch (moveError) {
      setIssue(issue)
      showOperationError(moveError instanceof Error ? moveError.message : '调整顺序失败')
    }
  }

  const moveStoryToCategory = async (storyId: string, targetCategory: string) => {
    if (!issue || !categoryOrder.has(targetCategory)) return
    const story = issue.stories.find((item) => item.id === storyId)
    if (!story || story.category === targetCategory) return
    const targetPosition = issue.stories
      .filter((item) => item.selected && item.status !== 'excluded' && item.category === targetCategory)
      .reduce((maximum, item) => Math.max(maximum, item.position), -1) + 1
    const previous = issue
    const optimistic = issueWithMetrics(issue, issue.stories.map((item) => item.id === storyId ? { ...item, category: targetCategory, position: targetPosition } : item))
    setIssue(optimistic)
    setMovingStoryId(storyId)
    window.setTimeout(() => setMovingStoryId((current) => current === storyId ? null : current), 320)
    if (dataMode === 'static') return
    try {
      const updated = await api.patchStory(storyId, { category: targetCategory, position: targetPosition })
      setIssue((current) => current ? issueWithMetrics(current, current.stories.map((item) => item.id === storyId ? updated : item)) : current)
    } catch (moveError) {
      setIssue(previous)
      showOperationError(moveError instanceof Error ? moveError.message : '移动栏目失败')
    }
  }

  const moveStoryToWeekendSection = async (storyId: string, targetSection: string) => {
    if (!issue || !weekendDraftCategories.includes(targetSection as typeof weekendDraftCategories[number])) return
    const story = issue.stories.find((item) => item.id === storyId)
    if (!story || weekendDraftSection(story) === targetSection) return
    const title = moveToWeekendDraftSection(story, targetSection)
    const previous = issue
    setIssue(issueWithMetrics(issue, issue.stories.map((item) => item.id === storyId ? { ...item, title } : item)))
    setMovingStoryId(storyId)
    window.setTimeout(() => setMovingStoryId((current) => current === storyId ? null : current), 320)
    if (dataMode === 'static') return
    try {
      const updated = await api.patchStory(storyId, { title })
      setIssue((current) => current ? issueWithMetrics(current, current.stories.map((item) => item.id === storyId ? updated : item)) : current)
    } catch (moveError) {
      setIssue(previous)
      showOperationError(moveError instanceof Error ? moveError.message : '移动周末栏目失败')
    }
  }

  const scrollToDraftSection = (section: string) => {
    setActiveDraftSection(section)
    if (query) setQuery('')
    const performScroll = () => {
      const container = draftScrollRef.current
      if (!container) return
      if (section === '全部') {
        container.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }
      const target = document.getElementById(`section-${section.replaceAll('/', '-')}`)
      if (!target) return
      const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
      container.scrollTo({ top, behavior: 'smooth' })
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(performScroll))
  }

  const scrollToStory = (story: Story) => {
    setSelectedStoryId(story.id)
    setActiveDraftSection(isSaturdayIssue ? weekendDraftSection(story) : story.category)
    const performScroll = () => {
      const container = draftScrollRef.current
      const target = document.getElementById(`story-${story.id}`)
      if (!container || !target) return
      const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 24
      container.scrollTo({ top, behavior: 'smooth' })
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(performScroll))
  }

  const syncDraftSection = () => {
    const container = draftScrollRef.current
    if (!container || view !== 'draft') return
    if (container.scrollTop < 180) {
      setActiveDraftSection('全部')
      return
    }
    const threshold = container.getBoundingClientRect().top + 90
    let active = '全部'
    groupedDraft.forEach(([section]) => {
      const element = document.getElementById(`section-${section.replaceAll('/', '-')}`)
      if (element && element.getBoundingClientRect().top <= threshold) active = section
    })
    setActiveDraftSection((current) => current === active ? current : active)
  }

  const adoptCandidate = async (story: Story) => {
    setSelectedStoryId(story.id)
    try {
      const targetPosition = issue?.stories
        .filter((item) => item.category === story.category && (
          (item.selected && item.status !== 'excluded')
          || pendingAiEditorRequest(item)
        ))
        .reduce((maximum, item) => Math.max(maximum, item.position), -1) ?? -1
      await updateStory(story.id, {
        selected: false,
        status: 'drafting',
        position: targetPosition + 1,
        editorial_reason: '已采用，等待下一轮 AI 主编追源、撰写并复核',
        metadata: {
          ...story.metadata,
          _ai_editor_request: {
            state: 'pending',
            requested_at: new Date().toISOString(),
            requested_by: 'human',
            requested_category: story.category,
          },
        },
      })
      setView('draft')
      window.requestAnimationFrame(() => scrollToDraftSection(story.category))
    } catch (adoptError) {
      showOperationError(adoptError instanceof Error ? adoptError.message : '提交 AI 主编失败')
    }
  }

  const refresh = async (runPreflight: boolean) => {
    if (!issue) return
    if (dataMode === 'static') {
      await loadIssue()
      return
    }
    setOperationError('')
    try {
      const job = await api.refreshIssue(issue.id, runPreflight)
      const current = await api.watchJob(job.id, () => undefined).catch(async () => {
        let fallback = await api.job(job.id)
        while (!['completed', 'failed'].includes(fallback.state)) { await new Promise((resolve) => window.setTimeout(resolve, 1200)); fallback = await api.job(job.id) }
        return fallback
      })
      if (current.state === 'failed') throw new Error(current.error)
      setIssue(await api.getIssue(issue.id))
    } catch (refreshError) { showOperationError(refreshError instanceof Error ? refreshError.message : '刷新失败') }
  }

  const generateBrand = async (brand: 'appso' | 'ifanr') => {
    if (!issue) return
    setGeneratingBrand(brand)
    setOperationError('')
    try {
      const generated = await generateBrandHeadlines(issue, brand)
      const patch = { headline_options: generated.headline_options, selected_headline: generated.selected_headline }
      setIssue((current) => current ? { ...current, brand_packages: { ...current.brand_packages, [brand]: { ...current.brand_packages[brand], ...patch } } } : current)
      if (dataMode === 'worker') {
        await api.patchBrand(issue.id, brand, patch)
        setIssue(await api.getIssue(issue.id))
      }
    } catch (brandError) { showOperationError(brandError instanceof Error ? brandError.message : '品牌包装生成失败') } finally { setGeneratingBrand(null) }
  }

  const createStory = async (input: StoryCreateInput) => {
    if (!issue || dataMode !== 'worker') throw new Error('连接 Worker 后才能手动添加选题')
    setCreatingStory(true)
    try {
      const created = await api.createStory(issue.id, input)
      const latest = await api.getIssue(issue.id)
      const refreshed = issueWithMetrics(latest, latest.stories)
      setIssue(refreshed)
      setSelectedStoryId(created.id)
      setView('draft')
      closeOverlay('create')
    } finally {
      setCreatingStory(false)
    }
  }

  const createHandoff = async () => {
    if (!issue) return
    if (dataMode === 'static') {
      if (!baseIssue) return
      const review = buildReviewExport(baseIssue, issue, reviewSessionId)
      downloadText(`ifanr-editorial-review-${issue.publication_date}-${review.export_id.slice(0, 8)}.json`, JSON.stringify(review, null, 2) + '\n')
      return
    }
    setExporting(true)
    setOperationError('')
    try { setHandoff(await api.handoff(issue.id)) }
    catch (handoffError) { showOperationError(handoffError instanceof Error ? handoffError.message : 'handoff 写入失败') }
    finally { setExporting(false) }
  }

  const switchView = (next: View) => { setView(next); setSelectedStoryId(null); setCategory('全部'); setActiveDraftSection('全部'); setQuery('') }

  const jumpToReview = () => {
    const target = issue?.stories.find((story) => story.status === 'needs_review' || story.changed_since_review)
    if (!target) return
    setDetailClosing(false)
    setSelectedStoryId(target.id)
    setQuery('')
    if (target.selected) {
      setView('draft')
      window.requestAnimationFrame(() => scrollToDraftSection(isSaturdayIssue ? weekendDraftSection(target) : target.category))
    } else {
      setView('candidates')
      setCategory('全部')
      setCandidateStatus('needs_review')
    }
  }

  const saveGeminiKey = async () => {
    if (!geminiKey.trim()) {
      setProfileMessage('请输入 Gemini API Key')
      return
    }
    try {
      persistGeminiKey(geminiKey)
      setGeminiConfigured(true)
      setGeminiKey('')
      setProfileMessage('Gemini API Key 已保存到当前浏览器')
    } catch (settingsError) {
      setProfileMessage(settingsError instanceof Error ? settingsError.message : 'Gemini 配置保存失败')
    }
  }

  const connectWorker = async () => {
    let normalized: string
    try {
      normalized = normalizeApiUrl(apiUrl)
    } catch (connectError) {
      setWorkerConnection({
        status: 'invalid',
        detail: connectError instanceof Error ? connectError.message : 'Worker URL 格式不正确',
        url: apiUrl,
      })
      return
    }
    const problem = apiUrlProblem(normalized)
    if (problem) {
      setWorkerConnection({ status: 'invalid', detail: problem, url: normalized })
      return
    }
    setApiUrl(normalized)
    setApiUrlInput(normalized)
    const pageUrl = new URL(window.location.href)
    pageUrl.searchParams.delete('static')
    window.history.replaceState({}, '', pageUrl)
    await loadIssue(true)
  }

  const usePagesMode = async () => {
    const pageUrl = new URL(window.location.href)
    pageUrl.searchParams.set('static', '1')
    window.history.replaceState({}, '', pageUrl)
    await loadIssue(false)
  }

  const reviewOperationCount = useMemo(() => baseIssue && issue ? buildReviewExport(baseIssue, issue, reviewSessionId).operations.length : 0, [baseIssue, issue, reviewSessionId])

  const connectionLabel = workerConnection.status === 'connected'
    ? 'Worker 已连接'
    : workerConnection.status === 'checking'
      ? '正在检测'
      : workerConnection.status === 'pages'
        ? 'Pages 快照'
        : 'Worker 未连接'

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <img className="brand-logo" src={theme === 'dark' ? ifanrLogoDarkUrl : ifanrLogoLightUrl} alt="爱范儿 iFanr" />
          <div className="brand-product"><strong>早报编辑台</strong><span>BOT DRAFT · {issue?.publication_date || '未连接刊期'}</span></div>
        </div>
        <nav className="view-switcher" aria-label="编辑台视图">
          <button className={view === 'draft' ? 'active' : ''} onClick={() => switchView('draft')} type="button">早报稿</button>
          <button className={view === 'candidates' ? 'active' : ''} onClick={() => switchView('candidates')} type="button">候选库</button>
          <button className={view === 'trash' ? 'active' : ''} onClick={() => switchView('trash')} type="button">回收站</button>
          <button className={view === 'brands' ? 'active' : ''} onClick={() => switchView('brands')} type="button">标题</button>
          <button className={view === 'weekend' ? 'active' : ''} onClick={() => switchView('weekend')} type="button">周末备选</button>
        </nav>
        <div className="topbar-actions">
          <button ref={connectionTriggerRef} className={`connection connection-${workerConnection.status}`} type="button" title={workerConnection.detail} onClick={openSettings}>
            {workerConnection.status === 'checking' ? <LoaderCircle size={14} className="spin" /> : workerConnection.status === 'connected' ? <CircleDot size={13} /> : <CloudOff size={14} />}
            <span>{connectionLabel}</span>
          </button>
          <IconButton title={dataMode === 'worker' ? '手动添加选题' : '连接 Worker 后才能添加选题'} onClick={() => { setClosingOverlay(null); setShowCreateStory(true) }} disabled={!issue || dataMode !== 'worker'}><Plus size={17} /></IconButton>
          <IconButton title={repoRuntimeAccess ? '同步最新自动化产物' : '读取自动化已同步的最终稿'} onClick={() => void refresh(false)} disabled={!issue}><RefreshCw size={17} /></IconButton>
          <IconButton title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'} onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}><>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</></IconButton>
          <button ref={settingsTriggerRef} className={`icon-button ${showSettings && !settingsClosing ? 'active' : ''}`} type="button" title="连接设置" aria-label="连接设置" onClick={toggleSettings}><Settings size={17} /></button>
          <button className="export-button" type="button" disabled={!issue} onClick={() => { setHandoff(null); setClosingOverlay(null); setShowExport(true) }}><Download size={16} />导出</button>
        </div>
        {showSettings ? <div ref={settingsPopoverRef} className={`settings-popover ${settingsClosing ? 'closing' : ''}`} onAnimationEnd={() => { if (settingsClosing) finishSettingsClose() }}>
          <div className={`connection-summary connection-${workerConnection.status}`}>
            <div>{workerConnection.status === 'checking' ? <LoaderCircle size={16} className="spin" /> : workerConnection.status === 'connected' ? <CircleDot size={15} /> : <CloudOff size={16} />}</div>
            <span><strong>{connectionLabel}</strong><small>{workerConnection.detail}</small></span>
          </div>
          <label><span>Worker URL</span><input aria-label="Worker URL" value={apiUrl} onChange={(event) => setApiUrlInput(event.target.value)} /></label>
          <p className="settings-hint">Tailscale Serve 使用 HTTPS 根地址，不含 <code>:8765</code>。{apiUrl.includes('.ts.net') ? <><br /><a href={`${apiUrl.replace(/\/$/, '')}/health`} target="_blank" rel="noreferrer">直接打开 Worker 健康检查</a>；Chrome 询问时请允许「本地网络访问」。</> : null}</p>
          {window.location.hostname.endsWith('github.io') ? <div className="same-origin-links"><a className="same-origin-console" href={lanConsoleUrl} target="_blank" rel="noreferrer">同 Wi-Fi 打开可编辑工作台</a><a className="same-origin-console" href={tailscaleConsoleUrl} target="_blank" rel="noreferrer">通过 Tailscale 直连工作台</a></div> : null}
          <div className="settings-actions"><button type="button" disabled={workerConnection.status === 'checking'} onClick={() => void connectWorker()}>{workerConnection.status === 'checking' ? '正在检测…' : '测试并连接'}</button><button type="button" onClick={() => void usePagesMode()}>仅使用 Pages</button></div>
          <div className="settings-divider" />
          <label><span>Gemini API Key</span><input type="password" aria-label="Gemini API Key" autoComplete="off" value={geminiKey} placeholder={geminiConfigured ? '已在当前浏览器配置 · Gemini 3.5 Flash' : '用于双品牌标题生成'} onChange={(event) => setGeminiKey(event.target.value)} /></label>
          <button type="button" disabled={!geminiKey.trim()} onClick={() => void saveGeminiKey()}>保存 Gemini Key</button>
          <p className="settings-hint">Key 只保存在当前浏览器的网页数据中；Gemini 请求也由当前设备直接发出。</p>
          <button type="button" disabled={workerConnection.status !== 'connected'} onClick={() => { setProfileMessage('正在归纳本周编辑决策…'); void api.proposeProfile().then((proposal) => setProfileMessage(proposal.status === 'pending' ? '已生成待确认的偏好差异提案' : '本周暂无需调整的偏好')).catch((profileError) => setProfileMessage(profileError instanceof Error ? profileError.message : '提案生成失败')) }}>生成每周偏好提案</button>
          {profileMessage ? <p className="settings-message">{profileMessage}</p> : null}
        </div> : null}
      </header>

      {(view === 'draft' || view === 'candidates' || view === 'trash') ? (
        <div className={`editor-layout ${selectedStory ? 'with-detail' : ''}`}>
          <aside className="sidebar">
            <div className="sidebar-heading"><Menu size={16} /><span>栏目</span></div>
            <nav>{sidebarCategories.map((item) => <button type="button" className={(view === 'draft' ? activeDraftSection : category) === item ? 'active' : ''} onClick={() => view === 'draft' ? scrollToDraftSection(item) : setCategory(item)} key={item}><span>{item}</span><em>{view === 'draft' ? draftCounts[item] || 0 : view === 'trash' ? issue?.stories.filter((story) => story.status === 'excluded' && (item === '全部' || story.category === item)).length || 0 : issue?.stories.filter((story) => !story.selected && !pendingAiEditorRequest(story) && story.status !== 'excluded' && (item === '全部' || story.category === item)).length || 0}</em></button>)}</nav>
            {view === 'candidates' ? <><div className="sidebar-heading"><ArrowUpDown size={16} /><span>状态</span></div><nav>{[['all', '待处理'], ['needs_review', '待复核'], ['source_chasing', '追源中']].map(([value, label]) => <button type="button" className={candidateStatus === value ? 'active' : ''} onClick={() => setCandidateStatus(value)} key={value}><span>{label}</span></button>)}</nav></> : null}
            <div className="issue-metrics"><button type="button" onClick={() => switchView('draft')}><strong>{issue?.selected_count || 0}</strong><span>Bot 成稿</span></button><button type="button" onClick={() => { setView('candidates'); setCandidateStatus('all'); setCategory('全部'); setQuery('') }}><strong>{issue?.ready_count || 0}</strong><span>可用</span></button><button type="button" onClick={jumpToReview} disabled={!issue?.review_count}><strong>{issue?.review_count || 0}</strong><span>待复核</span></button></div>
          </aside>

          <main ref={view === 'draft' ? draftScrollRef : undefined} onScroll={view === 'draft' ? syncDraftSection : undefined} className={view === 'draft' ? 'draft-column' : 'candidate-column'}>
            {loading ? <div className="center-state"><LoaderCircle size={24} className="spin" /><span>正在读取刊期</span></div> : null}
            {!loading && error && !issue ? <div className="center-state error"><CloudOff size={26} /><strong>{workerConnection.status === 'pages' ? '尚未连接主 Mac' : 'Worker 未连接'}</strong><span>{error}</span><div className="center-state-actions"><button type="button" onClick={openSettings}>连接设置</button><button type="button" onClick={() => void loadIssue()}>重新检测</button></div></div> : null}
            {!loading && issue && view === 'draft' ? <div className={`draft-stage ${outlineCollapsed ? 'outline-collapsed' : ''}`}>
              {!outlineCollapsed ? <aside className="draft-outline" aria-label="稿件目录"><header><span>稿件目录</span><em>{draftStories.length}</em><button type="button" title="收起目录" aria-label="收起目录" onClick={() => setOutlineCollapsed(true)}><PanelRightClose size={16} /></button></header>{groupedDraft.map(([section, stories]) => <section key={section}><button type="button" className="draft-outline-section" onClick={() => scrollToDraftSection(section)}>{section}</button>{stories.map((story) => <button type="button" key={story.id} draggable className={selectedStoryId === story.id ? 'active' : ''} onClick={() => scrollToStory(story)} onDragStart={() => setDraggedStoryId(story.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void handleDrop(story.id) }}><span>{story.title}</span></button>)}</section>)}</aside> : null}
              {outlineCollapsed ? <button type="button" className="draft-outline-reveal" title="展开稿件目录" aria-label="展开稿件目录" onClick={() => setOutlineCollapsed(false)}><Menu size={17} /></button> : null}
              <div className="draft-page"><header className="draft-masthead"><div className="draft-date">{issue?.publication_date?.replaceAll('-', ' / ')}</div><h1>早报</h1><p>{issue?.diagnostics?.static_snapshot ? `当天飞书 Bot 稿 · ${issue?.selected_count || 0} 条 · Pages 只读快照` : `当前飞书 Bot 稿 · ${issue?.selected_count || 0} 条成稿${pendingAiEditorCount ? ` · ${pendingAiEditorCount} 条待 AI 主编撰写` : ''} · 自动化更新后保留人工编辑`}</p><div className="draft-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="在当前早报稿中搜索" /></div></header><div className="draft-document">{groupedDraft.map(([section, stories], sectionIndex) => <section className="issue-section" id={`section-${section.replaceAll('/', '-')}`} key={section}><header className="section-title"><span>{String(sectionIndex + 1).padStart(2, '0')}</span><h2>{section}</h2><em>{stories.length}</em></header>{stories.map((story, index) => <IssueArticle key={story.id} story={story} active={selectedStoryId === story.id} moving={movingStoryId === story.id} canMoveUp={index > 0} canMoveDown={index < stories.length - 1} onMoveTop={() => void moveStory(story.id, 'first')} onMoveUp={() => void moveStory(story.id, -1)} onMoveDown={() => void moveStory(story.id, 1)} onMoveBottom={() => void moveStory(story.id, 'last')} onMoveCategory={(target) => void (isSaturdayIssue ? moveStoryToWeekendSection(story.id, target) : moveStoryToCategory(story.id, target))} moveOptions={isSaturdayIssue ? weekendDraftCategories : undefined} currentMoveTarget={isSaturdayIssue ? weekendDraftSection(story) : undefined} onOpen={() => setSelectedStoryId(story.id)} onExclude={() => requestDeleteStory(story)} onDragStart={() => setDraggedStoryId(story.id)} onDrop={() => void handleDrop(story.id)} />)}</section>)}</div></div>
            </div> : null}
            {!loading && issue && view === 'candidates' ? <>
              <header className="candidate-masthead"><div><span>候选库</span><h1>待追源与待复核</h1><p>候选不会直接进入正文；采用后会先以「待 AI 主编撰写」状态出现在「早报稿」。</p></div><strong>{candidates.length}</strong></header>
              <div className="candidate-toolbar"><div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、正文或来源" /></div></div>
              <div className="candidate-list">{candidates.map((story) => <CandidateItem key={story.id} story={story} active={selectedStoryId === story.id} onOpen={() => setSelectedStoryId(story.id)} onAdopt={() => void adoptCandidate(story)} onExclude={() => requestDeleteStory(story)} />)}</div>
            </> : null}
            {!loading && issue && view === 'trash' ? <>
              <header className="candidate-masthead trash-masthead"><div><span>当前刊期</span><h1>回收站</h1><p>仅保留当天被移出的选题，恢复后回到原栏目末尾。</p></div><strong>{trashStories.length}</strong></header>
              <div className="candidate-toolbar"><div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索已删除的选题" /></div></div>
              <div className="candidate-list">{trashStories.length ? trashStories.map((story) => <TrashItem key={story.id} story={story} active={selectedStoryId === story.id} disabled={dataMode !== 'worker'} onOpen={() => setSelectedStoryId(story.id)} onRestore={() => void restoreStory(story)} />) : <div className="center-state"><Trash2 size={25} /><strong>回收站是空的</strong><span>当天从早报稿移出的选题会出现在这里。</span></div>}</div>
            </> : null}
          </main>
          {selectedStory ? <DetailPanel story={selectedStory} activeJob={selectedJob} staticMode={dataMode === 'static'} closing={detailClosing} onClose={closeDetail} onPatch={(patch) => updateStory(selectedStory.id, patch)} onImageChange={(updated) => setIssue((current) => current ? issueWithMetrics(current, current.stories.map((story) => story.id === updated.id ? updated : story)) : current)} onAction={async (action, chrome) => { const job = await api.action(selectedStory.id, action, chrome); await watchJob(selectedStory.id, job) }} /> : null}
        </div>
      ) : null}

      {view === 'brands' && issue ? <BrandWorkspace issue={issue} generating={generatingBrand} onGenerate={generateBrand} onSave={async (brand, patch) => { if (dataMode === 'static') { setIssue({ ...issue, brand_packages: { ...issue.brand_packages, [brand]: { ...issue.brand_packages[brand], ...patch } } }); return } await api.patchBrand(issue.id, brand, patch); setIssue(await api.getIssue(issue.id)) }} /> : null}
      {view === 'weekend' ? <WeekendWorkspace data={weekend} /> : null}
      {showCreateStory && issue ? <StoryCreateDialog busy={creatingStory} closing={closingOverlay === 'create'} onClose={() => closeOverlay('create')} onCreate={createStory} /> : null}
      {showExport && issue ? <ExportDialog issue={issue} handoff={handoff} busy={exporting} staticMode={dataMode === 'static'} operationCount={reviewOperationCount} closing={closingOverlay === 'export'} onClose={() => closeOverlay('export')} onMarkdown={() => downloadText(`${issue.id}.md`, renderIssueMarkdown(issue), 'text/markdown;charset=utf-8')} onHandoff={() => void createHandoff()} /> : null}
      {pendingDelete ? <DeleteConfirmDialog story={pendingDelete} busy={deleteBusy} closing={closingOverlay === 'delete'} onCancel={() => { if (!deleteBusy) closeOverlay('delete') }} onConfirm={() => void confirmDeleteStory()} /> : null}
      {operationError ? <div className="operation-error-toast" role="alert"><CloudOff size={16} /><span>{operationError}</span><button type="button" aria-label="关闭操作错误提示" onClick={() => setOperationError('')}>×</button></div> : null}
      {undoToastVisible && deletedStories.length ? <div className={`undo-toast ${undoToastClosing ? 'is-closing' : ''}`} role="status"><span>已移入回收站：{deletedStories.at(-1)?.title}</span><button type="button" disabled={undoBusy} onClick={() => void undoLastDeletion()}>{undoBusy ? <LoaderCircle size={14} className="spin" /> : <RotateCcw size={14} />}撤销 <kbd>⌘Z</kbd></button></div> : null}
    </div>
  )
}
