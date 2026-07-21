import { describe, expect, it } from 'vitest'
import { groupPublicationStories, normalizeStoryCategory, publicationCategories } from './categories'
import type { Story } from './types'

function story(overrides: Partial<Story>): Story {
  return {
    id: 'story-1', issue_id: 'issue-1', fingerprint: 'fingerprint-1', title: '测试选题', body: '正文',
    category: '大公司', status: 'ready', selected: true, position: 0, score: 100,
    source_url: '', source_name: '', source_type: '', source_quality: 'primary', confidence: 1,
    cross_day_status: '', rumor: false, fact_status: 'verified', changed_since_review: false,
    image_url: '', image_path: '', image_token: '', editorial_reason: '', metadata: {}, sources: [], claims: [],
    ...overrides,
  }
}

describe('publication categories', () => {
  it('keeps every formal section visible when some sections are empty', () => {
    const grouped = groupPublicationStories([story({ category: '重磅' })])

    expect(grouped.map(([category]) => category)).toEqual(publicationCategories)
    expect(grouped.find(([category]) => category === '新消费')?.[1]).toEqual([])
  })

  it('moves legacy opinions into 大公司 and legacy product leads into 新产品', () => {
    expect(normalizeStoryCategory(story({ category: '观点', title: '💡 CEO：观点标题' })).category).toBe('大公司')
    expect(normalizeStoryCategory(story({ category: 'AI/开发者', title: '某公司发布新模型' })).category).toBe('新产品')
  })
})
