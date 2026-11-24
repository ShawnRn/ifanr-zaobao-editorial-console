import { expect, it } from 'vitest'
import { isRelatedReadingPrefix, normalizeRelatedReadingPrefix } from './relatedReading'
it('recognizes common and brand-specific related reading without matching ordinary prose', () => {
  for (const prefix of ['相关阅读：', '🔗 相关阅读：', '🔗 相关阅读（APPSO）：', '🔗 相关阅读（爱范儿）：', '🔗 APPSO 相关阅读：']) expect(isRelatedReadingPrefix(prefix)).toBe(true)
  for (const prefix of ['原文链接：', '正文中的 https://example.com']) expect(isRelatedReadingPrefix(prefix)).toBe(false)
})

it('normalizes forgiving routing input to full-width punctuation', () => {
  expect(normalizeRelatedReadingPrefix('🔗 相关阅读( appso ) : ')).toBe('🔗 相关阅读（APPSO）：')
  expect(normalizeRelatedReadingPrefix('🔗 相关阅读 (爱范儿):')).toBe('🔗 相关阅读（爱范儿）：')
})

import { additionalRelatedLinks, relatedReadingLabel, stripTrailingStorySeparators } from './relatedReading'
it('keeps one related link when the same article is present in the body and metadata', () => {
  const link = { title: '拓竹文章', url: 'https://example.com/article' }
  expect(additionalRelatedLinks({ body: '🔗 相关阅读：[正文标题](https://example.com/article#part)', metadata: { related_links: [link, link] } })).toEqual([])
  expect(additionalRelatedLinks({ body: '普通来源 https://example.com/article', metadata: { related_links: [link, link] } })).toEqual([link])
})
it('preserves common fallback links when only one brand has an inline link', () => {
  const common = { title: '通用文章', url: 'https://example.com/article' }
  expect(additionalRelatedLinks({ body: '🔗 相关阅读（APPSO）：[文章](https://example.com/article)', metadata: { related_links: [common] } })).toEqual([common])
})


it('keeps scoped metadata for copy and only removes separators at the end', () => {
  const link = { title: 'APPSO 文章', url: 'https://example.com/article', brand: 'appso' }
  expect(additionalRelatedLinks({ body: '', metadata: { related_links: [link] } })).toEqual([link])
  expect(relatedReadingLabel(link.brand)).toBe('🔗 相关阅读（APPSO）：')
  expect(stripTrailingStorySeparators('上段。\n\n---\n\n下段。\n\n---')).toBe('上段。\n\n---\n\n下段。')
})

import { allRelatedLinks, replaceBodyRelatedLinks } from './relatedReading'
it('shares body and sidebar choices while retaining brand identity and ordinary source lines', () => {
  const body = '正文。\n\n🔗 来源：https://example.com/source\n\n🔗 相关阅读（APPSO）：[正文标题](https://example.com/a#part)'
  const links = allRelatedLinks({ body, metadata: { related_links: [{title:'旧标题',url:'https://example.com/a',brand:'appso'},{title:'另一篇',url:'https://example.com/b'}] } })
  expect(links).toHaveLength(2)
  expect(links[0].title).toBe('正文标题')
  const next = replaceBodyRelatedLinks(body, links.slice(1))
  expect(next).toContain('🔗 来源：https://example.com/source')
  expect(next).not.toContain('正文标题')
  expect(allRelatedLinks({body:next,metadata:{}})).toEqual(links.slice(1))
})
