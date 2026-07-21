import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, IssueArticle, StoryImageEditor } from './App'
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

  it('shows elevator controls only where movement is possible and keeps the card closed', () => {
    const onOpen = vi.fn()
    const onMoveDown = vi.fn()
    const story: Story = {
      id: 'story-1', issue_id: 'issue-1', fingerprint: 'fingerprint-1', title: '测试选题', body: '正文',
      category: '大公司', status: 'ready', selected: true, position: 0, score: 100,
      source_url: '', source_name: '', source_type: '', source_quality: 'primary', confidence: 1,
      cross_day_status: '', rumor: false, fact_status: 'verified', changed_since_review: false,
      image_url: '', image_path: '', image_token: '', editorial_reason: '', metadata: {}, sources: [], claims: [],
    }
    render(<IssueArticle story={story} active={false} canMoveUp={false} canMoveDown onMoveDown={onMoveDown} onOpen={onOpen} onExclude={() => undefined} onDragStart={() => undefined} onDrop={() => undefined} />)

    expect(screen.queryByRole('button', { name: '上移一位' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下移一位' }))

    expect(onMoveDown).toHaveBeenCalledOnce()
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
