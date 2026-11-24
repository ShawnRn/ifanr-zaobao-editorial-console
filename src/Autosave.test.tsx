import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DetailPanel } from './App'
import { WorkerRequestError } from './api'
import type { Story } from './types'

const story = {
  id: 'story-a', issue_id: 'issue-a', title: '原始标题', body: '原始完整正文。', category: '大公司', status: 'ready',
  selected: true, metadata: {}, sources: [], claims: [], updated_at: 'initial',
} as unknown as Story
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const props = { story, staticMode: false, onAction: async () => {}, onClose: vi.fn(), onImageChange: vi.fn() }
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('story autosave', () => {
  it('serializes slow saves and only acknowledges the latest complete input', async () => {
    const first = deferred<Story>(), second = deferred<Story>()
    const patch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    let flush!: () => Promise<void>
    const view = render(<DetailPanel {...props} onPatch={patch} onRegisterFlush={(fn) => { if (fn) flush = fn }} />)
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: '编辑中的第一段。' } })
    await advance(3000)
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: '编辑中的第一段。第二段完整内容。' } })
    // A parent render must not flush the debounce or replace the in-flight writer.
    view.rerender(<DetailPanel {...props} onPatch={patch} />)
    expect(patch).toHaveBeenCalledTimes(1)
    expect(localStorage.removeItem).not.toHaveBeenCalled()
    const savedFirst = { ...story, body: '编辑中的第一段。', updated_at: 'save-1' }
    await act(async () => { first.resolve(savedFirst) })
    expect(patch).toHaveBeenCalledTimes(1)
    await advance(3000)
    expect(patch).toHaveBeenCalledTimes(2)
    expect(patch.mock.calls[1][0].body).toBe('编辑中的第一段。第二段完整内容。')
    expect(patch.mock.calls[1][1].updated_at).toBe('save-1')
    expect(localStorage.removeItem).not.toHaveBeenCalled()
    let exported = false
    const exportWait = flush().then(() => { exported = true })
    await act(async () => { await Promise.resolve() })
    expect(exported).toBe(false)
    await act(async () => { second.resolve({ ...savedFirst, body: '编辑中的第一段。第二段完整内容。' }); await exportWait })
    expect(screen.getByText('已保存')).toBeTruthy()
    expect(exported).toBe(true)
  })

  it('retries a transient failure with the latest input and keeps recovery until acknowledged', async () => {
    const patch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockImplementation(async (changes) => ({ ...story, ...changes }))
    render(<DetailPanel {...props} onPatch={patch} />)
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: '网络中断时的完整输入。' } })
    await advance(3000)
    expect(screen.getByText('保存失败')).toBeTruthy()
    expect(localStorage.removeItem).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: '网络中断时的完整输入。继续追加。' } })
    await advance(3000)
    expect(patch).toHaveBeenLastCalledWith({ body: '网络中断时的完整输入。继续追加。' }, expect.objectContaining({ body: story.body }))
    expect(screen.getByText('已保存')).toBeTruthy()
  })

  it('does not send saves while typing repeatedly with short pauses', async () => {
    const patch = vi.fn().mockImplementation(async (changes) => ({ ...story, ...changes }))
    render(<DetailPanel {...props} onPatch={patch} />)
    const body = screen.getByLabelText('正文')
    for (let index = 0; index < 5; index++) {
      fireEvent.change(body, { target: { value: `持续编辑中的完整内容 ${index}` } })
      await advance(1000)
      expect(patch).not.toHaveBeenCalled()
    }
    await advance(2000)
    expect(patch).toHaveBeenCalledTimes(1)
    expect(patch.mock.calls[0][0].body).toBe('持续编辑中的完整内容 4')
  })

  it('preserves a genuine field conflict without retrying or acknowledging it', async () => {
    const patch = vi.fn().mockRejectedValue(new WorkerRequestError('保存冲突：正文已在另一处被修改', 409))
    render(<DetailPanel {...props} onPatch={patch} />)
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: '保留我的完整版本。' } })
    await advance(20000)
    expect(patch).toHaveBeenCalledTimes(1)
    expect((screen.getByLabelText('正文') as HTMLTextAreaElement).value).toBe('保留我的完整版本。')
    expect(screen.getByRole('alert').textContent).toContain('保存冲突')
    expect(localStorage.removeItem).not.toHaveBeenCalled()
  })

  it('does not save input-method intermediate text', async () => {
    const patch = vi.fn().mockImplementation(async (changes) => ({ ...story, ...changes }))
    render(<DetailPanel {...props} onPatch={patch} />)
    const body = screen.getByLabelText('正文')
    fireEvent.compositionStart(body)
    fireEvent.change(body, { target: { value: '原始完整正文。zhong' } })
    await advance(2000)
    expect(patch).not.toHaveBeenCalled()
    fireEvent.change(body, { target: { value: '原始完整正文。中文输入完成。' } })
    fireEvent.compositionEnd(body)
    await advance(3000)
    expect(patch).toHaveBeenCalledTimes(1)
    expect(patch.mock.calls[0][0].body).toBe('原始完整正文。中文输入完成。')
  })

  it('flushes the previous story to its own callback when switching stories', async () => {
    const first = deferred<Story>()
    const patchA = vi.fn().mockReturnValue(first.promise)
    const patchB = vi.fn().mockImplementation(async (changes) => ({ ...story, id: 'story-b', ...changes }))
    const view = render(<DetailPanel {...props} key="story-a" onPatch={patchA} />)
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: 'A 的完整修改。' } })
    view.rerender(<DetailPanel {...props} key="story-b" story={{ ...story, id: 'story-b', body: 'B 的原稿。' }} onPatch={patchB} />)
    await act(async () => { await Promise.resolve() })
    expect(patchA.mock.calls[0][0].body).toBe('A 的完整修改。')
    expect(patchB).not.toHaveBeenCalled()
    await act(async () => { first.resolve({ ...story, body: 'A 的完整修改。' }) })
    expect((screen.getByLabelText('正文') as HTMLTextAreaElement).value).toBe('B 的原稿。')
  })

  it('updates clean remote fields but retains the baseline of a dirty field', async () => {
    const patch = vi.fn().mockImplementation(async (changes) => ({ ...story, ...changes }))
    const view = render(<DetailPanel {...props} onPatch={patch} />)
    fireEvent.change(screen.getByLabelText('正文'), { target: { value: '我的未保存正文。' } })
    view.rerender(<DetailPanel {...props} story={{ ...story, title: '后台的新标题', body: '另一处改过正文。' }} onPatch={patch} />)
    expect((screen.getByLabelText('标题') as HTMLTextAreaElement).value).toBe('后台的新标题')
    expect((screen.getByLabelText('正文') as HTMLTextAreaElement).value).toBe('我的未保存正文。')
    await advance(3000)
    expect(patch.mock.calls[0][1].body).toBe(story.body)
  })

  it('recovers unsaved input even when the server baseline changed while closed', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify({ title: story.title, body: '未能保存的完整版本。', baseTitle: story.title, baseBody: story.body }))
    const patch = vi.fn().mockRejectedValue(new WorkerRequestError('保存冲突', 409))
    render(<DetailPanel {...props} story={{ ...story, body: '另一处的新版本。' }} onPatch={patch} />)
    await advance(0)
    expect((screen.getByLabelText('正文') as HTMLTextAreaElement).value).toBe('未能保存的完整版本。')
    expect(patch.mock.calls[0][1].body).toBe(story.body)
    expect(localStorage.removeItem).not.toHaveBeenCalled()
  })
})
