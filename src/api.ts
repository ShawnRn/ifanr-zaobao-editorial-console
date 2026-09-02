import type { AutomationHandoff, BrandPackage, FlashDraftItem, Issue, IssueSummary, Job, SocialPost, SocialPostInput, Story, StoryCreateInput, StoryStatus } from './types'

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

type FlashDraftRecord = {
  id: string
  user_id: string
  title: string
  body: string
  category: string
  source_url: string
  image_url: string
  content: string
  key_points: string[]
  published_doc: { document_url?: string; document_title?: string }
  author_name: string
  updated_at_ms: number
  created_at: string
  updated_at: string
}

export const flashDraftFromRecord = (record: FlashDraftRecord): FlashDraftItem => ({
  id: record.id,
  title: record.title,
  body: record.body,
  category: record.category,
  sourceUrl: record.source_url || undefined,
  imageUrl: record.image_url || undefined,
  content: record.content || undefined,
  keyPoints: record.key_points || [],
  publishedDoc: record.published_doc?.document_url && record.published_doc?.document_title
    ? {
        document_url: record.published_doc.document_url,
        document_title: record.published_doc.document_title,
      }
    : undefined,
  updatedAt: record.updated_at_ms,
  authorName: record.author_name || undefined,
})

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

export class WorkerRequestError extends Error {
  status: number
  code: string

  constructor(message: string, status: number, code = '') {
    super(message)
    this.name = 'WorkerRequestError'
    this.status = status
    this.code = code
  }
}

function requestError(payload: { detail?: unknown; code?: unknown }, status: number, statusText: string) {
  const detail = payload.detail
  const nested = detail && typeof detail === 'object' ? detail as { message?: unknown; code?: unknown } : null
  const message = nested ? String(nested.message || statusText) : String(detail || statusText)
  const code = String(nested?.code || payload.code || '')
  return new WorkerRequestError(message, status, code)
}

async function readJsonResponse<T>(response: Response, source: string): Promise<T> {
  const contentType = response.headers?.get?.('content-type') || ''
  if (contentType && !/\b(?:application|text)\/(?:[\w.+-]*\+)?json\b/i.test(contentType)) {
    throw new WorkerRequestError(`${source}返回了网页而不是 JSON；请检查 Worker URL 是否指向 API 根地址`, response.status)
  }
  try {
    return await response.json() as T
  } catch {
    throw new WorkerRequestError(`${source}没有返回有效 JSON；请检查 Worker URL 是否指向 API 根地址`, response.status)
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
      throw requestError(payload, response.status, response.statusText)
    }
    return readJsonResponse<T>(response, 'Worker')
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
      throw requestError(payload, response.status, response.statusText)
    }
    return readJsonResponse<T>(response, 'Worker')
  } finally {
    window.clearTimeout(timeout)
  }
}

export const api = {
  health: () => request<WorkerHealth>('/health'),
  currentIssue: (scope: 'full' | 'draft' = 'full') => request<Issue>(`/api/issues/current${scope === 'draft' ? '?scope=draft' : ''}`),
  currentIssueVersion: () => request<{ id: string; publication_date: string; revision: number; updated_at: string }>('/api/issues/current/version'),
  recentIssues: (days = 3) => request<IssueSummary[]>(`/api/issues/recent?days=${days}`),
  staticIssue: async () => {
    const response = await fetch(`${staticAssetUrl('data/current-issue.json')}?v=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) throw new Error('Pages 尚未生成当天早报快照')
    return readJsonResponse<Issue>(response, 'Pages 快照')
  },
  importLatest: () => request<Issue>('/api/issues/import', { method: 'POST', body: '{}' }),
  getIssue: (id: string) => request<Issue>(`/api/issues/${id}`),
  socialPosts: (issueId: string) => request<SocialPost[]>(`/api/issues/${issueId}/social-posts?platform=weibo`),
  flashDrafts: async () => (await request<FlashDraftRecord[]>('/api/flash-drafts')).map(flashDraftFromRecord),
  upsertFlashDraft: async (draft: FlashDraftItem) => flashDraftFromRecord(await request<FlashDraftRecord>(`/api/flash-drafts/${encodeURIComponent(draft.id)}`, {
    method: 'PUT',
    body: JSON.stringify({
      title: draft.title,
      body: draft.body,
      category: draft.category,
      source_url: draft.sourceUrl || '',
      image_url: draft.imageUrl || '',
      content: draft.content || '',
      key_points: draft.keyPoints || [],
      published_doc: draft.publishedDoc || {},
      updated_at_ms: draft.updatedAt,
    }),
  })),
  deleteFlashDraft: (draftId: string) => request<{ ok: boolean }>(`/api/flash-drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' }),
  upsertSocialPost: (issueId: string, post: SocialPostInput) =>
    request<SocialPost>(`/api/issues/${issueId}/social-posts`, { method: 'POST', body: JSON.stringify({ platform: 'weibo', ...post }) }),
  patchSocialPost: (postId: string, patch: Partial<SocialPostInput>) =>
    request<SocialPost>(`/api/social-posts/${postId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  markSocialPostPublished: (postId: string) =>
    request<SocialPost>(`/api/social-posts/${postId}/publish`, { method: 'POST' }),
  deleteSocialPost: (postId: string) => request<{ ok: boolean }>(`/api/social-posts/${postId}`, { method: 'DELETE' }),
  recordSocialPostMetrics: (postId: string, metrics: {
    published_url: string
    published_at?: string
    reposts_count?: number | null
    comments_count?: number | null
    attitudes_count?: number | null
    reads_count?: number | null
    captured_at?: string
    source?: string
  }) => request<SocialPost>(`/api/social-posts/${postId}/metrics`, { method: 'POST', body: JSON.stringify(metrics) }),
  createStory: (issueId: string, story: StoryCreateInput) =>
    request<Story>(`/api/issues/${issueId}/stories`, { method: 'POST', body: JSON.stringify(story) }),
  refreshIssue: (id: string, runPreflight: boolean) =>
    request<Job>(`/api/issues/${id}/refresh`, {
      method: 'POST',
      body: JSON.stringify({ edition: 'noon', run_preflight: runPreflight, max_candidates: 320 }),
    }),
  patchStory: (id: string, patch: Partial<Story> & { status?: StoryStatus; confirm_delete?: boolean; expected_updated_at?: string; expected_fields?: Record<string, unknown> }) =>
    request<Story>(`/api/stories/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  resolveRelatedLink: (id: string, url: string) =>
    request<{ title: string; url: string }>(`/api/stories/${id}/related-link`, { method: 'POST', body: JSON.stringify({ url }) }),
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
  publishToLark: (issueId: string, expectedRevision: number) =>
    request<Job>(`/api/issues/${issueId}/lark-publish`, {
      method: 'POST',
      body: JSON.stringify({ expected_revision: expectedRevision }),
    }),
  publishFlashNewsToLark: (payload: {
    title: string
    body: string
    image_url?: string
    image_path?: string
    source_url?: string
    related_links?: Array<[string, string]>
  }) => request<{
    ok: boolean
    document_ref: string
    document_url: string
    document_title: string
    permission?: Record<string, unknown>
  }>('/api/flash-news/publish-lark', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  extractUrlsContent: (payload: { urls?: string[]; raw_text?: string }) =>
    mediaRequest<{
      ok: boolean
      items: Array<{
        url: string
        title: string
        content: string
        image_url: string
        site_name: string
      }>
      merged_title: string
      merged_content: string
      primary_image_url: string
      primary_source_url: string
      errors?: Array<{ url: string; error: string }>
    }>('/api/tools/extract-urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  researchStory: (payload: { title: string; source_urls?: string[]; max_results?: number }) =>
    request<{
      ok: boolean
      query: string
      search_provider: 'hub_web_search' | 'bing_news_fallback'
      results: Array<{
        title: string
        url: string
        snippet?: string
        content?: string
        image_url?: string
        site_name?: string
      }>
      research_content: string
      errors?: Array<{ url: string; error: string }>
    }>('/api/tools/research-story', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  weekend: () => request<Record<string, { label: string; candidates: Array<Record<string, unknown>> }>>('/api/weekend-candidates'),
  proposeProfile: () => request<Record<string, unknown>>('/api/editorial-profile/propose', { method: 'POST' }),
  authStatus: () =>
    request<{
      require_auth: boolean
      authenticated: boolean
      read_only: boolean
      user_id?: string | null
      username?: string | null
      display_name?: string | null
      feishu_user_id?: string | null
      feishu_name?: string | null
      role?: string | null
      permissions?: string[] | null
      is_admin?: boolean
      has_2fa: boolean
      recovery_codes_remaining?: number | null
      avatar_url?: string | null
    }>('/api/auth/status'),
  authUploadAvatar: (file: File) => mediaRequest<{ ok: boolean; avatar_url: string }>('/api/auth/avatar', {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  }),
  authDeleteAvatar: () => mediaRequest<{ ok: boolean; avatar_url: null }>('/api/auth/avatar', { method: 'DELETE' }),
  authChangePassword: (username: string, currentPasswordHash: string, newPasswordHash: string) =>
    request<{ ok: boolean; token: string }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        username,
        current_password_hash: currentPasswordHash,
        new_password_hash: newPasswordHash,
      }),
    }),
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
  authFeishuUrl: () => request<{ ok: boolean; configured: boolean; url: string; message?: string }>('/api/auth/feishu/auth-url'),
  authFeishuBind: (payload: { feishu_user_id: string; feishu_name?: string }) =>
    request<{ ok: boolean; feishu_user_id: string; feishu_name: string }>('/api/auth/feishu/bind', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  authFeishuUnbind: () => request<{ ok: boolean }>('/api/auth/feishu/unbind', { method: 'POST' }),
  authRegister: (payload: {
    username: string
    password: string
    display_name?: string
    feishu_user_id?: string
    feishu_name?: string
    invite_code?: string
  }) => request<{
    ok: boolean
    token: string
    user: Record<string, unknown>
    permissions: string[]
    is_admin: boolean
  }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  getUsers: () => request<Array<{
    id: string
    username: string
    display_name: string
    feishu_user_id: string
    feishu_name: string
    role: string
    permissions: string[]
    is_active: boolean
    is_admin: boolean
    created_at: string
    last_login_at?: string
  }>>('/api/admin/users'),
  createUser: (payload: {
    username: string
    password: string
    display_name?: string
    feishu_user_id?: string
    feishu_name?: string
    role?: string
    permissions?: string[]
  }) => request<{ ok: boolean; user: Record<string, unknown> }>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  updateUser: (userId: string, patch: {
    display_name?: string
    role?: string
    permissions?: string[]
    feishu_user_id?: string
    feishu_name?: string
    is_active?: boolean
    password?: string
  }) => request<{ ok: boolean; user: Record<string, unknown> }>(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }),
  deleteUser: (userId: string) => request<{ ok: boolean }>(`/api/admin/users/${userId}`, {
    method: 'DELETE',
  }),
  getRegistrationSettings: () => request<{
    allow_registration: boolean
    registration_invite_code: string
  }>('/api/admin/registration-settings'),
  updateRegistrationSettings: (payload: {
    allow_registration: boolean
    registration_invite_code: string
  }) => request<{ ok: boolean; settings: Record<string, unknown> }>('/api/admin/registration-settings', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  authLogout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
}
