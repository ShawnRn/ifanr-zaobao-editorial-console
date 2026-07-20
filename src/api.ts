import type { AutomationHandoff, BrandPackage, Issue, Job, Story, StoryStatus } from './types'

const fallbackUrl = import.meta.env.VITE_EDITORIAL_API_URL || 'http://127.0.0.1:8765'

export const getApiUrl = () => localStorage.getItem('editorial-api-url') || fallbackUrl

export const setApiUrl = (value: string) => {
  localStorage.setItem('editorial-api-url', value.replace(/\/$/, ''))
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiUrl()}${path}`, {
    ...init,
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
}

export const api = {
  health: () => request<{ ok: boolean; mode: string; repo_runtime_access: boolean }>('/health'),
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
  storyImageUrl: (storyId: string) => `${getApiUrl()}/api/stories/${storyId}/image`,
  handoff: (issueId: string) =>
    request<AutomationHandoff>(`/api/issues/${issueId}/handoff`, { method: 'POST' }),
  weekend: () => request<Record<string, { label: string; candidates: Array<Record<string, unknown>> }>>('/api/weekend-candidates'),
  proposeProfile: () => request<Record<string, unknown>>('/api/editorial-profile/propose', { method: 'POST' }),
  profileProposals: () => request<Array<Record<string, unknown>>>('/api/editorial-profile/proposals'),
}
