import QRCode from 'qrcode'

/**
 * Render a standards-compliant QR symbol from qrcode's tested encoder.
 *
 * Keeping the SVG assembly local gives the UI a crisp, integer-aligned image,
 * while delegating version selection, block interleaving, BCH format data,
 * masking, and Reed–Solomon error correction to the library.
 */
export function generateQrSvgDataUri(text: string): string {
  if (!text) return ''

  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const moduleCount = qr.modules.size
  const quietZone = 4
  const viewBoxSize = moduleCount + quietZone * 2
  const darkModules: string[] = []

  for (let row = 0; row < moduleCount; row++) {
    for (let column = 0; column < moduleCount; column++) {
      if (qr.modules.get(row, column)) {
        darkModules.push(`<rect x="${column + quietZone}" y="${row + quietZone}" width="1" height="1"/>`)
      }
    }
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" shape-rendering="crispEdges">`,
    '<rect width="100%" height="100%" fill="#fff"/>',
    `<g fill="#111">${darkModules.join('')}</g>`,
    '</svg>',
  ].join('')

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
