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
  CloudUpload,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileCheck2,
  Film,
  FolderInput,
  Gamepad2,
  GripVertical,
  Image,
  KeyRound,
  Library,
  LoaderCircle,
  Lock,
  Menu,
  PanelRightClose,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  Save,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unlock,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEventHandler, type ReactNode } from 'react'
import { api, describeWorkerError, getApiUrl, getAuthToken, isPagesDeployment, resolveApiAssetUrl, setAuthToken } from './api'
import { comparePublicationStories, groupPublicationStories, normalizeStoryCategory, publicationCategories, publicationCategoryOrder } from './categories'
import { defaultGeminiModel, generateBrandHeadlines, getGeminiModel, hasGeminiKey, listGeminiModels, saveGeminiKey as persistGeminiKey, saveGeminiModel } from './gemini'
import { generateQrSvgDataUri } from './totp'
import { buildReviewExport, downloadText, renderIssueMarkdown } from './review'
import type { EditorialReviewExport } from './review'
import type { AutomationHandoff, BrandPackage, Issue, Job, Source, Story, StoryCreateInput, StoryStatus } from './types'
import ifanrLogoDarkUrl from './assets/ifanr-logo-dark.png'
import ifanrLogoLightUrl from './assets/ifanr-logo-light.png'
import ifanrMarkUrl from './assets/ifanr-mark.png'
const LEGACY_AVATAR_STORAGE_KEY = 'ifanr-editorial-avatar'

const categories = ['全部', ...publicationCategories]
const categoryOrder = publicationCategoryOrder
// Saturday keeps the familiar editorial buckets in the workbench.  The Bot
// renderer deliberately collapses them into one reader-facing weekend section.
const weekendWorkbenchCategories = ['大公司', '新产品', '新消费', '好看的'] as const
const workerRefreshIntervalMs = 25_000
const draftRecoveryKey = (storyId: string) => `ifanr-editorial-draft-recovery:${storyId}`

type DraftRecovery = { title: string; body: string; baseTitle: string; baseBody: string; savedAt: string }

function loadDraftRecovery(story: Story): DraftRecovery | null {
  try {
    const raw = localStorage.getItem(draftRecoveryKey(story.id))
    if (!raw) return null
    const value = JSON.parse(raw) as DraftRecovery
    return value.baseTitle === story.title && value.baseBody === story.body ? value : null
  } catch {
    return null
  }
}

function storeDraftRecovery(story: Story, title: string, body: string) {
  try {
    localStorage.setItem(draftRecoveryKey(story.id), JSON.stringify({ title, body, baseTitle: story.title, baseBody: story.body, savedAt: new Date().toISOString() }))
  } catch {
    // Private browsing or a full storage quota must not interrupt editing.
  }
}

function legacyAvatarFile(dataUrl: string): File | null {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/)
  if (!match) return null
  try {
    const binary = window.atob(match[2])
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    return new File([bytes], 'legacy-avatar', { type: match[1] })
  } catch {
    return null
  }
}

function IfanrMarkIcon({ size = 18 }: { size?: number }) {
  return (
    <svg role="img" aria-label="ifanr" width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', flex: '0 0 auto' }}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" stroke="#ec1700" strokeWidth="1.8" />
      <path d="M8 8L16 16" stroke="#ec1700" strokeWidth="3.6" strokeLinecap="square" />
    </svg>
  )
}

function isSaturdayPublication(publicationDate?: string) {
  if (!publicationDate) return false
  const [year, month, day] = publicationDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 6
}

function weekendWorkbenchSection(story: Story) {
  // Saturday does not expose a 重磅 column, but never hide a legacy item.
  return story.category === '重磅' ? '大公司' : story.category
}

function groupDraftStories(stories: Story[], isSaturday: boolean): Array<readonly [string, Story[]]> {
  if (!isSaturday) return groupPublicationStories(stories)
  const groups = new Map<string, Story[]>()
  stories.forEach((story) => {
    const section = weekendWorkbenchSection(story)
    groups.set(section, [...(groups.get(section) || []), story])
  })
  return weekendWorkbenchCategories.map((section) => [section, groups.get(section) || []] as const)
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

function matchesStoryQuery(story: Story, query: string) {
  const terms = query
    .normalize('NFKC')
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!terms.length) return true
  const metadata = (() => {
    try { return JSON.stringify(story.metadata) } catch { return '' }
  })()
  const searchable = [
    story.title,
    story.body,
    story.source_name,
    story.source_url,
    story.editorial_reason,
    metadata,
    ...story.sources.flatMap((source) => [source.title, source.publisher, source.url]),
    ...story.claims.flatMap((claim) => [claim.text, claim.evidence, claim.source_url]),
  ].join(' ').normalize('NFKC').toLocaleLowerCase()
  return terms.every((term) => searchable.includes(term))
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
  onDragEnd,
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
  onDrop: (after: boolean) => void
  onDragEnd: () => void
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
  const relatedLinks = clipboardRelatedLinks(story)
  return (
    <article
      id={`story-${story.id}`}
      className={`issue-article ${active ? 'active' : ''} ${moving ? 'moving' : ''}`}
      onClick={onOpen}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        const after = event.clientY >= rect.top + rect.height / 2
        onDrop(after)
      }}
      onDragEnd={onDragEnd}
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
          {relatedLinks.map((link) => <p className="related-link-display" key={link.url}>🔗 相关阅读：<a href={link.url} target="_blank" rel="noreferrer">{link.title}</a></p>)}
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
  const [relatedTitle, setRelatedTitle] = useState('')
  const [relatedUrl, setRelatedUrl] = useState('')
  const [relatedBusy, setRelatedBusy] = useState(false)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const saveTimerRef = useRef<number | null>(null)
  const pendingPatchRef = useRef<Partial<Story>>({})
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const titleRef = useRef(title)
  const bodyRef = useRef(body)

  useEffect(() => {
    const recovery = !staticMode ? loadDraftRecovery(story) : null
    setTitle(recovery?.title ?? story.title)
    setBody(recovery?.body ?? story.body)
    titleRef.current = recovery?.title ?? story.title
    bodyRef.current = recovery?.body ?? story.body
    pendingPatchRef.current = {}
    if (recovery) {
      pendingPatchRef.current = { title: recovery.title, body: recovery.body }
      setSaveState('error')
      window.setTimeout(() => { void flushPending() }, 0)
    } else setSaveState('saved')
  }, [story.id])

  const flushPending = useCallback(async () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const patch = pendingPatchRef.current
    pendingPatchRef.current = {}
    if (!Object.keys(patch).length) return
    setSaveState('saving')
    const request = saveQueueRef.current.then(() => onPatch(patch))
    saveQueueRef.current = request.catch(() => undefined)
    try {
      await request
      if (!Object.keys(pendingPatchRef.current).length) {
        try { localStorage.removeItem(draftRecoveryKey(story.id)) } catch { /* no-op */ }
        setSaveState('saved')
      }
    } catch {
      pendingPatchRef.current = { ...patch, ...pendingPatchRef.current }
      storeDraftRecovery(story, titleRef.current, bodyRef.current)
      setSaveState('error')
    }
  }, [onPatch, story])

  const schedulePersist = useCallback((field: 'title' | 'body', value: string, immediate = false) => {
    pendingPatchRef.current = { ...pendingPatchRef.current, [field]: value }
    if (field === 'title') titleRef.current = value
    else bodyRef.current = value
    if (!staticMode) storeDraftRecovery(story, titleRef.current, bodyRef.current)
    setSaveState('saving')
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    if (immediate) void flushPending()
    else saveTimerRef.current = window.setTimeout(() => { saveTimerRef.current = null; void flushPending() }, 600)
  }, [flushPending, staticMode, story])

  const relatedLinks = Array.isArray(story.metadata.related_links)
    ? story.metadata.related_links.filter((item): item is { title: string; url: string } => Boolean(item && typeof item === 'object' && typeof (item as { title?: unknown }).title === 'string' && typeof (item as { url?: unknown }).url === 'string'))
    : []
  const saveRelatedLinks = (links: { title: string; url: string }[]) => void onPatch({ metadata: { ...story.metadata, related_links: links } })
  const addRelatedLink = async () => {
    if (!/^https?:\/\//.test(relatedUrl.trim())) return
    setRelatedBusy(true)
    try {
      const resolved = await api.resolveRelatedLink(story.id, relatedUrl.trim())
      saveRelatedLinks([...relatedLinks, resolved])
      setRelatedTitle('')
      setRelatedUrl('')
    } catch {
      // A title field remains as a deliberate fallback for paywalls or JS-only pages.
      if (relatedTitle.trim()) {
        saveRelatedLinks([...relatedLinks, { title: relatedTitle.trim(), url: relatedUrl.trim() }])
        setRelatedTitle('')
        setRelatedUrl('')
      }
    } finally { setRelatedBusy(false) }
  }

  useEffect(() => {
    const flushOnLeave = () => { void flushPending() }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushOnLeave() }
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        flushOnLeave()
      }
    }
    window.addEventListener('beforeunload', flushOnLeave)
    window.addEventListener('keydown', onShortcut)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
      window.removeEventListener('beforeunload', flushOnLeave)
      window.removeEventListener('keydown', onShortcut)
      document.removeEventListener('visibilitychange', onVisibility)
      flushOnLeave()
    }
  }, [flushPending])

  return (
    <aside className={`detail-panel ${closing ? 'closing' : ''}`} onKeyDownCapture={(event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      void (async () => {
        await flushPending()
        onClose()
      })()
    }}>
      <div className="detail-toolbar">
        <span className="detail-kicker">稿件与来源</span>
        <span className={`autosave-state ${saveState}`} aria-live="polite">{saveState === 'saving' ? '正在保存' : saveState === 'error' ? '保存失败' : staticMode ? '本地审稿' : '已保存'}</span>
        <button type="button" className="detail-save-button" title="立即保存（⌘S）" onClick={() => void flushPending()}><Save size={15} />⌘S 保存</button>
        <IconButton title="关闭详情" onClick={() => { void (async () => { await flushPending(); onClose() })() }}><PanelRightClose size={18} /></IconButton>
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
        <section className="related-links-editor" aria-label="相关阅读">
          <span className="field-label">相关阅读</span>
          <p>粘贴链接后自动抓取文章标题；仅在抓取失败时手动补标题。发布时会自动置于正文末尾。</p>
          {relatedLinks.map((link, index) => <div className="related-link-item" key={`${link.url}-${index}`}><a href={link.url} target="_blank" rel="noreferrer">{link.title}</a><button type="button" aria-label={`删除相关阅读：${link.title}`} onClick={() => saveRelatedLinks(relatedLinks.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button></div>)}
          <div className="related-link-inputs">
            <input value={relatedTitle} onChange={(event) => setRelatedTitle(event.target.value)} placeholder="抓取失败时手动填标题" aria-label="相关阅读标题" />
            <input value={relatedUrl} onChange={(event) => setRelatedUrl(event.target.value)} placeholder="https://…" aria-label="相关阅读链接" />
            <button type="button" disabled={relatedBusy || !/^https?:\/\//.test(relatedUrl.trim())} onClick={() => void addRelatedLink()}><Plus size={15} />{relatedBusy ? '抓取中' : '添加'}</button>
          </div>
        </section>
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
  generating: Record<'appso' | 'ifanr', boolean>
}) {
  return (
    <div className="brand-workspace">
      {(['appso', 'ifanr'] as const).map((brand) => {
        const pack = issue.brand_packages[brand]
        return (
          <section className="brand-section" key={brand}>
            <header><div><span className="brand-code">{brand.toUpperCase()}</span><h2>{brand === 'appso' ? 'AI 与产品入口' : '消费电子与生活方式'}</h2></div><button type="button" className="generate-button" disabled={generating[brand]} onClick={() => void onGenerate(brand)}>{generating[brand] ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{(pack?.headline_options || []).length ? '重新生成标题' : '生成标题'}</button></header>
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

function ExportDialog({ issue, handoff, busy, staticMode, operationCount, closing = false, onClose, onMarkdown, onHandoff, onCopyToFeishu, onPublishToLark }: {
  issue: Issue
  handoff: AutomationHandoff | null
  busy: boolean
  staticMode: boolean
  operationCount: number
  closing?: boolean
  onClose: () => void
  onMarkdown: () => void
  onHandoff: () => void
  onCopyToFeishu: () => Promise<boolean>
  onPublishToLark: () => Promise<Job>
}) {
  const [copied, setCopied] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishMessage, setPublishMessage] = useState('')
  const [publishProgress, setPublishProgress] = useState(0)
  const headlineRewriteNotice = handoff?.requires_ai_headline_rewrite
    ? `已保存，但仍有 ${handoff.headline_quality_warnings?.length || 1} 条标题待 AI 主编根据原文改写；在改写前不能发布。`
    : ''
  const bodyWriteNotice = handoff?.requires_ai_body_write
    ? `已保存，但仍有 ${handoff.empty_body_titles?.length || 1} 条选题待 AI 主编补全正文；在补全前不能发布。`
    : ''
  const copyToFeishu = async () => {
    const ok = await onCopyToFeishu()
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2600)
    }
  }
  const publishToLark = async () => {
    setPublishing(true)
    setPublishProgress(0)
    setPublishMessage('正在启动同步…')
    try {
      const queued = await onPublishToLark()
      setPublishProgress(queued.progress || 0)
      const completed = await api.watchJob(queued.id, (job) => { setPublishMessage(job.message); setPublishProgress(job.progress) })
      if (completed.state === 'failed') throw new Error(completed.error || '飞书 Bot 同步失败')
      setPublishProgress(100)
      setPublishMessage(completed.message || '已同步飞书 Bot 同刊期文档')
    } catch (error) {
      setPublishMessage(error instanceof Error ? error.message : '飞书 Bot 同步失败')
    } finally {
      setPublishing(false)
    }
  }
  return <div className={`modal-backdrop ${closing ? 'closing' : ''}`} role="presentation" onMouseDown={onClose}><div className={`export-dialog ${closing ? 'closing' : ''}`} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header><div><span>结构化导出</span><h2>导出 {issue.selected_count} 条早报稿</h2></div><IconButton title="关闭" onClick={onClose}><X size={18} /></IconButton></header><div className="export-options">{!staticMode ? <button className="export-option" type="button" disabled={publishing} onClick={() => void publishToLark()}>{publishing ? <LoaderCircle size={19} className="spin" /> : <CloudUpload size={19} />}<span><strong>同步飞书 Bot 同刊期文档</strong><small>{publishMessage || '覆盖当前同刊期 Bot 文档，并回读校验标题、正文、分栏和图片'}</small>{publishing ? <span className="publish-progress" aria-live="polite"><i><b style={{ width: `${Math.max(2, publishProgress)}%` }} /></i><em>{Math.round(publishProgress)}%</em></span> : null}</span></button> : null}<button className="export-option" type="button" onClick={() => void copyToFeishu()}><Copy size={19} /><span><strong>{copied ? '已复制，可粘贴到飞书云文档' : '复制到飞书云文档'}</strong><small>复制当前标题、正文、分类和排序，打开飞书云文档后直接粘贴</small></span></button><button className="export-option" type="button" onClick={onMarkdown}><Download size={19} /><span><strong>下载 Markdown</strong><small>导出当前标题、正文、分类、排序和来源行</small></span></button><button className="export-option" type="button" disabled={busy || (staticMode && operationCount === 0)} onClick={onHandoff}>{busy ? <LoaderCircle size={19} className="spin" /> : <RefreshCw size={19} />}<span><strong>{staticMode ? '下载飞书审稿单' : '交给下一轮自动化'}</strong><small>{staticMode ? `仅包含 ${operationCount} 个显式修改；下载后发送到早报飞书群` : '写入本机 handoff，定时任务会在同刊期继承并合并新内容'}</small></span></button></div>{staticMode ? <div className="review-safety"><ShieldCheck size={16} /><span>审稿单不会把未列出的新闻视为删除。刊期、版本或故事指纹冲突时，主 Mac 会保留原稿并转为人工复核。</span></div> : null}{handoff ? <div className="handoff-success"><Check size={16} /><span>已写入刊期 {handoff.issue_id} 的 handoff，共 {handoff.selected_count} 条。{headlineRewriteNotice ? ` ${headlineRewriteNotice}` : ''}{bodyWriteNotice ? ` ${bodyWriteNotice}` : ''}</span></div> : null}<footer><button type="button" className="secondary-button" onClick={onClose}>完成</button></footer></div></div>
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
    const urls = sourceUrls.split(/\r?\n|；/).map((item) => item.trim()).filter(Boolean)
    if (!urls.length) {
      setError('请至少填写一个来源 URL')
      return
    }
    setError('')
    try {
      await onCreate({
        title: title.trim(),
        body: body.trim(),
        category,
        selected: title.trim() ? selected : false,
        source_urls: urls,
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
        <label className="wide"><span>标题（可留空）</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="可只填来源 URL，后续由 AI 主编补写" /></label>
        <label><span>栏目</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{publicationCategories.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
        <label><span>事件发生日</span><input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} /></label>
        <label className="wide"><span>正文</span><textarea rows={7} value={body} onChange={(event) => setBody(event.target.value)} placeholder="按早报 prompt 写入正文；也可以只填标题，稍后追源成稿" /></label>
        <label className="wide"><span>来源 URL（必填）</span><textarea rows={3} value={sourceUrls} onChange={(event) => setSourceUrls(event.target.value)} placeholder="每行一个 URL，第一条作为主来源" /></label>
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

function sha256(ascii: string): string {
  let i: number, j: number
  let result = ''
  const words: number[] = []
  const asciiBitLength = ascii.length * 8
  const hash: number[] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const k: number[] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  for (i = 0; i < ascii.length; i++) {
    words[i >> 2] |= ascii.charCodeAt(i) << (24 - (i % 4) * 8)
  }
  words[ascii.length >> 2] |= 0x80 << (24 - (ascii.length % 4) * 8)
  while ((words.length % 16) !== 14) words.push(0)
  words.push(Math.floor(asciiBitLength / Math.pow(2, 32)))
  words.push(asciiBitLength & 0xffffffff)
  for (j = 0; j < words.length; j += 16) {
    const w = words.slice(j, j + 16)
    const oldHash = [...hash]
    for (i = 0; i < 64; i++) {
      if (i >= 16) {
        const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3)
        const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10)
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
      }
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6])
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2])
      const S0 = ((hash[0] >>> 2) | (hash[0] << 30)) ^ ((hash[0] >>> 13) | (hash[0] << 19)) ^ ((hash[0] >>> 22) | (hash[0] << 10))
      const S1 = ((hash[4] >>> 6) | (hash[4] << 26)) ^ ((hash[4] >>> 11) | (hash[4] << 21)) ^ ((hash[4] >>> 25) | (hash[4] << 7))
      const temp1 = hash[7] + S1 + ch + k[i] + w[i]
      const temp2 = S0 + maj
      hash[7] = hash[6]
      hash[6] = hash[5]
      hash[5] = hash[4]
      hash[4] = (hash[3] + temp1) | 0
      hash[3] = hash[2]
      hash[2] = hash[1]
      hash[1] = hash[0]
      hash[0] = (temp1 + temp2) | 0
    }
    for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0
  }
  for (i = 0; i < 8; i++) {
    for (j = 3; j >= 0; j--) {
      const b = (hash[i] >> (j * 8)) & 255
      result += (b < 16 ? '0' : '') + b.toString(16)
    }
  }
  return result
}

async function hashPassword(username: string, password: string): Promise<string> {
  const salt = 'ifanr_zaobao_secure_salt_v2'
  const str = `${salt}:${username.trim().toLowerCase()}:${password}`
  if (window.crypto && window.crypto.subtle && typeof window.crypto.subtle.digest === 'function') {
    try {
      const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
    } catch {
      // fallback to pure JS sha256
    }
  }
  return sha256(str)
}

function AuthDialog({
  isReadOnly, authUser, busy, error, closing = false, has2FA, onClose, onLogin,
  onChangePassword, onStart2FA, onEnable2FA, onDisable2FA, onLogout,
}: {
  isReadOnly: boolean
  authUser: string
  busy: boolean
  error: string
  closing?: boolean
  has2FA: boolean
  onClose: () => void
  onLogin: (username: string, password: string, totpCode?: string) => void
  onChangePassword: (currentPassword: string, newPassword: string) => void
  onStart2FA: () => Promise<{ secret: string; otpauth_url: string }>
  onEnable2FA: (totpCode: string) => Promise<string[]>
  onDisable2FA: (totpCode: string) => Promise<void>
  onLogout: () => void
}) {
  const [username, setUsername] = useState('Shawn Rain')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [twoFactorView, setTwoFactorView] = useState<'idle' | 'setup' | 'recovery' | 'disable'>('idle')
  const [setupPayload, setSetupPayload] = useState<{ secret: string; otpauth_url: string } | null>(null)
  const [verifyTotpInput, setVerifyTotpInput] = useState('')
  const [twoFactorError, setTwoFactorError] = useState('')
  const [twoFactorBusy, setTwoFactorBusy] = useState(false)
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [recoverySaved, setRecoverySaved] = useState(false)
  const [copyMessage, setCopyMessage] = useState('')

  const passwordChangeReady = Boolean(currentPassword.trim() && newPassword.length >= 12 && newPassword === confirmPassword)
  const cleanTotp = (value: string) => value.replace(/\D/g, '').slice(0, 6)
  const cleanSecondFactor = (value: string) => value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9)
  const secondFactorReady = (value: string) => /^\d{6}$/.test(value) || /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/.test(value)
  const qrSvgData = setupPayload ? generateQrSvgDataUri(setupPayload.otpauth_url) : ''
  const recoveryText = `ifanr 早报编辑台备用码\n账号：${authUser || 'Shawn Rain'}\n\n${recoveryCodes.join('\n')}\n\n每个备用码只能使用一次，请离线妥善保存。`

  const startSetup = async () => {
    setTwoFactorBusy(true)
    setTwoFactorError('')
    setVerifyTotpInput('')
    setCopyMessage('')
    try {
      setSetupPayload(await onStart2FA())
      setTwoFactorView('setup')
    } catch (setupError) {
      setTwoFactorError(setupError instanceof Error ? setupError.message : '无法生成绑定二维码')
    } finally {
      setTwoFactorBusy(false)
    }
  }

  const enableTwoFactor = async () => {
    if (!/^\d{6}$/.test(verifyTotpInput) || !setupPayload) return
    setTwoFactorBusy(true)
    setTwoFactorError('')
    try {
      setRecoveryCodes(await onEnable2FA(verifyTotpInput))
      setRecoverySaved(false)
      setTwoFactorView('recovery')
      setSetupPayload(null)
      setVerifyTotpInput('')
    } catch (enableError) {
      setTwoFactorError(enableError instanceof Error ? enableError.message : '动态验证码不正确或已过期')
    } finally {
      setTwoFactorBusy(false)
    }
  }

  const disableTwoFactor = async () => {
    if (!secondFactorReady(verifyTotpInput)) return
    setTwoFactorBusy(true)
    setTwoFactorError('')
    try {
      await onDisable2FA(verifyTotpInput)
      setTwoFactorView('idle')
      setVerifyTotpInput('')
    } catch (disableError) {
      setTwoFactorError(disableError instanceof Error ? disableError.message : '无法关闭两步验证')
    } finally {
      setTwoFactorBusy(false)
    }
  }

  const copyText = async (text: string, message: string) => {
    const copied = await writeClipboardText(text)
    setCopyMessage(copied ? message : '复制失败，请手动选择文本')
  }

  const resetTwoFactorView = () => {
    setTwoFactorView('idle')
    setSetupPayload(null)
    setVerifyTotpInput('')
    setTwoFactorError('')
    setCopyMessage('')
  }

  return <div className={`modal-backdrop ${closing ? 'closing' : ''}`} role="presentation" onMouseDown={onClose}>
    <form className={`auth-dialog ${closing ? 'closing' : ''}`} role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title" onSubmit={(event) => {
      event.preventDefault()
      if (isReadOnly) onLogin(username, password, totpCode)
      else if (passwordChangeReady) onChangePassword(currentPassword, newPassword)
    }} onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <div><span>管理员鉴权</span><h2 id="auth-dialog-title">{isReadOnly ? '解锁编辑权限' : '账号与安全'}</h2></div>
        <IconButton title="关闭" onClick={onClose}><X size={18} /></IconButton>
      </header>
      <div className="auth-dialog-body">
        {isReadOnly ? <>
          <div className="auth-login-intro"><div className="auth-login-icon"><Lock size={18} /></div><div><strong>工作台当前为只读</strong><p>验证管理员身份后可恢复编辑、提交与发布操作。</p></div></div>
          <label><span>用户名</span><input autoFocus autoComplete="username" type="text" value={username} placeholder="Shawn Rain" onChange={(event) => setUsername(event.target.value)} /></label>
          <label><span>密码</span><input autoComplete="current-password" type="password" value={password} placeholder="请输入管理员密码" onChange={(event) => setPassword(event.target.value)} /></label>
          {has2FA ? <label><span>安全验证码</span><input className="auth-code-input" autoComplete="one-time-code" maxLength={9} value={totpCode} placeholder="6 位动态验证码或备用码" onChange={(event) => setTotpCode(cleanSecondFactor(event.target.value))} /><small>打开身份验证器查看验证码；手机不在身边时可使用备用码。</small></label> : null}
        </> : <>
          <div className="auth-account-card">
            <div className="auth-account-identity"><div className="unlocked-badge"><Unlock size={17} /></div><div><strong>{authUser || 'Shawn Rain'}</strong><span>管理员权限已解锁</span></div></div>
            <button type="button" className="auth-text-button" disabled={busy} onClick={onLogout}>退出登录</button>
          </div>

          <section className="auth-security-section" aria-labelledby="two-factor-title">
            <div className="auth-section-heading">
              <div className="auth-section-icon"><ShieldCheck size={18} /></div>
              <div><strong id="two-factor-title">两步验证</strong><span>使用兼容 TOTP 的身份验证器保护账号</span></div>
              {has2FA ? <span className="auth-2fa-badge enabled"><ShieldCheck size={12} />已开启</span> : <span className="auth-2fa-badge"><Shield size={12} />未开启</span>}
            </div>

            {twoFactorView === 'setup' && setupPayload ? <div className="auth-2fa-panel">
              <div className="auth-step-title"><span>1</span><div><strong>绑定身份验证器</strong><p>用 Google Authenticator、1Password 或其他 TOTP 应用扫描二维码。</p></div></div>
              <div className="auth-2fa-qr-container">
                <img src={qrSvgData} className="auth-2fa-qr-img" alt="2FA 二维码" />
                <div className="auth-2fa-qr-info"><span>无法扫码？手动输入密钥</span><div className="auth-secret-row"><code>{setupPayload.secret}</code><button type="button" aria-label="复制设置密钥" onClick={() => void copyText(setupPayload.secret, '设置密钥已复制')}><Copy size={14} /></button></div><button type="button" className="auth-inline-link" onClick={() => void startSetup()}>重新生成二维码</button></div>
              </div>
              <div className="auth-step-title"><span>2</span><div><strong>验证绑定</strong><p>输入应用中显示的 6 位动态验证码。</p></div></div>
              <label><span>动态验证码</span><input className="auth-code-input" autoFocus autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={verifyTotpInput} placeholder="000 000" onChange={(event) => setVerifyTotpInput(cleanTotp(event.target.value))} /></label>
              {copyMessage ? <p className="auth-success-msg" role="status">{copyMessage}</p> : null}
              {twoFactorError ? <p className="auth-error-msg" role="alert">{twoFactorError}</p> : null}
              <div className="auth-panel-actions"><button type="button" className="secondary-button" onClick={resetTwoFactorView}>取消</button><button type="button" className="primary-button" disabled={twoFactorBusy || verifyTotpInput.length !== 6} onClick={() => void enableTwoFactor()}>{twoFactorBusy ? <LoaderCircle size={15} className="spin" /> : <ShieldCheck size={15} />}确认开启</button></div>
            </div> : twoFactorView === 'recovery' ? <div className="auth-2fa-panel recovery">
              <div className="auth-step-title success"><span><Check size={15} /></span><div><strong>两步验证已开启</strong><p>请立即保存备用码。每个只能使用一次，关闭此窗口后将不再显示。</p></div></div>
              <div className="auth-recovery-grid">{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div>
              <div className="auth-panel-actions spread"><div><button type="button" className="secondary-button" onClick={() => void copyText(recoveryText, '全部备用码已复制')}><Copy size={14} />复制全部</button><button type="button" className="secondary-button" onClick={() => downloadText('ifanr-2fa-recovery-codes.txt', recoveryText, 'text/plain;charset=utf-8')}><Download size={14} />下载</button></div>{copyMessage ? <span className="auth-copy-note" role="status">{copyMessage}</span> : null}</div>
              <label className="auth-confirm-check"><input type="checkbox" checked={recoverySaved} onChange={(event) => setRecoverySaved(event.target.checked)} /><span>我已把备用码保存在安全的位置</span></label>
              <button type="button" className="primary-button auth-finish-2fa" disabled={!recoverySaved} onClick={() => { resetTwoFactorView(); setRecoveryCodes([]) }}>完成设置</button>
            </div> : twoFactorView === 'disable' ? <div className="auth-2fa-panel danger">
              <div className="auth-step-title"><span><KeyRound size={15} /></span><div><strong>关闭两步验证？</strong><p>之后只需密码即可登录。输入当前动态验证码或一个备用码确认。</p></div></div>
              <label><span>安全验证码</span><input autoFocus className="auth-code-input" autoComplete="one-time-code" maxLength={9} value={verifyTotpInput} placeholder="6 位动态验证码或备用码" onChange={(event) => setVerifyTotpInput(cleanSecondFactor(event.target.value))} /></label>
              {twoFactorError ? <p className="auth-error-msg" role="alert">{twoFactorError}</p> : null}
              <div className="auth-panel-actions"><button type="button" className="secondary-button" onClick={resetTwoFactorView}>取消</button><button type="button" className="danger-button" disabled={twoFactorBusy || !secondFactorReady(verifyTotpInput)} onClick={() => void disableTwoFactor()}>{twoFactorBusy ? <LoaderCircle size={15} className="spin" /> : null}关闭两步验证</button></div>
            </div> : <div className="auth-2fa-summary">
              <p>{has2FA ? '登录时需要密码和动态验证码，备用码可在无法使用手机时应急登录。' : '开启后，即使密码泄露，仍需要手机上的动态验证码才能登录。'}</p>
              {has2FA ? <button type="button" className="auth-inline-link danger-link" onClick={() => { setTwoFactorView('disable'); setVerifyTotpInput(''); setTwoFactorError('') }}>关闭两步验证</button> : <button type="button" className="primary-button" disabled={twoFactorBusy} onClick={() => void startSetup()}>{twoFactorBusy ? <LoaderCircle size={15} className="spin" /> : <QrCode size={15} />}开始设置</button>}
              {twoFactorError ? <p className="auth-error-msg" role="alert">{twoFactorError}</p> : null}
            </div>}
          </section>

          <section className="auth-security-section auth-password-section" aria-labelledby="password-title">
            <div className="auth-section-heading"><div className="auth-section-icon"><KeyRound size={18} /></div><div><strong id="password-title">登录密码</strong><span>建议定期更新，并避免与其他账号重复</span></div>{!showPasswordForm ? <button type="button" className="auth-text-button" onClick={() => setShowPasswordForm(true)}>修改</button> : null}</div>
            {showPasswordForm ? <>
              <div className="auth-password-fields">
                <label><span>当前密码</span><input autoFocus type="password" autoComplete="current-password" value={currentPassword} placeholder="输入当前密码" onChange={(event) => setCurrentPassword(event.target.value)} /></label>
                <label><span>新密码</span><input type="password" autoComplete="new-password" minLength={12} value={newPassword} placeholder="至少 12 个字符" onChange={(event) => setNewPassword(event.target.value)} /></label>
                <label><span>确认新密码</span><input type="password" autoComplete="new-password" minLength={12} value={confirmPassword} placeholder="再次输入新密码" onChange={(event) => setConfirmPassword(event.target.value)} /></label>
              </div>
              {confirmPassword && newPassword !== confirmPassword ? <p className="auth-error-msg">两次输入的新密码不一致</p> : null}
              <div className="auth-panel-actions"><button type="button" className="secondary-button" onClick={() => { setShowPasswordForm(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword('') }}>取消</button><button type="submit" className="primary-button" disabled={busy || !passwordChangeReady}>{busy ? <LoaderCircle size={15} className="spin" /> : <Lock size={15} />}保存新密码</button></div>
            </> : null}
          </section>
        </>}
        {error ? <p className={error.startsWith('密码已更新') || error.includes('成功') ? 'auth-success-msg auth-global-message' : 'auth-error-msg auth-global-message'}>{error}</p> : null}
      </div>
      <footer>
        {isReadOnly ? <><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={busy || !username.trim() || !password.trim() || (has2FA && !secondFactorReady(totpCode))}>{busy ? <LoaderCircle size={15} className="spin" /> : <Lock size={15} />}安全登录</button></> : <button type="button" className="primary-button" onClick={onClose}>完成</button>}
      </footer>
    </form>
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
    review_count: issue.diagnostics?._story_scope
      ? issue.review_count
      : normalizedStories.filter((story) => story.status === 'needs_review' || story.changed_since_review).length,
  }
}

export function App() {
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(() => {
    const saved = localStorage.getItem('ifanr-editorial-theme')
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
    return 'system'
  })
  const [systemIsDark, setSystemIsDark] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [issue, setIssue] = useState<Issue | null>(null)
  const [baseIssue, setBaseIssue] = useState<Issue | null>(null)
  const [reviewSessionId, setReviewSessionId] = useState('')
  const [dataMode, setDataMode] = useState<'worker' | 'static' | 'offline'>('offline')
  const [repoRuntimeAccess, setRepoRuntimeAccess] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingIssueDetails, setLoadingIssueDetails] = useState(false)
  const [error, setError] = useState('')
  const [operationError, setOperationError] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('全部')
  const [activeDraftSection, setActiveDraftSection] = useState('全部')
  const [candidateStatus, setCandidateStatus] = useState('all')
  const [view, setView] = useState<View>('draft')
  const [activeView, setActiveView] = useState<View>('draft')
  const [viewMotion, setViewMotion] = useState<'idle' | 'out' | 'in'>('idle')
  const [outlineCollapsed, setOutlineCollapsed] = useState(() => localStorage.getItem('ifanr-editorial-outline-collapsed') === '1')
  const [mobileReadOnly, setMobileReadOnly] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches)
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null)
  const [activeStoryId, setActiveStoryId] = useState<string | null>(null)
  const [detailClosing, setDetailClosing] = useState(false)
  const [draggedStoryId, setDraggedStoryId] = useState<string | null>(null)
  const [outlineDrop, setOutlineDrop] = useState<{ targetId: string; after: boolean } | null>(null)
  const [movingStoryId, setMovingStoryId] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Record<string, Job>>({})
  const [weekend, setWeekend] = useState<Record<string, { label: string; candidates: Array<Record<string, unknown>> }>>({})
  const [showExport, setShowExport] = useState(false)
  const [showCreateStory, setShowCreateStory] = useState(false)
  const [closingOverlay, setClosingOverlay] = useState<'create' | 'export' | 'delete' | 'auth' | null>(null)
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
  const [generatingBrand, setGeneratingBrand] = useState<Record<'appso' | 'ifanr', boolean>>({ appso: false, ifanr: false })
  const [brandToast, setBrandToast] = useState<{ brand: 'appso' | 'ifanr'; message: string } | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsClosing, setSettingsClosing] = useState(false)
  const [geminiKey, setGeminiKey] = useState('')
  const [geminiConfigured, setGeminiConfigured] = useState(hasGeminiKey())
  const [geminiModel, setGeminiModel] = useState(getGeminiModel())
  const [geminiModels, setGeminiModels] = useState<Array<{ name: string; displayName: string }>>([])
  const [geminiModelsLoading, setGeminiModelsLoading] = useState(false)
  const [profileMessage, setProfileMessage] = useState('')
  const [showAuthDialog, setShowAuthDialog] = useState(false)
  const [authUser, setAuthUser] = useState('Shawn Rain')
  const [isReadOnly, setIsReadOnly] = useState(isPagesDeployment)
  const [authBusy, setAuthBusy] = useState(false)
  const [authMessage, setAuthMessage] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarMessage, setAvatarMessage] = useState('')
  const [showAvatarMenu, setShowAvatarMenu] = useState(false)
  const [avatarMenuClosing, setAvatarMenuClosing] = useState(false)
  const avatarFileRef = useRef<HTMLInputElement | null>(null)
  const avatarMenuRef = useRef<HTMLDivElement | null>(null)
  const avatarTriggerRef = useRef<HTMLButtonElement | null>(null)
  const avatarCloseTimerRef = useRef<number | null>(null)
  const avatarMigrationRef = useRef(false)
  const sidebarItemRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  useEffect(() => {
    const currentId = activeStoryId || selectedStoryId
    if (currentId && sidebarItemRefs.current[currentId]) {
      sidebarItemRefs.current[currentId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }
  }, [activeStoryId, selectedStoryId])

  const [has2FA, setHas2FA] = useState(false)

  const doStart2FA = () => api.authSetup2FA()

  const doEnable2FA = async (totpInput: string): Promise<string[]> => {
    const result = await api.authEnable2FA(totpInput)
    setAuthToken(result.token)
    setHas2FA(true)
    setAuthMessage('两步验证设置成功')
    return result.recovery_codes
  }

  const doDisable2FA = async (totpInput: string): Promise<void> => {
    const result = await api.authDisable2FA(totpInput)
    setAuthToken(result.token)
    setHas2FA(false)
    setAuthMessage('两步验证已关闭')
  }

  const checkAuthStatus = useCallback(async () => {
    if (isPagesDeployment) {
      setAuthToken('')
      setIsReadOnly(true)
      setHas2FA(false)
      setAvatarUrl(null)
      return
    }
    try {
      const status = await api.authStatus()
      setIsReadOnly(status.read_only)
      setHas2FA(status.has_2fa)
      if (status.username) setAuthUser(status.username)
      const serverAvatarUrl = status.avatar_url ? resolveApiAssetUrl(status.avatar_url) : null
      const legacyAvatar = localStorage.getItem(LEGACY_AVATAR_STORAGE_KEY)
      setAvatarUrl(serverAvatarUrl || (status.authenticated ? legacyAvatar : null))
      if (serverAvatarUrl && legacyAvatar) {
        localStorage.removeItem(LEGACY_AVATAR_STORAGE_KEY)
      } else if (status.authenticated && legacyAvatar && !avatarMigrationRef.current) {
        const legacyFile = legacyAvatarFile(legacyAvatar)
        if (legacyFile) {
          avatarMigrationRef.current = true
          try {
            const migrated = await api.authUploadAvatar(legacyFile)
            setAvatarUrl(resolveApiAssetUrl(migrated.avatar_url))
            localStorage.removeItem(LEGACY_AVATAR_STORAGE_KEY)
          } catch {
            avatarMigrationRef.current = false
          }
        }
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void checkAuthStatus()
  }, [checkAuthStatus, dataMode])

  const doAuthLogin = async (usernameInput: string, passwordInput: string, totpInput?: string) => {
    if (isPagesDeployment) return
    if (!usernameInput.trim() || !passwordInput.trim()) return
    setAuthBusy(true)
    setAuthMessage('正在验证安全登录…')
    try {
      const pHash = await hashPassword(usernameInput, passwordInput)
      const res = await api.authLogin(usernameInput.trim(), pHash, totpInput || '')
      setAuthToken(res.token)
      setIsReadOnly(false)
      if (res.username) setAuthUser(res.username)
      await checkAuthStatus()
      setAuthMessage('')
      closeOverlay('auth')
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : '验证失败，请检查用户名或密码')
    } finally {
      setAuthBusy(false)
    }
  }

  const doAuthLogout = async () => {
    if (isPagesDeployment) return
    try {
      await api.authLogout()
    } catch {
      // ignore
    } finally {
      setAuthToken('')
      setIsReadOnly(true)
      setAvatarUrl(null)
      setAuthMessage('')
      closeOverlay('auth')
    }
  }

  const doAuthChangePassword = async (currentPassword: string, newPassword: string) => {
    setAuthBusy(true)
    setAuthMessage('正在更新密码…')
    try {
      const [currentHash, newHash] = await Promise.all([
        hashPassword(authUser, currentPassword),
        hashPassword(authUser, newPassword),
      ])
      const res = await api.authChangePassword(authUser, currentHash, newHash)
      setAuthToken(res.token)
      setIsReadOnly(false)
      setAuthMessage('密码已更新，其他浏览器中的旧登录已失效。')
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : '密码修改失败')
    } finally {
      setAuthBusy(false)
    }
  }

  const uploadAccountAvatar = async (file: File) => {
    if (isReadOnly) {
      setAvatarMessage('请先登录，再更换账号头像')
      return
    }
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
      setAvatarMessage('请选择 JPEG、PNG、GIF 或 WebP 图片')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarMessage('头像不能超过 5 MB')
      return
    }
    setAvatarBusy(true)
    setAvatarMessage('正在保存到账号…')
    try {
      const result = await api.authUploadAvatar(file)
      setAvatarUrl(resolveApiAssetUrl(result.avatar_url))
      localStorage.removeItem(LEGACY_AVATAR_STORAGE_KEY)
      setAvatarMessage('头像已保存到服务器账号')
    } catch (error) {
      setAvatarMessage(error instanceof Error ? error.message : '头像上传失败')
    } finally {
      setAvatarBusy(false)
    }
  }

  const resetAccountAvatar = async () => {
    if (isReadOnly) return
    setAvatarBusy(true)
    setAvatarMessage('正在恢复默认头像…')
    try {
      await api.authDeleteAvatar()
      setAvatarUrl(null)
      localStorage.removeItem(LEGACY_AVATAR_STORAGE_KEY)
      setAvatarMessage('已恢复默认头像')
    } catch (error) {
      setAvatarMessage(error instanceof Error ? error.message : '无法恢复默认头像')
    } finally {
      setAvatarBusy(false)
    }
  }
  const [workerConnection, setWorkerConnection] = useState<WorkerConnection>({
    status: 'checking',
    detail: '正在检测主 Mac Worker',
    url: getApiUrl(),
  })

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (e: MediaQueryListEvent) => setSystemIsDark(e.matches)
    setSystemIsDark(media.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [])

  const effectiveTheme = theme === 'system' ? (systemIsDark ? 'dark' : 'light') : theme

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme
    localStorage.setItem('ifanr-editorial-theme', theme)
  }, [theme, effectiveTheme])
  useEffect(() => { localStorage.setItem('ifanr-editorial-outline-collapsed', outlineCollapsed ? '1' : '0') }, [outlineCollapsed])
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width: 760px)')
    const sync = () => setMobileReadOnly(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])
  useEffect(() => { if (mobileReadOnly) setSelectedStoryId(null) }, [mobileReadOnly])
  const draftScrollRef = useRef<HTMLElement | null>(null)
  const outlineRef = useRef<HTMLDivElement | null>(null)
  const settingsPopoverRef = useRef<HTMLDivElement | null>(null)
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null)
  const connectionTriggerRef = useRef<HTMLButtonElement | null>(null)
  const settingsCloseTimerRef = useRef<number | null>(null)
  const operationErrorTimerRef = useRef<number | null>(null)
  const detailCloseTimerRef = useRef<number | null>(null)
  const overlayCloseTimerRef = useRef<number | null>(null)
  const viewExitTimerRef = useRef<number | null>(null)
  const brandToastTimerRef = useRef<number | null>(null)
  const viewEnterTimerRef = useRef<number | null>(null)
  const issueRef = useRef<Issue | null>(null)
  const dataModeRef = useRef(dataMode)
  const workerRefreshInFlightRef = useRef(false)
  const fullIssueLoadRef = useRef<Promise<void> | null>(null)

  useEffect(() => { issueRef.current = issue }, [issue])
  useEffect(() => { dataModeRef.current = dataMode }, [dataMode])
  useEffect(() => {
    if (viewMotion === 'idle') setActiveView(view)
  }, [view, viewMotion])

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

  const closeOverlay = useCallback((overlay: 'create' | 'export' | 'delete' | 'auth') => {
    if (closingOverlay) return
    setClosingOverlay(overlay)
    if (overlayCloseTimerRef.current !== null) window.clearTimeout(overlayCloseTimerRef.current)
    overlayCloseTimerRef.current = window.setTimeout(() => {
      if (overlay === 'create') setShowCreateStory(false)
      if (overlay === 'export') setShowExport(false)
      if (overlay === 'delete') setPendingDelete(null)
      if (overlay === 'auth') setShowAuthDialog(false)
      setClosingOverlay(null)
      overlayCloseTimerRef.current = null
    }, 180)
  }, [closingOverlay])

  const loadIssue = useCallback(async (preferWorker = false) => {
    setLoading(true)
    setError('')
    const workerUrl = getApiUrl()
    const forceStatic = isPagesDeployment || (!preferWorker && new URLSearchParams(window.location.search).get('static') === '1')
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
      const [health, current] = await Promise.all([
        api.health(),
        api.currentIssue('draft').catch(() => api.importLatest()),
      ])
      setDataMode('worker')
      setRepoRuntimeAccess(health.repo_runtime_access)
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

  const loadFullIssue = useCallback(async () => {
    const currentIssue = issueRef.current
    if (!currentIssue?.diagnostics?._story_scope || dataModeRef.current !== 'worker') return
    if (fullIssueLoadRef.current) return fullIssueLoadRef.current
    setLoadingIssueDetails(true)
    const task = api.currentIssue()
      .then((fullIssue) => {
        const normalized = issueWithMetrics(fullIssue, fullIssue.stories)
        if (issueRef.current?.id === normalized.id) issueRef.current = normalized
        setIssue((current) => current?.id === normalized.id ? normalized : current)
        setBaseIssue((current) => current?.id === normalized.id ? structuredClone(normalized) : current)
      })
      .catch((detailError) => {
        showOperationError(detailError instanceof Error ? detailError.message : '完整刊期读取失败')
      })
      .finally(() => {
        setLoadingIssueDetails(false)
        fullIssueLoadRef.current = null
      })
    fullIssueLoadRef.current = task
    return task
  }, [showOperationError])

  useEffect(() => {
    void loadIssue(false)
  }, [loadIssue])

  const refreshWorkerIssue = useCallback(async () => {
    const currentIssue = issueRef.current
    if (!currentIssue || dataModeRef.current !== 'worker' || document.hidden || workerRefreshInFlightRef.current) return
    workerRefreshInFlightRef.current = true
    try {
      const latestVersion = await api.currentIssueVersion()
      if (latestVersion.id === currentIssue.id && latestVersion.revision === currentIssue.revision) return
      const latest = await api.currentIssue()
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

  const finishAvatarMenuClose = useCallback(() => {
    if (avatarCloseTimerRef.current !== null) window.clearTimeout(avatarCloseTimerRef.current)
    avatarCloseTimerRef.current = null
    setShowAvatarMenu(false)
    setAvatarMenuClosing(false)
  }, [])

  const closeAvatarMenu = useCallback(() => {
    setAvatarMenuClosing(true)
    if (avatarCloseTimerRef.current !== null) window.clearTimeout(avatarCloseTimerRef.current)
    avatarCloseTimerRef.current = window.setTimeout(finishAvatarMenuClose, 180)
  }, [finishAvatarMenuClose])

  useEffect(() => {
    if (!showAvatarMenu) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (avatarMenuRef.current?.contains(target) || avatarTriggerRef.current?.contains(target)) return
      closeAvatarMenu()
    }
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeAvatarMenu() }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeAvatarMenu, showAvatarMenu])

  useEffect(() => () => {
    if (settingsCloseTimerRef.current !== null) window.clearTimeout(settingsCloseTimerRef.current)
    if (avatarCloseTimerRef.current !== null) window.clearTimeout(avatarCloseTimerRef.current)
    if (operationErrorTimerRef.current !== null) window.clearTimeout(operationErrorTimerRef.current)
    if (detailCloseTimerRef.current !== null) window.clearTimeout(detailCloseTimerRef.current)
    if (overlayCloseTimerRef.current !== null) window.clearTimeout(overlayCloseTimerRef.current)
    if (viewExitTimerRef.current !== null) window.clearTimeout(viewExitTimerRef.current)
    if (viewEnterTimerRef.current !== null) window.clearTimeout(viewEnterTimerRef.current)
    if (brandToastTimerRef.current !== null) window.clearTimeout(brandToastTimerRef.current)
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
    return issue.stories.filter((story) => (
      (story.selected && story.status !== 'excluded' && hasMeaningfulBody(story.body))
      || pendingAiEditorRequest(story)
    ))
      .filter((story) => matchesStoryQuery(story, query))
      .sort(comparePublicationStories)
  }, [issue, query])

  const isSaturdayIssue = isSaturdayPublication(issue?.publication_date)

  const groupedDraft = useMemo(() => {
    return groupDraftStories(draftStories, isSaturdayIssue)
  }, [draftStories, isSaturdayIssue])

  const outlineGroupedDraft = useMemo(() => groupedDraft.map(([section, stories]) => {
    if (!draggedStoryId || !outlineDrop || !stories.some((story) => story.id === draggedStoryId) || !stories.some((story) => story.id === outlineDrop.targetId)) return [section, stories] as const
    const reordered = [...stories]
    const from = reordered.findIndex((story) => story.id === draggedStoryId)
    const [dragged] = reordered.splice(from, 1)
    const targetIndex = reordered.findIndex((story) => story.id === outlineDrop.targetId)
    reordered.splice(targetIndex + (outlineDrop.after ? 1 : 0), 0, dragged)
    return [section, reordered] as const
  }), [draggedStoryId, groupedDraft, outlineDrop])

  const candidates = useMemo(() => {
    if (!issue) return []
    return issue.stories.filter((story) => !story.selected && !pendingAiEditorRequest(story))
      .filter((story) => category === '全部' || story.category === category)
      .filter((story) => candidateStatus === 'all' ? story.status !== 'excluded' : candidateStatus === 'excluded' ? story.status === 'excluded' : story.status === candidateStatus)
      .filter((story) => matchesStoryQuery(story, query))
      .sort((a, b) => b.score - a.score)
  }, [issue, query, category, candidateStatus])

  const trashStories = useMemo(() => {
    if (!issue) return []
    return issue.stories
      .filter((story) => story.status === 'excluded')
      .filter((story) => category === '全部' || story.category === category)
      .filter((story) => matchesStoryQuery(story, query))
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')) || b.score - a.score)
  }, [issue, query, category])

  const draftCounts = useMemo(() => {
    const counts: Record<string, number> = { 全部: draftStories.length }
    draftStories.forEach((story) => {
      const section = isSaturdayIssue ? weekendWorkbenchSection(story) : story.category
      counts[section] = (counts[section] || 0) + 1
    })
    return counts
  }, [draftStories, isSaturdayIssue])

  const sidebarCategories = view === 'draft' && isSaturdayIssue
    ? ['全部', ...weekendWorkbenchCategories]
    : categories

  const pendingAiEditorCount = useMemo(
    () => issue?.stories.filter((story) => pendingAiEditorRequest(story)).length || 0,
    [issue],
  )

  const selectedStory = mobileReadOnly ? null : issue?.stories.find((story) => story.id === selectedStoryId) || null
  const selectedJob = selectedStory ? jobs[selectedStory.id] : undefined

  const updateStory = async (storyId: string, patch: Partial<Story> & { confirm_delete?: boolean }) => {
    const existing = issue?.stories.find((story) => story.id === storyId)
    if (!existing) throw new Error('选题不存在')
    const updated = dataMode === 'static'
      ? { ...existing, ...patch }
      : await api.patchStory(storyId, { ...patch, expected_updated_at: existing.updated_at || '' })
    setIssue((current) => current ? issueWithMetrics(current, current.stories.map((story) => story.id === storyId ? updated : story)) : current)
    return updated
  }

  const excludeStory = async (story: Story) => {
    await updateStory(story.id, {
      selected: false,
      status: 'excluded',
      confirm_delete: true,
      metadata: {
        ...story.metadata,
        _trash_state: 'deleted',
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
      metadata: {
        ...story.metadata,
        _trash_state: 'restored',
        _trash_restored_at: new Date().toISOString(),
      },
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

  const canOutlineReorder = (targetId: string) => {
    if (!issue || !draggedStoryId || targetId === draggedStoryId) return false
    const target = issue.stories.find((story) => story.id === targetId)
    const dragged = issue.stories.find((story) => story.id === draggedStoryId)
    return Boolean(target && dragged && (isSaturdayIssue ? weekendWorkbenchSection(target) === weekendWorkbenchSection(dragged) : target.category === dragged.category))
  }

  const updateOutlineDrop = (event: DragEvent<HTMLButtonElement>, targetId: string) => {
    if (!canOutlineReorder(targetId)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    const after = event.clientY >= rect.top + rect.height / 2
    setOutlineDrop((current) => current?.targetId === targetId && current.after === after ? current : { targetId, after })
    const outline = outlineRef.current
    if (!outline) return
    const outlineRect = outline.getBoundingClientRect()
    if (event.clientY < outlineRect.top + SCROLL_EDGE) outline.scrollBy({ top: -SCROLL_SPEED, behavior: 'auto' })
    if (event.clientY > outlineRect.bottom - SCROLL_EDGE) outline.scrollBy({ top: SCROLL_SPEED, behavior: 'auto' })
  }

  const clearOutlineDrag = () => {
    setDraggedStoryId(null)
    setOutlineDrop(null)
  }

  // Auto-scroll speed & edge zone
  const SCROLL_EDGE = 52
  const SCROLL_SPEED = 26

  const handleDrop = async (targetId: string, after = false) => {
    if (!issue || !draggedStoryId || draggedStoryId === targetId) return
    const activeId = draggedStoryId
    const target = issue.stories.find((story) => story.id === targetId)
    const dragged = issue.stories.find((story) => story.id === draggedStoryId)
    if (!target || !dragged || (isSaturdayIssue ? weekendWorkbenchSection(target) !== weekendWorkbenchSection(dragged) : target.category !== dragged.category)) return
    const targetCategory = isSaturdayIssue ? weekendWorkbenchSection(target) : target.category
    const ordered = issue.stories.filter((story) => story.selected && (isSaturdayIssue ? weekendWorkbenchSection(story) === targetCategory : story.category === target.category)).sort((a, b) => a.position - b.position)
    const from = ordered.findIndex((story) => story.id === activeId)
    const [moved] = ordered.splice(from, 1)
    const targetIndex = ordered.findIndex((story) => story.id === targetId)
    ordered.splice(targetIndex + (after ? 1 : 0), 0, moved)

    // Synchronous optimistic UI update (<1ms response time)
    const positions = new Map(ordered.map((story, index) => [story.id, index]))
    const updatedStories = issue.stories.map((story) => positions.has(story.id) ? { ...story, category: targetCategory, position: positions.get(story.id) || 0 } : story)
    const optimisticIssue = issueWithMetrics(issue, updatedStories)
    setIssue(optimisticIssue)
    setMovingStoryId(activeId)
    setActiveStoryId(activeId)
    clearOutlineDrag()
    window.setTimeout(() => setMovingStoryId(null), 440)

    // Background server sync — only apply remote response if it differs meaningfully
    if (dataMode !== 'static') {
      try {
        const remoteIssue = await api.reorder(issue.id, ordered.map((story) => story.id), targetCategory)
        // Only update if remote positions differ from our optimistic state (avoids re-render jank)
        const remoteOrder = remoteIssue.stories.map((s) => s.id).join(',')
        const localOrder = optimisticIssue.stories.map((s) => s.id).join(',')
        if (remoteOrder !== localOrder) setIssue(remoteIssue)
      } catch (reorderError) {
        showOperationError(reorderError instanceof Error ? reorderError.message : '保存排版顺序失败')
        void loadIssue()
      }
    }
  }

  const moveStory = async (storyId: string, target: -1 | 1 | 'first' | 'last') => {
    if (!issue) return
    const story = issue.stories.find((item) => item.id === storyId)
    if (!story) return
    const ordered = issue.stories
      .filter((item) => item.selected && item.status !== 'excluded' && (isSaturdayIssue ? weekendWorkbenchSection(item) === weekendWorkbenchSection(story) : item.category === story.category))
      .sort((a, b) => a.position - b.position)
    const from = ordered.findIndex((item) => item.id === storyId)
    const to = target === 'first' ? 0 : target === 'last' ? ordered.length - 1 : from + target
    if (from < 0 || to < 0 || to >= ordered.length) return
    const [moved] = ordered.splice(from, 1)
    ordered.splice(to, 0, moved)
    const positions = new Map(ordered.map((item, index) => [item.id, index]))
    const targetCategory = isSaturdayIssue ? weekendWorkbenchSection(story) : story.category
    const optimistic = issueWithMetrics(issue, issue.stories.map((item) => positions.has(item.id) ? { ...item, category: targetCategory, position: positions.get(item.id) ?? item.position } : item))
    setIssue(optimistic)
    setMovingStoryId(storyId)
    window.setTimeout(() => setMovingStoryId((current) => current === storyId ? null : current), 440)
    if (dataMode === 'static') return
    try {
      const remoteIssue = await api.reorder(issue.id, ordered.map((item) => item.id), targetCategory)
      // Only update if remote order differs
      const remoteOrder = remoteIssue.stories.map((s) => s.id).join(',')
      const localOrder = optimistic.stories.map((s) => s.id).join(',')
      if (remoteOrder !== localOrder) setIssue(remoteIssue)
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
    setActiveDraftSection(isSaturdayIssue ? weekendWorkbenchSection(story) : story.category)
    setActiveStoryId(story.id)
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
    const containerTop = container.getBoundingClientRect().top
    if (container.scrollTop < 180) {
      setActiveDraftSection('全部')
      setActiveStoryId(null)
      return
    }
    const threshold = containerTop + 90
    let active = '全部'
    groupedDraft.forEach(([section]) => {
      const element = document.getElementById(`section-${section.replaceAll('/', '-')}`)
      if (element && element.getBoundingClientRect().top <= threshold) active = section
    })
    setActiveDraftSection((current) => current === active ? current : active)

    const articles = container.querySelectorAll<HTMLElement>('.issue-article')
    let closestId: string | null = null
    let minDiff = Infinity
    articles.forEach((article) => {
      const diff = Math.abs(article.getBoundingClientRect().top - containerTop - 40)
      if (diff < minDiff) {
        minDiff = diff
        closestId = article.id.replace(/^story-/, '')
      }
    })
    if (closestId && closestId !== activeStoryId) {
      setActiveStoryId(closestId)
    }
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
    setGeneratingBrand((current) => ({ ...current, [brand]: true }))
    setOperationError('')
    try {
      const generated = await generateBrandHeadlines(issue, brand)
      const patch = { headline_options: generated.headline_options, selected_headline: generated.selected_headline }
      setIssue((current) => current ? { ...current, brand_packages: { ...current.brand_packages, [brand]: { ...current.brand_packages[brand], ...patch } } } : current)
      if (dataMode === 'worker') {
        await api.patchBrand(issue.id, brand, patch)
        setIssue(await api.getIssue(issue.id))
      }
      setBrandToast({ brand, message: `${brand === 'appso' ? 'APPSO' : 'IFANR'} 标题已生成` })
      if (brandToastTimerRef.current !== null) window.clearTimeout(brandToastTimerRef.current)
      brandToastTimerRef.current = window.setTimeout(() => {
        setBrandToast(null)
        brandToastTimerRef.current = null
      }, 3200)
    } catch (brandError) { showOperationError(brandError instanceof Error ? brandError.message : '品牌包装生成失败') } finally { setGeneratingBrand((current) => ({ ...current, [brand]: false })) }
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

  const switchView = (next: View) => {
    if (next === activeView) return
    if (viewExitTimerRef.current !== null) window.clearTimeout(viewExitTimerRef.current)
    if (viewEnterTimerRef.current !== null) window.clearTimeout(viewEnterTimerRef.current)

    const applyView = () => {
      setView(next)
      setSelectedStoryId(null)
      setCategory('全部')
      setActiveDraftSection('全部')
      setQuery('')
      if (next === 'candidates' || next === 'trash') void loadFullIssue()
    }

    setActiveView(next)
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setViewMotion('idle')
      applyView()
      return
    }

    setViewMotion('out')
    viewExitTimerRef.current = window.setTimeout(() => {
      viewExitTimerRef.current = null
      applyView()
      setViewMotion('in')
      viewEnterTimerRef.current = window.setTimeout(() => {
        viewEnterTimerRef.current = null
        setViewMotion('idle')
      }, 190)
    }, 110)
  }

  const jumpToReview = async () => {
    await loadFullIssue()
    const currentIssue = issueRef.current
    const target = currentIssue?.stories.find((story) => story.status === 'needs_review' || story.changed_since_review)
    if (!target) return
    setDetailClosing(false)
    setSelectedStoryId(target.id)
    setQuery('')
    if (target.selected) {
      setView('draft')
      window.requestAnimationFrame(() => scrollToDraftSection(isSaturdayIssue ? weekendWorkbenchSection(target) : target.category))
    } else {
      setView('candidates')
      setCategory('全部')
      setCandidateStatus('needs_review')
    }
  }

  const saveGeminiKey = async () => {
    if (!geminiKey.trim() && !geminiConfigured) {
      setProfileMessage('请输入 Gemini API Key')
      return
    }
    try {
      if (geminiKey.trim()) persistGeminiKey(geminiKey)
      saveGeminiModel(geminiModel)
      setGeminiConfigured(true)
      setGeminiKey('')
      setProfileMessage(`Gemini 已保存，当前模型：${geminiModel.trim() || defaultGeminiModel}`)
    } catch (settingsError) {
      setProfileMessage(settingsError instanceof Error ? settingsError.message : 'Gemini 配置保存失败')
    }
  }

  const loadGeminiModels = async () => {
    setGeminiModelsLoading(true)
    try {
      const models = await listGeminiModels(geminiKey)
      setGeminiModels(models)
      if (models.length && !models.some((model) => model.name === geminiModel)) setGeminiModel(models[0].name)
      setProfileMessage(models.length ? `已读取 ${models.length} 个支持生成内容的模型` : '没有读到支持生成内容的模型，可手动填写模型名称')
    } catch (modelError) {
      setGeminiModels([])
      setProfileMessage(modelError instanceof Error ? `${modelError.message}；可手动填写模型名称` : '模型列表读取失败；可手动填写模型名称')
    } finally {
      setGeminiModelsLoading(false)
    }
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
          <img className="brand-logo" src={effectiveTheme === 'dark' ? ifanrLogoDarkUrl : ifanrLogoLightUrl} alt="爱范儿 iFanr" />
          <div className="brand-product"><strong>早报编辑台</strong><span>BOT DRAFT · {issue?.publication_date || '未连接刊期'}</span></div>
        </div>
        <nav className="view-switcher" aria-label="编辑台视图">
          <button className={activeView === 'draft' ? 'active' : ''} onClick={() => switchView('draft')} type="button">早报稿</button>
          <button className={activeView === 'candidates' ? 'active' : ''} onClick={() => switchView('candidates')} type="button">候选库</button>
          <button className={activeView === 'trash' ? 'active' : ''} onClick={() => switchView('trash')} type="button">回收站</button>
          <button className={activeView === 'brands' ? 'active' : ''} onClick={() => switchView('brands')} type="button">标题</button>
          <button className={activeView === 'weekend' ? 'active' : ''} onClick={() => switchView('weekend')} type="button">周末备选</button>
        </nav>
        <div className="topbar-actions">
          {!isPagesDeployment && !isReadOnly ? <button ref={connectionTriggerRef} className={`connection connection-${workerConnection.status}`} type="button" title={workerConnection.detail} onClick={() => { setClosingOverlay(null); setShowAuthDialog(true) }}>
            {workerConnection.status === 'checking' ? <LoaderCircle size={14} className="spin" /> : workerConnection.status === 'connected' ? <CircleDot size={13} /> : <CloudOff size={14} />}
            <span>{connectionLabel}</span>
          </button> : null}
          <IconButton title="新增条目" onClick={() => { setClosingOverlay(null); setShowCreateStory(true) }} disabled={!issue || dataMode !== 'worker'}><Plus size={17} /></IconButton>
          <IconButton title="刷新" onClick={() => void refresh(false)} disabled={!issue}><RefreshCw size={17} /></IconButton>
          <button ref={settingsTriggerRef} className={`icon-button ${showSettings && !settingsClosing ? 'active' : ''}`} type="button" title="设置" aria-label="设置" onClick={toggleSettings}><Settings size={17} /></button>
          {!isPagesDeployment ? <button
            ref={avatarTriggerRef}
            className={`avatar-button ${showAvatarMenu && !avatarMenuClosing ? 'active' : ''}`}
            type="button"
            title={isReadOnly ? 'ifanr' : authUser}
            aria-label="账号"
            onClick={() => {
              if (showAvatarMenu && !avatarMenuClosing) closeAvatarMenu()
              else if (!showAvatarMenu) setShowAvatarMenu(true)
            }}
          >
            {avatarUrl
              ? <img src={avatarUrl} alt="头像" />
              : <img src={ifanrMarkUrl} alt="ifanr" className="avatar-default-icon" />}
          </button> : null}
          <button className="export-button" type="button" disabled={!issue} onClick={() => { setHandoff(null); setClosingOverlay(null); setShowExport(true) }}><Download size={16} />导出</button>
        </div>
        {showSettings ? <div ref={settingsPopoverRef} className={`settings-popover ${settingsClosing ? 'closing' : ''}`} onAnimationEnd={() => { if (settingsClosing) finishSettingsClose() }}>
          {!isPagesDeployment ? <><div className={`connection-summary connection-${workerConnection.status}`}>
            <div>{workerConnection.status === 'checking' ? <LoaderCircle size={16} className="spin" /> : workerConnection.status === 'connected' ? <CircleDot size={15} /> : <CloudOff size={16} />}</div>
            <span><strong>{connectionLabel}</strong><small>{workerConnection.detail}</small></span>
          </div>
          <div className="settings-actions"><button type="button" disabled={workerConnection.status === 'checking'} onClick={() => void loadIssue(true)}>{workerConnection.status === 'checking' ? '正在检测…' : '重新检测连接'}</button></div>
          <div className="settings-divider" /></> : null}
          <label className="settings-theme-row"><span>界面主题</span><select aria-label="界面主题" value={theme} onChange={(event) => setTheme(event.target.value as 'system' | 'light' | 'dark')}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
          <div className="settings-divider" />
          <label><span>Gemini API Key</span><input type="password" aria-label="Gemini API Key" autoComplete="off" value={geminiKey} placeholder={geminiConfigured ? '已配置' : '用于双品牌标题生成'} onChange={(event) => setGeminiKey(event.target.value)} /></label>
          <label><span>Gemini 模型</span><input aria-label="Gemini 模型" list="gemini-model-list" autoComplete="off" value={geminiModel} placeholder={defaultGeminiModel} onChange={(event) => setGeminiModel(event.target.value)} /></label>
          <datalist id="gemini-model-list">{geminiModels.map((model) => <option key={model.name} value={model.name}>{model.displayName}</option>)}</datalist>
          <div className="settings-actions"><button type="button" disabled={geminiModelsLoading || (!geminiKey.trim() && !geminiConfigured)} onClick={() => void loadGeminiModels()}>{geminiModelsLoading ? '正在读取模型…' : '读取可用模型'}</button><button type="button" disabled={!geminiModel.trim() || (!geminiKey.trim() && !geminiConfigured)} onClick={() => void saveGeminiKey()}>保存配置</button></div>
          <p className="settings-hint">Key 仅保存在当前浏览器本地；请求也由当前设备直接发出，不经过服务器。</p>
          <button type="button" disabled={workerConnection.status !== 'connected'} onClick={() => { setProfileMessage('正在归纳本周编辑决策…'); void api.proposeProfile().then((proposal) => setProfileMessage(proposal.status === 'pending' ? '已生成待确认的偏好差异提案' : '本周暂无需更新的偏好')).catch((profileError) => setProfileMessage(profileError instanceof Error ? profileError.message : '提案生成失败')) }}>生成本周偏好提案</button>
          {profileMessage ? <p className="settings-message">{profileMessage}</p> : null}
        </div> : null}
        {/* Avatar menu */}
        {!isPagesDeployment && showAvatarMenu ? <div ref={avatarMenuRef} className={`avatar-menu ${avatarMenuClosing ? 'closing' : ''}`}>
          <div className="avatar-menu-profile">
            <div className="avatar-menu-avatar">
              {avatarUrl ? <img src={avatarUrl} alt="头像" /> : <img src={ifanrMarkUrl} alt="ifanr" className="avatar-default-icon" />}
            </div>
            <div className="avatar-menu-info">
              <strong>{isReadOnly ? 'ifanr' : (authUser || 'Shawn Rain')}</strong>
              <span>{isReadOnly ? '只读模式' : '编辑权限已解锁'}</span>
            </div>
          </div>
          <div className="avatar-menu-divider" />
          {!isReadOnly ? <button type="button" className="avatar-menu-item" disabled={avatarBusy} onClick={() => { setAvatarMessage(''); avatarFileRef.current?.click() }}>
            {avatarBusy ? <LoaderCircle size={14} className="spin" /> : <Upload size={14} />}更换头像
          </button> : null}
          {!isReadOnly && avatarUrl ? <button type="button" className="avatar-menu-item" disabled={avatarBusy} onClick={() => void resetAccountAvatar()}>
            <X size={14} />恢复默认头像
          </button> : null}
          {avatarMessage ? <p className="avatar-menu-status" role="status">{avatarMessage}</p> : null}
          <div className="avatar-menu-divider" />
          <button type="button" className="avatar-menu-item" onClick={() => {
            closeAvatarMenu()
            setClosingOverlay(null)
            setShowAuthDialog(true)
          }}>
            {isReadOnly ? <><Lock size={14} />登录以解锁编辑</> : <><Unlock size={14} />账号与安全</>}
          </button>
          {!isReadOnly ? <button type="button" className="avatar-menu-item danger" onClick={() => {
            closeAvatarMenu()
            void doAuthLogout()
          }}>
            退出登录
          </button> : null}
          <input
            ref={avatarFileRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="visually-hidden"
            disabled={avatarBusy || isReadOnly}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) return
              event.target.value = ''
              void uploadAccountAvatar(file)
            }}
          />
        </div> : null}
      </header>

      <div className={`view-content view-content-${viewMotion}`} aria-live="polite">
      {(view === 'draft' || view === 'candidates' || view === 'trash') ? (
        <div className={`editor-layout ${selectedStory ? 'with-detail' : ''}`}>
          <aside className="sidebar">
            <div className="sidebar-header">
              <div className="sidebar-title"><Menu size={16} /><span>{view === 'draft' ? '稿件目录' : '栏目'}</span></div>
              <em className="sidebar-count">{view === 'draft' ? draftStories.length : candidates.length}</em>
            </div>

            <div className="sidebar-content" ref={outlineRef}>
              {view === 'draft' ? outlineGroupedDraft.map(([section, stories]) => (
                <section key={section} className="sidebar-outline-group">
                  <button type="button" className={`sidebar-outline-section ${activeDraftSection === section ? 'active' : ''}`} onClick={() => scrollToDraftSection(section)}>
                    <span>{section}</span>
                    <em>{stories.length}</em>
                  </button>
                  {stories.map((story) => {
                    const isSelected = activeStoryId === story.id || selectedStoryId === story.id
                    const isDragging = draggedStoryId === story.id
                    const isDropTarget = outlineDrop?.targetId === story.id
                    const dropPositionClass = isDropTarget ? (outlineDrop.after ? 'drop-after' : 'drop-before') : ''
                    return (
                      <button
                        ref={(el) => { sidebarItemRefs.current[story.id] = el }}
                        type="button"
                        key={story.id}
                        draggable
                        className={`sidebar-outline-item ${isSelected ? 'active ' : ''}${isDragging ? 'dragging ' : ''}${movingStoryId === story.id ? 'moving ' : ''}${dropPositionClass}`}
                        onClick={() => {
                          scrollToStory(story)
                        }}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('text/plain', story.id)
                          setDraggedStoryId(story.id)
                          setOutlineDrop(null)
                        }}
                        onDragOver={(event) => updateOutlineDrop(event, story.id)}
                        onDrop={(event) => {
                          event.preventDefault()
                          const drop = outlineDrop
                          void handleDrop(story.id, drop?.targetId === story.id ? drop.after : false)
                        }}
                        onDragEnd={clearOutlineDrag}
                      >
                        <GripVertical size={13} className="drag-handle" />
                        <span className="item-title" title={story.title}>{story.title}</span>
                      </button>
                    )
                  })}
                </section>
              )) : (
                <nav>{sidebarCategories.map((item) => <button type="button" className={category === item ? 'active' : ''} onClick={() => setCategory(item)} key={item}><span>{item}</span><em>{view === 'trash' ? issue?.stories.filter((story) => story.status === 'excluded' && (item === '全部' || story.category === item)).length || 0 : issue?.stories.filter((story) => !story.selected && !pendingAiEditorRequest(story) && story.status !== 'excluded' && (item === '全部' || story.category === item)).length || 0}</em></button>)}</nav>
              )}
              {view === 'candidates' ? <><div className="sidebar-heading"><ArrowUpDown size={16} /><span>状态</span></div><nav>{[['all', '待处理'], ['needs_review', '待复核'], ['source_chasing', '追源中']].map(([value, label]) => <button type="button" className={candidateStatus === value ? 'active' : ''} onClick={() => setCandidateStatus(value)} key={value}><span>{label}</span></button>)}</nav></> : null}
            </div>

            <div className="sidebar-footer">
              <div className="issue-metrics"><button type="button" onClick={() => switchView('draft')}><strong>{issue?.selected_count || 0}</strong><span>Bot 成稿</span></button><button type="button" onClick={() => { switchView('candidates'); setCandidateStatus('all') }}><strong>{issue?.ready_count || 0}</strong><span>可用</span></button><button type="button" onClick={() => void jumpToReview()} disabled={!issue?.review_count}><strong>{issue?.review_count || 0}</strong><span>待复核</span></button></div>
            </div>
          </aside>

          <main ref={view === 'draft' ? draftScrollRef : undefined} onScroll={view === 'draft' ? syncDraftSection : undefined} className={view === 'draft' ? 'draft-column' : 'candidate-column'}>
            {loading ? <div className="center-state"><LoaderCircle size={24} className="spin" /><span>正在读取刊期</span></div> : null}
            {!loading && error && !issue ? <div className="center-state error"><CloudOff size={26} /><strong>{workerConnection.status === 'pages' ? '尚未连接主 Mac' : 'Worker 未连接'}</strong><span>{error}</span><div className="center-state-actions"><button type="button" onClick={openSettings}>连接设置</button><button type="button" onClick={() => void loadIssue()}>重新检测</button></div></div> : null}
            {!loading && loadingIssueDetails && (view === 'candidates' || view === 'trash') ? <div className="center-state"><LoaderCircle size={24} className="spin" /><span>正在载入完整候选库</span></div> : null}
            {!loading && issue && view === 'draft' ? <div className="draft-stage">
              <div className="draft-page"><header className="draft-masthead"><div className="draft-date">{issue?.publication_date?.replaceAll('-', ' / ')}</div><h1>{isSaturdayIssue ? '周末也值得一看的新闻' : '早报'}</h1><p>{issue?.diagnostics?.static_snapshot ? `当天飞书 Bot 稿 · ${issue?.selected_count || 0} 条 · Pages 只读快照` : `当前飞书 Bot 稿 · ${issue?.selected_count || 0} 条成稿${pendingAiEditorCount ? ` · ${pendingAiEditorCount} 条待 AI 主编撰写` : ''} · 自动化更新后保留人工编辑`}</p><div className="draft-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="在当前早报稿中搜索" /></div></header><div className="draft-document">{groupedDraft.map(([section, stories], sectionIndex) => <section className="issue-section" id={`section-${section.replaceAll('/', '-')}`} key={section}><header className="section-title"><span>{String(sectionIndex + 1).padStart(2, '0')}</span><h2>{section}</h2><em>{stories.length}</em></header>{stories.map((story, index) => <IssueArticle key={story.id} story={story} active={selectedStoryId === story.id} moving={movingStoryId === story.id} canMoveUp={index > 0} canMoveDown={index < stories.length - 1} onMoveTop={() => void moveStory(story.id, 'first')} onMoveUp={() => void moveStory(story.id, -1)} onMoveDown={() => void moveStory(story.id, 1)} onMoveBottom={() => void moveStory(story.id, 'last')} onMoveCategory={(target) => void moveStoryToCategory(story.id, target)} moveOptions={isSaturdayIssue ? weekendWorkbenchCategories : undefined} currentMoveTarget={isSaturdayIssue ? weekendWorkbenchSection(story) : undefined} onOpen={() => setSelectedStoryId(story.id)} onExclude={() => requestDeleteStory(story)} onDragStart={() => setDraggedStoryId(story.id)} onDragEnd={clearOutlineDrag} onDrop={(after) => void handleDrop(story.id, after)} />)}</section>)}</div></div>
            </div> : null}
            {!loading && !loadingIssueDetails && issue && view === 'candidates' ? <>
              <header className="candidate-masthead"><div><span>候选库</span><h1>待追源与待复核</h1><p>候选不会直接进入正文；采用后会先以「待 AI 主编撰写」状态出现在「早报稿」。</p></div><strong>{candidates.length}</strong></header>
              <div className="candidate-toolbar"><div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、正文或来源" /></div></div>
              <div className="candidate-list">{candidates.map((story) => <CandidateItem key={story.id} story={story} active={selectedStoryId === story.id} onOpen={() => setSelectedStoryId(story.id)} onAdopt={() => void adoptCandidate(story)} onExclude={() => requestDeleteStory(story)} />)}</div>
            </> : null}
            {!loading && !loadingIssueDetails && issue && view === 'trash' ? <>
              <header className="candidate-masthead trash-masthead"><div><span>当前刊期</span><h1>回收站</h1><p>仅保留当天被移出的选题，恢复后回到原栏目末尾。</p></div><strong>{trashStories.length}</strong></header>
              <div className="candidate-toolbar"><div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索已删除的选题" /></div></div>
              <div className="candidate-list">{trashStories.length ? trashStories.map((story) => <TrashItem key={story.id} story={story} active={selectedStoryId === story.id} disabled={dataMode !== 'worker'} onOpen={() => setSelectedStoryId(story.id)} onRestore={() => void restoreStory(story)} />) : <div className="center-state"><Trash2 size={25} /><strong>回收站是空的</strong><span>当天从早报稿移出的选题会出现在这里。</span></div>}</div>
            </> : null}
          </main>
          {selectedStory && !mobileReadOnly ? <DetailPanel story={selectedStory} activeJob={selectedJob} staticMode={dataMode === 'static' || isReadOnly} closing={detailClosing} onClose={closeDetail} onPatch={(patch) => updateStory(selectedStory.id, patch)} onImageChange={(updated) => setIssue((current) => current ? issueWithMetrics(current, current.stories.map((story) => story.id === updated.id ? updated : story)) : current)} onAction={async (action, chrome) => { const job = await api.action(selectedStory.id, action, chrome); await watchJob(selectedStory.id, job) }} /> : null}
        </div>
      ) : null}

      {view === 'brands' && issue ? <BrandWorkspace issue={issue} generating={generatingBrand} onGenerate={generateBrand} onSave={async (brand, patch) => { if (dataMode === 'static') { setIssue({ ...issue, brand_packages: { ...issue.brand_packages, [brand]: { ...issue.brand_packages[brand], ...patch } } }); return } await api.patchBrand(issue.id, brand, patch); setIssue(await api.getIssue(issue.id)) }} /> : null}
      {view === 'weekend' ? <WeekendWorkspace data={weekend} /> : null}
      </div>
      {showCreateStory && issue ? <StoryCreateDialog busy={creatingStory} closing={closingOverlay === 'create'} onClose={() => closeOverlay('create')} onCreate={createStory} /> : null}
      {showExport && issue ? <ExportDialog issue={issue} handoff={handoff} busy={exporting} staticMode={dataMode === 'static'} operationCount={reviewOperationCount} closing={closingOverlay === 'export'} onClose={() => closeOverlay('export')} onMarkdown={() => downloadText(`${issue.id}.md`, renderIssueMarkdown(issue), 'text/markdown;charset=utf-8')} onCopyToFeishu={() => copyIssueToFeishu(issue)} onPublishToLark={() => api.publishToLark(issue.id)} onHandoff={() => void createHandoff()} /> : null}
      {pendingDelete ? <DeleteConfirmDialog story={pendingDelete} busy={deleteBusy} closing={closingOverlay === 'delete'} onCancel={() => { if (!deleteBusy) closeOverlay('delete') }} onConfirm={() => void confirmDeleteStory()} /> : null}
      {!isPagesDeployment && showAuthDialog ? <AuthDialog isReadOnly={isReadOnly} authUser={authUser} busy={authBusy} error={authMessage} closing={closingOverlay === 'auth'} has2FA={has2FA} onClose={() => closeOverlay('auth')} onLogin={doAuthLogin} onChangePassword={doAuthChangePassword} onStart2FA={doStart2FA} onEnable2FA={doEnable2FA} onDisable2FA={doDisable2FA} onLogout={doAuthLogout} /> : null}
      {operationError ? <div className="operation-error-toast" role="alert"><CloudOff size={16} /><span>{operationError}</span><button type="button" aria-label="关闭操作错误提示" onClick={() => setOperationError('')}>×</button></div> : null}
      {brandToast ? <div className="brand-toast" role="status"><Check size={15} /><span>{brandToast.message}</span></div> : null}
      {undoToastVisible && deletedStories.length ? <div className={`undo-toast ${undoToastClosing ? 'is-closing' : ''}`} role="status"><span>已移入回收站：{deletedStories.at(-1)?.title}</span><button type="button" disabled={undoBusy} onClick={() => void undoLastDeletion()}>{undoBusy ? <LoaderCircle size={14} className="spin" /> : <RotateCcw size={14} />}撤销 <kbd>⌘Z</kbd></button></div> : null}
    </div>
  )
}
export async function writeClipboardText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the synchronous copy path. It remains available on
      // the HTTP-hosted editorial console where Clipboard API is restricted.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.setAttribute('aria-hidden', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)

  try {
    return typeof document.execCommand === 'function' && document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

function escapeClipboardHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character)
}

function clipboardRelatedLinks(story: Story): Array<{ title: string; url: string }> {
  return Array.isArray(story.metadata.related_links)
    ? story.metadata.related_links.filter((item): item is { title: string; url: string } => Boolean(item && typeof item === 'object' && typeof (item as { title?: unknown }).title === 'string' && /^https?:\/\//.test(String((item as { url?: unknown }).url || ''))))
    : []
}

async function copyIssueToFeishu(issue: Issue): Promise<boolean> {
  const stories = issue.stories.filter((story) => story.selected && story.status !== 'excluded').sort(comparePublicationStories)
  const imageCache = new Map<string, string>()
  // This mirrors the hand-edited Bot document shell so a direct Feishu paste
  // lands in the same order and leaves the manual visual slots intact.
  const htmlParts = ['<h1>早报｜</h1>', '<p>插入头图</p>', '<p>插入日期</p>', '<p>appso 头图</p>', '<p>插入目录</p>']
  const textParts = ['早报｜', '', '插入头图', '插入日期', '', 'appso 头图', '', '插入目录', '']
  let currentCategory = ''
  for (const story of stories) {
    let imageData = imageCache.get(story.id) || ''
    if (!imageData && story.image_path) {
      try {
        const response = await fetch(api.storyImageUrl(story.id), { headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {} })
        if (response.ok) {
          const blob = await response.blob()
          imageData = `data:${blob.type || 'image/png'};base64,${await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = reject; reader.readAsDataURL(blob) })}`
          imageCache.set(story.id, imageData)
        }
      } catch { /* 图片不可读时仍复制正文 */ }
    }
    if (story.category !== currentCategory) {
      currentCategory = story.category
      htmlParts.push(`<h2>${escapeClipboardHtml(currentCategory)}</h2>`)
      textParts.push(`## ${currentCategory}`, '')
    }
    htmlParts.push(`<h3>${escapeClipboardHtml(story.title)}</h3>`)
    // Only paste locally fetched image bytes. Remote source URLs frequently
    // fail Feishu's server-side fetch or violate a source's anti-hotlink rule.
    if (imageData) htmlParts.push(`<p><img src="${escapeClipboardHtml(imageData)}" alt="" style="max-width:100%;height:auto" /></p>`)
    htmlParts.push(...story.body.split(/\n\s*\n/).filter(Boolean).map((paragraph) => `<p>${escapeClipboardHtml(paragraph).replace(/\n/g, '<br>')}</p>`))
    const relatedLinks = clipboardRelatedLinks(story)
    for (const link of relatedLinks) {
      htmlParts.push(`<p>🔗 相关阅读：<a href="${escapeClipboardHtml(link.url)}">${escapeClipboardHtml(link.title)}</a></p>`)
    }
    textParts.push(`### ${story.title}`, story.body.trim(), ...relatedLinks.map((link) => `🔗 相关阅读：${link.title}（${link.url}）`), '')
  }
  const html = htmlParts.join('')
  const plain = textParts.join('\n')
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })])
      return true
    } catch { /* fall through to plain text */ }
  }
  return writeClipboardText(plain)
}
