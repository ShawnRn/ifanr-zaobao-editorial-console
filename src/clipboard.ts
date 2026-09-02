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

export type ClipboardWriteResult = {
  copied: boolean
  imageCopied: boolean
}

async function fetchClipboardPng(imageUrl: string): Promise<Blob | null> {
  try {
    const response = await fetch(imageUrl)
    if (!response.ok) return null
    const source = await response.blob()
    if (!source.type.startsWith('image/')) return null
    if (source.type === 'image/png') return source
    if (typeof createImageBitmap !== 'function') return null

    const bitmap = await createImageBitmap(source)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close()
      return null
    }
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  } catch {
    return null
  }
}

export async function writeClipboardTextAndImage(text: string, imageUrl: string): Promise<ClipboardWriteResult> {
  if (imageUrl && navigator.clipboard?.write && window.isSecureContext && typeof ClipboardItem !== 'undefined') {
    const image = await fetchClipboardPng(imageUrl)
    if (image) {
      try {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'image/png': image,
        })])
        return { copied: true, imageCopied: true }
      } catch {
        // Some browsers expose rich clipboard APIs but reject mixed text and
        // image payloads. Preserve the user's text through the normal path.
      }
    }
  }

  return { copied: await writeClipboardText(text), imageCopied: false }
}
