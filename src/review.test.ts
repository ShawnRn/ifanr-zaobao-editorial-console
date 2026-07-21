import { describe, expect, it, vi } from 'vitest'
import { applyReviewOperations, buildReviewExport } from './review'
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
