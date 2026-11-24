// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { navigateDraft, revealOutlineItem } from './draftNavigation'

let now = 0
let nextId = 0
let frames: Map<number, FrameRequestCallback>
const tick = (duration = 16) => {
  now += duration
  const pending = [...frames.values()]
  frames.clear()
  for (const callback of pending) callback(now)
}

function fixture() {
  const container = document.createElement('main')
  const target = document.createElement('article')
  container.append(target)
  document.body.append(container)
  let targetTop = 5000
  Object.defineProperties(container, { scrollHeight: { value: 10000, configurable: true }, clientHeight: { value: 800 } })
  container.getBoundingClientRect = () => ({ top: 62, bottom: 862 } as DOMRect)
  target.getBoundingClientRect = () => ({ top: 62 + targetTop - container.scrollTop } as DOMRect)
  const scroll = vi.fn((options: ScrollToOptions) => { if (options.behavior !== 'smooth') container.scrollTop = options.top || 0 })
  container.scrollTo = scroll
  return { container, target, scroll, shift: (top: number) => { targetTop = top } }
}

beforeEach(() => {
  now = 0
  nextId = 0
  frames = new Map()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++nextId, callback); return nextId })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
})
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

describe('draft directory navigation', () => {
  it('corrects layout growth while travelling and finishes at the current title', () => {
    const { container, target, scroll, shift } = fixture()
    const finished = vi.fn()
    navigateDraft(container, () => target, { onFinish: finished })
    tick(); tick()
    expect(scroll).toHaveBeenLastCalledWith({ top: 4976, behavior: 'smooth' })
    container.scrollTop = 2000
    shift(9000) // Deferred editors above the destination become taller.
    tick()
    expect(scroll).toHaveBeenLastCalledWith({ top: 8976, behavior: 'smooth' })
    for (let i = 0; i < 600; i++) tick()
    expect(container.scrollTop).toBe(8976)
    expect(finished).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
  })

  it('lets manual scrolling immediately cancel all subsequent corrections', () => {
    const { container, target, scroll, shift } = fixture()
    navigateDraft(container, () => target)
    tick(); tick()
    container.dispatchEvent(new WheelEvent('wheel'))
    const calls = scroll.mock.calls.length
    container.scrollTop = 1200
    shift(8000)
    for (let i = 0; i < 250; i++) tick()
    expect(container.scrollTop).toBe(1200)
    expect(scroll).toHaveBeenCalledTimes(calls)
  })

  it('clamps short final articles and cancels a replaced navigation', () => {
    const { container, target, shift } = fixture()
    const first = navigateDraft(container, () => target)
    tick(); tick()
    first.cancel()
    shift(9900)
    navigateDraft(container, () => target, { smooth: false })
    tick(); tick()
    expect(container.scrollTop).toBe(9200)
    for (let i = 0; i < 600; i++) tick()
    expect(container.scrollTop).toBe(9200)
  })

  it('reveals the highlighted directory row only within its own scroll container', () => {
    const { container, target, scroll } = fixture()
    target.getBoundingClientRect = () => ({ top: 950, bottom: 990 } as DOMRect)
    const globalScroll = vi.fn()
    target.scrollIntoView = globalScroll
    revealOutlineItem(container, target)
    expect(scroll).toHaveBeenCalledWith({ top: 128, behavior: 'auto' })
    expect(globalScroll).not.toHaveBeenCalled()
  })

  it('keeps the destination aligned when late content loads after the first animation', () => {
    const { container, target, shift } = fixture()
    navigateDraft(container, () => target, { smooth: false })
    for (let i = 0; i < 260; i++) tick()
    expect(container.scrollTop).toBe(4976)
    shift(8700)
    tick()
    expect(container.scrollTop).toBe(8676)
    for (let i = 0; i < 350; i++) tick()
    expect(frames.size).toBe(0)
  })
})
