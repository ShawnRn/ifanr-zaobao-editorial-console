import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, IssueArticle, StoryImageEditor, TrashItem } from './App'
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
  it('falls back to the current real Bot draft snapshot while the worker is offline', async () => {
    render(<App />)
    expect(screen.getByText('早报编辑台')).toBeInTheDocument()
    expect(screen.getByText('双品牌')).toBeInTheDocument()
    expect((await screen.findAllByText('Pages 快照')).length).toBeGreaterThan(0)
    expect(await screen.findByText('当天真实 Bot 稿标题')).toBeInTheDocument()
    expect(screen.getByText('当天飞书 Bot 稿 · 1 条 · Pages 只读快照')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '连接设置' }).length).toBeGreaterThan(0)
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
    render(<IssueArticle story={story} active={false} onOpen={onOpen} onExclude={onExclude} onDragStart={() => undefined} onDrop={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: '移出早报稿' }))

    expect(onExclude).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('ignores zero-width placeholder lines instead of rendering empty paragraphs', () => {
    const story = {
      ...staticStory,
      body: '\u200b\n\n第一段。\n\n\u200b\n\n第二段。\n\n\uFEFF',
    }
    const { container } = render(<IssueArticle story={story} active={false} onOpen={() => undefined} onExclude={() => undefined} onDragStart={() => undefined} onDrop={() => undefined} />)

    const paragraphs = container.querySelectorAll('.article-body p')
    expect(paragraphs).toHaveLength(2)
    expect([...paragraphs].map((paragraph) => paragraph.textContent)).toEqual(['第一段。', '第二段。'])
  })

  it('asks for confirmation before deletion and restores it with Command-Z', async () => {
    render(<App />)
    expect(await screen.findByText('当天真实 Bot 稿标题')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '移出早报稿' }))
    expect(screen.getByRole('dialog', { name: '确定删除这个选题？' })).toBeInTheDocument()
    expect(screen.getByText('当天真实 Bot 稿标题')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '确定删除这个选题？' })).not.toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('已移入回收站')

    fireEvent.keyDown(document, { key: 'z', metaKey: true })
    await waitFor(() => expect(screen.getByText('当天真实 Bot 稿标题')).toBeInTheDocument())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
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
    render(<IssueArticle story={story} active={false} canMoveUp={false} canMoveDown onMoveDown={onMoveDown} onMoveBottom={onMoveBottom} onOpen={onOpen} onExclude={() => undefined} onDragStart={() => undefined} onDrop={() => undefined} />)

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
    render(<IssueArticle story={story} active={false} onMoveCategory={onMoveCategory} onOpen={onOpen} onExclude={() => undefined} onDragStart={() => undefined} onDrop={() => undefined} />)

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

  it('closes settings after an outside click with an exit animation', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '连接设置' }))
    const popover = document.querySelector('.settings-popover') as HTMLElement
    expect(popover).toBeInTheDocument()

    fireEvent.pointerDown(document.body)
    expect(popover).toHaveClass('closing')
    fireEvent.animationEnd(popover)

    await waitFor(() => expect(document.querySelector('.settings-popover')).not.toBeInTheDocument())
  })

  it('uses corner quotes in visible UI copy', async () => {
    render(<App />)
    await screen.findByText('当天真实 Bot 稿标题')

    fireEvent.click(screen.getByRole('button', { name: '候选库' }))
    expect(screen.getByText(/采用后会先以「待 AI 主编撰写」状态出现在「早报稿」/)).toBeInTheDocument()
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
    expect(await screen.findByText('待 AI 主编撰写')).toBeInTheDocument()
    expect(screen.getByText('已提交给 AI 主编，等待下一轮追源、核验并按早报 prompt 成稿。')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '等待主编撰写的候选' })).toBeInTheDocument()
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
    const { container } = render(<IssueArticle story={story} active={false} onOpen={() => undefined} onExclude={() => undefined} onDragStart={() => undefined} onDrop={() => undefined} />)

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
