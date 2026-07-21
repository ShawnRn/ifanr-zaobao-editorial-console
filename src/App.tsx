import {
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
  Gamepad2,
  Image,
  Library,
  LoaderCircle,
  Menu,
  Newspaper,
  PanelRightClose,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, getApiUrl, setApiUrl } from './api'
import { applyReviewOperations, buildReviewExport, downloadText, renderIssueMarkdown } from './review'
import type { EditorialReviewExport } from './review'
import type { AutomationHandoff, BrandPackage, Issue, Job, Source, Story, StoryStatus } from './types'

const categories = ['全部', '重磅', '大公司', 'AI/开发者', '观点', '新产品', '新消费', '好看的']
const categoryOrder = new Map(categories.slice(1).map((value, index) => [value, index]))

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

type View = 'draft' | 'candidates' | 'brands' | 'weekend'

function IconButton({
  title,
  onClick,
  children,
  active = false,
  disabled = false,
}: {
  title: string
  onClick?: () => void
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
    const line = lines[index].trim()
    if (!line) {
      index += 1
      continue
    }
    if (line.startsWith('- ')) {
      const items: string[] = []
      while (index < lines.length && lines[index].trim().startsWith('- ')) {
        items.push(lines[index].trim().slice(2))
        index += 1
      }
      blocks.push(<ul key={`list-${index}`}>{items.map((item) => <li key={item}>{item}</li>)}</ul>)
      continue
    }
    if (line.startsWith('>')) {
      const quote: string[] = []
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quote.push(lines[index].trim().replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push(<blockquote key={`quote-${index}`}>{quote.join('\n')}</blockquote>)
      continue
    }
    const paragraph = [line]
    index += 1
    while (index < lines.length && lines[index].trim() && !lines[index].trim().startsWith('- ') && !lines[index].trim().startsWith('>')) {
      paragraph.push(lines[index].trim())
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

function IssueArticle({
  story,
  active,
  onOpen,
  onExclude,
  onDragStart,
  onDrop,
}: {
  story: Story
  active: boolean
  onOpen: () => void
  onExclude: () => void
  onDragStart: () => void
  onDrop: () => void
}) {
  const image = story.image_path ? api.storyImageUrl(story.id) : story.image_url
  return (
    <article
      className={`issue-article ${active ? 'active' : ''}`}
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
      <header className={image ? 'article-title-with-image' : ''}>
        <div>
          <h3>{story.title}</h3>
          {story.changed_since_review ? <span className="changed-note">事实有更新，需复核</span> : null}
        </div>
        {image ? <img src={image} alt="" /> : null}
      </header>
      <div className="article-body"><BodyBlocks body={story.body} /></div>
      <LinkedSourceLine story={story} />
      <div className="article-hover-tools">
        <IconButton title="编辑与核验" onClick={onOpen}><FileCheck2 size={15} /></IconButton>
        <IconButton title="移出早报稿" onClick={onExclude}><Trash2 size={15} /></IconButton>
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
        <button type="button" className="adopt-button" title="追源、重写并采用" onClick={(event) => { event.stopPropagation(); onAdopt() }}><Check size={16} /></button>
        <button type="button" className="inline-icon" title="排除" onClick={(event) => { event.stopPropagation(); onExclude() }}><Trash2 size={15} /></button>
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
}: {
  story: Story
  onPatch: (patch: Partial<Story>) => Promise<unknown>
  onAction: (action: string, chrome?: boolean) => Promise<void>
  onClose: () => void
  activeJob?: Job
  staticMode: boolean
}) {
  const [title, setTitle] = useState(story.title)
  const [body, setBody] = useState(story.body)

  useEffect(() => {
    setTitle(story.title)
    setBody(story.body)
  }, [story.id, story.title, story.body])

  return (
    <aside className="detail-panel">
      <div className="detail-toolbar">
        <span className="detail-kicker">稿件与来源</span>
        <IconButton title="关闭详情" onClick={onClose}><PanelRightClose size={18} /></IconButton>
      </div>
      <div className="detail-scroll">
        <label className="field-label" htmlFor="story-title">标题</label>
        <textarea id="story-title" className="title-editor" value={title} rows={2} onChange={(event) => setTitle(event.target.value)} onBlur={() => title !== story.title && void onPatch({ title })} />
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
        {staticMode ? <p className="static-mode-note">当前是 Pages 审稿模式。标题、正文、分类和取舍会写入审稿单；追源、Chrome、核验和找图由主 Mac 执行。</p> : null}
        {activeJob ? <div className={`job-banner ${activeJob.state}`}><LoaderCircle size={16} className={activeJob.state === 'running' ? 'spin' : ''} /><span>{activeJob.message || activeJob.action}</span><strong>{activeJob.progress}%</strong></div> : null}
        <label className="field-label" htmlFor="story-body">{story.metadata.content_role === 'lead_only' ? '待成稿（原始抓取材料不会直接进入正文）' : '正文'}</label>
        <textarea id="story-body" className="body-editor" value={body} onChange={(event) => setBody(event.target.value)} onBlur={() => body !== story.body && void onPatch({ body })} />
        <DetailSources story={story} />
      </div>
    </aside>
  )
}

function DetailSources({ story }: { story: Story }) {
  const image = story.image_path ? api.storyImageUrl(story.id) : story.image_url
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
      <section className="detail-section image-section">
        <div className="section-heading"><Image size={16} /><h4>配图</h4></div>
        {image ? <img src={image} alt={story.title} /> : <div className="image-empty"><Image size={22} /></div>}
      </section>
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
            <header><div><span className="brand-code">{brand.toUpperCase()}</span><h2>{brand === 'appso' ? 'AI 与产品入口' : '消费电子与生活方式'}</h2></div><button type="button" className="generate-button" disabled={generating !== null} onClick={() => void onGenerate(brand)}>{generating === brand ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}生成标题</button></header>
            <p className="brand-note">从当前共享母稿生成 3 组“三个消息 / 分隔”标题，两个品牌可使用同一选题，但表达分别调整。</p>
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

function ExportDialog({ issue, handoff, busy, staticMode, operationCount, onClose, onMarkdown, onHandoff }: {
  issue: Issue
  handoff: AutomationHandoff | null
  busy: boolean
  staticMode: boolean
  operationCount: number
  onClose: () => void
  onMarkdown: () => void
  onHandoff: () => void
}) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><div className="export-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header><div><span>结构化导出</span><h2>导出 {issue.selected_count} 条早报稿</h2></div><IconButton title="关闭" onClick={onClose}><X size={18} /></IconButton></header><div className="export-options"><button className="export-option" type="button" onClick={onMarkdown}><Download size={19} /><span><strong>下载 Markdown</strong><small>导出当前标题、正文、分类、排序和来源行</small></span></button><button className="export-option" type="button" disabled={busy || (staticMode && operationCount === 0)} onClick={onHandoff}>{busy ? <LoaderCircle size={19} className="spin" /> : <RefreshCw size={19} />}<span><strong>{staticMode ? '下载飞书审稿单' : '交给下一轮自动化'}</strong><small>{staticMode ? `仅包含 ${operationCount} 个显式修改；下载后发送到早报飞书群` : '写入本机 handoff，定时任务会在同刊期继承并合并新内容'}</small></span></button></div>{staticMode ? <div className="review-safety"><ShieldCheck size={16} /><span>审稿单不会把未列出的新闻视为删除。刊期、版本或故事指纹冲突时，主 Mac 会保留原稿并转为人工复核。</span></div> : null}{handoff ? <div className="handoff-success"><Check size={16} /><span>已写入刊期 {handoff.issue_id} 的 handoff，共 {handoff.selected_count} 条。</span></div> : null}<footer><button type="button" className="secondary-button" onClick={onClose}>完成</button></footer></div></div>
}

function issueWithMetrics(issue: Issue, stories: Story[]): Issue {
  return {
    ...issue,
    stories,
    selected_count: stories.filter((story) => story.selected && story.status !== 'excluded').length,
    ready_count: stories.filter((story) => story.selected && story.status === 'ready').length,
    review_count: stories.filter((story) => story.status === 'needs_review' || story.changed_since_review).length,
  }
}

export function App() {
  const [issue, setIssue] = useState<Issue | null>(null)
  const [baseIssue, setBaseIssue] = useState<Issue | null>(null)
  const [reviewSessionId, setReviewSessionId] = useState('')
  const [dataMode, setDataMode] = useState<'worker' | 'static' | 'offline'>('offline')
  const [online, setOnline] = useState(false)
  const [publishMode, setPublishMode] = useState('shadow')
  const [repoRuntimeAccess, setRepoRuntimeAccess] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('全部')
  const [candidateStatus, setCandidateStatus] = useState('all')
  const [view, setView] = useState<View>('draft')
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null)
  const [draggedStoryId, setDraggedStoryId] = useState<string | null>(null)
  const [jobs, setJobs] = useState<Record<string, Job>>({})
  const [weekend, setWeekend] = useState<Record<string, { label: string; candidates: Array<Record<string, unknown>> }>>({})
  const [showExport, setShowExport] = useState(false)
  const [handoff, setHandoff] = useState<AutomationHandoff | null>(null)
  const [exporting, setExporting] = useState(false)
  const [generatingBrand, setGeneratingBrand] = useState<'appso' | 'ifanr' | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [apiUrl, setApiUrlInput] = useState(getApiUrl())
  const [profileMessage, setProfileMessage] = useState('')

  const loadIssue = useCallback(async () => {
    setLoading(true)
    setError('')
    const forceStatic = new URLSearchParams(window.location.search).get('static') === '1'
    const loadStaticIssue = async () => {
      const current = await api.staticIssue()
      const snapshot = structuredClone(current)
      const snapshotDigest = typeof current.diagnostics?.public_snapshot === 'object'
        && current.diagnostics.public_snapshot
        && 'digest' in current.diagnostics.public_snapshot
        ? String(current.diagnostics.public_snapshot.digest || '')
        : String(current.revision)
      const draftKey = `editorial-review-draft:${current.id}:${snapshotDigest}`
      const sessionKey = `editorial-review-session:${current.id}:${snapshotDigest}`
      let sessionId = localStorage.getItem(sessionKey)
      if (!sessionId) {
        sessionId = crypto.randomUUID()
        localStorage.setItem(sessionKey, sessionId)
      }
      let reviewDraft = current
      try {
        const stored = localStorage.getItem(draftKey)
        if (stored) {
          const parsed = JSON.parse(stored) as EditorialReviewExport
          if (parsed.schema === 'ifanr_editorial_review' && parsed.issue_id === current.id && Array.isArray(parsed.operations)) {
            reviewDraft = applyReviewOperations(current, parsed.operations)
          }
        }
      } catch {
        localStorage.removeItem(draftKey)
      }
      setIssue(reviewDraft)
      setBaseIssue(snapshot)
      setReviewSessionId(sessionId)
      setOnline(true)
      setDataMode('static')
      setPublishMode('pages')
      setRepoRuntimeAccess(false)
      setSelectedStoryId(null)
    }
    if (forceStatic) {
      try {
        await loadStaticIssue()
      } catch (staticError) {
        setOnline(false)
        setDataMode('offline')
        setError(staticError instanceof Error ? staticError.message : 'Pages 暂无可用刊期包')
      } finally {
        setLoading(false)
      }
      return
    }
    try {
      const health = await api.health()
      setOnline(true)
      setDataMode('worker')
      setPublishMode(health.mode)
      setRepoRuntimeAccess(health.repo_runtime_access)
      let current: Issue
      try { current = await api.currentIssue() } catch { current = await api.importLatest() }
      setIssue(current)
      setBaseIssue(structuredClone(current))
      setReviewSessionId('')
      setSelectedStoryId(null)
    } catch (loadError) {
      try {
        await loadStaticIssue()
      } catch (staticError) {
        setOnline(false)
        setDataMode('offline')
        const workerMessage = loadError instanceof Error ? loadError.message : '本地 worker 不可达'
        const staticMessage = staticError instanceof Error ? staticError.message : 'Pages 暂无可用刊期包'
        setError(`${workerMessage}；${staticMessage}`)
      }
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    void loadIssue()
    api.weekend().then(setWeekend).catch(() => api.staticWeekend().then(setWeekend).catch(() => undefined))
  }, [loadIssue])

  useEffect(() => {
    if (dataMode !== 'static' || !issue || !baseIssue) return
    const snapshotDigest = typeof baseIssue.diagnostics?.public_snapshot === 'object'
      && baseIssue.diagnostics.public_snapshot
      && 'digest' in baseIssue.diagnostics.public_snapshot
      ? String(baseIssue.diagnostics.public_snapshot.digest || '')
      : String(baseIssue.revision)
    try {
      const review = buildReviewExport(baseIssue, issue, reviewSessionId)
      localStorage.setItem(`editorial-review-draft:${baseIssue.id}:${snapshotDigest}`, JSON.stringify(review))
    } catch {
      // The review still remains in memory and can be exported even if browser storage is unavailable.
    }
  }, [baseIssue, dataMode, issue, reviewSessionId])

  const draftStories = useMemo(() => {
    if (!issue) return []
    const normalized = query.trim().toLowerCase()
    return issue.stories.filter((story) => story.selected && story.status !== 'excluded')
      .filter((story) => category === '全部' || story.category === category)
      .filter((story) => !normalized || `${story.title} ${story.body} ${story.source_name}`.toLowerCase().includes(normalized))
      .sort((a, b) => (categoryOrder.get(a.category) ?? 99) - (categoryOrder.get(b.category) ?? 99) || a.position - b.position)
  }, [issue, query, category])

  const groupedDraft = useMemo(() => {
    const groups = new Map<string, Story[]>()
    draftStories.forEach((story) => groups.set(story.category, [...(groups.get(story.category) || []), story]))
    return categories.slice(1).filter((item) => groups.has(item)).map((item) => [item, groups.get(item) || []] as const)
  }, [draftStories])

  const candidates = useMemo(() => {
    if (!issue) return []
    const normalized = query.trim().toLowerCase()
    return issue.stories.filter((story) => !story.selected)
      .filter((story) => category === '全部' || story.category === category)
      .filter((story) => candidateStatus === 'all' ? story.status !== 'excluded' : candidateStatus === 'excluded' ? story.status === 'excluded' : story.status === candidateStatus)
      .filter((story) => !normalized || `${story.title} ${story.body} ${story.source_name}`.toLowerCase().includes(normalized))
      .sort((a, b) => b.score - a.score)
  }, [issue, query, category, candidateStatus])

  const draftCounts = useMemo(() => {
    const counts: Record<string, number> = { 全部: issue?.selected_count || 0 }
    issue?.stories.filter((story) => story.selected && story.status !== 'excluded').forEach((story) => { counts[story.category] = (counts[story.category] || 0) + 1 })
    return counts
  }, [issue])

  const selectedStory = issue?.stories.find((story) => story.id === selectedStoryId) || null
  const selectedJob = selectedStory ? jobs[selectedStory.id] : undefined

  const updateStory = async (storyId: string, patch: Partial<Story>) => {
    const existing = issue?.stories.find((story) => story.id === storyId)
    if (!existing) throw new Error('选题不存在')
    const updated = dataMode === 'static' ? { ...existing, ...patch } : await api.patchStory(storyId, patch)
    setIssue((current) => current ? issueWithMetrics(current, current.stories.map((story) => story.id === storyId ? updated : story)) : current)
    return updated
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

  const adoptCandidate = async (story: Story) => {
    setSelectedStoryId(story.id)
    if (dataMode === 'static') {
      await updateStory(story.id, { selected: true, status: story.body.trim() ? 'needs_review' : 'drafting' })
      return
    }
    try {
      await updateStory(story.id, { status: 'drafting' })
      const queued = await api.action(story.id, 'rewrite')
      await watchJob(story.id, queued)
      await updateStory(story.id, { selected: true })
    } catch (adoptError) {
      setError(adoptError instanceof Error ? adoptError.message : '追源成稿失败')
      await updateStory(story.id, { selected: false, status: 'needs_review' }).catch(() => undefined)
    }
  }

  const refresh = async (runPreflight: boolean) => {
    if (!issue) return
    if (dataMode === 'static') {
      await loadIssue()
      return
    }
    setError('')
    try {
      const job = await api.refreshIssue(issue.id, runPreflight)
      const current = await api.watchJob(job.id, () => undefined).catch(async () => {
        let fallback = await api.job(job.id)
        while (!['completed', 'failed'].includes(fallback.state)) { await new Promise((resolve) => window.setTimeout(resolve, 1200)); fallback = await api.job(job.id) }
        return fallback
      })
      if (current.state === 'failed') throw new Error(current.error)
      setIssue(await api.getIssue(issue.id))
    } catch (refreshError) { setError(refreshError instanceof Error ? refreshError.message : '刷新失败') }
  }

  const generateBrand = async (brand: 'appso' | 'ifanr') => {
    if (!issue) return
    if (dataMode === 'static') {
      setError('Pages 审稿模式不运行 AI 任务；主 Mac 下一轮会根据审稿单处理。')
      return
    }
    setGeneratingBrand(brand)
    setError('')
    try {
      const queued = await api.generateBrand(issue.id, brand)
      const job = await api.watchJob(queued.id, () => undefined).catch(async () => {
        let fallback = await api.job(queued.id)
        while (!['completed', 'failed'].includes(fallback.state)) { await new Promise((resolve) => window.setTimeout(resolve, 1200)); fallback = await api.job(queued.id) }
        return fallback
      })
      if (job.state === 'failed') throw new Error(job.error)
      setIssue(await api.getIssue(issue.id))
    } catch (brandError) { setError(brandError instanceof Error ? brandError.message : '品牌包装生成失败') } finally { setGeneratingBrand(null) }
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
    setError('')
    try { setHandoff(await api.handoff(issue.id)) }
    catch (handoffError) { setError(handoffError instanceof Error ? handoffError.message : 'handoff 写入失败') }
    finally { setExporting(false) }
  }

  const switchView = (next: View) => { setView(next); setSelectedStoryId(null); setCategory('全部'); setQuery('') }

  const reviewOperationCount = useMemo(() => baseIssue && issue ? buildReviewExport(baseIssue, issue, reviewSessionId).operations.length : 0, [baseIssue, issue, reviewSessionId])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><Newspaper size={21} /><div><strong>早报编辑台</strong><span>BOT DRAFT · {issue?.publication_date || '未连接刊期'}</span></div></div>
        <nav className="view-switcher" aria-label="编辑台视图">
          <button className={view === 'draft' ? 'active' : ''} onClick={() => switchView('draft')} type="button">早报稿</button>
          <button className={view === 'candidates' ? 'active' : ''} onClick={() => switchView('candidates')} type="button">候选库</button>
          <button className={view === 'brands' ? 'active' : ''} onClick={() => switchView('brands')} type="button">双品牌</button>
          <button className={view === 'weekend' ? 'active' : ''} onClick={() => switchView('weekend')} type="button">周末备选</button>
        </nav>
        <div className="topbar-actions">
          <span className={`connection ${online ? 'online' : 'offline'}`} title={dataMode === 'static' ? 'GitHub Pages 静态审稿包' : repoRuntimeAccess ? '可直接读取仓库 runtime' : '由早报自动化同步到编辑台'}>{online ? <CircleDot size={13} /> : <CloudOff size={14} />}{online ? (dataMode === 'static' ? 'PAGES' : publishMode) : '离线'}</span>
          <IconButton title={repoRuntimeAccess ? '同步最新自动化产物' : '读取自动化已同步的最终稿'} onClick={() => void refresh(false)} disabled={!issue}><RefreshCw size={17} /></IconButton>
          <IconButton title="连接设置" onClick={() => setShowSettings((value) => !value)} active={showSettings}><Settings size={17} /></IconButton>
          <button className="export-button" type="button" disabled={!issue} onClick={() => { setHandoff(null); setShowExport(true) }}><Download size={16} />导出</button>
        </div>
        {showSettings ? <div className="settings-popover"><label><span>本地 Worker URL</span><input value={apiUrl} onChange={(event) => setApiUrlInput(event.target.value)} /></label><button type="button" onClick={() => { setApiUrl(apiUrl); setShowSettings(false); void loadIssue() }}>连接</button><button type="button" onClick={() => { setProfileMessage('正在归纳本周编辑决策…'); void api.proposeProfile().then((proposal) => setProfileMessage(proposal.status === 'pending' ? '已生成待确认的偏好差异提案' : '本周暂无需调整的偏好')).catch((profileError) => setProfileMessage(profileError instanceof Error ? profileError.message : '提案生成失败')) }}>生成每周偏好提案</button>{profileMessage ? <p className="settings-message">{profileMessage}</p> : null}</div> : null}
      </header>

      {(view === 'draft' || view === 'candidates') ? (
        <div className={`editor-layout ${selectedStory ? 'with-detail' : ''}`}>
          <aside className="sidebar">
            <div className="sidebar-heading"><Menu size={16} /><span>栏目</span></div>
            <nav>{categories.map((item) => <button type="button" className={category === item ? 'active' : ''} onClick={() => setCategory(item)} key={item}><span>{item}</span><em>{view === 'draft' ? draftCounts[item] || 0 : issue?.stories.filter((story) => !story.selected && (item === '全部' || story.category === item)).length || 0}</em></button>)}</nav>
            {view === 'candidates' ? <><div className="sidebar-heading"><ArrowUpDown size={16} /><span>状态</span></div><nav>{[['all', '待处理'], ['needs_review', '待复核'], ['source_chasing', '追源中'], ['excluded', '已排除']].map(([value, label]) => <button type="button" className={candidateStatus === value ? 'active' : ''} onClick={() => setCandidateStatus(value)} key={value}><span>{label}</span></button>)}</nav></> : null}
            <div className="issue-metrics"><div><strong>{issue?.selected_count || 0}</strong><span>Bot 成稿</span></div><div><strong>{issue?.ready_count || 0}</strong><span>可用</span></div><div><strong>{issue?.review_count || 0}</strong><span>待复核</span></div></div>
          </aside>

          <main className={view === 'draft' ? 'draft-column' : 'candidate-column'}>
            {loading ? <div className="center-state"><LoaderCircle size={24} className="spin" /><span>正在读取刊期</span></div> : null}
            {!loading && error ? <div className="center-state error"><CloudOff size={26} /><strong>暂无可用刊期</strong><span>{error}</span><button type="button" onClick={() => void loadIssue()}>重试</button></div> : null}
            {!loading && !error && view === 'draft' ? <>
              <header className="draft-masthead"><div className="draft-date">{issue?.publication_date?.replaceAll('-', ' / ')}</div><h1>早报</h1><p>当前飞书 Bot 稿 · {issue?.selected_count || 0} 条 · {dataMode === 'static' ? '远程审稿修改将导出到飞书' : '自动化更新后保留人工编辑'}</p><div className="draft-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="在当前早报稿中搜索" /></div></header>
              <div className="draft-document">{groupedDraft.map(([section, stories]) => <section className="issue-section" id={`section-${section}`} key={section}><header className="section-title"><span>{String((categoryOrder.get(section) ?? 0) + 1).padStart(2, '0')}</span><h2>{section}</h2><em>{stories.length}</em></header>{stories.map((story) => <IssueArticle key={story.id} story={story} active={selectedStoryId === story.id} onOpen={() => setSelectedStoryId(story.id)} onExclude={() => void updateStory(story.id, { selected: false, status: 'excluded' })} onDragStart={() => setDraggedStoryId(story.id)} onDrop={() => void handleDrop(story.id)} />)}</section>)}</div>
            </> : null}
            {!loading && !error && view === 'candidates' ? <>
              <header className="candidate-masthead"><div><span>候选库</span><h1>待追源与待复核</h1><p>候选不会直接进入正文；采用后才会出现在“早报稿”。</p></div><strong>{candidates.length}</strong></header>
              <div className="candidate-toolbar"><div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、正文或来源" /></div></div>
              <div className="candidate-list">{candidates.map((story) => <CandidateItem key={story.id} story={story} active={selectedStoryId === story.id} onOpen={() => setSelectedStoryId(story.id)} onAdopt={() => void adoptCandidate(story)} onExclude={() => void updateStory(story.id, { selected: false, status: 'excluded' })} />)}</div>
            </> : null}
          </main>
          {selectedStory ? <DetailPanel story={selectedStory} activeJob={selectedJob} staticMode={dataMode === 'static'} onClose={() => setSelectedStoryId(null)} onPatch={(patch) => updateStory(selectedStory.id, patch)} onAction={async (action, chrome) => { const job = await api.action(selectedStory.id, action, chrome); await watchJob(selectedStory.id, job) }} /> : null}
        </div>
      ) : null}

      {view === 'brands' && issue ? <BrandWorkspace issue={issue} generating={generatingBrand} onGenerate={generateBrand} onSave={async (brand, patch) => { if (dataMode === 'static') { setIssue({ ...issue, brand_packages: { ...issue.brand_packages, [brand]: { ...issue.brand_packages[brand], ...patch } } }); return } await api.patchBrand(issue.id, brand, patch); setIssue(await api.getIssue(issue.id)) }} /> : null}
      {view === 'weekend' ? <WeekendWorkspace data={weekend} /> : null}
      {showExport && issue ? <ExportDialog issue={issue} handoff={handoff} busy={exporting} staticMode={dataMode === 'static'} operationCount={reviewOperationCount} onClose={() => setShowExport(false)} onMarkdown={() => downloadText(`${issue.id}.md`, renderIssueMarkdown(issue), 'text/markdown;charset=utf-8')} onHandoff={() => void createHandoff()} /> : null}
    </div>
  )
}
