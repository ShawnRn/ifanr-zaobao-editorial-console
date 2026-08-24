import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, BrandWorkspace, IssueArticle, sortCandidatesNewestFirst, StoryImageEditor, TrashItem } from './App'
import { api } from './api'
import type { Issue, Story } from './types'

const staticStory: Story = {
  id: 'static-story', issue_id: 'ifanr-daily-20260722', fingerprint: 'static-fingerprint', title: '当天真实 Bot 稿标题', body: '当天真实 Bot 稿正文。',
  category: '重磅', status: 'ready', selected: true, position: 0, score: 0,
  source_url: 'https://example.com/story', source_name: '公开来源', source_type: 'draft_source', source_quality: 'primary', confidence: 1,
  cross_day_status: 'current', rumor: false, fact_status: 'verified', changed_since_review: false,
  image_url: '', image_path: '', image_token: '', editorial_reason: '', metadata: { static_snapshot: true }, sources: [], claims: [],
}

const staticIssue: Issue = {
  id: 'ifanr-daily-20260722', publication_date: '2026-07-22', title: '20260722 早报', state: 'static_snapshot', runtime_path: '', draft_path: '',
  revision: 3, selected_count: 1, review_count: 0, ready_count: 1, updated_at: '2026-07-21T09:00:00Z', stories: [staticStory],
  brand_packages: { appso: { headline_options: [], selected_headline: '', cover_candidates: [], selected_cover: '' }, ifanr: { headline_options: [], selected_headline: '', cover_candidates: [], selected_cover: '' } },
  diagnostics: { static_snapshot: true, snapshot_generated_at: '2026-07-21T09:05:00Z' },
}

vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('data/current-issue.json') ? ({
  ok: true,
  json: async () => structuredClone(staticIssue),
}) : ({
  ok: false,
  statusText: 'offline',
  json: async () => ({ detail: 'offline' }),
})))
vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('App', () => {
  it('sorts candidates from newest to oldest and leaves undated items last', () => {
    const stories: Story[] = [
      { ...staticStory, id: 'undated', published_at: undefined },
      { ...staticStory, id: 'older', published_at: '2026-08-15 20:00' },
      { ...staticStory, id: 'newer', published_at: '2026-08-16T09:00:00+08:00' },
      { ...staticStory, id: 'event-date-fallback', published_at: undefined, event_date: '2026-08-16' },
    ]

    expect(sortCandidatesNewestFirst(stories).map((story) => story.id)).toEqual([
      'newer',
      'event-date-fallback',
      'older',
      'undated',
    ])
  })

  it('keeps generated headline history in a separate secondary view and restores a version', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const issue = structuredClone(staticIssue)
    issue.brand_packages.ifanr.headline_history = [{
      id: 'history-1', created_at: '2026-07-21T10:00:00Z', source: 'ai_editor_batch', model: 'codex',
      headline_options: ['历史一', '历史二', '历史三'], selected_headline: '历史一',
    }]
    render(<BrandWorkspace issue={issue} onSave={onSave} onGenerate={vi.fn().mockResolvedValue(undefined)} generating={{ appso: false, ifanr: false }} />)
    expect(screen.getAllByText(/标题编辑Skill:每组3条不同新闻/)).toHaveLength(2)
    expect(screen.queryByText('历史一')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '历史版本' }))
    expect(screen.getByText('历史一')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '恢复为当期' })[0])
    expect(onSave).toHaveBeenCalledWith('ifanr', expect.objectContaining({ headline_options: ['历史一', '历史二', '历史三'], generation_source: 'history_restore' }))
  })

  it('falls back to the current real Bot draft snapshot while the worker is offline', async () => {
    render(<App />)
    expect(screen.getByText('早报编辑台')).toBeInTheDocument()
    expect(screen.getByText('标题')).toBeInTheDocument()
    expect((await screen.findAllByText('Pages 快照')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '早报稿' }))
    expect(await screen.findByRole('heading', { name: '当天真实 Bot 稿标题' })).toBeInTheDocument()
    expect(screen.getByText('当天飞书 Bot 稿 · 1 条 · Pages 只读快照')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '设置' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('img', { name: 'ifanr' })).not.toHaveAttribute('src', '/favicon.png')
  })

  it('does not open the detail panel when removing a draft item', () => {
    const onOpen = vi.fn()
    const onExclude = vi.fn()
    const story: Story = {
      id: 'story-1', issue_id: 'issue-1', fingerprint: 'fingerprint-1', title: '测试选题', body: '正文',
      category: '大公司', status: 'ready', selected: true, position: 0, score: 100,
      source_url: '', source_name: '', source_type: '', source_quality: 'primary', confidence: 1,
      cross_day_status: '', rumor: false, fact_status: 'verified', changed_since_review: false,
      image_url: '', image_path: '', image_token: '', editorial_reason: '', metadata: {}, sources: [], claims: [],
    }
    render(<IssueArticle story={story} active={false} onOpen={onOpen} onExclude={onExclude} onDragStart={() => undefined} onDrop={() => undefined} onDragEnd={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: '移出早报稿' }))

    expect(onExclude).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('ignores zero-width placeholder lines instead of rendering empty paragraphs', () => {
    const story = {
      ...staticStory,
      body: '\u200b\n\n第一段。\n\n\u200b\n\n第二段。\n\n\uFEFF',
    }
    const { container } = render(<IssueArticle story={story} active={false} onOpen={() => undefined} onExclude={() => undefined} onDragStart={() => undefined} onDrop={() => undefined} onDragEnd={() => undefined} />)

    const paragraphs = container.querySelectorAll('.article-body p')
    expect(paragraphs).toHaveLength(2)
    expect([...paragraphs].map((paragraph) => paragraph.textContent)).toEqual(['第一段。', '第二段。'])
  })

  it('asks for confirmation before deletion and restores it with Command-Z', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '早报稿' }))
    expect(await screen.findByRole('heading', { name: '当天真实 Bot 稿标题' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '移出早报稿' }))
    expect(screen.getByRole('dialog', { name: '确定删除这个选题？' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '当天真实 Bot 稿标题' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '确定删除这个选题？' })).not.toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('已移入回收站')

    fireEvent.keyDown(document, { key: 'z', metaKey: true })
    await waitFor(() => expect(screen.getByRole('heading', { name: '当天真实 Bot 稿标题' })).toBeInTheDocument())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('fades the deletion toast after 10 seconds without losing Command-Z history', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '早报稿' }))
    expect(await screen.findByRole('heading', { name: '当天真实 Bot 稿标题' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '移出早报稿' }))
    vi.useFakeTimers()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))
    })
    expect(screen.getByRole('status')).toHaveTextContent('已移入回收站')

    await act(async () => { vi.advanceTimersByTime(9650) })
    expect(screen.getByRole('status')).toHaveClass('is-closing')
    await act(async () => { vi.advanceTimersByTime(350) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'z', metaKey: true })
    await act(async () => Promise.resolve())
    expect(screen.getByRole('heading', { name: '当天真实 Bot 稿标题' })).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('shows elevator controls only where movement is possible and keeps the card closed', () => {
    const onOpen = vi.fn()
    const onMoveDown = vi.fn()
    const onMoveBottom = vi.fn()
    const story: Story = {
      id: 'story-1', issue_id: 'issue-1', fingerprint: 'fingerprint-1', title: '测试选题', body: '正文',
      category: '大公司', status: 'ready', selected: true, position: 0, score: 100,
      source_url: '', source_name: '', source_type: '', source_quality: 'primary', confidence: 1,
      cross_day_status: '', rumor: false, fact_status: 'verified', changed_since_review: false,
      image_url: '', image_path: '', image_token: '', editorial_reason: '', metadata: {}, sources: [], claims: [],
    }
    render(<IssueArticle story={story} active={false} canMoveUp={false} canMoveDown onMoveDown={onMoveDown} onMoveBottom={onMoveBottom} onOpen={onOpen} onExclude={() => undefined} onDragStart={() => undefined} onDrop={() => undefined} onDragEnd={() => undefined} />)

    expect(screen.queryByRole('button', { name: '上移一位' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '置顶到当前栏目' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下移一位' }))
    fireEvent.click(screen.getByRole('button', { name: '置底到当前栏目' }))

    expect(onMoveDown).toHaveBeenCalledOnce()
    expect(onMoveBottom).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('moves a story to another category without opening the detail panel', () => {
    const onOpen = vi.fn()
    const onMoveCategory = vi.fn()
    const story: Story = {
      id: 'story-1', issue_id: 'issue-1', fingerprint: 'fingerprint-1', title: '测试选题', body: '正文',
      category: '重磅', status: 'ready', selected: true, position: 0, score: 100,
      source_url: '', source_name: '', source_type: '', source_quality: 'primary', confidence: 1,
      cross_day_status: '', rumor: false, fact_status: 'verified', changed_since_review: false,
      image_url: '', image_path: '', image_token: '', editorial_reason: '', metadata: {}, sources: [], claims: [],
    }
    render(<IssueArticle story={story} active={false} onMoveCategory={onMoveCategory} onOpen={onOpen} onExclude={() => undefined} onDragStart={() => undefined} onDrop={() => undefined} onDragEnd={() => undefined} />)

    fireEvent.change(screen.getByLabelText('移动到其他栏目'), { target: { value: '大公司' } })

    expect(onMoveCategory).toHaveBeenCalledWith('大公司')
    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.queryByRole('option', { name: '重磅' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '观点' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'AI/开发者' })).not.toBeInTheDocument()
  })

  it('restores a discarded story without opening its detail panel', () => {
    const onOpen = vi.fn()
    const onRestore = vi.fn()
    render(<TrashItem story={{ ...staticStory, selected: false, status: 'excluded' }} active={false} disabled={false} onOpen={onOpen} onRestore={onRestore} />)

    fireEvent.click(screen.getByRole('button', { name: '恢复到早报稿' }))

    expect(onRestore).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('opens and closes settings dialog', async () => {
    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: '设置' })[0])
    const card = document.querySelector('.settings-dialog-card') as HTMLElement
    expect(card).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(document.querySelector('.settings-dialog-card')).not.toBeInTheDocument())
  })

  it('uses corner quotes in visible UI copy', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '早报稿' }))
    await screen.findByRole('heading', { name: '当天真实 Bot 稿标题' })

    fireEvent.click(screen.getByRole('button', { name: '候选库' }))
    expect(await screen.findByText(/采用后会先以「待 AI 主编撰写」状态出现在「早报稿」/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/[“”]/)
  })

  it('queues a candidate for the next AI editor run without starting an immediate job', async () => {
    const candidate: Story = {
      ...staticStory,
      id: 'candidate-story',
      fingerprint: 'candidate-fingerprint',
      title: '等待主编撰写的候选',
      body: '',
      category: '大公司',
      selected: false,
      status: 'discovered',
      metadata: { origin: 'runtime_candidate' },
    }
    const connectedIssue = { ...structuredClone(staticIssue), stories: [staticStory, candidate] }
    const health = vi.spyOn(api, 'health').mockResolvedValue({ ok: true, mode: 'local', repo_runtime_access: true, access_mode: 'local' })
    vi.spyOn(api, 'currentIssue').mockResolvedValue(connectedIssue)
    vi.spyOn(api, 'weekend').mockResolvedValue({})
    const patch = vi.spyOn(api, 'patchStory').mockImplementation(async (_id, changes) => ({ ...candidate, ...changes }))
    const action = vi.spyOn(api, 'action')

    render(<App />)
    await waitFor(() => expect(health).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '候选库' }))
    fireEvent.click(await screen.findByRole('button', { name: '提交给 AI 主编撰写' }))

    await waitFor(() => expect(patch).toHaveBeenCalled())
    expect(action).not.toHaveBeenCalled()
    // 提交后保留在候选库，不自动跳转到早报稿或打开详情侧栏。
    expect(screen.getByRole('heading', { name: '待追源与待复核' })).toBeInTheDocument()
    expect(screen.queryByText('待 AI 主编撰写')).not.toBeInTheDocument()
    const changes = patch.mock.calls[0][1]
    expect(changes.selected).toBe(false)
    expect(changes.status).toBe('drafting')
    expect((changes.metadata?._ai_editor_request as Record<string, unknown>).state).toBe('pending')
  })

  it('keeps article copy flowing independently from a tall side image', () => {
    const story: Story = {
      ...staticStory,
      title: '带图稿件',
      body: '第一段正文。\\n\\n第二段正文。',
      image_url: 'https://example.com/tall-image.jpg',
    }
    const { container } = render(<IssueArticle story={story} active={false} onOpen={() => undefined} onExclude={() => undefined} onDragStart={() => undefined} onDrop={() => undefined} onDragEnd={() => undefined} />)

    const layout = container.querySelector('.article-layout-with-image')
    expect(layout).toBeInTheDocument()
    expect(layout?.querySelector('.article-copy .article-body')).toBeInTheDocument()
    expect(layout?.querySelector(':scope > .article-side-image')).toBeInTheDocument()
  })

  it('shows manual image controls while connected and protects static mode', () => {
    const story: Story = {
      id: 'story-image', issue_id: 'issue-1', fingerprint: 'fingerprint-image', title: '带图选题', body: '正文',
      category: '大公司', status: 'ready', selected: true, position: 0, score: 100,
      source_url: '', source_name: '', source_type: '', source_quality: 'primary', confidence: 1,
      cross_day_status: '', rumor: false, fact_status: 'verified', changed_since_review: false,
      image_url: 'https://example.com/image.jpg', image_path: '', image_token: '', editorial_reason: '', metadata: {}, sources: [], claims: [],
    }
    const { rerender } = render(<StoryImageEditor story={story} staticMode={false} onImageChange={() => undefined} />)

    expect(screen.getByRole('button', { name: '替换本地图' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '删除' })).toBeEnabled()
    expect(screen.getByPlaceholderText('粘贴原图 URL')).toBeEnabled()

    rerender(<StoryImageEditor story={story} staticMode onImageChange={() => undefined} />)
    expect(screen.getByRole('button', { name: '替换本地图' })).toBeDisabled()
    expect(screen.getByText('连接 Worker 后才能粘贴或修改配图。')).toBeInTheDocument()
  })

  it('uploads an image pasted from the clipboard while connected', async () => {
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'clipboard.png', { type: 'image/png' })
    const updated = { ...staticStory, image_path: '/tmp/clipboard.png' }
    const upload = vi.spyOn(api, 'uploadStoryImage').mockResolvedValue(updated)
    const onImageChange = vi.fn()
    render(<StoryImageEditor story={staticStory} staticMode={false} onImageChange={onImageChange} />)

    fireEvent.paste(window, {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      },
    })

    await waitFor(() => expect(upload).toHaveBeenCalledWith(staticStory.id, file))
    expect(onImageChange).toHaveBeenCalledWith(updated)
  })
})
