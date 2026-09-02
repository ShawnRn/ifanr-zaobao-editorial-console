import { describe, expect, it, vi } from 'vitest'
import { applyReviewOperations, buildReviewExport, createClientId, renderFeishuCloudMarkdown, renderHeadlineCandidatesMarkdown } from './review'
import type { Issue, Story } from './types'

vi.stubGlobal('crypto', { randomUUID: () => '12345678-1234-1234-1234-123456789abc' })

function story(overrides: Partial<Story> = {}): Story {
  return {
    id: 'story-a',
    issue_id: 'ifanr-daily-20260721',
    fingerprint: 'fingerprint-a',
    title: '原始标题',
    body: '原始正文。',
    category: '大公司',
    status: 'ready',
    selected: true,
    position: 0,
    score: 100,
    source_url: 'https://example.com/a',
    source_name: 'Example',
    source_type: 'rss',
    source_quality: 'strong',
    confidence: 1,
    cross_day_status: 'current',
    rumor: false,
    fact_status: 'supported',
    changed_since_review: false,
    image_url: '',
    image_path: '',
    image_token: '',
    editorial_reason: '',
    metadata: {},
    sources: [],
    claims: [],
    ...overrides,
  }
}

function issue(stories: Story[]): Issue {
  return {
    id: 'ifanr-daily-20260721',
    publication_date: '2026-07-21',
    title: '早报',
    state: 'editing',
    runtime_path: '',
    draft_path: '',
    revision: 7,
    selected_count: stories.filter((item) => item.selected).length,
    review_count: 0,
    ready_count: stories.filter((item) => item.selected).length,
    updated_at: '2026-07-21T00:00:00Z',
    stories,
    brand_packages: { appso: { headline_options: [], selected_headline: '', cover_candidates: [], selected_cover: '' }, ifanr: { headline_options: [], selected_headline: '', cover_candidates: [], selected_cover: '' } },
    diagnostics: { public_snapshot: { digest: 'snapshot-digest' } },
  }
}

describe('buildReviewExport', () => {
  it('keeps current brand candidates in the workbench and out of the Feishu shell', () => {
    const current = issue([story()])
    current.brand_packages.ifanr.headline_options = ['爱范儿一', '爱范儿二', '爱范儿三', '爱范儿四', '爱范儿五', '爱范儿六']
    current.brand_packages.ifanr.selected_headline = '爱范儿四'
    current.brand_packages.appso.headline_options = ['APPSO一', 'APPSO二', 'APPSO三', 'APPSO四', 'APPSO五', 'APPSO六']
    current.brand_packages.appso.selected_headline = 'APPSO五'
    const candidates = renderHeadlineCandidatesMarkdown(current)
    expect(candidates).toContain('#### 爱范儿\n1. 爱范儿四\n2. 爱范儿一\n3. 爱范儿二\n4. 爱范儿三\n5. 爱范儿五\n6. 爱范儿六')
    expect(candidates).toContain('#### APPSO\n1. APPSO五\n2. APPSO一\n3. APPSO二\n4. APPSO三\n5. APPSO四\n6. APPSO六')
    const markdown = renderFeishuCloudMarkdown(current)
    expect(markdown).toMatch(/^早报｜\n\n插入日期\n\nappso 头图\n\n插入目录/)
    expect(markdown).not.toContain('插入头图')
    expect(markdown).not.toContain('备选标题')
    expect(markdown).toContain('## 重磅')
  })

  it('renders the Saturday reader sections without weekday category headings', () => {
    const current = issue([
      story({ title: '周六新闻' }),
      story({ id: 'weekend', fingerprint: 'weekend', title: '周末看什么｜主选｜电影', category: '好看的', position: 1 }),
    ])
    current.publication_date = '2026-08-01'
    const markdown = renderFeishuCloudMarkdown(current)
    expect(markdown).toContain('### 📰 周末也值得一看的新闻')
    expect(markdown).toContain('### ✨ 是周末啊！')
    expect(markdown).toContain('### 周末看什么｜电影')
    expect(markdown).not.toContain('主选｜')
    expect(markdown).not.toContain('## 大公司')
    expect(markdown).not.toContain('插入头图')
    expect(markdown).not.toContain('备选标题')
  })

  it('creates ids when randomUUID is unavailable on a local HTTP origin', () => {
    const originalCrypto = globalThis.crypto
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(17)
        return bytes
      },
    })
    expect(createClientId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    vi.stubGlobal('crypto', originalCrypto)
  })

  it('never treats an absent story as an implicit deletion', () => {
    const before = issue([story(), story({ id: 'story-b', fingerprint: 'fingerprint-b', title: '第二条', position: 1 })])
    const current = issue([story()])
    const review = buildReviewExport(before, current)
    expect(review.selection_semantics).toBe('explicit_operations_only')
    expect(review.operations).toEqual([])
  })

  it('records only explicit exclude and field updates', () => {
    const before = issue([story(), story({ id: 'story-b', fingerprint: 'fingerprint-b', title: '第二条', position: 1 })])
    const current = issue([
      story({ selected: false, status: 'excluded' }),
      story({ id: 'story-b', fingerprint: 'fingerprint-b', title: '修改后的第二条', body: '修改后的正文。', position: 1 }),
    ])
    const review = buildReviewExport(before, current)
    expect(review.operations.map((operation) => operation.op)).toEqual(['exclude', 'update'])
    expect(review.operations[1]).toMatchObject({
      op: 'update',
      fingerprint: 'fingerprint-b',
      changes: { title: '修改后的第二条', body: '修改后的正文。' },
    })
  })

  it('replays only the explicit operations over a fresh snapshot', () => {
    const before = issue([story(), story({ id: 'story-b', fingerprint: 'fingerprint-b', title: '第二条', position: 1 })])
    const current = issue([
      story({ selected: false, status: 'excluded' }),
      story({ id: 'story-b', fingerprint: 'fingerprint-b', title: '新标题', position: 1 }),
    ])
    const review = buildReviewExport(before, current)

    const replayed = applyReviewOperations(before, review.operations)

    expect(replayed.stories.find((item) => item.id === 'story-a')).toMatchObject({ selected: false, status: 'excluded' })
    expect(replayed.stories.find((item) => item.id === 'story-b')).toMatchObject({ selected: true, title: '新标题' })
    expect(replayed.selected_count).toBe(1)
  })
})
