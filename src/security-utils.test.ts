import { afterEach, describe, expect, it, vi } from 'vitest'
import QRCode from 'qrcode'
import { writeClipboardText } from './App'
import { generateQrSvgDataUri } from './totp'

afterEach(() => {
  vi.restoreAllMocks()
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
})
