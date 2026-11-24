import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeferredLayoutSaver, editingIdleMs, type LayoutWrite } from './deferredLayout'
import type { Issue } from './types'

const issue = { id: 'issue-a', revision: 1, stories: [
  { id: 'a', selected: true, status: 'ready', category: '大公司', position: 0 },
  { id: 'b', selected: true, status: 'ready', category: '大公司', position: 1 },
] } as Issue
const write = (ids: string[]): LayoutWrite => ({ issueId: issue.id, category: '大公司', storyIds: ids })
const later = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
let storage: Map<string, string>
beforeEach(() => {
  vi.useFakeTimers()
  storage = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('deferred layout saving', () => {
  it('coalesces repeated arranging into the final order after three idle seconds', async () => {
    const save = vi.fn().mockResolvedValue({ ...issue, revision: 2 })
    const saver = new DeferredLayoutSaver(save, vi.fn(), vi.fn())
    saver.enqueue(issue, [write(['b', 'a'])])
    await vi.advanceTimersByTimeAsync(2000)
    saver.enqueue(issue, [write(['a', 'b'])])
    await vi.advanceTimersByTimeAsync(2000)
    saver.enqueue(issue, [write(['b', 'a'])])
    await vi.advanceTimersByTimeAsync(editingIdleMs - 1)
    expect(save).not.toHaveBeenCalled()
    expect(storage.size).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledExactlyOnceWith(write(['b', 'a']))
    expect(saver.pending).toBe(false)
    expect(storage.size).toBe(0)
  })
  it('allows another drag during a slow save and defers that newer order until idle', async () => {
    const first = later<Issue>()
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ ...issue, revision: 3 })
    const saver = new DeferredLayoutSaver(save, vi.fn(), vi.fn())
    saver.enqueue(issue, [write(['b', 'a'])])
    await vi.advanceTimersByTimeAsync(editingIdleMs)
    saver.enqueue(issue, [write(['a', 'b'])])
    first.resolve({ ...issue, revision: 2 })
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(1)
    expect(saver.pending).toBe(true)
    expect(storage.size).toBe(1)
    await vi.advanceTimersByTimeAsync(editingIdleMs)
    expect(save).toHaveBeenLastCalledWith(write(['a', 'b']))
    expect(saver.pending).toBe(false)
  })
  it('keeps failed adjustments in recovery and retries the latest order', async () => {
    const save = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(issue)
    const state = vi.fn()
    const saver = new DeferredLayoutSaver(save, vi.fn(), state)
    saver.enqueue(issue, [write(['b', 'a'])])
    await vi.advanceTimersByTimeAsync(editingIdleMs)
    expect(storage.size).toBe(1)
    expect(state).toHaveBeenCalledWith('error', expect.any(String))
    saver.enqueue(issue, [write(['a', 'b'])])
    await vi.advanceTimersByTimeAsync(editingIdleMs)
    expect(save).toHaveBeenLastCalledWith(write(['a', 'b']))
    expect(storage.size).toBe(0)
  })
  it('flushes the final order immediately when explicitly saving or exporting', async () => {
    const save = vi.fn().mockResolvedValue(issue)
    const saver = new DeferredLayoutSaver(save, vi.fn(), vi.fn())
    saver.enqueue(issue, [write(['b', 'a'])])
    await saver.flush()
    expect(save).toHaveBeenCalledExactlyOnceWith(write(['b', 'a']))
    saver.dispose()
  })
  it('recovers local order after reopening when the server layout is unchanged', () => {
    const first = new DeferredLayoutSaver(vi.fn(), vi.fn(), vi.fn())
    first.enqueue(issue, [write(['b', 'a'])]); first.dispose()
    const next = new DeferredLayoutSaver(vi.fn(), vi.fn(), vi.fn())
    const recovered = next.recover(issue)!
    expect(recovered.stories.find(s => s.id === 'b')?.position).toBe(0)
    expect(next.pending).toBe(true)
    next.dispose()
  })
  it('retains recovery without overwriting an external layout change', () => {
    const first = new DeferredLayoutSaver(vi.fn(), vi.fn(), vi.fn())
    first.enqueue(issue, [write(['b', 'a'])]); first.dispose()
    const state = vi.fn()
    const next = new DeferredLayoutSaver(vi.fn(), vi.fn(), state)
    expect(next.recover({ ...issue, stories: issue.stories.map(s => ({ ...s, category: '新产品' })) })).toBeUndefined()
    expect(state).toHaveBeenCalledWith('error', expect.stringContaining('线上排序也有变化'))
    expect(storage.size).toBe(1)
  })
})
