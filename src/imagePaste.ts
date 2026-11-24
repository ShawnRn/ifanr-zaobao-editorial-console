export type PastedImage = { file: File } | { url: string }

/** File and image-only HTML are covers. A copied article remains rich text. */
export function pastedImage(data: Pick<DataTransfer, 'items' | 'files' | 'getData'> | null): PastedImage | null {
  if (!data) return null
  const file = Array.from(data.items || []).find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
    || Array.from(data.files || []).find(item => item.type.startsWith('image/'))
  if (file) return { file }
  const html = data.getData?.('text/html') || ''
  if (!html) return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script,style,meta').forEach(node => node.remove())
  const images = doc.querySelectorAll('img')
  if (images.length !== 1 || doc.body.textContent?.trim()) return null
  const url = images[0].getAttribute('src') || ''
  const embedded = url.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/i)
  if (embedded) {
    try {
      const bytes = Uint8Array.from(atob(embedded[2].replace(/\s/g, '')), char => char.charCodeAt(0))
      return { file: new File([bytes], 'pasted-image', { type: embedded[1].toLowerCase() }) }
    } catch { return null }
  }
  return /^https?:\/\//i.test(url) ? { url } : null
}
