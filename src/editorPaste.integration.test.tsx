import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DetailPanel } from './App'
import { api } from './api'
import type { Story } from './types'

const story = { id:'isolated-paste',issue_id:'fixture',fingerprint:'fixture',title:'粘贴验收',body:'第一段。\n\n第二段。',category:'新产品',status:'ready',selected:true,position:0,score:0,source_url:'',source_name:'',source_type:'draft_source',source_quality:'primary',confidence:1,cross_day_status:'current',rumor:false,fact_status:'verified',changed_since_review:false,image_url:'',image_path:'',image_token:'',editorial_reason:'',metadata:{},sources:[],claims:[] } as Story

afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('intercepts image HTML before the real ProseMirror paste handler and retains both paragraphs', async () => {
  const downloaded = {...story,image_path:'/isolated/cover.png',metadata:{_image_manual_state:'set'}}
  const download = vi.spyOn(api,'downloadStoryImage').mockResolvedValue(downloaded)
  const changed = vi.fn()
  render(<DetailPanel inline story={story} staticMode={false} onPatch={vi.fn()} onAction={vi.fn()} onClose={vi.fn()} onImageChange={changed}/>)
  const body = screen.getByLabelText('正文：isolated-paste')
  const accepted = fireEvent.paste(body,{clipboardData:{items:[],files:[],types:['text/html'],getData:(type:string)=> type==='text/html'?'<img src="https://example.com/copied.png">':''}})
  expect(accepted).toBe(false)
  await waitFor(()=>expect(download).toHaveBeenCalledExactlyOnceWith(story.id,'https://example.com/copied.png'))
  expect(body.textContent).toContain('第一段。')
  expect(body.textContent).toContain('第二段。')
  expect(body.querySelector('img')).toBeNull()
  expect(changed).toHaveBeenCalledWith(downloaded)
})
