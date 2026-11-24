import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/react'
import { markdownExtensions } from './MarkdownEditor'

describe('inline Markdown document fidelity', () => {
  it('preserves the plugin caption syntax as an independent paragraph', () => {
    const editor = new Editor({ extensions: markdownExtensions(), contentType: 'markdown', content: '![图片](https://example.com/a.png)\n\n图｜图片来源\n\n正文' })
    expect(editor.getHTML()).toContain('class="image-caption"')
    expect(editor.getMarkdown()).toContain('\n\n图｜图片来源\n\n')
    editor.destroy()
  })
  it('keeps rich blocks when a user edits another paragraph', () => {
    const editor = new Editor({ extensions: markdownExtensions(), contentType: 'markdown', content: '# 标题\n\n完整正文和 **重点**。\n\n> 引用内容\n\n- 第一项\n- 第二项\n\n- [x] 已完成\n\n| 项目 | 数值 |\n| --- | --- |\n| A | 12 |\n\n![图片](https://example.com/a.png)' })
    editor.commands.insertContentAt(1, '新增')
    const result = editor.getMarkdown()
    for (const fragment of ['完整正文', '**重点**', '> 引用内容', '第一项', '第二项', '[x]', '12', 'https://example.com/a.png']) expect(result).toContain(fragment)
    editor.destroy()
  })
})
