import type { Issue } from './types'

export const editingIdleMs = 3000
export type LayoutWrite = { issueId: string; category: string; storyIds: string[] }
export type LayoutSaveState = 'saved' | 'pending' | 'saving' | 'error'
const recoveryKey = (id: string) => `ifanr-editorial-layout-recovery:${id}`
const layoutFingerprint = (issue: Issue) => JSON.stringify(issue.stories.filter(s => s.selected && s.status !== 'excluded').map(s => [s.id, s.category, s.position]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))

// Keep interaction local. Only the final order after an idle period is sent;
// a slow acknowledgement must never replace the user's newer visible order.
export class DeferredLayoutSaver {
  private writes = new Map<string, LayoutWrite>()
  private baselines = new Map<string, string>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private active: Promise<void> | undefined
  private lastActivity = 0
  private force = false
  private retryMs = 1000
  private disposed = false
  constructor(private save: (write: LayoutWrite) => Promise<Issue>, private acknowledge: (issue: Issue) => void,
    private state: (state: LayoutSaveState, message?: string) => void) {}

  get pending() { return this.writes.size > 0 || Boolean(this.active) }
  touch() {
    this.lastActivity = Date.now()
    if (this.writes.size) this.schedule(editingIdleMs)
  }
  enqueue(before: Issue, writes: LayoutWrite[]) {
    if (!this.baselines.has(before.id)) this.baselines.set(before.id, layoutFingerprint(before))
    for (const write of writes) this.writes.set(`${write.issueId}:${write.category}`, write)
    this.persist(before.id)
    this.state('pending')
    this.touch()
  }
  recover(issue: Issue): Issue | undefined {
    if (this.pending) return
    try {
      const raw = localStorage.getItem(recoveryKey(issue.id))
      if (!raw) return
      const data = JSON.parse(raw) as { baseline: string; writes: LayoutWrite[] }
      if (!Array.isArray(data.writes) || !data.writes.length) return
      const known = new Set(issue.stories.filter(s => s.selected && s.status !== 'excluded').map(s => s.id))
      if (data.writes.some(w => w.issueId !== issue.id || !Array.isArray(w.storyIds) || new Set(w.storyIds).size !== w.storyIds.length || w.storyIds.some(id => !known.has(id)))) throw new Error('排序恢复稿与当前条目不一致')
      const positions = new Map(data.writes.flatMap(w => w.storyIds.map((id, position) => [id, { category: w.category, position }] as const)))
      const recovered = { ...issue, stories: issue.stories.map(s => positions.has(s.id) ? { ...s, ...positions.get(s.id) } : s) }
      if (layoutFingerprint(recovered) === layoutFingerprint(issue)) {
        localStorage.removeItem(recoveryKey(issue.id))
        return
      }
      if (data.baseline !== layoutFingerprint(issue)) throw new Error('本机未保存的排序已保留，线上排序也有变化，请先复核')
      this.enqueue(issue, data.writes)
      return recovered
    } catch (error) { this.state('error', error instanceof Error ? error.message : '本机排序恢复失败') }
  }
  private persist(issueId: string) {
    try {
      const writes = [...this.writes.values()].filter(w => w.issueId === issueId)
      if (writes.length) localStorage.setItem(recoveryKey(issueId), JSON.stringify({ baseline: this.baselines.get(issueId), writes }))
      else { localStorage.removeItem(recoveryKey(issueId)); this.baselines.delete(issueId) }
    } catch { /* An unavailable browser cache must not interrupt dragging. */ }
  }
  private schedule(delay: number) {
    if (this.disposed) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = undefined; void this.start().catch(() => undefined) }, delay)
  }
  private start(): Promise<void> {
    if (this.active) return this.active
    this.active = Promise.resolve().then(async () => {
      while (this.writes.size) {
        const remaining = editingIdleMs - (Date.now() - this.lastActivity)
        if (!this.force && remaining > 0) { this.schedule(remaining); break }
        const [key, write] = this.writes.entries().next().value!
        this.state('saving')
        try {
          if (write.storyIds.length) {
            const response = await this.save(write)
            this.baselines.set(write.issueId, layoutFingerprint(response))
            this.acknowledge(response)
          }
          if (this.writes.get(key) === write) this.writes.delete(key)
          this.persist(write.issueId)
          this.retryMs = 1000
        } catch (error) {
          this.state('error', '排序已保留在本机，保存失败后将自动重试')
          this.schedule(this.retryMs)
          this.retryMs = Math.min(this.retryMs * 2, 15000)
          throw error
        }
      }
      this.state(this.writes.size ? 'pending' : 'saved')
    }).finally(() => { this.active = undefined; this.force = false })
    return this.active
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer)
    this.force = true
    await this.start()
    if (this.writes.size) await this.flush()
  }
  resume() { this.disposed = false; if (this.writes.size) this.schedule(editingIdleMs) }
  dispose() { this.disposed = true; clearTimeout(this.timer) }
}
