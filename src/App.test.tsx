import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, BrandWorkspace, IssueArticle, sortCandidatesNewestFirst, StoryImageEditor, TrashItem } from './App'
import { api, WorkerRequestError } from './api'
import { formatWeiboPost, WeiboWorkspace } from './WeiboWorkspace'
import * as llmGateway from './llm-gateway'
import type { FlashDraftItem, Issue, SocialPost, Story } from './types'

expect.extend({
  toBeInTheDocument(received: Element | null) {
    const pass = Boolean(received && document.documentElement.contains(received))
    return { pass, message: () => `expected element ${pass ? 'not ' : ''}to be in the document` }
  },
  toBeEnabled(received: HTMLButtonElement | HTMLInputElement) {
    const pass = !received.disabled
    return { pass, message: () => `expected control ${pass ? 'not ' : ''}to be enabled` }
  },
  toBeDisabled(received: HTMLButtonElement | HTMLInputElement) {
    const pass = received.disabled
    return { pass, message: () => `expected control ${pass ? 'not ' : ''}to be disabled` }
  },
  toHaveAttribute(received: Element, name: string, value?: string) {
    const actual = received.getAttribute(name)
    const pass = value === undefined ? received.hasAttribute(name) : actual === value
    return { pass, message: () => `expected ${name}=${JSON.stringify(actual)} ${pass ? 'not ' : ''}to equal ${JSON.stringify(value)}` }
  },
  toHaveClass(received: Element, ...classNames: string[]) {
    const pass = classNames.every((className) => received.classList.contains(className))
    return { pass, message: () => `expected ${received.className} ${pass ? 'not ' : ''}to contain ${classNames.join(' ')}` }
  },
  toHaveTextContent(received: Element, expected: string | RegExp) {
    const actual = received.textContent || ''
    const pass = typeof expected === 'string' ? actual.includes(expected) : expected.test(actual)
    return { pass, message: () => `expected ${JSON.stringify(actual)} ${pass ? 'not ' : ''}to match ${String(expected)}` }
  },
})

const staticStory: Story = {
  id: 'static-story', issue_id: 'ifanr-daily-20260722', fingerprint: 'static-fingerprint', title: '当天真实 Bot 稿标题', body: '当天真实 Bot 稿正文。',
  category: '重磅', status: 'ready', selected: true, position: 0, score: 0,
  source_url: 'https://example.com/story', source_name: '公开来源', source_type: 'draft_source', source_quality: 'primary', confidence: 1,
  cross_day_status: 'current', rumor: false, fact_status: 'verified', changed_since_review: false,
  image_url: '', image_path: '', image_token: '', editorial_reason: '', metadata: { static_snapshot: true }, sources: [], claims: [],
}

const staticIssue: Issue = {
  id: 'ifanr-daily-20260722', publication_date: '2026-07-22', title: '20260722 早报', state: 'static_snapshot', runtime_path: '', draft_path: '',
  revision: 3, selected_count: 1, review_count: 0, ready_count: 1, updated_at: '2026-07-21T09:00:00Z', stories: [staticStory],
  brand_packages: { appso: { headline_options: [], selected_headline: '', cover_candidates: [], selected_cover: '' }, ifanr: { headline_options: [], selected_headline: '', cover_candidates: [], selected_cover: '' } },
  diagnostics: { static_snapshot: true, snapshot_generated_at: '2026-07-21T09:05:00Z' },
}

const staticSocialPost: SocialPost = {
  id: 'social-1', issue_id: staticIssue.id, story_id: staticStory.id, platform: 'weibo', target_date: staticIssue.publication_date,
  content: '完整微博正文。', interaction: '', tags: ['测试话题'], status: 'ready', position: 0, suggested_time: '20:10',
  last_editor: 'codex_agent', last_editor_at: '', published_url: '', published_at: '', reposts_count: null, comments_count: null,
  attitudes_count: null, reads_count: null, metrics_captured_at: '', metrics_source: '', created_at: '', updated_at: '',
}

vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('data/current-issue.json') ? ({
  ok: true,
  json: async () => structuredClone(staticIssue),
}) : ({
  ok: false,
  statusText: 'offline',
  json: async () => ({ detail: 'offline' }),
})))
vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
})
Element.prototype.scrollIntoView = vi.fn()

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.mocked(localStorage.getItem).mockImplementation(() => null)
  vi.mocked(localStorage.setItem).mockClear()
  vi.mocked(localStorage.removeItem).mockClear()
  window.history.replaceState(null, '', '/')
})

describe('App', () => {
  it('opens a dismissible sign-in card for signed-out users', async () => {
    vi.spyOn(api, 'health').mockResolvedValue({ ok: true, mode: 'local', repo_runtime_access: true, access_mode: 'local' })
    vi.spyOn(api, 'currentIssue').mockResolvedValue(structuredClone(staticIssue))
    vi.spyOn(api, 'recentIssues').mockResolvedValue([staticIssue])
    vi.spyOn(api, 'weekend').mockResolvedValue({})
    vi.spyOn(api, 'authStatus').mockResolvedValue({ require_auth: true, authenticated: false, read_only: true, has_2fa: false })

    render(<App />)

    expect(await screen.findByRole('heading', { name: '登录早报编辑台' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭并进入只读模式' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: '登录早报编辑台' })).toBeNull())
    expect(screen.getByRole('button', { name: '账号' })).toBeInTheDocument()
  })

  it('logs in an account without Authenticator before showing a verification field', async () => {
    let loggedIn = false
    vi.spyOn(api, 'health').mockResolvedValue({ ok: true, mode: 'local', repo_runtime_access: true, access_mode: 'local' })
    vi.spyOn(api, 'currentIssue').mockResolvedValue(structuredClone(staticIssue))
    vi.spyOn(api, 'recentIssues').mockResolvedValue([staticIssue])
    vi.spyOn(api, 'weekend').mockResolvedValue({})
    vi.spyOn(api, 'flashDrafts').mockResolvedValue([])
    vi.spyOn(api, 'authStatus').mockImplementation(async () => loggedIn ? {
      require_auth: true, authenticated: true, read_only: false, user_id: 'usr_franky', username: 'Franky', display_name: 'Franky', has_2fa: false,
    } : {
      require_auth: true, authenticated: false, read_only: true, has_2fa: true,
    })
    const login = vi.spyOn(api, 'authLogin').mockImplementation(async () => {
      loggedIn = true
      return { ok: true, token: 'franky-token', username: 'Franky', read_only: false }
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: '登录早报编辑台' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '双重认证' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: '6 位安全验证码' })).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('请输入用户名'), { target: { value: 'Franky' } })
    fireEvent.change(screen.getByPlaceholderText('请输入登录密码'), { target: { value: 'franky-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(login).toHaveBeenCalledWith('Franky', expect.any(String), ''))
    await waitFor(() => expect(screen.queryByRole('heading', { name: '登录早报编辑台' })).toBeNull())
  })

  it('reveals the Authenticator field only after a password-verified challenge', async () => {
    let loggedIn = false
    vi.spyOn(api, 'health').mockResolvedValue({ ok: true, mode: 'local', repo_runtime_access: true, access_mode: 'local' })
    vi.spyOn(api, 'currentIssue').mockResolvedValue(structuredClone(staticIssue))
    vi.spyOn(api, 'recentIssues').mockResolvedValue([staticIssue])
    vi.spyOn(api, 'weekend').mockResolvedValue({})
    vi.spyOn(api, 'flashDrafts').mockResolvedValue([])
    vi.spyOn(api, 'authStatus').mockImplementation(async () => loggedIn ? {
      require_auth: true, authenticated: true, read_only: false, user_id: 'usr_shawn_admin', username: 'Shawn Rain', display_name: 'Shawn Rain', has_2fa: true,
    } : {
      require_auth: true, authenticated: false, read_only: true, has_2fa: true,
    })
    const login = vi.spyOn(api, 'authLogin').mockImplementation(async (_username, _passwordHash, code) => {
      if (!code) throw new WorkerRequestError('请输入 6 位动态验证码或备用码', 401, 'two_factor_required')
      loggedIn = true
      return { ok: true, token: 'admin-token', username: 'Shawn Rain', read_only: false }
    })

    render(<App />)

    await screen.findByRole('heading', { name: '登录早报编辑台' })
    fireEvent.change(screen.getByPlaceholderText('请输入登录密码'), { target: { value: 'admin-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByRole('heading', { name: '双重认证' })).toBeInTheDocument()
    expect(document.querySelector('.auth-two-factor-emblem')).toBeNull()
    expect(screen.getByText(/Shawn Rain/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '使用备用码' }))
    expect(screen.getByPlaceholderText('XXXX-XXXX')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '使用 Authenticator 验证码' }))
    const codeInput = screen.getByRole('textbox', { name: '6 位安全验证码' }) as HTMLInputElement
    fireEvent.change(codeInput, { target: { value: '123456' } })

    await waitFor(() => expect(login).toHaveBeenLastCalledWith('Shawn Rain', expect.any(String), '123456'))
    await waitFor(() => expect(screen.queryByRole('heading', { name: '登录早报编辑台' })).toBeNull())
  })

  it('opens invitation links directly in registration mode with the code prefilled', async () => {
    window.history.replaceState(null, '', '/#register/team-invite-2026')
    vi.spyOn(api, 'health').mockResolvedValue({ ok: true, mode: 'local', repo_runtime_access: true, access_mode: 'local' })
    vi.spyOn(api, 'currentIssue').mockResolvedValue(structuredClone(staticIssue))
    vi.spyOn(api, 'recentIssues').mockResolvedValue([staticIssue])
    vi.spyOn(api, 'weekend').mockResolvedValue({})
    vi.spyOn(api, 'authStatus').mockResolvedValue({ require_auth: true, authenticated: false, read_only: true, has_2fa: false })

    render(<App />)

    expect(await screen.findByRole('heading', { name: '注册采编账号' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('team-invite-2026')).toHaveAttribute('readonly')
    expect(screen.getByText('已从邀请链接安全预填')).toBeInTheDocument()
  })

  it('sorts candidates from newest to oldest and leaves undated items last', () => {
    const stories: Story[] = [
      { ...staticStory, id: 'undated', published_at: undefined },
      { ...staticStory, id: 'older', published_at: '2026-08-15 20:00' },
      { ...staticStory, id: 'newer', published_at: '2026-08-16T09:00:00+08:00' },
      { ...staticStory, id: 'event-date-fallback', published_at: undefined, event_date: '2026-08-16' },
    ]

    expect(sortCandidatesNewestFirst(stories).map((story) => story.id)).toEqual([
      'newer',
      'event-date-fallback',
      'older',
      'undated',
    ])
  })

  it('keeps generated headline history in a separate secondary view and restores a version', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const issue = structuredClone(staticIssue)
    issue.brand_packages.ifanr.headline_history = [{
      id: 'history-1', created_at: '2026-07-21T10:00:00Z', source: 'ai_editor_batch', model: 'codex',
      headline_options: ['历史一', '历史二', '历史三'], selected_headline: '历史一',
    }]
    render(<BrandWorkspace issue={issue} onSave={onSave} onGenerate={vi.fn().mockResolvedValue(undefined)} generating={{ appso: false, ifanr: false }} />)
    expect(screen.getAllByText(/标题编辑Skill:每组3条不同新闻/)).toHaveLength(2)
    expect(screen.queryByText('历史一')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '历史版本' }))
    expect(screen.getByText('历史一')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '恢复为当期' })[0])
    expect(onSave).toHaveBeenCalledWith('ifanr', expect.objectContaining({ headline_options: ['历史一', '历史二', '历史三'], generation_source: 'history_restore' }))
  })

  it('falls back to the current real Bot draft snapshot while the worker is offline', async () => {
    render(<App />)
    expect(screen.getByText('早报编辑台')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '欢迎使用 早报编辑台，ifanr' })).toBeInTheDocument()
    expect(screen.getByText('标题')).toBeInTheDocument()
    expect((await screen.findAllByText('Pages 快照')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '早报稿' }))
    expect(await screen.findByRole('heading', { name: '当天真实 Bot 稿标题' })).toBeInTheDocument()
    expect(screen.getByText('当天飞书 Bot 稿 · 1 条 · Pages 只读快照')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '设置' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '账号' }).querySelector('svg')).toBeTruthy()
  })

  it('shows the dedicated next-day Weibo workspace from the simplified top navigation', async () => {
    render(<App />)
    await screen.findAllByText('Pages 快照')

    fireEvent.click(screen.getByRole('button', { name: '社媒' }))

    expect(await screen.findByRole('heading', { name: '微博成稿' })).toBeInTheDocument()
    expect(screen.getAllByText('2026.07.22')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '复制全部' })).toBeDisabled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText('重写')).not.toBeInTheDocument()
  })

  it('combines a social post into one copy-ready Weibo text', () => {
    const post = {
      content: '这是一条自然的微博正文。', interaction: '你遇到过吗？', tags: ['特斯拉否认上海数据中心撤离', '#特斯拉#'],
    } as SocialPost

    expect(formatWeiboPost(post, '特斯拉中国回应数据中心传闻')).toBe('【特斯拉中国回应数据中心传闻】 #特斯拉否认上海数据中心撤离#\n\n这是一条自然的微博正文。\n\n你遇到过吗？\n\n#特斯拉#')
    expect(formatWeiboPost(post, '游戏推荐｜备选｜《Hades II》发起循环挑战')).toContain('【游戏推荐｜《Hades II》发起循环挑战】')
    expect(formatWeiboPost(post, '游戏推荐｜备选｜《Hades II》发起循环挑战')).not.toContain('备选')
  })

  it('generates a missing Weibo post immediately and saves it to the Worker', async () => {
    vi.spyOn(api, 'socialPosts').mockResolvedValue([])
    vi.spyOn(llmGateway, 'generateWeiboPosts').mockResolvedValue([{
      story_id: staticStory.id,
      content: '即时生成的完整微博。',
      interaction: '你最想先试哪个功能？',
      tags: ['测试话题'],
      suggested_time: '10:00',
    }])
    const savedPost = { ...staticSocialPost, content: '即时生成的完整微博。', interaction: '你最想先试哪个功能？' }
    const upsertPost = vi.spyOn(api, 'upsertSocialPost').mockResolvedValue(savedPost)
    const onNotify = vi.fn()

    render(<WeiboWorkspace issue={staticIssue} dataMode="worker" onNotify={onNotify} />)

    fireEvent.click(await screen.findByRole('button', { name: '立即生成' }))
    expect(await screen.findByText(/即时生成的完整微博。/)).toBeInTheDocument()
    expect(llmGateway.generateWeiboPosts).toHaveBeenCalledWith([staticStory], staticIssue.publication_date)
    expect(upsertPost).toHaveBeenCalledWith(staticIssue.id, expect.objectContaining({
      story_id: staticStory.id,
      content: '即时生成的完整微博。',
      status: 'ready',
    }))
    expect(onNotify).toHaveBeenCalledWith('微博已生成，可直接复制发布')
  })

  it('revises a Weibo post with either AI judgment or optional user feedback', async () => {
    vi.spyOn(api, 'socialPosts').mockResolvedValue([staticSocialPost])
    const generate = vi.spyOn(llmGateway, 'generateWeiboPosts')
      .mockResolvedValueOnce([{
        story_id: staticStory.id, content: 'AI 主动优化后的微博。', interaction: '', tags: ['测试话题'], suggested_time: '20:10',
      }])
      .mockResolvedValueOnce([{
        story_id: staticStory.id, content: '按用户意见修改后的微博。', interaction: '', tags: ['测试话题'], suggested_time: '20:10',
      }])
    const patchPost = vi.spyOn(api, 'patchSocialPost')
      .mockResolvedValueOnce({ ...staticSocialPost, content: 'AI 主动优化后的微博。' })
      .mockResolvedValueOnce({ ...staticSocialPost, content: '按用户意见修改后的微博。' })
    const onNotify = vi.fn()

    render(<WeiboWorkspace issue={staticIssue} dataMode="worker" onNotify={onNotify} />)

    fireEvent.click(await screen.findByRole('button', { name: '修改微博' }))
    expect(screen.getByPlaceholderText('想怎么修改这条微博？（可选）')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '生成' }))
    expect(await screen.findByText(/AI 主动优化后的微博。/)).toBeInTheDocument()
    expect(generate).toHaveBeenLastCalledWith([staticStory], staticIssue.publication_date, expect.objectContaining({ instruction: '' }))
    expect(onNotify).toHaveBeenCalledWith('AI 已完成微博优化')

    fireEvent.click(screen.getByRole('button', { name: '修改微博' }))
    fireEvent.change(screen.getByRole('textbox', { name: '微博修改意见' }), { target: { value: '把开头写得更直接' } })
    fireEvent.click(screen.getByRole('button', { name: '生成' }))
    expect(await screen.findByText(/按用户意见修改后的微博。/)).toBeInTheDocument()
    expect(generate).toHaveBeenLastCalledWith([staticStory], staticIssue.publication_date, expect.objectContaining({ instruction: '把开头写得更直接' }))
    expect(patchPost).toHaveBeenLastCalledWith(staticSocialPost.id, expect.objectContaining({ content: '按用户意见修改后的微博。', status: 'ready' }))
    expect(onNotify).toHaveBeenCalledWith('微博已按附加意见修改')
  })

  it('extracts a manually submitted source link before generating its Weibo post', async () => {
    vi.spyOn(api, 'socialPosts').mockResolvedValue([])
    const manualStory: Story = {
      ...staticStory,
      id: 'manual-pending-story',
      title: '追觅咖啡回应闭店',
      body: '',
      selected: false,
      status: 'drafting',
      metadata: { origin: 'manual_workbench', _ai_editor_request: { state: 'pending' } },
    }
    const manualIssue = { ...staticIssue, stories: [manualStory] }
    const extract = vi.spyOn(api, 'extractUrlsContent').mockResolvedValue({
      ok: true,
      items: [],
      merged_title: '追觅咖啡回应闭店',
      merged_content: '从来源链接提取的完整正文。',
      primary_image_url: '',
      primary_source_url: manualStory.source_url,
    })
    vi.spyOn(llmGateway, 'generateWeiboPosts').mockResolvedValue([{
      story_id: manualStory.id,
      content: '根据链接生成的微博。',
      interaction: '',
      tags: ['追觅咖啡'],
      suggested_time: '10:00',
    }])
    vi.spyOn(api, 'upsertSocialPost').mockResolvedValue({ ...staticSocialPost, story_id: manualStory.id, content: '根据链接生成的微博。' })

    render(<WeiboWorkspace issue={manualIssue} dataMode="worker" onNotify={vi.fn()} />)

    expect(await screen.findByText('追觅咖啡回应闭店')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '抓取并生成' }))
    expect(await screen.findByText(/根据链接生成的微博。/)).toBeInTheDocument()
    expect(extract).toHaveBeenCalledWith({ urls: [manualStory.source_url] })
    expect(llmGateway.generateWeiboPosts).toHaveBeenCalledWith([
      expect.objectContaining({ id: manualStory.id, body: '从来源链接提取的完整正文。' }),
    ], manualIssue.publication_date)
  })

  it('hides legacy time hints and archives a Weibo card after marking it published', async () => {
    vi.spyOn(api, 'socialPosts').mockResolvedValue([staticSocialPost])
    const publishPost = vi.spyOn(api, 'markSocialPostPublished').mockResolvedValue({ ...staticSocialPost, status: 'published' })
    const onNotify = vi.fn()

    render(<WeiboWorkspace issue={staticIssue} dataMode="worker" onNotify={onNotify} />)

    expect(await screen.findByText(/完整微博正文。/)).toBeInTheDocument()
    expect(screen.queryByText('20:10')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制微博正文和配图' }).textContent).toBe('')
    const publishButton = screen.getByRole('button', { name: '标记已发布' })
    expect(publishButton.textContent).toBe('')
    fireEvent.click(publishButton)
    await waitFor(() => expect(publishPost).toHaveBeenCalledWith('social-1'))
    await waitFor(() => expect(screen.queryByText(/完整微博正文。/)).not.toBeInTheDocument())
    expect(screen.getByText('当前刊期微博已全部发布')).toBeInTheDocument()
    expect(onNotify).toHaveBeenCalledWith('已标记为已发布，并从社媒页收纳')
    fireEvent.click(screen.getByRole('button', { name: /已发布 1/ }))
    expect(await screen.findByText(/完整微博正文。/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '已发布' })).toBeDisabled()
  })

  it('copies the complete Weibo card through the HTTP-compatible clipboard fallback', async () => {
    vi.spyOn(api, 'socialPosts').mockResolvedValue([staticSocialPost])
    const onNotify = vi.fn()
    let copiedText = ''
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        copiedText = (document.querySelector('textarea[aria-hidden="true"]') as HTMLTextAreaElement | null)?.value || ''
        return true
      }),
    })

    render(<WeiboWorkspace issue={staticIssue} dataMode="worker" onNotify={onNotify} />)

    fireEvent.click(await screen.findByRole('button', { name: '复制微博正文和配图' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument())
    expect(copiedText).toBe('【当天真实 Bot 稿标题】 #测试话题#\n\n完整微博正文。')
    expect(onNotify).toHaveBeenCalledWith('微博正文已复制；当前浏览器未允许写入配图')
  })

  it('keeps the Weibo card visible when marking it published fails', async () => {
    vi.spyOn(api, 'socialPosts').mockResolvedValue([staticSocialPost])
    vi.spyOn(api, 'markSocialPostPublished').mockRejectedValue(new Error('写入失败'))

    render(<WeiboWorkspace issue={staticIssue} dataMode="worker" onNotify={vi.fn()} />)

    expect(await screen.findByText(/完整微博正文。/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '标记已发布' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('写入失败')
    expect(screen.getByText(/完整微博正文。/)).toBeInTheDocument()
  })

  it('shows Worker recovery controls instead of a blank Weibo workspace when every data source fails', async () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) => key === 'ifanr-editorial-active-view' ? 'weibo' : null)
    vi.spyOn(api, 'health').mockRejectedValue(new TypeError('Failed to fetch'))
    vi.spyOn(api, 'currentIssue').mockRejectedValue(new TypeError('Failed to fetch'))
    vi.spyOn(api, 'importLatest').mockRejectedValue(new TypeError('Failed to fetch'))
    vi.spyOn(api, 'staticIssue').mockRejectedValue(new Error('Pages 快照返回了网页而不是 JSON'))

    render(<App />)

    expect((await screen.findAllByText('Worker 未连接')).length).toBeGreaterThan(0)
    expect(screen.getByText(/Pages 快照返回了网页而不是 JSON/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain("Unexpected token '<'")
    fireEvent.click(screen.getByRole('button', { name: 'Worker 设置' }))
    expect(screen.getByRole('button', { name: 'Worker 状态与数据源' })).toHaveClass('active')
  })

  it('switches among the latest three publication days without changing the active workspace', async () => {
    const previousIssue = { ...structuredClone(staticIssue), id: 'ifanr-daily-20260721', publication_date: '2026-07-21', title: '20260721 早报' }
    vi.spyOn(api, 'health').mockResolvedValue({ ok: true, mode: 'local', repo_runtime_access: true, access_mode: 'local' })
    vi.spyOn(api, 'currentIssue').mockResolvedValue(structuredClone(staticIssue))
    vi.spyOn(api, 'recentIssues').mockResolvedValue([
      staticIssue,
      previousIssue,
      { ...previousIssue, id: 'ifanr-daily-20260720', publication_date: '2026-07-20' },
    ])
    vi.spyOn(api, 'weekend').mockResolvedValue({})
    const getIssue = vi.spyOn(api, 'getIssue').mockResolvedValue(previousIssue)
    render(<App />)
    const switcher = await screen.findByRole('combobox', { name: '刊期' }) as HTMLSelectElement
    await waitFor(() => expect(switcher.options).toHaveLength(3))
    await waitFor(() => expect(getIssue).toHaveBeenCalledWith(previousIssue.id))
    await act(async () => Promise.resolve())
    getIssue.mockImplementation(() => new Promise<Issue>(() => undefined))

    fireEvent.change(switcher, { target: { value: previousIssue.id } })

    expect((screen.getByRole('combobox', { name: '刊期' }) as HTMLSelectElement).value).toBe(previousIssue.id)
    expect(screen.getByRole('combobox', { name: '刊期' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '主页' })).toHaveClass('active')
  })

  it('loads recent flash drafts from the signed-in account', async () => {
    const accountDraft: FlashDraftItem = {
      id: 'draft_synced',
      title: '另一台设备保存的快讯',
      body: '这篇正文来自账号云端记录。',
      category: '大公司',
      updatedAt: Date.now(),
      authorName: 'Shawn Rain',
    }
    vi.spyOn(api, 'health').mockResolvedValue({ ok: true, mode: 'local', repo_runtime_access: true, access_mode: 'local' })
    vi.spyOn(api, 'currentIssue').mockResolvedValue(structuredClone(staticIssue))
    vi.spyOn(api, 'recentIssues').mockResolvedValue([staticIssue])
    vi.spyOn(api, 'weekend').mockResolvedValue({})
    vi.spyOn(api, 'authStatus').mockResolvedValue({
      require_auth: true,
      authenticated: true,
      read_only: false,
      user_id: 'usr_shawn_admin',
      username: 'Shawn Rain',
      display_name: '郑廷旭',
      has_2fa: false,
    })
    vi.spyOn(api, 'flashDrafts').mockResolvedValue([accountDraft])

    render(<App />)

    expect(await screen.findByRole('heading', { name: '欢迎使用 早报编辑台，郑廷旭' })).toBeInTheDocument()
    expect(await screen.findByText('另一台设备保存的快讯')).toBeInTheDocument()
    expect(screen.getByText('已随账号同步')).toBeInTheDocument()
  })

  it('starts a fresh flash draft when opening a morning-news story after another draft', async () => {
    const previousDraft: FlashDraftItem = {
      id: 'draft_previous',
      title: '上一条快讯稿标题',
      body: '上一条快讯稿正文，不应进入新会话。',
      content: '上一条快讯原始素材。',
      category: '大公司',
      updatedAt: Date.now(),
    }
    vi.spyOn(api, 'health').mockResolvedValue({ ok: true, mode: 'local', repo_runtime_access: true, access_mode: 'local' })
    vi.spyOn(api, 'currentIssue').mockResolvedValue(structuredClone(staticIssue))
    vi.spyOn(api, 'recentIssues').mockResolvedValue([staticIssue])
    vi.spyOn(api, 'weekend').mockResolvedValue({})
    vi.spyOn(api, 'authStatus').mockResolvedValue({
      require_auth: true,
      authenticated: true,
      read_only: false,
      user_id: 'usr_shawn_admin',
      username: 'Shawn Rain',
      display_name: '郑廷旭',
      has_2fa: false,
    })
    vi.spyOn(api, 'flashDrafts').mockResolvedValue([previousDraft])

    render(<App />)

    fireEvent.click(await screen.findByText(previousDraft.title))
    await waitFor(() => expect((screen.getByPlaceholderText('快讯标题...') as HTMLInputElement).value).toBe(previousDraft.title))

    fireEvent.click(screen.getByRole('button', { name: '早报稿' }))
    await screen.findByRole('heading', { name: staticStory.title })
    fireEvent.click(screen.getByRole('button', { name: '⚡️ 快速生成快讯' }))

    await waitFor(() => expect((screen.getByPlaceholderText(/例如：苹果/) as HTMLInputElement).value).toBe(staticStory.title))
    expect((screen.getByPlaceholderText('快讯标题...') as HTMLInputElement).value).toBe('')
    expect((screen.getByPlaceholderText('快讯正文将在此处生成，支持实时编辑...') as HTMLTextAreaElement).value).toBe('')
    expect(screen.queryByDisplayValue(previousDraft.title)).toBeNull()
  })

  it('migrates legacy browser drafts into the signed-in account once', async () => {
    const legacyDraft: FlashDraftItem = {
      id: 'draft_legacy',
      title: '升级前保存在浏览器的快讯',
      body: '本地旧草稿正文。',
      category: '新产品',
      updatedAt: Date.now() - 1000,
    }
    vi.mocked(localStorage.getItem).mockImplementation((key) => (
      key === 'editorial_flash_drafts' ? JSON.stringify([legacyDraft]) : null
    ))
    vi.spyOn(api, 'health').mockResolvedValue({ ok: true, mode: 'local', repo_runtime_access: true, access_mode: 'local' })
    vi.spyOn(api, 'currentIssue').mockResolvedValue(structuredClone(staticIssue))
    vi.spyOn(api, 'recentIssues').mockResolvedValue([staticIssue])
    vi.spyOn(api, 'weekend').mockResolvedValue({})
    vi.spyOn(api, 'authStatus').mockResolvedValue({
      require_auth: true,
      authenticated: true,
      read_only: false,
      user_id: 'usr_shawn_admin',
      username: 'Shawn Rain',
      display_name: 'Shawn Rain',
      has_2fa: false,
    })
    vi.spyOn(api, 'flashDrafts').mockResolvedValue([])
    const upload = vi.spyOn(api, 'upsertFlashDraft').mockResolvedValue(legacyDraft)

    render(<App />)

    expect(await screen.findByText('升级前保存在浏览器的快讯')).toBeInTheDocument()
    await waitFor(() => expect(upload).toHaveBeenCalledWith(legacyDraft))
    expect(localStorage.removeItem).toHaveBeenCalledWith('editorial_flash_drafts')
  })

  it('restores the last active top-level tab after a page reload', async () => {
    vi.mocked(localStorage.getItem).mockImplementation((key) => key === 'ifanr-editorial-active-view' ? 'candidates' : null)

    render(<App />)

    expect(await screen.findByRole('heading', { name: '待追源与待复核' })).toBeInTheDocument()
    expect((screen.getByRole('combobox', { name: '更多工作区' }) as HTMLSelectElement).value).toBe('candidates')
    expect(screen.getByRole('combobox', { name: '更多工作区' }).closest('label')).toHaveClass('active')
    vi.mocked(localStorage.getItem).mockImplementation(() => null)
  })

  it('publishes the revision returned by an edit without requiring a page refresh', async () => {
    const connectedIssue = structuredClone(staticIssue)
    const editedStory = { ...staticStory, category: '大公司', issue_revision: 4 }
    vi.spyOn(api, 'health').mockResolvedValue({ ok: true, mode: 'local', repo_runtime_access: true, access_mode: 'local' })
    vi.spyOn(api, 'currentIssue').mockResolvedValue(connectedIssue)
    vi.spyOn(api, 'weekend').mockResolvedValue({})
    vi.spyOn(api, 'patchStory').mockResolvedValue(editedStory)
    const publish = vi.spyOn(api, 'publishToLark').mockResolvedValue({
      id: 'publish-job', issue_id: connectedIssue.id, action: 'lark-publish', state: 'queued', progress: 0, message: '', result: {}, error: '',
    })
    vi.spyOn(api, 'watchJob').mockResolvedValue({
      id: 'publish-job', issue_id: connectedIssue.id, action: 'lark-publish', state: 'completed', progress: 100, message: '已同步', result: {}, error: '',
    })

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '早报稿' }))
    fireEvent.click(await screen.findByRole('heading', { name: staticStory.title }))
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: '大公司' } })
    await waitFor(() => expect(api.patchStory).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    fireEvent.click(screen.getByRole('button', { name: /同步飞书 Bot 同刊期文档/ }))

    await waitFor(() => expect(publish).toHaveBeenCalledWith(connectedIssue.id, 4))
  })

  it('publishes the revision returned by reorder without requiring a page refresh', async () => {
    const secondStory = { ...staticStory, id: 'second-story', fingerprint: 'second-fingerprint', title: '同栏目第二条', position: 1 }
    const connectedIssue = { ...structuredClone(staticIssue), selected_count: 2, ready_count: 2, stories: [structuredClone(staticStory), secondStory] }
    const reorderedIssue = {
      ...structuredClone(connectedIssue),
      revision: 4,
      stories: [{ ...secondStory, position: 0 }, { ...structuredClone(staticStory), position: 1 }],
    }
    vi.spyOn(api, 'health').mockResolvedValue({ ok: true, mode: 'local', repo_runtime_access: true, access_mode: 'local' })
    vi.spyOn(api, 'currentIssue').mockResolvedValue(connectedIssue)
    vi.spyOn(api, 'weekend').mockResolvedValue({})
    const reorder = vi.spyOn(api, 'reorder').mockResolvedValue(reorderedIssue)
    const publish = vi.spyOn(api, 'publishToLark').mockResolvedValue({
      id: 'publish-job', issue_id: connectedIssue.id, action: 'lark-publish', state: 'queued', progress: 0, message: '', result: {}, error: '',
    })
    vi.spyOn(api, 'watchJob').mockResolvedValue({
      id: 'publish-job', issue_id: connectedIssue.id, action: 'lark-publish', state: 'completed', progress: 100, message: '已同步', result: {}, error: '',
    })

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '早报稿' }))
    fireEvent.click(await screen.findByRole('button', { name: '上移一位' }))
    await waitFor(() => expect(reorder).toHaveBeenCalledWith(connectedIssue.id, [secondStory.id, staticStory.id], '重磅'))
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    fireEvent.click(screen.getByRole('button', { name: /同步飞书 Bot 同刊期文档/ }))

    await waitFor(() => expect(publish).toHaveBeenCalledWith(connectedIssue.id, 4))
  })

  it('shows sync conflicts as per-field choices and resolves them in the workbench', async () => {
    const connectedIssue = structuredClone(staticIssue)
    vi.spyOn(api, 'health').mockResolvedValue({ ok: true, mode: 'local', repo_runtime_access: true, access_mode: 'local' })
    vi.spyOn(api, 'currentIssue').mockResolvedValue(connectedIssue)
    vi.spyOn(api, 'currentIssueVersion').mockResolvedValue({ id: connectedIssue.id, revision: connectedIssue.revision })
    vi.spyOn(api, 'weekend').mockResolvedValue({})
    vi.spyOn(api, 'publishToLark').mockResolvedValue({
      id: 'conflict-job', issue_id: connectedIssue.id, action: 'lark-publish', state: 'queued', progress: 0, message: '', result: {}, error: '',
    })
    vi.spyOn(api, 'watchJob').mockResolvedValue({
      id: 'conflict-job', issue_id: connectedIssue.id, action: 'lark-publish', state: 'completed', progress: 100,
      message: '两端改稿存在冲突', error: '',
      result: {
        requires_review: true,
        readback: {
          conflict_set_id: 'set-1',
          conflict_issue_revision: 3,
          conflicts: [{
            id: 'conflict-1', title: connectedIssue.stories[0].title, story_id: connectedIssue.stories[0].id,
            field: 'body', reason: '工作台在上次发布后也修改了该字段',
            workbench_value: '工作台人工正文。', lark_value: '飞书人工正文。', can_accept_lark: true,
          }],
        },
      },
    })
    const resolve = vi.spyOn(api, 'resolveLarkConflicts').mockResolvedValue({ ok: true, resolved_count: 1, revision: 4, document_ref: 'doc-token' })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '导出' }))
    fireEvent.click(screen.getByRole('button', { name: /同步飞书 Bot 同刊期文档/ }))

    expect(await screen.findByRole('heading', { name: '解决 1 项同步冲突' })).toBeInTheDocument()
    expect(screen.getByText('工作台人工正文。')).toBeInTheDocument()
    expect(screen.getByText('飞书人工正文。')).toBeInTheDocument()
    const conflictPanel = screen.getByRole('region', { name: '飞书同步冲突' })
    fireEvent.click(within(conflictPanel).getAllByRole('radio')[1])
    fireEvent.click(screen.getByRole('button', { name: '保存解决方案' }))

    await waitFor(() => expect(resolve).toHaveBeenCalledWith(
      connectedIssue.id,
      'set-1',
      3,
      [{ conflict_id: 'conflict-1', choice: 'lark' }],
    ))
    await waitFor(() => expect(screen.queryByRole('heading', { name: '解决 1 项同步冲突' })).toBeNull())
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
    render(<IssueArticle story={story} active={false} onOpen={onOpen} onExclude={onExclude} onDragStart={() => undefined} onDrop={() => undefined} onDragEnd={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: '移出早报稿' }))

    expect(onExclude).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('ignores zero-width placeholder lines instead of rendering empty paragraphs', () => {
    const story = {
      ...staticStory,
      body: '\u200b\n\n第一段。\n\n\u200b\n\n第二段。\n\n\uFEFF',
    }
    const { container } = render(<IssueArticle story={story} active={false} onOpen={() => undefined} onExclude={() => undefined} onDragStart={() => undefined} onDrop={() => undefined} onDragEnd={() => undefined} />)

    const paragraphs = container.querySelectorAll('.article-body p')
    expect(paragraphs).toHaveLength(2)
    expect([...paragraphs].map((paragraph) => paragraph.textContent)).toEqual(['第一段。', '第二段。'])
  })

  it('asks for confirmation before deletion and restores it with Command-Z', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '早报稿' }))
    expect(await screen.findByRole('heading', { name: '当天真实 Bot 稿标题' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '移出早报稿' }))
    expect(screen.getByRole('dialog', { name: '确定删除这个选题？' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '当天真实 Bot 稿标题' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '确定删除这个选题？' })).not.toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('已移入回收站')

    fireEvent.keyDown(document, { key: 'z', metaKey: true })
    await waitFor(() => expect(screen.getByRole('heading', { name: '当天真实 Bot 稿标题' })).toBeInTheDocument())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('fades the deletion toast after 10 seconds without losing Command-Z history', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '早报稿' }))
    expect(await screen.findByRole('heading', { name: '当天真实 Bot 稿标题' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '移出早报稿' }))
    vi.useFakeTimers()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))
    })
    expect(screen.getByRole('status')).toHaveTextContent('已移入回收站')

    await act(async () => { vi.advanceTimersByTime(9650) })
    expect(screen.getByRole('status')).toHaveClass('is-closing')
    await act(async () => { vi.advanceTimersByTime(350) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'z', metaKey: true })
    await act(async () => Promise.resolve())
    expect(screen.getByRole('heading', { name: '当天真实 Bot 稿标题' })).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('shows elevator controls only where movement is possible and keeps the card closed', () => {
    const onOpen = vi.fn()
    const onMoveDown = vi.fn()
    const onMoveBottom = vi.fn()
    const story: Story = {
      id: 'story-1', issue_id: 'issue-1', fingerprint: 'fingerprint-1', title: '测试选题', body: '正文',
      category: '大公司', status: 'ready', selected: true, position: 0, score: 100,
      source_url: '', source_name: '', source_type: '', source_quality: 'primary', confidence: 1,
      cross_day_status: '', rumor: false, fact_status: 'verified', changed_since_review: false,
      image_url: '', image_path: '', image_token: '', editorial_reason: '', metadata: {}, sources: [], claims: [],
    }
    render(<IssueArticle story={story} active={false} canMoveUp={false} canMoveDown onMoveDown={onMoveDown} onMoveBottom={onMoveBottom} onOpen={onOpen} onExclude={() => undefined} onDragStart={() => undefined} onDrop={() => undefined} onDragEnd={() => undefined} />)

    expect(screen.queryByRole('button', { name: '上移一位' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '置顶到当前栏目' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下移一位' }))
    fireEvent.click(screen.getByRole('button', { name: '置底到当前栏目' }))

    expect(onMoveDown).toHaveBeenCalledOnce()
    expect(onMoveBottom).toHaveBeenCalledOnce()
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
    render(<IssueArticle story={story} active={false} onMoveCategory={onMoveCategory} onOpen={onOpen} onExclude={() => undefined} onDragStart={() => undefined} onDrop={() => undefined} onDragEnd={() => undefined} />)

    fireEvent.change(screen.getByLabelText('移动到其他栏目'), { target: { value: '大公司' } })

    expect(onMoveCategory).toHaveBeenCalledWith('大公司')
    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.queryByRole('option', { name: '重磅' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '观点' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'AI/开发者' })).not.toBeInTheDocument()
  })

  it('offers touch-friendly move, category, and delete actions from the mobile menu', () => {
    const onOpen = vi.fn()
    const onMoveUp = vi.fn()
    const onMoveDown = vi.fn()
    const onMoveCategory = vi.fn()
    const onExclude = vi.fn()
    const story: Story = {
      ...staticStory,
      id: 'mobile-actions-story',
      title: '移动端操作测试',
      category: '重磅',
    }
    render(<IssueArticle story={story} active={false} canMoveUp canMoveDown onMoveUp={onMoveUp} onMoveDown={onMoveDown} onMoveCategory={onMoveCategory} onOpen={onOpen} onExclude={onExclude} onDragStart={() => undefined} onDrop={() => undefined} onDragEnd={() => undefined} />)

    const openMenu = () => fireEvent.click(screen.getByRole('button', { name: `更多操作：${story.title}` }))
    openMenu()
    let dialog = screen.getByRole('dialog', { name: story.title })
    fireEvent.click(within(dialog).getByRole('button', { name: '上移一位' }))
    expect(onMoveUp).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()

    openMenu()
    dialog = screen.getByRole('dialog', { name: story.title })
    fireEvent.click(within(dialog).getByRole('button', { name: '大公司' }))
    expect(onMoveCategory).toHaveBeenCalledWith('大公司')

    openMenu()
    dialog = screen.getByRole('dialog', { name: story.title })
    fireEvent.click(within(dialog).getByRole('button', { name: '删除选题' }))
    expect(onExclude).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog', { name: story.title })).not.toBeInTheDocument()
  })

  it('opens the same mobile action menu after a touch long press without opening the article', async () => {
    const onOpen = vi.fn()
    const story = { ...staticStory, id: 'long-press-story', title: '长按操作测试' }
    const { container } = render(<IssueArticle story={story} active={false} onOpen={onOpen} onExclude={() => undefined} onDragStart={() => undefined} onDrop={() => undefined} onDragEnd={() => undefined} />)
    const article = container.querySelector('.issue-article') as HTMLElement
    vi.useFakeTimers()
    try {
      const pointerDown = new Event('pointerdown', { bubbles: true })
      Object.defineProperties(pointerDown, {
        pointerType: { value: 'touch' },
        clientX: { value: 20 },
        clientY: { value: 20 },
      })
      fireEvent(article, pointerDown)
      await act(async () => { vi.advanceTimersByTime(520) })
      expect(screen.getByRole('dialog', { name: story.title })).toBeInTheDocument()
      fireEvent.pointerUp(article)
      fireEvent.click(article)
      expect(onOpen).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores a discarded story without opening its detail panel', () => {
    const onOpen = vi.fn()
    const onRestore = vi.fn()
    render(<TrashItem story={{ ...staticStory, selected: false, status: 'excluded' }} active={false} disabled={false} onOpen={onOpen} onRestore={onRestore} />)

    fireEvent.click(screen.getByRole('button', { name: '恢复到早报稿' }))

    expect(onRestore).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('opens and closes settings dialog', async () => {
    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: '设置' })[0])
    const card = document.querySelector('.settings-dialog-card') as HTMLElement
    expect(card).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(document.querySelector('.settings-dialog-card')).not.toBeInTheDocument())
  })

  it('uses corner quotes in visible UI copy', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '早报稿' }))
    await screen.findByRole('heading', { name: '当天真实 Bot 稿标题' })

    fireEvent.change(screen.getByRole('combobox', { name: '更多工作区' }), { target: { value: 'candidates' } })
    expect(await screen.findByText(/采用后会先以「待 AI 主编撰写」状态出现在「早报稿」/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/[“”]/)
  })

  it('queues a candidate for the next AI editor run without starting an immediate job', async () => {
    const candidate: Story = {
      ...staticStory,
      id: 'candidate-story',
      fingerprint: 'candidate-fingerprint',
      title: '等待主编撰写的候选',
      body: '',
      category: '大公司',
      selected: false,
      status: 'discovered',
      metadata: { origin: 'runtime_candidate' },
    }
    const connectedIssue = { ...structuredClone(staticIssue), stories: [staticStory, candidate] }
    const health = vi.spyOn(api, 'health').mockResolvedValue({ ok: true, mode: 'local', repo_runtime_access: true, access_mode: 'local' })
    vi.spyOn(api, 'currentIssue').mockResolvedValue(connectedIssue)
    vi.spyOn(api, 'weekend').mockResolvedValue({})
    const patch = vi.spyOn(api, 'patchStory').mockImplementation(async (_id, changes) => ({ ...candidate, ...changes }))
    const action = vi.spyOn(api, 'action')

    render(<App />)
    await waitFor(() => expect(health).toHaveBeenCalled())
    fireEvent.change(screen.getByRole('combobox', { name: '更多工作区' }), { target: { value: 'candidates' } })
    fireEvent.click(await screen.findByRole('button', { name: '提交给 AI 主编撰写' }))

    await waitFor(() => expect(patch).toHaveBeenCalled())
    expect(action).not.toHaveBeenCalled()
    // 提交后保留在候选库，不自动跳转到早报稿或打开详情侧栏。
    expect(screen.getByRole('heading', { name: '待追源与待复核' })).toBeInTheDocument()
    expect(screen.queryByText('待 AI 主编撰写')).not.toBeInTheDocument()
    const changes = patch.mock.calls[0][1]
    expect(changes.selected).toBe(false)
    expect(changes.status).toBe('drafting')
    expect((changes.metadata?._ai_editor_request as Record<string, unknown>).state).toBe('pending')
  })

  it('keeps article copy flowing independently from a tall side image', () => {
    const story: Story = {
      ...staticStory,
      title: '带图稿件',
      body: '第一段正文。\\n\\n第二段正文。',
      image_url: 'https://example.com/tall-image.jpg',
    }
    const { container } = render(<IssueArticle story={story} active={false} onOpen={() => undefined} onExclude={() => undefined} onDragStart={() => undefined} onDrop={() => undefined} onDragEnd={() => undefined} />)

    const layout = container.querySelector('.article-layout-with-image')
    expect(layout).toBeInTheDocument()
    expect(layout?.querySelector('.article-copy .article-body')).toBeInTheDocument()
    expect(layout?.querySelector(':scope > .article-side-image')).toBeInTheDocument()
  })

  it('shows manual image controls while connected and protects static mode', () => {
    const story: Story = {
      id: 'story-image', issue_id: 'issue-1', fingerprint: 'fingerprint-image', title: '带图选题', body: '正文',
      category: '大公司', status: 'ready', selected: true, position: 0, score: 100,
      source_url: '', source_name: '', source_type: '', source_quality: 'primary', confidence: 1,
      cross_day_status: '', rumor: false, fact_status: 'verified', changed_since_review: false,
      image_url: 'https://example.com/image.jpg', image_path: '', image_token: '', editorial_reason: '', metadata: {}, sources: [], claims: [],
    }
    const { rerender } = render(<StoryImageEditor story={story} staticMode={false} onImageChange={() => undefined} />)

    expect(screen.getByRole('button', { name: '替换本地图' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '删除' })).toBeEnabled()
    expect(screen.getByPlaceholderText('粘贴原图 URL')).toBeEnabled()

    rerender(<StoryImageEditor story={story} staticMode onImageChange={() => undefined} />)
    expect(screen.getByRole('button', { name: '替换本地图' })).toBeDisabled()
    expect(screen.getByText('连接 Worker 后才能粘贴或修改配图。')).toBeInTheDocument()
  })

  it('uploads an image pasted from the clipboard while connected', async () => {
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'clipboard.png', { type: 'image/png' })
    const updated = { ...staticStory, image_path: '/tmp/clipboard.png' }
    const upload = vi.spyOn(api, 'uploadStoryImage').mockResolvedValue(updated)
    const onImageChange = vi.fn()
    render(<StoryImageEditor story={staticStory} staticMode={false} onImageChange={onImageChange} />)

    fireEvent.paste(window, {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      },
    })

    await waitFor(() => expect(upload).toHaveBeenCalledWith(staticStory.id, file))
    expect(onImageChange).toHaveBeenCalledWith(updated)
  })
})
