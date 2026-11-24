import { expect, it } from 'vitest'
import { pastedImage } from './imagePaste'
const htmlData = (html: string) => ({ items: [], files: [], getData: (type: string) => type === 'text/html' ? html : '' })
it('recognizes browser image-only HTML without inserting an image into the article', () => {
  expect(pastedImage(htmlData('<a href="https://example.com"><img src="https://example.com/a.png"></a>'))).toEqual({ url: 'https://example.com/a.png' })
  expect(pastedImage(htmlData('<p>原文正文</p><img src="https://example.com/a.png">'))).toBeNull()
})
it('uses clipboard bytes in preference to expiring HTML URLs and accepts embedded image bytes', async () => {
  const file = new File(['image'], 'a.png', { type: 'image/png' })
  expect(pastedImage({ ...htmlData('<img src="https://example.com/a.png">'), files: [file] })).toEqual({ file })
  const embedded = pastedImage(htmlData('<img src="data:image/png;base64,aW1hZ2U=">'))
  expect(embedded && 'file' in embedded && embedded.file.type).toBe('image/png')
})
