import type { AutomationHandoff, BrandPackage, Issue, Job, Story, StoryCreateInput, StoryStatus } from './types'

const fallbackUrl = import.meta.env.VITE_EDITORIAL_API_URL || 'http://111.228.56.220:8765'
export const lanConsoleUrl = import.meta.env.VITE_EDITORIAL_LAN_URL || 'http://111.228.56.220:8765'
// GitHub Pages is a public, static delivery target. This build-time flag keeps
// its security boundary explicit instead of inferring it from mutable browser state.
export const isPagesDeployment = import.meta.env.VITE_EDITORIAL_DEPLOYMENT === 'pages'

const isWorkerOrigin = () => window.location.hostname.endsWith('.ts.net') || window.location.port === '8765'

const runtimeDefaultUrl = () => isWorkerOrigin() ? window.location.origin : fallbackUrl

const staticAssetUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

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
  if (/^100\.(?:6[4-9]|[78]\d|9\d|1[01]\d|12[0-7])\./.test(url.hostname)) {
    return 'Tailscale IP 无法匹配 HTTPS 证书；请使用 .ts.net 域名'
  }
  return ''
}

export const getApiUrl = () => isWorkerOrigin()
  ? window.location.origin
  : localStorage.getItem('editorial-api-url') || runtimeDefaultUrl()

export const resolveApiAssetUrl = (path: string) => {
  if (!path) return ''
  if (/^https?:\/\//i.test(path)) return path
  return `${getApiUrl().replace(/\/$/, '')}/${path.replace(/^\/+/, '')}`
}

// The Tailscale address is tailnet-specific. Do not keep a bare 100.x IP as
// a fallback: it cannot present Tailscale's HTTPS certificate and would make
// the "direct console" escape hatch fail from GitHub Pages.
export const getTailscaleConsoleUrl = () => {
  const configured = import.meta.env.VITE_EDITORIAL_TAILSCALE_URL || getApiUrl()
  try {
    const normalized = normalizeApiUrl(configured)
    return new URL(normalized).hostname.endsWith('.ts.net') ? normalized : ''
  } catch {
    return ''
  }
}

export const setApiUrl = (value: string) => {
  localStorage.setItem('editorial-api-url', normalizeApiUrl(value))
}

type LocalNetworkRequestInit = RequestInit & {
  targetAddressSpace?: 'local'
}

export const workerFetchOptions = (baseUrl: string): LocalNetworkRequestInit => {
  try {
    const url = new URL(baseUrl)
    // Tailscale Serve is always called over its certificate-backed HTTPS
    // address. Declaring it as a local-network request needlessly invokes
    // Chrome's Local Network Access permission prompt on GitHub Pages.
    // That declaration is only useful when an HTTPS page must call an HTTP
    // local endpoint to bypass mixed-content protection.
    if (url.hostname.endsWith('.ts.net') && url.protocol === 'http:') {
      return { targetAddressSpace: 'local' }
    }
    return {}
  } catch {
    return {}
  }
}

export const describeWorkerError = (error: unknown) => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'Worker 连接超时；请确认两台 Mac 都已连接 Tailscale'
  }
  const message = error instanceof Error ? error.message : String(error || '未知错误')
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return '浏览器阻止了 Worker 请求；请允许本站访问「本地网络」，并确认 Air 已连接 Tailscale'
  }
  return message
}

const getCookie = (name: string) => {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
  return match ? decodeURIComponent(match[2]) : ''
}

export const getAuthToken = () => localStorage.getItem('editorial-auth-token') || getCookie('editorial_auth_token') || ''
export const setAuthToken = (token: string) => {
  if (token) {
    localStorage.setItem('editorial-auth-token', token)
    document.cookie = `editorial_auth_token=${encodeURIComponent(token)}; path=/; max-age=31536000; SameSite=Lax`
  } else {
    localStorage.removeItem('editorial-auth-token')
    document.cookie = 'editorial_auth_token=; path=/; max-age=0; SameSite=Lax'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 10000)
  const baseUrl = getApiUrl()
  const token = getAuthToken()
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...workerFetchOptions(baseUrl),
      credentials: 'include',
      ...init,
      signal: init?.signal || controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  const baseUrl = getApiUrl()
  const token = getAuthToken()
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...workerFetchOptions(baseUrl),
      ...init,
      signal: controller.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
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

export const api = {
  health: () => request<WorkerHealth>('/health'),
  currentIssue: (scope: 'full' | 'draft' = 'full') => request<Issue>(`/api/issues/current${scope === 'draft' ? '?scope=draft' : ''}`),
  currentIssueVersion: () => request<{ id: string; publication_date: string; revision: number; updated_at: string }>('/api/issues/current/version'),
  staticIssue: async () => {
    const response = await fetch(`${staticAssetUrl('data/current-issue.json')}?v=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) throw new Error('Pages 尚未生成当天早报快照')
    return response.json() as Promise<Issue>
  },
  importLatest: () => request<Issue>('/api/issues/import', { method: 'POST', body: '{}' }),
  getIssue: (id: string) => request<Issue>(`/api/issues/${id}`),
  createStory: (issueId: string, story: StoryCreateInput) =>
    request<Story>(`/api/issues/${issueId}/stories`, { method: 'POST', body: JSON.stringify(story) }),
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
  resolveStoryImage: (storyId: string) => mediaRequest<Story>(`/api/stories/${storyId}/image/from-sources`, { method: 'POST' }),
  deleteStoryImage: (storyId: string) => mediaRequest<Story>(`/api/stories/${storyId}/image`, { method: 'DELETE' }),
  handoff: (issueId: string) =>
    request<AutomationHandoff>(`/api/issues/${issueId}/handoff`, { method: 'POST' }),
  publishToLark: (issueId: string) =>
    request<Job>(`/api/issues/${issueId}/lark-publish`, { method: 'POST' }),
  weekend: () => request<Record<string, { label: string; candidates: Array<Record<string, unknown>> }>>('/api/weekend-candidates'),
  proposeProfile: () => request<Record<string, unknown>>('/api/editorial-profile/propose', { method: 'POST' }),
  profileProposals: () => request<Array<Record<string, unknown>>>('/api/editorial-profile/proposals'),
  authStatus: () => request<{ require_auth: boolean; authenticated: boolean; read_only: boolean; username?: string | null; has_2fa: boolean; recovery_codes_remaining?: number | null; avatar_url?: string | null }>('/api/auth/status'),
  authUploadAvatar: (file: File) => mediaRequest<{ ok: boolean; avatar_url: string }>('/api/auth/avatar', {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  }),
  authDeleteAvatar: () => mediaRequest<{ ok: boolean; avatar_url: null }>('/api/auth/avatar', { method: 'DELETE' }),
  authLogin: (username: string, passwordHash: string, totpCode = '') => request<{ ok: boolean; token: string; username?: string; read_only: boolean; message?: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password_hash: passwordHash, totp_code: totpCode }) }),
  authSetup2FA: () => request<{ secret: string; otpauth_url: string }>('/api/auth/2fa/setup', { method: 'POST' }),
  authEnable2FA: (code: string) => request<{ ok: boolean; has_2fa: boolean; token: string; recovery_codes: string[]; recovery_codes_remaining: number }>('/api/auth/2fa/enable', {
    method: 'POST',
    body: JSON.stringify({ code }),
  }),
  authDisable2FA: (code: string) => request<{ ok: boolean; has_2fa: boolean; token: string }>('/api/auth/2fa/disable', {
    method: 'POST',
    body: JSON.stringify({ code }),
  }),
  authChangePassword: (username: string, currentPasswordHash: string, newPasswordHash: string) =>
    request<{ ok: boolean; token: string; username?: string; read_only: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        username,
        current_password_hash: currentPasswordHash,
        new_password_hash: newPasswordHash,
      }),
    }),
  authLogout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
}
