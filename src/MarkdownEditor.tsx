import { isRelatedReadingPrefix, normalizeRelatedReadingPrefix } from './relatedReading'
import Paragraph from '@tiptap/extension-paragraph'
import { TableKit } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { useEffect, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'

const CaptionParagraph = Paragraph.extend({
  renderHTML({ node, HTMLAttributes }) {
    return ['p', { ...HTMLAttributes, ...( /^图[｜|]/.test(node.textContent.trim()) ? { class: 'image-caption' } : {}) }, 0]
  },
})

export const markdownExtensions = (title = false) => [StarterKit.configure({ paragraph: false, heading: title ? false : { levels: [1, 2, 3, 4, 5, 6] }, link: { openOnClick: false } }), CaptionParagraph, Markdown, TableKit, Image, TaskList, TaskItem.configure({ nested: true })]

function paintCaptions(element: HTMLElement) {
  element.querySelectorAll('p').forEach(p => p.classList.toggle('image-caption', /^图[｜|]/.test(p.textContent?.trim() || '')))
}

export function MarkdownEditor({ value, onChange, onComposition, title = false, label, resolveRelatedLink }: {
  value: string; onChange: (value: string) => void; onComposition: (active: boolean) => void; title?: boolean; label: string; resolveRelatedLink?: (url: string) => Promise<{ title: string; url: string }>
}) {
  const callbacks = useRef({ onChange, onComposition, resolveRelatedLink })
  callbacks.current = { onChange, onComposition, resolveRelatedLink }
  const lastEmitted = useRef(value)
  const editor = useEditor({
    shouldRerenderOnTransaction: false,
    extensions: markdownExtensions(title),
    content: value, contentType: 'markdown',
    editorProps: {
      handlePaste: (view, event) => {
        // The story wrapper owns cover uploads, including HTML-only images.
        if (event.defaultPrevented) return true
        const url = event.clipboardData?.getData('text/plain').trim() || ''
        const { $from } = view.state.selection
        if (!/^https?:\/\/[^\s]+$/.test(url) || !isRelatedReadingPrefix($from.parent.textBetween(0, $from.parentOffset)) || !callbacks.current.resolveRelatedLink) return false
        event.preventDefault()
        const mark = view.state.schema.marks.link.create({ href: url })
        const prefix = $from.parent.textBetween(0, $from.parentOffset)
        const canonical = normalizeRelatedReadingPrefix(prefix)
        const transaction = view.state.tr
        if (prefix !== canonical) transaction.insertText(canonical, $from.start(), $from.pos)
        view.dispatch(transaction.replaceSelectionWith(view.state.schema.text(url, [mark]), false))
        void callbacks.current.resolveRelatedLink(url).then(result => {
          if (view.isDestroyed || !result.title) return
          // Locate the untouched URL in the current document, never replay an old snapshot.
          let match: { from: number; to: number } | undefined
          view.state.doc.descendants((node, pos, parent) => {
            if (!match && node.isText && node.text === url && node.marks.some(m => m.type.name === 'link' && m.attrs.href === url) && parent && /^🔗.*相关阅读/.test(parent.textContent)) match = { from: pos, to: pos + node.nodeSize }
          })
          if (match) view.dispatch(view.state.tr.replaceWith(match.from, match.to, view.state.schema.text(result.title, [mark])))
        }).catch(() => { /* The original link remains editable and is already backed up. */ })
        return true
      },
      attributes: { role: 'textbox', 'aria-label': label, 'aria-multiline': String(!title), spellcheck: 'false' },
      handleDOMEvents: {
        compositionstart: () => { callbacks.current.onComposition(true); return false },
        compositionend: () => {
          callbacks.current.onComposition(false)
          queueMicrotask(() => { if (editor && !editor.isDestroyed) emit(editor) })
          return false
        },
      },
    },
    onCreate: ({ editor: created }) => paintCaptions(created.view.dom),
    onUpdate: ({ editor: updated }) => { paintCaptions(updated.view.dom); emit(updated) },
  })
  function emit(updated: NonNullable<typeof editor>) {
    const next = title ? updated.getText({ blockSeparator: ' ' }) : updated.getMarkdown()
    lastEmitted.current = next
    callbacks.current.onChange(next)
  }
  useEffect(() => {
    if (!editor || value === lastEmitted.current || editor.isFocused) return
    lastEmitted.current = value
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
  }, [editor, value])
  return title ? <h3 className="inline-title"><EditorContent editor={editor} /></h3> : <div className="article-body inline-body"><EditorContent editor={editor} /></div>
}
