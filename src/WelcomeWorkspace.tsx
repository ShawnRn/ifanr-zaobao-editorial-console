import {
  BookOpen,
  Calendar,
  Clock,
  Copy,
  ExternalLink,
  FileCode2,
  FileEdit,
  FilePlus2,
  FileText,
  Grid2X2,
  List,
  Newspaper,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Users,
  Wand2,
  Zap,
} from 'lucide-react'
import { useState, useMemo } from 'react'
import type { Issue } from './types'

export type FlashDraftItem = {
  id: string
  title: string
  body: string
  category: string
  sourceUrl?: string
  imageUrl?: string
  content?: string
  keyPoints?: string[]
  publishedDoc?: {
    document_url: string
    document_title: string
  }
  updatedAt: number
  authorName?: string
}

export type WelcomeWorkspaceProps = {
  issue: Issue | null
  currentUserName?: string
  drafts: FlashDraftItem[]
  onOpenDraft: (draft: FlashDraftItem) => void
  onNewFlashNews: () => void
  onSwitchView: (view: 'draft' | 'candidates' | 'trash' | 'brands' | 'weekend' | 'flash' | 'home') => void
  onDeleteDraft: (id: string) => void
  onCopyDraftMarkdown: (draft: FlashDraftItem) => void
  onOpenSettings?: (tab?: 'ai' | 'worker' | 'appearance' | 'users') => void
  onOpenAuthDialog?: () => void
}

const TEMPLATES = [
  {
    id: 'blank',
    title: '空白即时快讯',
    desc: '从头开始粘贴线索或链接，AI 智能撰写并发布',
    icon: Plus,
    badge: '最常用',
    action: 'new_flash',
  },
  {
    id: 'hardware',
    title: '硬件新品首发',
    desc: '聚焦工业设计、屏幕形态、核心规格与发售价格',
    icon: Sparkles,
    badge: '模板',
    action: 'hardware',
  },
  {
    id: 'financial',
    title: '大公司财报与并购',
    desc: '严格核对金额与十进制换算，提炼核心商业动向',
    icon: FileText,
    badge: '规范',
    action: 'financial',
  },
  {
    id: 'morning_board',
    title: '早报今日大盘',
    desc: '查看今日 Folo 发现、事件聚类与正式排版大盘',
    icon: Newspaper,
    badge: '大盘',
    action: 'view_morning',
  },
]

export function WelcomeWorkspace({
  issue,
  currentUserName,
  drafts,
  onOpenDraft,
  onNewFlashNews,
  onSwitchView,
  onDeleteDraft,
  onCopyDraftMarkdown,
}: WelcomeWorkspaceProps) {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [searchFilter, setSearchFilter] = useState('')
  const [activeFilterTab, setActiveFilterTab] = useState<'all' | 'flash' | 'published'>('all')

  const filteredDrafts = useMemo(() => {
    return drafts.filter((d) => {
      if (activeFilterTab === 'published' && !d.publishedDoc) return false
      if (activeFilterTab === 'flash' && d.publishedDoc) return false
      if (!searchFilter.trim()) return true
      const q = searchFilter.toLowerCase()
      return (
        d.title.toLowerCase().includes(q) ||
        d.body.toLowerCase().includes(q) ||
        d.category?.toLowerCase().includes(q)
      )
    })
  }, [drafts, activeFilterTab, searchFilter])

  const formatRelativeTime = (timestamp: number) => {
    const diffSec = Math.max(1, Math.floor((Date.now() - timestamp) / 1000))
    if (diffSec < 60) return '刚刚'
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`
    const date = new Date(timestamp)
    return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }

  const userGreetingName = currentUserName || 'Shawn Rain'

  return (
    <div className="welcome-workspace-container">
      {/* 顶部问候与快速操作 Banner */}
      <div className="welcome-hero-banner">
        <div className="welcome-greeting-section">
          <h1 className="welcome-greeting-title">
            欢迎使用 早报编辑台，{userGreetingName}
          </h1>
          <p className="welcome-greeting-sub">
            今日刊期：<span className="hero-issue-pill">BOT DRAFT · {issue?.publication_date || '未连接刊期'}</span>
            <span className="hero-status-dot" /> 服务端已就绪，随时开始创作与发布。
          </p>
        </div>

        <div className="welcome-quick-actions">
          <button
            type="button"
            className="welcome-action-btn primary"
            onClick={onNewFlashNews}
          >
            <Zap size={16} /> 新建即时快讯
          </button>
          <button
            type="button"
            className="welcome-action-btn"
            onClick={() => onSwitchView('draft')}
          >
            <Newspaper size={16} /> 打开今日早报
          </button>
        </div>
      </div>

      {/* 模板与新建卡片行 (Word 风格) */}
      <div className="welcome-templates-section">
        <div className="section-header-row">
          <div className="welcome-section-title">快捷新建与模板</div>
        </div>
        <div className="welcome-templates-grid">
          {TEMPLATES.map((tmpl) => {
            const Icon = tmpl.icon
            return (
              <div
                key={tmpl.id}
                className="welcome-template-card"
                onClick={() => {
                  if (tmpl.action === 'view_morning') onSwitchView('draft')
                  else onNewFlashNews()
                }}
              >
                <div className="template-icon-wrapper">
                  <Icon size={22} />
                </div>
                <div className="template-info">
                  <div className="template-title-row">
                    <strong>{tmpl.title}</strong>
                    <span className="template-badge">{tmpl.badge}</span>
                  </div>
                  <p>{tmpl.desc}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 最近使用项 (Photoshop / Word 风格 Grid & List) */}
      <div className="welcome-recents-section">
        <div className="recents-header-bar">
          <div className="recents-tabs-group">
            <button
              type="button"
              className={`recents-tab-btn ${activeFilterTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveFilterTab('all')}
            >
              全部草稿 ({drafts.length})
            </button>
            <button
              type="button"
              className={`recents-tab-btn ${activeFilterTab === 'published' ? 'active' : ''}`}
              onClick={() => setActiveFilterTab('published')}
            >
              已发布飞书 ({drafts.filter((d) => d.publishedDoc).length})
            </button>
            <button
              type="button"
              className={`recents-tab-btn ${activeFilterTab === 'flash' ? 'active' : ''}`}
              onClick={() => setActiveFilterTab('flash')}
            >
              未发布草稿 ({drafts.filter((d) => !d.publishedDoc).length})
            </button>
          </div>

          <div className="recents-tools-group">
            <div className="recents-search-box">
              <Search size={13} />
              <input
                type="text"
                placeholder="搜索最近稿件..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
              />
            </div>

            <div className="view-mode-toggle">
              <button
                type="button"
                className={`view-mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
                onClick={() => setViewMode('grid')}
                title="网格视图"
              >
                <Grid2X2 size={14} />
              </button>
              <button
                type="button"
                className={`view-mode-btn ${viewMode === 'list' ? 'active' : ''}`}
                onClick={() => setViewMode('list')}
                title="列表视图"
              >
                <List size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* 列表渲染 */}
        {filteredDrafts.length === 0 ? (
          <div className="welcome-empty-state">
            <FileText size={36} style={{ color: 'var(--muted)', opacity: 0.6 }} />
            <h3>暂无最近稿件记录</h3>
            <p>点击上方「新建即时快讯」或「打开今日早报」开始采编工作</p>
            <button type="button" className="flash-btn-primary" onClick={onNewFlashNews} style={{ marginTop: '12px' }}>
              <Zap size={15} /> 立即创建第一篇快讯
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="welcome-recent-grid">
            {filteredDrafts.map((draft) => {
              const charCount = (draft.body || '').replace(/\s+/g, '').length
              return (
                <div
                  key={draft.id}
                  className="recent-grid-card"
                  onClick={() => onOpenDraft(draft)}
                >
                  <div className="card-thumb-area">
                    {draft.imageUrl ? (
                      <img src={draft.imageUrl} alt={draft.title} className="card-cover-img" />
                    ) : (
                      <div className="card-cover-placeholder">
                        <FileCode2 size={28} />
                      </div>
                    )}
                    <span className="card-category-tag">{draft.category || '大公司'}</span>
                    {draft.publishedDoc ? (
                      <span className="card-published-pill">已直出飞书</span>
                    ) : null}
                  </div>

                  <div className="card-content-area">
                    <h4 className="card-title" title={draft.title}>
                      {draft.title || '无标题快讯草稿'}
                    </h4>
                    <p className="card-snippet">
                      {draft.body ? draft.body.slice(0, 80).replace(/[#*`>]/g, '') : '暂无正文内容...'}
                    </p>

                    <div className="card-meta-row">
                      <span className="card-time">
                        <Clock size={11} /> {formatRelativeTime(draft.updatedAt)} · {charCount} 字
                      </span>
                      <div className="card-actions-hover" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="card-mini-btn"
                          title="复制 Markdown"
                          onClick={() => onCopyDraftMarkdown(draft)}
                        >
                          <Copy size={12} />
                        </button>
                        {draft.publishedDoc ? (
                          <a
                            href={draft.publishedDoc.document_url}
                            target="_blank"
                            rel="noreferrer"
                            className="card-mini-btn"
                            title="在飞书中打开"
                          >
                            <ExternalLink size={12} />
                          </a>
                        ) : null}
                        <button
                          type="button"
                          className="card-mini-btn danger"
                          title="删除草稿"
                          onClick={() => onDeleteDraft(draft.id)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="welcome-recent-list">
            <div className="list-header-row">
              <span style={{ flex: 3 }}>稿件标题 / 摘要</span>
              <span style={{ width: '100px' }}>分类</span>
              <span style={{ width: '120px' }}>字数 / 状态</span>
              <span style={{ width: '140px' }}>修改时间</span>
              <span style={{ width: '120px', textAlign: 'right' }}>操作</span>
            </div>
            {filteredDrafts.map((draft) => {
              const charCount = (draft.body || '').replace(/\s+/g, '').length
              return (
                <div
                  key={draft.id}
                  className="recent-list-row"
                  onClick={() => onOpenDraft(draft)}
                >
                  <div className="row-title-cell" style={{ flex: 3 }}>
                    <div className="row-icon">
                      {draft.imageUrl ? (
                        <img src={draft.imageUrl} alt="" />
                      ) : (
                        <FileText size={16} />
                      )}
                    </div>
                    <div className="row-text">
                      <strong>{draft.title || '无标题快讯草稿'}</strong>
                      <small>{draft.body ? draft.body.slice(0, 60).replace(/[#*`>]/g, '') : '暂无正文'}</small>
                    </div>
                  </div>

                  <div style={{ width: '100px' }}>
                    <span className="row-category-badge">{draft.category || '大公司'}</span>
                  </div>

                  <div style={{ width: '120px', fontSize: '12px', color: 'var(--muted)' }}>
                    {charCount} 字 {draft.publishedDoc ? <span className="row-published-tag">飞书已发</span> : null}
                  </div>

                  <div style={{ width: '140px', fontSize: '12px', color: 'var(--quiet)' }}>
                    {formatRelativeTime(draft.updatedAt)}
                  </div>

                  <div className="row-actions-cell" style={{ width: '120px' }} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="row-action-btn"
                      title="复制 Markdown"
                      onClick={() => onCopyDraftMarkdown(draft)}
                    >
                      <Copy size={13} />
                    </button>
                    {draft.publishedDoc ? (
                      <a
                        href={draft.publishedDoc.document_url}
                        target="_blank"
                        rel="noreferrer"
                        className="row-action-btn"
                        title="在飞书中打开"
                      >
                        <ExternalLink size={13} />
                      </a>
                    ) : null}
                    <button
                      type="button"
                      className="row-action-btn danger"
                      title="删除草稿"
                      onClick={() => onDeleteDraft(draft.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
