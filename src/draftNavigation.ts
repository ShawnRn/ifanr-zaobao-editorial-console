export type DraftNavigation = { cancel: () => void }

// Smooth scrolling computes one destination, but deferred editors and images
// change that destination while travelling through a long issue.
export function navigateDraft(
  container: HTMLElement,
  target: () => HTMLElement | null,
  { offset = 24, smooth = true, onFinish }: { offset?: number; smooth?: boolean; onFinish?: () => void } = {},
): DraftNavigation {
  let frame = 0
  let finished = false
  let started = -1
  let goal: number | undefined
  let lastTop = container.scrollTop
  let lastMovement = performance.now()
  let arrived = false

  const finish = (holdPosition = false) => {
    if (finished) return
    finished = true
    window.cancelAnimationFrame(frame)
    container.removeEventListener('wheel', interrupt)
    container.removeEventListener('touchstart', interrupt)
    container.removeEventListener('pointerdown', interrupt)
    window.removeEventListener('keydown', keyInterrupt)
    if (holdPosition && goal !== undefined) container.scrollTo({ top: container.scrollTop, behavior: 'auto' })
    onFinish?.()
  }
  const interrupt = () => finish(true)
  const keyInterrupt = (event: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) interrupt()
  }
  const step = () => {
    if (finished) return
    const now = performance.now()
    if (started < 0) started = now
    if (!container.isConnected) { finish(); return }
    const destination = target()
    if (destination) {
      const position = destination === container ? 0
        : destination.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - offset
      const top = Math.max(0, Math.min(position, container.scrollHeight - container.clientHeight))
      if (goal !== undefined && Math.abs(top - container.scrollTop) <= 1) arrived = true
      if (Math.abs(container.scrollTop - lastTop) > 0.5) lastMovement = now
      lastTop = container.scrollTop
      if (goal === undefined || Math.abs(top - goal) > 1) {
        container.scrollTo({ top, behavior: smooth && !arrived && now - started < 1000 ? 'smooth' : 'auto' })
        goal = top
      } else if (Math.abs(top - container.scrollTop) > 1 && now - lastMovement > 180) {
        // An interrupted native animation must not leave the title offscreen.
        container.scrollTo({ top, behavior: 'auto' })
      }
      if (now - started >= 8000) {
        if (Math.abs(top - container.scrollTop) > 1) container.scrollTo({ top, behavior: 'auto' })
        finish()
        return
      }
    } else if (now - started >= 8000) { finish(); return }
    frame = window.requestAnimationFrame(step)
  }
  container.addEventListener('wheel', interrupt, { passive: true })
  container.addEventListener('touchstart', interrupt, { passive: true })
  container.addEventListener('pointerdown', interrupt, { passive: true })
  window.addEventListener('keydown', keyInterrupt)
  // Let React clear filters and mount the destination editor before measuring.
  frame = window.requestAnimationFrame(() => { frame = window.requestAnimationFrame(step) })
  return { cancel: interrupt }
}

export function revealOutlineItem(container: HTMLElement, item: HTMLElement) {
  const viewport = container.getBoundingClientRect()
  const row = item.getBoundingClientRect()
  const delta = row.top < viewport.top ? row.top - viewport.top
    : row.bottom > viewport.bottom ? row.bottom - viewport.bottom : 0
  if (delta) container.scrollTo({ top: container.scrollTop + delta, behavior: 'auto' })
}
