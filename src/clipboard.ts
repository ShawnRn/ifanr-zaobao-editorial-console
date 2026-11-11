export async function writeClipboardText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the synchronous copy path. It remains available on
      // the HTTP-hosted editorial console where Clipboard API is restricted.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.setAttribute('aria-hidden', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)

  try {
    return typeof document.execCommand === 'function' && document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

async function fetchClipboardPng(imageUrl: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(imageUrl, { signal })
  if (!response.ok) throw new Error('微博配图下载失败')
  const source = await response.blob()
  if (source.type === 'image/png') return source
  if (!source.type.startsWith('image/')) throw new Error('微博配图格式无效')

  const bitmap = await createImageBitmap(source)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  try {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('微博配图无法转换为 PNG')
    context.drawImage(bitmap, 0, 0)
  } finally {
    bitmap.close()
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((png) => {
      if (png) resolve(png)
      else reject(new Error('微博配图无法转换为 PNG'))
    }, 'image/png')
  })
}

export async function writeClipboardImage(imageUrl: string): Promise<boolean> {
  if (!imageUrl || !navigator.clipboard?.write || !window.isSecureContext || typeof ClipboardItem === 'undefined') {
    return false
  }

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 4000)
  const image = fetchClipboardPng(imageUrl, controller.signal)
  // The browser must receive the write during the click, before the image finishes downloading.
  void image.catch(() => {}) // A browser may reject the write before reading the image promise.
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })])
    return true
  } catch {
    return false
  } finally {
    window.clearTimeout(timeout)
    controller.abort()
  }
}
