import { afterEach, describe, expect, it, vi } from 'vitest'
import QRCode from 'qrcode'
import { writeClipboardText } from './App'
import { writeClipboardTextAndImage } from './clipboard'
import { generateQrSvgDataUri } from './totp'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('two-factor setup utilities', () => {
  it('renders every module from the standards-compliant QR encoder with a four-module quiet zone', () => {
    const value = 'otpauth://totp/ifanr%20Zaobao:test?secret=JBSWY3DPEHPK3PXP&issuer=ifanr%20Zaobao'
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' })
    const svg = decodeURIComponent(generateQrSvgDataUri(value).split(',')[1])

    expect(svg).toContain(`viewBox="0 0 ${qr.modules.size + 8} ${qr.modules.size + 8}"`)
    expect((svg.match(/<rect x=/g) || []).length).toBe(
      Array.from(qr.modules.data).filter(Boolean).length,
    )
    expect(svg).toContain('shape-rendering="crispEdges"')
  })

  it('uses the Clipboard API on secure pages', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    await expect(writeClipboardText('setup-secret')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('setup-secret')
  })

  it('falls back to the legacy copy command on the HTTP-hosted console', async () => {
    const execCommand = vi.fn(() => true)
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    await expect(writeClipboardText('setup-secret')).resolves.toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea[aria-hidden="true"]')).toBeNull()
  })

  it('starts the rich clipboard write before the Weibo image arrives', async () => {
    let finishDownload!: (response: Response) => void
    const fetchImage = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((resolve) => {
      finishDownload = resolve
    }))
    const png = new Blob(['png'], { type: 'image/png' })
    const write = vi.fn(async ([item]: TestClipboardItem[]) => { await item.data['image/png'] })
    class TestClipboardItem {
      constructor(readonly data: Record<string, Blob | Promise<Blob>>) {}
    }
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } })
    Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: TestClipboardItem })

    const result = writeClipboardTextAndImage('微博正文', '/story.png')
    expect(write).toHaveBeenCalledOnce()
    expect(fetchImage).toHaveBeenCalledWith('/story.png', { signal: expect.any(AbortSignal) })
    const item = write.mock.calls[0][0][0]
    expect(Object.keys(item.data)).toEqual(['text/plain', 'image/png'])

    finishDownload({ ok: true, blob: async () => png } as Response)
    await expect(item.data['image/png']).resolves.toBe(png)
    await expect(result).resolves.toEqual({ copied: true, imageCopied: true })
  })

  it('copies Weibo text when the image download times out', async () => {
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
    }))
    class TestClipboardItem {
      constructor(readonly data: Record<string, Blob | Promise<Blob>>) {}
    }
    const write = vi.fn(async ([item]: TestClipboardItem[]) => { await item.data['image/png'] })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write, writeText } })
    Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: TestClipboardItem })

    const result = writeClipboardTextAndImage('微博正文', '/slow.jpg')
    await vi.advanceTimersByTimeAsync(4000)
    await expect(result).resolves.toEqual({ copied: true, imageCopied: false })
    expect(writeText).toHaveBeenCalledWith('微博正文')
  })
})
