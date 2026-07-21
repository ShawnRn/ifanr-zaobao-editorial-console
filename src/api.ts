import type { AutomationHandoff, BrandPackage, Issue, Job, Story, StoryStatus } from './types'

const fallbackUrl = import.meta.env.VITE_EDITORIAL_API_URL || 'http://127.0.0.1:8765'

export type WorkerHealth = {
  ok: boolean
  mode: string
  repo_runtime_access: boolean
  access_mode: 'local' | 'tailscale'
  identity?: string | null
  time?: string
}

export const normalizeApiUrl = (value: string) => {
  const raw = value.trim()
  if (!raw) throw new Error('请输入 Worker URL')
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  const url = new URL(withScheme)
  if (url.hostname.endsWith('.ts.net') && url.protocol === 'http:') url.protocol = 'https:'
  if (url.hostname.endsWith('.ts.net') && url.port === '8765') url.port = ''
  url.pathname = url.pathname.replace(/\/$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

export const apiUrlProblem = (value: string, pageProtocol = window.location.protocol) => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'Worker URL 格式不正确'
  }
  if (pageProtocol === 'https:' && url.protocol !== 'https:') {
    return 'GitHub Pages 无法连接 HTTP Worker；请使用 Tailscale Serve 的 HTTPS 地址'
  }
  if (url.hostname.endsWith('.ts.net') && url.port === '8765') {
    return 'Tailscale Serve 请填写 HTTPS 根地址，不要附加 :8765'
  }
  return ''
}

export const getApiUrl = () => localStorage.getItem('editorial-api-url') || fallbackUrl

export const setApiUrl = (value: string) => {
  localStorage.setItem('editorial-api-url', normalizeApiUrl(value))
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 1400)
  try {
    const response = await fetch(`${getApiUrl()}${path}`, {
      ...init,
      signal: init?.signal || controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(payload.detail || response.statusText)
    }
    return response.json() as Promise<T>
  } finally {
    window.clearTimeout(timeout)
  }
}

async function mediaRequest<T>(path: string, init: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 45000)
  try {
    const response = await fetch(`${getApiUrl()}${path}`, { ...init, signal: controller.signal })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(payload.detail || response.statusText)
    }
    return response.json() as Promise<T>
  } finally {
    window.clearTimeout(timeout)
  }
}

export const api = {
  health: () => request<WorkerHealth>('/health'),
  currentIssue: () => request<Issue>('/api/issues/current'),
  importLatest: () => request<Issue>('/api/issues/import', { method: 'POST', body: '{}' }),
  getIssue: (id: string) => request<Issue>(`/api/issues/${id}`),
  refreshIssue: (id: string, runPreflight: boolean) =>
    request<Job>(`/api/issues/${id}/refresh`, {
      method: 'POST',
      body: JSON.stringify({ edition: 'noon', run_preflight: runPreflight, max_candidates: 320 }),
    }),
  patchStory: (id: string, patch: Partial<Story> & { status?: StoryStatus }) =>
    request<Story>(`/api/stories/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  reorder: (issueId: string, storyIds: string[], category?: string) =>
    request<Issue>(`/api/issues/${issueId}/reorder`, {
      method: 'POST',
      body: JSON.stringify({ story_ids: storyIds, category }),
    }),
  action: (id: string, action: string, useChrome = false, instruction = '') =>
    request<Job>(`/api/stories/${id}/actions/${action}`, {
      method: 'POST',
      body: JSON.stringify({ use_chrome: useChrome, instruction }),
    }),
  job: (id: string) => request<Job>(`/api/jobs/${id}`),
  watchJob: (id: string, onUpdate: (job: Job) => void) => new Promise<Job>((resolve, reject) => {
    const stream = new EventSource(`${getApiUrl()}/api/jobs/${id}/events`)
    stream.addEventListener('progress', (event) => {
      const job = JSON.parse((event as MessageEvent).data) as Job
      onUpdate(job)
      if (job.state === 'completed' || job.state === 'failed') {
        stream.close()
        resolve(job)
      }
    })
    stream.addEventListener('error', () => {
      stream.close()
      reject(new Error('任务进度连接中断'))
    })
  }),
  patchBrand: (issueId: string, brand: 'appso' | 'ifanr', patch: Partial<BrandPackage>) =>
    request<BrandPackage>(`/api/issues/${issueId}/brands/${brand}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  generateBrand: (issueId: string, brand: 'appso' | 'ifanr') =>
    request<Job>(`/api/issues/${issueId}/brands/${brand}/generate`, { method: 'POST' }),
  markdownUrl: (issueId: string) => `${getApiUrl()}/api/issues/${issueId}/markdown`,
  storyImageUrl: (storyId: string, version = '') => `${getApiUrl()}/api/stories/${storyId}/image${version ? `?v=${encodeURIComponent(version)}` : ''}`,
  uploadStoryImage: (storyId: string, file: File) => mediaRequest<Story>(`/api/stories/${storyId}/image/upload`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  }),
  downloadStoryImage: (storyId: string, url: string) => mediaRequest<Story>(`/api/stories/${storyId}/image/from-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  }),
  deleteStoryImage: (storyId: string) => mediaRequest<Story>(`/api/stories/${storyId}/image`, { method: 'DELETE' }),
  handoff: (issueId: string) =>
    request<AutomationHandoff>(`/api/issues/${issueId}/handoff`, { method: 'POST' }),
  weekend: () => request<Record<string, { label: string; candidates: Array<Record<string, unknown>> }>>('/api/weekend-candidates'),
  proposeProfile: () => request<Record<string, unknown>>('/api/editorial-profile/propose', { method: 'POST' }),
  profileProposals: () => request<Array<Record<string, unknown>>>('/api/editorial-profile/proposals'),
}
