import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, IssueArticle } from './App'
import type { Story } from './types'

vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: false,
  statusText: 'offline',
  json: async () => ({ detail: 'offline' }),
})))
vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
})

afterEach(cleanup)

describe('App', () => {
  it('renders the operational shell while the worker is offline', async () => {
    render(<App />)
    expect(screen.getByText('早报编辑台')).toBeInTheDocument()
    expect(screen.getByText('双品牌')).toBeInTheDocument()
    expect((await screen.findAllByText('Worker 未连接')).length).toBeGreaterThan(0)
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
})
