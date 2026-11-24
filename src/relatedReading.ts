export const relatedReadingPrefix = /^(?:🔗\s*)?(?:(APPSO|爱范儿)\s*)?相关阅读\s*(?:[（(【]\s*(APPSO|爱范儿)\s*[）)】])?\s*[：:]\s*$/i
export function isRelatedReadingPrefix(text: string) { return relatedReadingPrefix.test(text) }
export function normalizeRelatedReadingPrefix(text: string) {
  const match = text.match(relatedReadingPrefix)
  if (!match) return text
  const raw = match[1] || match[2]
  const brand = raw?.toUpperCase() === 'APPSO' ? 'APPSO' : raw
  return relatedReadingLabel(brand)
}

const relatedLine = /^(?:🔗\s*)?(?:(APPSO|爱范儿)\s*)?相关阅读\s*(?:[（(【]\s*(APPSO|爱范儿)\s*[）)】])?\s*[：:]/i
const scope = (brand?: string) => /^(appso)$/i.test(brand || '') ? 'appso' : /^(爱范儿|ifanr)$/i.test(brand || '') ? 'ifanr' : ''
export function relatedReadingLabel(brand?: string) {
  const normalized = scope(brand)
  const label = normalized === 'appso' ? 'APPSO' : normalized === 'ifanr' ? '爱范儿' : ''
  return `🔗 相关阅读${label ? `（${label}）` : ''}：`
}

export function stripTrailingStorySeparators(body: string) {
  const lines = body.trimEnd().split('\n')
  while (/^(?:\\?-){3,}$/.test(lines.at(-1)?.trim() || '')) {
    lines.pop()
    while (lines.length && !lines.at(-1)?.trim()) lines.pop()
  }
  return lines.join('\n').trimEnd()
}

const linkKey = (url: string, brand?: string) => {
  try { const parsed = new URL(url); parsed.hash = ''; return `${scope(brand)}:${parsed.href}` } catch { return `${scope(brand)}:${url}` }
}
export type RelatedLink = { title: string; url: string; brand?: string }
export function bodyRelatedLinks(body: string): RelatedLink[] {
  const links: RelatedLink[] = []
  for (const line of body.split('\n')) {
    const marker = line.trim().match(relatedLine)
    if (!marker) continue
    const link = line.trim().slice(marker[0].length).trim().match(/^\[((?:\\.|[^\]\\\n])+)\]\((https?:\/\/[^\s]+)\)$/)
    if (!link) continue
    const brand = scope(marker[1] || marker[2])
    links.push({ title: link[1].replace(/\\([\[\]\\])/g, '$1'), url: link[2], ...(brand ? { brand } : {}) })
  }
  return links
}
export function allRelatedLinks(story: { body: string; metadata: Record<string, unknown> }): RelatedLink[] {
  const seen = new Set<string>()
  return [...bodyRelatedLinks(story.body), ...additionalRelatedLinks(story)].filter(link => {
    const key = linkKey(link.url, link.brand)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
export function replaceBodyRelatedLinks(body: string, links: RelatedLink[]): string {
  const base = body.split('\n').filter(line => !bodyRelatedLinks(line).length).join('\n').trimEnd()
  const seen = new Set<string>()
  const suffix = links.filter(link => {
    const key = linkKey(link.url, link.brand)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).map(link => `${relatedReadingLabel(link.brand)}[${link.title.replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]')}](${link.url})`).join('\n\n')
  return base + (base && suffix ? '\n\n' : '') + suffix
}
/** Body links take display precedence; stored editor choices remain recoverable. */
export function additionalRelatedLinks(story: { body: string; metadata: Record<string, unknown> }): Array<{ title: string; url: string; brand?: string }> {
  const seen = new Set<string>()
  for (const line of story.body.split('\n')) {
    const marker = line.trim().match(relatedLine)
    if (!marker) continue
    for (const url of line.match(/https?:\/\/[^\s<>)\]"']+/g) || []) seen.add(linkKey(url, marker[1] || marker[2]))
  }
  const links: Array<{ title: string; url: string; brand?: string }> = []
  for (const raw of Array.isArray(story.metadata.related_links) ? story.metadata.related_links : []) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as { title?: unknown; url?: unknown; brand?: string }
    if (typeof item.title !== 'string' || typeof item.url !== 'string' || !/^https?:\/\//.test(item.url)) continue
    const key = linkKey(item.url, item.brand)
    if (seen.has(key)) continue
    seen.add(key)
    const brand = scope(item.brand)
    links.push({ title: item.title, url: item.url, ...(brand ? { brand } : {}) })
  }
  return links
}
