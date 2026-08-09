import type { Story } from './types'

export const publicationCategories = ['重磅', '大公司', '新产品', '新消费', '好看的'] as const

export const publicationCategoryOrder = new Map<string, number>(
  publicationCategories.map((value, index) => [value, index]),
)

const productSignals = /(?:发布|推出|上线|上架|开源|更新|升级|测试|公测|模型|芯片|API|工具|功能|系统|设备|手机|汽车|机器人)/i

export function isOpinionStory(story: Pick<Story, 'title'>): boolean {
  return story.title.trim().startsWith('💡')
}

export function publicationCategoryForStory(story: Pick<Story, 'category' | 'title' | 'body'>): string {
  if (publicationCategoryOrder.has(story.category)) return story.category
  if (story.category === '观点') return '大公司'
  if (story.category === 'AI/开发者' || story.category === '汽车/机器人') {
    return productSignals.test(`${story.title}\n${story.body}`) ? '新产品' : '大公司'
  }
  return '大公司'
}

export function normalizeStoryCategory(story: Story): Story {
  const category = publicationCategoryForStory(story)
  return category === story.category ? story : { ...story, category }
}

export function comparePublicationStories(a: Story, b: Story): number {
  const categoryDelta = (publicationCategoryOrder.get(a.category) ?? 99) - (publicationCategoryOrder.get(b.category) ?? 99)
  if (categoryDelta) return categoryDelta
  if (a.category === '大公司') {
    const opinionDelta = Number(isOpinionStory(a)) - Number(isOpinionStory(b))
    if (opinionDelta) return opinionDelta
  }
  return a.position - b.position
}

export function groupPublicationStories(stories: Story[]): Array<readonly [string, Story[]]> {
  const groups = new Map<string, Story[]>()
  stories.forEach((story) => groups.set(story.category, [...(groups.get(story.category) || []), story]))
  return publicationCategories.map((category) => [category, groups.get(category) || []] as const)
}
