import {
  BarChart3,
  CalendarDays,
  Check,
  CircleAlert,
  CircleCheckBig,
  Copy,
  ExternalLink,
  Heart,
  Images,
  LoaderCircle,
  MessageCircle,
  PencilLine,
  Repeat2,
  Sparkles,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import { readerFacingStoryTitle } from './categories'
import { writeClipboardText, writeClipboardTextAndImage } from './clipboard'
import { generateWeiboPosts } from './llm-gateway'
import type { Issue, SocialPost, Story } from './types'

type WeiboWorkspaceProps = {
  issue: Issue
  dataMode: 'worker' | 'static' | 'offline'
  onNotify: (message: string) => void
}

function storyImage(story?: Story) {
  if (!story) return ''
  if (story.image_path) return api.storyImageUrl(story.id, story.updated_at || '')
  return story.image_url || ''
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

export function formatWeiboPost(post: SocialPost, storyTitle = '') {
  const tags = post.tags
    .map((tag) => tag.replaceAll('#', '').trim())
    .filter(Boolean)
  storyTitle = readerFacingStoryTitle(storyTitle)
  const isViewpoint = storyTitle.startsWith('💡')
  const cleanTitle = storyTitle.replace(/^💡\s*/, '').trim()
  const headline = cleanTitle
    ? (isViewpoint ? `💡观点｜${cleanTitle}` : `【${cleanTitle}】${tags[0] ? ` #${tags[0]}#` : ''}`)
    : ''
  const trailingTags = (headline && !isViewpoint ? tags.slice(1) : tags)
    .map((tag) => `#${tag}#`)
    .join(' ')
  return [
    headline,
    post.content.trim(),
    post.interaction.trim(),
    trailingTags,
  ].filter(Boolean).join('\n\n')
}

function WeiboThumbnail({ imageUrl }: { imageUrl: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [imageUrl])
  if (!imageUrl || failed) return null
  return <div className="weibo-copy-image">
    <img src={imageUrl} alt="微博配图" onError={() => setFailed(true)} />
    <span><Images size={12} />沿用早报配图</span>
  </div>
}

function WeiboMasonryCard({ children, className }: { children: ReactNode, className: string }) {
  const cardRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    const updateSpan = () => {
      const rowHeight = 4
      const gap = 18
      card.style.gridRowEnd = `span ${Math.ceil((card.getBoundingClientRect().height + gap) / (rowHeight + gap))}`
    }
    if (typeof ResizeObserver === 'undefined') {
      updateSpan()
      return
    }
    const observer = new ResizeObserver(updateSpan)
    observer.observe(card)
    updateSpan()
    return () => observer.disconnect()
  }, [])
  return <article className={className} ref={cardRef}>{children}</article>
}

export function WeiboWorkspace({ issue, dataMode, onNotify }: WeiboWorkspaceProps) {
  const sourceStories = useMemo(
    () => issue.stories
      .filter((story) => story.status !== 'excluded' && (story.selected || pendingAiEditorRequest(story)))
      .sort((left, right) => left.position - right.position || right.score - left.score),
    [issue],
  )
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copiedPostId, setCopiedPostId] = useState('')
  const [copyingPostId, setCopyingPostId] = useState('')
  const [copyFailedPostId, setCopyFailedPostId] = useState('')
  const [publishingPostId, setPublishingPostId] = useState('')
  const [generatingStoryId, setGeneratingStoryId] = useState('')
  const [editingPostId, setEditingPostId] = useState('')
  const [revisionInstruction, setRevisionInstruction] = useState('')
  const [revisingPostId, setRevisingPostId] = useState('')
  const [generationStage, setGenerationStage] = useState<'extracting' | 'generating'>('generating')
  const [listMode, setListMode] = useState<'pending' | 'published'>('pending')

  useEffect(() => {
    let cancelled = false
    setListMode('pending')
    setLoading(true)
    setError('')
    if (dataMode !== 'worker') {
      setPosts([])
      setLoading(false)
      return () => { cancelled = true }
    }
    api.socialPosts(issue.id)
      .then((items) => { if (!cancelled) setPosts(items) })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : '微博成稿读取失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [issue.id, dataMode])

  const postByStoryId = useMemo(() => new Map(posts.map((post) => [post.story_id, post])), [posts])
  const allEntries = useMemo(
    () => sourceStories.map((story) => ({ story, post: postByStoryId.get(story.id) })),
    [postByStoryId, sourceStories],
  )
  const pendingEntries = useMemo(
    () => allEntries.filter(({ post }) => post?.status !== 'published'),
    [allEntries],
  )
  const publishedEntries = useMemo(
    () => allEntries.filter(({ post }) => post?.status === 'published'),
    [allEntries],
  )
  const entries = listMode === 'published' ? publishedEntries : pendingEntries
  const completedEntries = entries.filter((entry) => entry.post)
  const measuredPosts = posts.filter((post) => post.metrics_captured_at)
  const performance = measuredPosts.reduce((totals, post) => ({
    reposts: totals.reposts + (post.reposts_count || 0),
    comments: totals.comments + (post.comments_count || 0),
    attitudes: totals.attitudes + (post.attitudes_count || 0),
    reads: totals.reads + (post.reads_count || 0),
    hasReads: totals.hasReads || typeof post.reads_count === 'number',
  }), { reposts: 0, comments: 0, attitudes: 0, reads: 0, hasReads: false })
  const latestMetricsAt = measuredPosts
    .map((post) => post.metrics_captured_at)
    .sort()
    .at(-1) || ''

  const copyPost = async (post: SocialPost, story: Story) => {
    setError('')
    setCopyFailedPostId('')
    setCopyingPostId(post.id)
    const result = await writeClipboardTextAndImage(formatWeiboPost(post, story.title), storyImage(story))
    setCopyingPostId('')
    if (!result.copied) {
      setError('复制失败，请手动选中卡片文字复制')
      setCopyFailedPostId(post.id)
      return
    }
    setCopiedPostId(post.id)
    window.setTimeout(() => setCopiedPostId((current) => current === post.id ? '' : current), 1400)
    onNotify(result.imageCopied ? '微博正文和配图已复制，可直接粘贴发布' : '微博正文已复制；当前浏览器未允许写入配图')
  }

  const copyBatch = async () => {
    const batch = completedEntries.map(({ post, story }) => formatWeiboPost(post as SocialPost, story.title)).join('\n\n——————————\n\n')
    setError('')
    const copied = await writeClipboardText(batch)
    if (!copied) {
      setError('复制失败，请手动选中卡片文字复制')
      return
    }
    onNotify(`已复制 ${completedEntries.length} 条完整微博`)
  }

  const markPublished = async (post: SocialPost) => {
    setPublishingPostId(post.id)
    setError('')
    try {
      const updated = await api.markSocialPostPublished(post.id)
      setPosts((current) => current.map((item) => item.id === post.id ? updated : item))
      onNotify('已标记为已发布，并从社媒页收纳')
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : '标记已发布失败')
    } finally {
      setPublishingPostId('')
    }
  }

  const generatePost = async (story: Story) => {
    setGeneratingStoryId(story.id)
    setGenerationStage(story.body.trim() ? 'generating' : 'extracting')
    setError('')
    try {
      let sourceStory = story
      if (!story.body.trim()) {
        const sourceUrls = [...new Set([story.source_url, ...story.sources.map((source) => source.url)].map((url) => url.trim()).filter(Boolean))]
        if (!sourceUrls.length) throw new Error('这条选题没有可抓取的来源链接')
        const extracted = await api.extractUrlsContent({ urls: sourceUrls })
        if (!extracted.merged_content.trim()) throw new Error('来源链接没有提取到可用正文')
        sourceStory = {
          ...story,
          title: story.title.startsWith('待 AI 主编撰写：') && extracted.merged_title.trim() ? extracted.merged_title.trim() : story.title,
          body: extracted.merged_content,
          source_url: extracted.primary_source_url || story.source_url,
        }
        setGenerationStage('generating')
      }
      const [draft] = await generateWeiboPosts([sourceStory], issue.publication_date)
      if (!draft) throw new Error('模型没有返回这条微博草稿')
      const saved = await api.upsertSocialPost(issue.id, {
        story_id: story.id,
        target_date: issue.publication_date,
        content: draft.content,
        interaction: draft.interaction,
        tags: draft.tags,
        status: 'ready',
        position: story.position,
        suggested_time: draft.suggested_time,
      })
      setPosts((current) => [...current.filter((item) => item.story_id !== story.id), saved])
      onNotify('微博已生成，可直接复制发布')
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : '微博生成失败')
    } finally {
      setGeneratingStoryId('')
    }
  }

  const revisePost = async (post: SocialPost, story: Story) => {
    if (dataMode !== 'worker') return
    setRevisingPostId(post.id)
    setError('')
    try {
      const instruction = revisionInstruction.trim()
      const [draft] = await generateWeiboPosts([story], issue.publication_date, {
        currentPost: {
          content: post.content,
          interaction: post.interaction,
          tags: post.tags,
          suggested_time: post.suggested_time,
        },
        instruction,
      })
      if (!draft) throw new Error('模型没有返回修改后的微博')
      const updated = await api.patchSocialPost(post.id, {
        content: draft.content,
        interaction: draft.interaction,
        tags: draft.tags,
        suggested_time: draft.suggested_time,
        status: 'ready',
      })
      setPosts((current) => current.map((item) => item.id === post.id ? updated : item))
      setEditingPostId('')
      setRevisionInstruction('')
      onNotify(instruction ? '微博已按附加意见修改' : 'AI 已完成微博优化')
    } catch (revisionError) {
      setError(revisionError instanceof Error ? revisionError.message : '微博修改失败')
    } finally {
      setRevisingPostId('')
    }
  }

  return (
    <main className="weibo-workspace">
      <header className="weibo-hero">
        <div>
          <span className="workspace-eyebrow"><MessageCircle size={14} /> 社媒发布稿</span>
          <h1>微博成稿</h1>
          <p>可用 ifanr 模型即时生成，也会随每轮早报同步。每张卡片都是已组合正文、自然互动和话题的完整发布文本。</p>
        </div>
        <div className="weibo-hero-actions">
          <div className="weibo-target-date"><CalendarDays size={16} /><span>刊期</span><strong>{issue.publication_date.replaceAll('-', '.')}</strong></div>
          <button type="button" className="weibo-copy-all" onClick={() => void copyBatch()} disabled={!completedEntries.length}><Copy size={15} />复制全部</button>
        </div>
      </header>

      <nav className="weibo-list-tabs" aria-label="微博发布状态">
        <button type="button" className={listMode === 'pending' ? 'active' : ''} aria-pressed={listMode === 'pending'} onClick={() => setListMode('pending')}>待发布 <span>{pendingEntries.length}</span></button>
        <button type="button" className={listMode === 'published' ? 'active' : ''} aria-pressed={listMode === 'published'} onClick={() => setListMode('published')}>已发布 <span>{publishedEntries.length}</span></button>
      </nav>

      {listMode === 'pending' && pendingEntries.length ? <section className="weibo-copy-summary" aria-label="微博成稿状态">
        <div><strong>{completedEntries.length}</strong><span>/ {pendingEntries.length} 条待发布</span></div>
        <p>{completedEntries.length === pendingEntries.length ? '当前待发布微博均已生成' : `还有 ${pendingEntries.length - completedEntries.length} 条可立即生成`}</p>
      </section> : null}

      {measuredPosts.length ? <section className="weibo-performance-summary" aria-label="微博发布后表现">
        <div className="weibo-performance-heading">
          <span><BarChart3 size={14} /> 发布后表现</span>
          <strong>{measuredPosts.length} / {publishedEntries.length} 条已回收</strong>
        </div>
        <div><span>转发</span><strong>{performance.reposts}</strong></div>
        <div><span>评论</span><strong>{performance.comments}</strong></div>
        <div><span>赞</span><strong>{performance.attitudes}</strong></div>
        <div><span>阅读</span><strong>{performance.hasReads ? performance.reads : '后台授权后补'}</strong></div>
        <small>{latestMetricsAt ? `最近回收 ${new Date(latestMetricsAt).toLocaleString('zh-CN', { hour12: false })}` : ''} · 指标只辅助 AI 主编复盘，不自动替代选题判断</small>
      </section> : null}

      {error ? <div className="weibo-error" role="alert">{error}</div> : null}
      {loading ? <div className="weibo-empty"><LoaderCircle size={22} className="spin" /><strong>正在读取微博成稿</strong></div> : null}
      {!loading && !sourceStories.length ? <div className="weibo-empty"><MessageCircle size={24} /><strong>当前刊期还没有早报成稿</strong></div> : null}
      {!loading && sourceStories.length > 0 && listMode === 'pending' && !pendingEntries.length ? <div className="weibo-empty"><CircleCheckBig size={24} /><strong>当前刊期微博已全部发布</strong><button type="button" onClick={() => setListMode('published')}>查看已发布</button></div> : null}
      {!loading && listMode === 'published' && !publishedEntries.length ? <div className="weibo-empty"><CircleCheckBig size={24} /><strong>还没有已发布的微博</strong></div> : null}

      {!loading ? <section className="weibo-copy-list" aria-label="可复制微博列表">
        {entries.map(({ story, post }, index) => {
          const text = post ? formatWeiboPost(post, story.title) : ''
          return <WeiboMasonryCard className={`weibo-copy-card${post ? '' : ' pending'}${post?.status === 'published' ? ' published' : ''}`} key={story.id}>
            <header>
              <span className="weibo-post-index">{String(index + 1).padStart(2, '0')}</span>
              <div className="weibo-copy-title"><em>{story.category}</em><strong>{story.title}</strong></div>
              <div className="weibo-card-actions">
                {post?.status !== 'published' ? <button type="button" className={`revise${editingPostId === post?.id ? ' active' : ''}`} aria-label="修改微博" aria-expanded={editingPostId === post?.id} aria-controls={post ? `weibo-revision-${post.id}` : undefined} disabled={!post || copyingPostId === post?.id || publishingPostId === post?.id || revisingPostId === post?.id} onClick={() => {
                  if (!post) return
                  setEditingPostId((current) => current === post.id ? '' : post.id)
                  setRevisionInstruction('')
                  setError('')
                }}><PencilLine size={14} /><span>修改</span></button> : null}
                <button type="button" className={copyFailedPostId === post?.id ? 'copy-failed' : copiedPostId === post?.id ? 'copied' : ''} aria-label={copyingPostId === post?.id ? '正在复制正文和配图' : copyFailedPostId === post?.id ? '复制失败，点击重试' : copiedPostId === post?.id ? '已复制' : '复制微博正文和配图'} title={copyFailedPostId === post?.id ? '复制失败，点击重试' : copiedPostId === post?.id ? '已复制' : '复制微博正文和配图'} disabled={!post || copyingPostId === post?.id || publishingPostId === post?.id} onClick={() => post && void copyPost(post, story)}>
                  {copyingPostId === post?.id ? <LoaderCircle size={16} className="spin" /> : copyFailedPostId === post?.id ? <CircleAlert size={16} /> : copiedPostId === post?.id ? <Check size={16} /> : <Copy size={16} />}
                </button>
                {post?.status === 'published'
                  ? <button type="button" className="publish complete" aria-label="已发布" title="已发布" disabled><CircleCheckBig size={17} /></button>
                  : <button type="button" className="publish" aria-label={publishingPostId === post?.id ? '收纳中' : '标记已发布'} title="标记已发布" disabled={!post || publishingPostId === post?.id} onClick={() => post && void markPublished(post)}>
                    {publishingPostId === post?.id ? <LoaderCircle size={16} className="spin" /> : <CircleCheckBig size={17} />}
                  </button>}
              </div>
            </header>
            {post ? <div className="weibo-copy-content">
              <WeiboThumbnail imageUrl={storyImage(story)} />
              <pre>{text}</pre>
              {editingPostId === post.id ? <form id={`weibo-revision-${post.id}`} className="weibo-revision-panel" onSubmit={(event) => { event.preventDefault(); void revisePost(post, story) }}>
                <textarea autoFocus rows={2} maxLength={500} value={revisionInstruction} placeholder="想怎么修改这条微博？（可选）" aria-label="微博修改意见" disabled={revisingPostId === post.id} onChange={(event) => setRevisionInstruction(event.target.value)} onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault()
                    void revisePost(post, story)
                  }
                }} />
                <div className="weibo-revision-actions">
                  <span><Sparkles size={13} />AI 修改</span>
                  <button type="button" className="cancel" disabled={revisingPostId === post.id} onClick={() => { setEditingPostId(''); setRevisionInstruction('') }}><X size={14} />取消</button>
                  <button type="submit" className="generate" disabled={revisingPostId === post.id}>{revisingPostId === post.id ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}{revisingPostId === post.id ? '正在修改' : '生成'}</button>
                </div>
              </form> : null}
              {post.metrics_captured_at ? <footer className="weibo-post-performance">
                <span><Repeat2 size={12} />{post.reposts_count || 0}</span>
                <span><MessageCircle size={12} />{post.comments_count || 0}</span>
                <span><Heart size={12} />{post.attitudes_count || 0}</span>
                {post.published_url ? <a href={post.published_url} target="_blank" rel="noreferrer">查看原帖 <ExternalLink size={11} /></a> : null}
              </footer> : null}
            </div> : <div className="weibo-copy-pending">
              {generatingStoryId === story.id
                ? <><LoaderCircle size={16} className="spin" /><span>{generationStage === 'extracting' ? '正在抓取来源链接正文…' : 'ifanr 模型正在生成完整微博…'}</span></>
                : <><span>{story.body.trim() ? '根据当前已核验正文生成完整微博。' : '抓取来源链接正文后，直接生成完整微博。'}</span><button type="button" onClick={() => void generatePost(story)} disabled={dataMode !== 'worker' || Boolean(generatingStoryId)}><Sparkles size={15} />{story.body.trim() ? '立即生成' : '抓取并生成'}</button></>}
            </div>}
          </WeiboMasonryCard>
        })}
      </section> : null}
    </main>
  )
}
