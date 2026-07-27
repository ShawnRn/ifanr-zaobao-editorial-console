/**
 * Standard RFC 6238 Time-based One-Time Password (TOTP) & Native QR Code Generator.
 * Zero external dependencies. Uses standard Web Crypto API & Pure TS ISO/IEC 18004 QR Generator.
 */

// Base32 Alphabet
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function generateTotpSecret(length = 16): string {
  const bytes = new Uint8Array(length)
  window.crypto.getRandomValues(bytes)
  let result = ''
  for (let i = 0; i < length; i++) {
    result += BASE32_ALPHABET[bytes[i] % 32]
  }
  return result
}

function base32ToBytes(base32: string): Uint8Array {
  const clean = base32.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let value = 0
  const output: number[] = []

  for (let i = 0; i < clean.length; i++) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(clean[i])
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(output)
}

export async function generateTotpCode(secret: string, timestamp = Date.now()): Promise<string> {
  const keyBytes = base32ToBytes(secret)
  const counter = Math.floor(timestamp / 1000 / 30)

  const buffer = new ArrayBuffer(8)
  const view = new DataView(buffer)
  view.setUint32(0, 0, false)
  view.setUint32(4, counter, false)

  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'HMAC', hash: { name: 'SHA-1' } },
    false,
    ['sign'],
  )

  const signature = await window.crypto.subtle.sign('HMAC', cryptoKey, buffer)
  const hash = new Uint8Array(signature)

  const offset = hash[hash.length - 1] & 0xf
  const binary =
    ((hash[offset] & 0x7f) << 24)
    | ((hash[offset + 1] & 0xff) << 16)
    | ((hash[offset + 2] & 0xff) << 8)
    | (hash[offset + 3] & 0xff)

  const otp = binary % 1000000
  return otp.toString().padStart(6, '0')
}

export async function verifyTotpCode(secret: string, code: string): Promise<boolean> {
  const cleanCode = code.trim().replace(/\s+/g, '')
  if (!/^\d{6}$/.test(cleanCode)) return false

  const now = Date.now()
  const offsets = [0, -30000, 30000]
  for (const offset of offsets) {
    const validCode = await generateTotpCode(secret, now + offset)
    if (validCode === cleanCode) return true
  }
  return false
}

export function generateOtpauthUrl(username: string, secret: string, issuer = 'ifanr Zaobao'): string {
  const label = encodeURIComponent(`${issuer}:${username}`)
  const encIssuer = encodeURIComponent(issuer)
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encIssuer}`
}

// ============================================================================
// Single-file Pure TypeScript ISO/IEC 18004 QR Code Matrix Engine
// ============================================================================

class QRBitBuffer {
  buffer: number[] = []
  length = 0

  get(index: number): boolean {
    const bufIndex = Math.floor(index / 8)
    return ((this.buffer[bufIndex] >>> (7 - (index % 8))) & 1) === 1
  }

  put(num: number, length: number): void {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1)
    }
  }

  putBit(bit: boolean): void {
    const bufIndex = Math.floor(this.length / 8)
    if (this.buffer.length <= bufIndex) {
      this.buffer.push(0)
    }
    if (bit) {
      this.buffer[bufIndex] |= 0x80 >>> (this.length % 8)
    }
    this.length++
  }
}

const QRPolynomial = {
  glog(n: number): number {
    if (n < 1) throw new Error(`glog(${n})`)
    return LOG_TABLE[n]
  },
  gexp(n: number): number {
    while (n < 0) n += 255
    while (n >= 255) n -= 255
    return EXP_TABLE[n]
  },
  multiply(p1: number[], p2: number[]): number[] {
    const num = new Array(p1.length + p2.length - 1).fill(0)
    for (let i = 0; i < p1.length; i++) {
      for (let j = 0; j < p2.length; j++) {
        num[i + j] ^= this.gexp(this.glog(p1[i]) + this.glog(p2[j]))
      }
    }
    return num
  },
  mod(num: number[], divisor: number[]): number[] {
    const diff = num.length - divisor.length
    if (diff < 0) return num
    const ratio = this.glog(num[0])
    const res = [...num]
    for (let i = 0; i < divisor.length; i++) {
      res[i] ^= this.gexp(this.glog(divisor[i]) + ratio)
    }
    return this.mod(res.slice(1), divisor)
  },
  errorPoly(errorLength: number): number[] {
    let e = [1]
    for (let i = 0; i < errorLength; i++) {
      e = this.multiply(e, [1, this.gexp(i)])
    }
    return e;
  },
}

const EXP_TABLE = new Array(256).fill(0)
const LOG_TABLE = new Array(256).fill(0)
for (let i = 0; i < 8; i++) EXP_TABLE[i] = 1 << i
for (let i = 8; i < 256; i++) {
  EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8]
}
for (let i = 0; i < 255; i++) LOG_TABLE[EXP_TABLE[i]] = i

function createQrModules(text: string): (boolean | null)[][] {
  // Determine version needed (Byte Mode, ECC Level M)
  const bytes = new TextEncoder().encode(text)
  let version = 1
  // Version capacity for Level M byte mode: V1:14, V2:26, V3:42, V4:62, V5:84, V6:106, V7:122, V8:152
  const capacities = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213]
  while (version < 10 && bytes.length > capacities[version]) {
    version++
  }

  const moduleCount = version * 4 + 17
  const modules: (boolean | null)[][] = Array.from({ length: moduleCount }, () => new Array(moduleCount).fill(null))

  // 1. Finder patterns
  const setupFinder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      if (row + r <= -1 || moduleCount <= row + r) continue
      for (let c = -1; c <= 7; c++) {
        if (col + c <= -1 || moduleCount <= col + c) continue
        if ((0 <= r && r <= 6 && (c === 0 || c === 6)) || (0 <= c && c <= 6 && (r === 0 || r === 6)) || (2 <= r && r <= 4 && 2 <= c && c <= 4)) {
          modules[row + r][col + c] = true
        } else {
          modules[row + r][col + c] = false
        }
      }
    }
  }
  setupFinder(0, 0)
  setupFinder(moduleCount - 7, 0)
  setupFinder(0, moduleCount - 7)

  // 2. Alignment patterns (for V2+)
  if (version >= 2) {
    const alignPos: number[][] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]
    const pos = alignPos[version] || []
    for (const r of pos) {
      for (const c of pos) {
        if (modules[r][c] !== null) continue
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            if (Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0)) {
              modules[r + dr][c + dc] = true
            } else {
              modules[r + dr][c + dc] = false
            }
          }
        }
      }
    }
  }

  // 3. Timing patterns
  for (let i = 8; i < moduleCount - 8; i++) {
    if (modules[i][6] === null) modules[i][6] = i % 2 === 0
    if (modules[6][i] === null) modules[6][i] = i % 2 === 0
  }

  // 4. Data payload
  const buffer = new QRBitBuffer()
  buffer.put(0x4, 4) // Mode: Byte
  buffer.put(bytes.length, version < 10 ? 8 : 16)
  for (let i = 0; i < bytes.length; i++) buffer.put(bytes[i], 8)

  // ECC capacities for Level M (dataCodewords, eccCodewordsPerBlock)
  const eccTable: Record<number, [number, number]> = {
    1: [16, 10], 2: [28, 16], 3: [44, 26], 4: [64, 18], 5: [86, 24],
    6: [108, 16], 7: [124, 18], 8: [154, 22], 9: [182, 22], 10: [216, 26],
  }
  const [totalDataBytes, eccPerBlock] = eccTable[version] || [16, 10]

  // Padding
  const padBytes = [0xec, 0x11]
  let padIdx = 0
  while (buffer.length < totalDataBytes * 8) {
    buffer.put(padBytes[padIdx % 2], 8)
    padIdx++
  }

  const dataBytes = buffer.buffer.slice(0, totalDataBytes)
  const poly = QRPolynomial.errorPoly(eccPerBlock)
  const rawPoly = [...dataBytes, ...new Array(eccPerBlock).fill(0)]
  const modPoly = QRPolynomial.mod(rawPoly, poly)

  const finalBytes = [...dataBytes]
  for (let i = 0; i < eccPerBlock; i++) {
    finalBytes.push(modPoly[i] || 0)
  }

  // Interleave and place bit grid
  let bitIdx = 0
  const totalBits = finalBytes.length * 8

  let inc = -1
  let col = moduleCount - 1
  while (col > 0) {
    if (col === 6) col--
    let row = inc === -1 ? moduleCount - 1 : 0
    while (row >= 0 && row < moduleCount) {
      for (let c = 0; c < 2; c++) {
        const r = row
        const cl = col - c
        if (modules[r][cl] === null) {
          let dark = false
          if (bitIdx < totalBits) {
            const bytePos = Math.floor(bitIdx / 8)
            const bitPos = 7 - (bitIdx % 8)
            dark = ((finalBytes[bytePos] >>> bitPos) & 1) === 1
            bitIdx++
          }
          // Apply mask pattern 0: (row + col) % 2 == 0
          const mask = (r + cl) % 2 === 0
          modules[r][cl] = dark !== mask
        }
      }
      row += inc
    }
    inc = -inc
    col -= 2
  }

  // 5. Format info (Mask pattern 0, ECC Level M -> 000000000000000)
  // Mask 0, ECC M (00) -> Format bits for Mask 0 / Level M with BCH(15,5) mask XOR 0x5412
  const formatInfoBits = 0x5412 ^ 0x0000
  for (let i = 0; i < 15; i++) {
    const bit = ((formatInfoBits >>> i) & 1) === 1
    if (i < 6) modules[i][8] = bit
    else if (i < 8) modules[i + 1][8] = bit
    else modules[moduleCount - 15 + i][8] = bit

    if (i < 8) modules[8][moduleCount - 1 - i] = bit
    else if (i < 9) modules[8][15 - i] = bit
    else modules[8][15 - i - 1] = bit
  }
  modules[moduleCount - 8][8] = true

  return modules
}

export function generateQrSvgDataUri(text: string): string {
  try {
    const modules = createQrModules(text)
    const count = modules.length
    const cellSize = 5
    const margin = 15
    const size = count * cellSize + margin * 2

    let paths = ''
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (modules[r][c] === true) {
          const x = margin + c * cellSize
          const y = margin + r * cellSize
          paths += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}"/>`
        }
      }
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <rect width="100%" height="100%" fill="#ffffff"/>
      <g fill="#111111">${paths}</g>
    </svg>`

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  } catch (err) {
    console.error('QR code generation failed:', err)
    return ''
  }
}
