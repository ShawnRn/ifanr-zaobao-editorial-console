import type { Issue, Story } from './types'
import { comparePublicationStories, publicationCategories } from './categories'

export type ReviewOperation =
  | {
    op: 'exclude'
    story_id: string
    fingerprint: string
    base_title: string
    base_story_digest: string
  }
  | {
    op: 'include'
    story_id: string
    fingerprint: string
    base_title: string
    base_story_digest: string
    story: Pick<Story, 'title' | 'body' | 'category' | 'status' | 'position' | 'source_url' | 'source_name' | 'event_date' | 'disclosed_at'>
  }
  | {
    op: 'update'
    story_id: string
    fingerprint: string
    base_title: string
    base_story_digest: string
    changes: Partial<Pick<Story, 'title' | 'body' | 'category' | 'status' | 'event_date' | 'disclosed_at'>>
  }
  | {
    op: 'reorder'
    category: string
    ordered_stories: Array<{ story_id: string; fingerprint: string; title: string }>
  }

export type EditorialReviewExport = {
  schema: 'ifanr_editorial_review'
  schema_version: 1
  export_id: string
  review_session_id: string
  issue_id: string
  publication_date: string
  base_revision: number
  base_digest: string
  created_at: string
  selection_semantics: 'explicit_operations_only'
  safety: {
    absent_story_means_delete: false
    stale_conflict_policy: 'preserve_and_review'
  }
  operations: ReviewOperation[]
}

const editableFields = ['title', 'body', 'category', 'status', 'event_date', 'disclosed_at'] as const

function storyDigest(story: Story): string {
  const payload = [story.fingerprint, story.title, story.body, story.category, story.source_url, story.updated_at || ''].join('\n')
  let hash = 2166136261
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function issueDigest(issue: Issue): string {
  const stored = issue.diagnostics?.public_snapshot
  if (stored && typeof stored === 'object' && 'digest' in stored && typeof stored.digest === 'string') return stored.digest
  return issue.stories.map(storyDigest).join('-')
}

export function buildReviewExport(base: Issue, current: Issue, reviewSessionId?: string): EditorialReviewExport {
  const operations: ReviewOperation[] = []
  const baseById = new Map(base.stories.map((story) => [story.id, story]))
  const currentById = new Map(current.stories.map((story) => [story.id, story]))

  base.stories.forEach((before) => {
    const after = currentById.get(before.id)
    if (!after) return
    const wasSelected = before.selected && before.status !== 'excluded'
    const isSelected = after.selected && after.status !== 'excluded'
    if (wasSelected && !isSelected) {
      operations.push({
        op: 'exclude',
        story_id: before.id,
        fingerprint: before.fingerprint,
        base_title: before.title,
        base_story_digest: storyDigest(before),
      })
      return
    }
    if (!wasSelected && isSelected) {
      operations.push({
        op: 'include',
        story_id: after.id,
        fingerprint: after.fingerprint,
        base_title: before.title,
        base_story_digest: storyDigest(before),
        story: {
          title: after.title,
          body: after.body,
          category: after.category,
          status: after.status,
          position: after.position,
          source_url: after.source_url,
          source_name: after.source_name,
          event_date: after.event_date,
          disclosed_at: after.disclosed_at,
        },
      })
      return
    }
    if (!isSelected) return
    const changes: Record<string, unknown> = {}
    editableFields.forEach((field) => {
      if ((before[field] ?? '') !== (after[field] ?? '')) changes[field] = after[field]
    })
    if (Object.keys(changes).length) {
      operations.push({
        op: 'update',
        story_id: after.id,
        fingerprint: after.fingerprint,
        base_title: before.title,
        base_story_digest: storyDigest(before),
        changes,
      } as ReviewOperation)
    }
  })

  current.stories.forEach((story) => {
    if (baseById.has(story.id) || !story.selected || story.status === 'excluded') return
    operations.push({
      op: 'include',
      story_id: story.id,
      fingerprint: story.fingerprint,
      base_title: story.title,
      base_story_digest: storyDigest(story),
      story: {
        title: story.title,
        body: story.body,
        category: story.category,
        status: story.status,
        position: story.position,
        source_url: story.source_url,
        source_name: story.source_name,
        event_date: story.event_date,
        disclosed_at: story.disclosed_at,
      },
    })
  })

  const categories = new Set(current.stories.filter((story) => story.selected && story.status !== 'excluded').map((story) => story.category))
  categories.forEach((category) => {
    const before = base.stories.filter((story) => story.selected && story.status !== 'excluded' && story.category === category).sort((a, b) => a.position - b.position)
    const after = current.stories.filter((story) => story.selected && story.status !== 'excluded' && story.category === category).sort((a, b) => a.position - b.position)
    const beforeIds = before.map((story) => story.id).join('|')
    const afterIds = after.map((story) => story.id).join('|')
    const sameStories = before.length === after.length && before.every((story) => after.some((item) => item.id === story.id))
    if (sameStories && beforeIds !== afterIds && beforeIds && afterIds) {
      operations.push({
        op: 'reorder',
        category,
        ordered_stories: after.map((story) => ({ story_id: story.id, fingerprint: story.fingerprint, title: story.title })),
      })
    }
  })

  return {
    schema: 'ifanr_editorial_review',
    schema_version: 1,
    export_id: crypto.randomUUID(),
    review_session_id: reviewSessionId || crypto.randomUUID(),
    issue_id: base.id,
    publication_date: base.publication_date,
    base_revision: base.revision,
    base_digest: issueDigest(base),
    created_at: new Date().toISOString(),
    selection_semantics: 'explicit_operations_only',
    safety: {
      absent_story_means_delete: false,
      stale_conflict_policy: 'preserve_and_review',
    },
    operations,
  }
}

export function applyReviewOperations(base: Issue, operations: ReviewOperation[]): Issue {
  let stories = structuredClone(base.stories)
  const findStory = (storyId: string, fingerprint: string) => stories.find((story) => story.id === storyId && story.fingerprint === fingerprint)

  operations.forEach((operation) => {
    if (operation.op === 'reorder') {
      const positions = new Map(operation.ordered_stories.map((item, index) => [item.story_id, index]))
      stories = stories.map((story) => story.category === operation.category && positions.has(story.id)
        ? { ...story, position: positions.get(story.id) || 0 }
        : story)
      return
    }
    const story = findStory(operation.story_id, operation.fingerprint)
    if (!story) return
    if (operation.op === 'exclude') {
      stories = stories.map((item) => item.id === story.id ? { ...item, selected: false, status: 'excluded' } : item)
      return
    }
    if (operation.op === 'include') {
      stories = stories.map((item) => item.id === story.id ? { ...item, ...operation.story, selected: true } : item)
      return
    }
    stories = stories.map((item) => item.id === story.id ? { ...item, ...operation.changes } : item)
  })

  const selected = stories.filter((story) => story.selected && story.status !== 'excluded')
  return {
    ...base,
    stories,
    selected_count: selected.length,
    ready_count: selected.filter((story) => story.status === 'ready').length,
    review_count: stories.filter((story) => story.status === 'needs_review' || story.changed_since_review).length,
  }
}

export function renderIssueMarkdown(issue: Issue): string {
  const stories = issue.stories.filter((story) => story.selected && story.status !== 'excluded')
  const sections = publicationCategories.map((category) => {
    const blocks = stories
      .filter((story) => story.category === category)
      .sort(comparePublicationStories)
      .map((story) => {
        const sourceLine = typeof story.metadata.source_line === 'string'
          ? story.metadata.source_line
          : story.source_url ? `🔗 原文链接：${story.source_url}` : ''
        return [`### ${story.title}`, story.body.trim(), sourceLine].filter(Boolean).join('\n\n')
      })
    return [`## ${category}`, ...blocks].join('\n\n')
  })
  return [`# 早报｜${issue.publication_date}`, ...sections].join('\n\n').trim() + '\n'
}

export function downloadText(filename: string, content: string, type = 'application/json;charset=utf-8') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
