import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  CloudOff,
  Copy,
  Cpu,
  Edit3,
  Eye,
  EyeOff,
  Globe,
  HardDrive,
  KeyRound,
  Laptop,
  LoaderCircle,
  Lock,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Server,
  Shield,
  ShieldCheck,
  Sun,
  Trash2,
  User,
  UserCheck,
  UserPlus,
  Users,
  X,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api, resolveApiAssetUrl } from './api'
import {
  defaultGeminiModel,
  defaultIfanrModel,
  defaultOpenaiBaseUrl,
  defaultOpenaiModel,
  getLLMConfig,
  listGeminiModels,
  listOpenAIModels,
  PRESET_MODELS,
  saveLLMConfig,
  testLLMConnection,
  type LLMConfig,
  type LLMModelOption,
  type LLMProvider,
} from './llm-gateway'
import type { Issue, Permission, User as UserType, UserRole } from './types'

export type SettingsDialogProps = {
  issue: Issue | null
  theme: 'system' | 'light' | 'dark'
  isAdmin?: boolean
  currentUserName?: string
  avatarUrl?: string | null
  initialTab?: SettingsTab
  onOpenAuthDialog?: () => void
  closing?: boolean
  workerStatus?: { status: string; detail: string }
  onClose: () => void
  onThemeChange: (theme: 'system' | 'light' | 'dark') => void
  onSaveNotice?: (msg: string) => void
}

type SettingsTab = 'ai' | 'worker' | 'appearance' | 'users'

const ALL_PERMS: Array<{ key: Permission; label: string; group: string; desc: string }> = [
  { key: 'zaobao.view', label: '早报大盘查看', group: '早报模块', desc: '查看今日选题、大盘与备选' },
  { key: 'zaobao.edit', label: '早报内容编辑', group: '早报模块', desc: '编辑早报正文、排序、修改分类' },
  { key: 'zaobao.publish', label: '早报飞书发布', group: '早报模块', desc: '发布到飞书 Bot 文档与导出 Handoff' },
  { key: 'flash.view', label: '快讯工坊访问', group: '快讯模块', desc: '访问即时快讯工作台' },
  { key: 'flash.create', label: '快讯 AI 撰写', group: '快讯模块', desc: '调用大模型撰写与多轮修改快讯' },
  { key: 'flash.publish', label: '快讯飞书直出', group: '快讯模块', desc: '一键创建独立飞书快讯云文档' },
  { key: 'brands.view', label: '品牌大标题查看', group: '品牌标题', desc: '查看爱范儿与 APPSO 备选大标题' },
  { key: 'brands.generate', label: '品牌大标题生成', group: '品牌标题', desc: '生成与保存品牌大标题包装' },
  { key: 'weekend.view', label: '周六特别栏目', group: '扩展栏目', desc: '查看周六 One Fun Thing 等栏目' },
  { key: 'settings.manage', label: '全局配置管理', group: '系统设置', desc: '配置 LLM 密钥与大模型端点' },
  { key: 'admin.users', label: '团队与权限管理', group: '管理员', desc: '仅超级管理员 Shawn Rain 可用' },
]

const ROLE_PRESETS: Record<UserRole, { label: string; perms: Permission[] }> = {
  super_admin: {
    label: '超级管理员',
    perms: ALL_PERMS.map((p) => p.key),
  },
  full_editor: {
    label: '全能主编',
    perms: [
      'zaobao.view',
      'zaobao.edit',
      'zaobao.publish',
      'flash.view',
      'flash.create',
      'flash.publish',
      'brands.view',
      'brands.generate',
      'weekend.view',
    ],
  },
  flash_editor: {
    label: '快讯专职采编',
    perms: ['flash.view', 'flash.create', 'flash.publish', 'zaobao.view'],
  },
  morning_chief: {
    label: '早报责任主编',
    perms: ['zaobao.view', 'zaobao.edit', 'zaobao.publish', 'brands.view', 'brands.generate', 'weekend.view', 'flash.view'],
  },
  morning_editor: {
    label: '早报采编记者',
    perms: ['zaobao.view', 'zaobao.edit', 'brands.view', 'weekend.view', 'flash.view'],
  },
  viewer: {
    label: '只读访客',
    perms: ['zaobao.view', 'flash.view', 'brands.view', 'weekend.view'],
  },
  custom: {
    label: '自定义权限',
    perms: [],
  },
}

export function SettingsDialog({
  issue,
  theme,
  isAdmin = false,
  currentUserName,
  avatarUrl,
  initialTab,
  onOpenAuthDialog,
  closing = false,
  workerStatus,
  onClose,
  onThemeChange,
  onSaveNotice,
}: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab || 'ai')
  const [userSubView, setUserSubView] = useState<'list' | 'edit' | 'add'>('list')
  const [config, setConfig] = useState<LLMConfig>(getLLMConfig())

  // AI 引擎设置表单项
  const [provider, setProvider] = useState<LLMProvider>(config.provider)
  const [ifanrModel] = useState(config.ifanrModel || defaultIfanrModel)
  const [geminiKey, setGeminiKey] = useState(config.geminiKey)
  const [geminiModel, setGeminiModel] = useState(config.geminiModel || defaultGeminiModel)
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState(config.openaiBaseUrl || defaultOpenaiBaseUrl)
  const [openaiKey, setOpenaiKey] = useState(config.openaiKey)
  const [openaiModel, setOpenaiModel] = useState(config.openaiModel || defaultOpenaiModel)

  // 密码显示控制
  const [showGeminiKey, setShowGeminiKey] = useState(false)
  const [showOpenaiKey, setShowOpenaiKey] = useState(false)

  // 连接测试与反馈状态
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  // 动态模型读取状态
  const [geminiModels, setGeminiModels] = useState<LLMModelOption[]>([])
  const [loadingGeminiModels, setLoadingGeminiModels] = useState(false)
  const [openaiModels, setOpenaiModels] = useState<LLMModelOption[]>([])
  const [loadingOpenaiModels, setLoadingOpenaiModels] = useState(false)

  // 团队账号与权限管理状态 (Shawn Rain 专属)
  const [users, setUsers] = useState<UserType[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [allowRegistration, setAllowRegistration] = useState(true)
  const [inviteCode, setInviteCode] = useState('')
  const [savingRegSettings, setSavingRegSettings] = useState(false)
  const [regNotice, setRegNotice] = useState<string | null>(null)
  const [editingUser, setEditingUser] = useState<UserType | null>(null)
  const [showAddUserModal, setShowAddUserModal] = useState(false)
  const [newUserForm, setNewUserForm] = useState<{
    username: string
    password: string
    display_name: string
    feishu_user_id: string
    feishu_name: string
    role: UserRole
  }>({
    username: '',
    password: '',
    display_name: '',
    feishu_user_id: '',
    feishu_name: '',
    role: 'viewer',
  })
  const [savingUser, setSavingUser] = useState(false)
  const [userActionNotice, setUserActionNotice] = useState<string | null>(null)
  const [savedSuccess, setSavedSuccess] = useState(false)

  const isSuperAdmin = isAdmin || currentUserName?.toLowerCase() === 'shawn rain' || !currentUserName

  // 历史前进/返回导航栈
  const [navHistory, setNavHistory] = useState<Array<{ tab: SettingsTab; subView: 'list' | 'edit' | 'add'; editUser: UserType | null }>>([
    { tab: initialTab || 'ai', subView: 'list', editUser: null },
  ])
  const [historyIndex, setHistoryIndex] = useState(0)

  const canGoBack = historyIndex > 0
  const canGoForward = historyIndex < navHistory.length - 1
  const settingsRouteKey = `${activeTab}-${activeTab === 'users' ? userSubView : 'root'}-${editingUser?.id || ''}`
  const registrationInviteLink = inviteCode.trim()
    ? `${window.location.origin}${window.location.pathname}#register/${encodeURIComponent(inviteCode.trim())}`
    : ''

  const navigateTo = (tab: SettingsTab, subView: 'list' | 'edit' | 'add' = 'list', targetUser: UserType | null = null) => {
    setNavHistory((prev) => [...prev.slice(0, historyIndex + 1), { tab, subView, editUser: targetUser }])
    setHistoryIndex((prev) => prev + 1)
    setActiveTab(tab)
    setUserSubView(subView)
    if (targetUser) setEditingUser(targetUser)
    else if (subView !== 'edit') setEditingUser(null)
    setTestResult(null)
  }

  const goBack = () => {
    if (historyIndex > 0) {
      const target = navHistory[historyIndex - 1]
      setHistoryIndex((prev) => prev - 1)
      setActiveTab(target.tab)
      setUserSubView(target.subView)
      if (target.editUser) setEditingUser(target.editUser)
      setTestResult(null)
    }
  }

  const goForward = () => {
    if (historyIndex < navHistory.length - 1) {
      const target = navHistory[historyIndex + 1]
      setHistoryIndex((prev) => prev + 1)
      setActiveTab(target.tab)
      setUserSubView(target.subView)
      if (target.editUser) setEditingUser(target.editUser)
      setTestResult(null)
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '[') {
        e.preventDefault()
        goBack()
      } else if ((e.metaKey || e.ctrlKey) && e.key === ']') {
        e.preventDefault()
        goForward()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [historyIndex, navHistory])

  // 个人账号与飞书授权状态
  const [myAccount, setMyAccount] = useState<{
    username: string
    display_name?: string
    feishu_user_id?: string
    feishu_name?: string
    role?: string
    permissions?: string[]
  } | null>(null)
  const [feishuLoading, setFeishuLoading] = useState(false)
  const [feishuNotice, setFeishuNotice] = useState<string | null>(null)
  const [showManualFeishu, setShowManualFeishu] = useState(false)
  const [manualFeishuInput, setManualFeishuInput] = useState('')

  const fetchMyAccount = useCallback(async () => {
    try {
      const status = await api.authStatus()
      if (status.authenticated && status.username) {
        setMyAccount({
          username: status.username,
          display_name: status.display_name || status.username,
          feishu_user_id: status.feishu_user_id || '',
          feishu_name: status.feishu_name || '',
          role: status.role || 'viewer',
          permissions: status.permissions || [],
        })
      }
    } catch {
      // ignore
    }
  }, [])

  const handleFeishuWebAuth = async () => {
    try {
      setFeishuLoading(true)
      setFeishuNotice(null)
      const res = await api.authFeishuUrl()
      if (res.configured && res.url) {
        const popup = window.open(res.url, 'ifanr-feishu-oauth', 'popup=yes,width=600,height=700')
        if (!popup) setFeishuNotice('浏览器拦截了授权窗口，请允许本站弹出窗口后重试')
      } else {
        setFeishuNotice(res.message || '飞书网页授权应用待配置，建议使用下方快捷 ID 绑定')
        setShowManualFeishu(true)
      }
    } catch (e) {
      setFeishuNotice(e instanceof Error ? e.message : '获取飞书授权链接失败')
      setShowManualFeishu(true)
    } finally {
      setFeishuLoading(false)
    }
  }

  useEffect(() => {
    const handleFeishuOAuthMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'ifanr-feishu-oauth') return
      setFeishuNotice(String(event.data.message || (event.data.ok ? '飞书账号绑定成功' : '飞书账号绑定失败')))
      if (event.data.ok) {
        void fetchMyAccount()
        if (isSuperAdmin) void fetchUsersAndSettings()
      }
    }
    window.addEventListener('message', handleFeishuOAuthMessage)
    return () => window.removeEventListener('message', handleFeishuOAuthMessage)
  }, [fetchMyAccount, isSuperAdmin])

  const handleManualFeishuBind = async () => {
    if (!manualFeishuInput.trim()) return
    try {
      setFeishuLoading(true)
      setFeishuNotice(null)
      await api.authFeishuBind({ feishu_user_id: manualFeishuInput.trim() })
      setFeishuNotice('飞书账号绑定成功！')
      setShowManualFeishu(false)
      setManualFeishuInput('')
      void fetchMyAccount()
      if (isSuperAdmin) void fetchUsersAndSettings()
    } catch (e) {
      setFeishuNotice(e instanceof Error ? e.message : '飞书绑定失败')
    } finally {
      setFeishuLoading(false)
    }
  }

  const handleFeishuUnbind = async () => {
    try {
      setFeishuLoading(true)
      setFeishuNotice(null)
      await api.authFeishuUnbind()
      setFeishuNotice('已解除飞书账号绑定')
      void fetchMyAccount()
      if (isSuperAdmin) void fetchUsersAndSettings()
    } catch (e) {
      setFeishuNotice(e instanceof Error ? e.message : '解除绑定失败')
    } finally {
      setFeishuLoading(false)
    }
  }

  const fetchUsersAndSettings = async () => {
    if (!isSuperAdmin) return
    setLoadingUsers(true)
    setUsersError(null)
    try {
      const [userList, reg] = await Promise.all([
        api.getUsers().catch(() => []),
        api.getRegistrationSettings().catch(() => ({ allow_registration: true, registration_invite_code: '' })),
      ])
      setUsers(userList as UserType[])
      setAllowRegistration(reg.allow_registration)
      setInviteCode(reg.registration_invite_code || '')
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : '获取用户列表失败')
    } finally {
      setLoadingUsers(false)
    }
  }

  useEffect(() => {
    void fetchMyAccount()
    if (activeTab === 'users' && isSuperAdmin) {
      void fetchUsersAndSettings()
    }
  }, [activeTab, isSuperAdmin, fetchMyAccount])

  const handleSaveRegistrationSettings = async () => {
    setSavingRegSettings(true)
    setRegNotice(null)
    try {
      await api.updateRegistrationSettings({
        allow_registration: allowRegistration,
        registration_invite_code: inviteCode.trim(),
      })
      setRegNotice('注册控制设置已保存')
      setTimeout(() => setRegNotice(null), 3000)
    } catch (err) {
      setRegNotice(`保存失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setSavingRegSettings(false)
    }
  }

  const handleCopyRegistrationLink = async () => {
    if (!registrationInviteLink) return
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(registrationInviteLink)
      } else {
        const helper = document.createElement('textarea')
        helper.value = registrationInviteLink
        helper.style.position = 'fixed'
        helper.style.opacity = '0'
        document.body.appendChild(helper)
        helper.select()
        document.execCommand('copy')
        helper.remove()
      }
      setRegNotice('邀请链接已复制，打开后会直接进入注册并预填邀请码')
    } catch {
      setRegNotice('复制失败，请手动选中链接复制')
    }
  }

  const handleSaveEditUser = async () => {
    if (!editingUser) return
    setSavingUser(true)
    setUserActionNotice(null)
    try {
      await api.updateUser(editingUser.id, {
        display_name: editingUser.display_name,
        role: editingUser.role,
        permissions: editingUser.permissions,
        feishu_user_id: editingUser.feishu_user_id,
        feishu_name: editingUser.feishu_name,
        is_active: editingUser.is_active,
      })
      setUserActionNotice(`已成功更新成员 ${editingUser.display_name || editingUser.username} 的权限与配置`)
      setEditingUser(null)
      await fetchUsersAndSettings()
      setTimeout(() => setUserActionNotice(null), 3000)
    } catch (err) {
      setUserActionNotice(`保存失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setSavingUser(false)
    }
  }

  const handleDeleteUser = async (userId: string, username: string) => {
    if (!window.confirm(`确定要删除成员账号 "${username}" 吗？此操作无法撤销。`)) return
    try {
      await api.deleteUser(userId)
      setUserActionNotice(`已删除成员 ${username}`)
      await fetchUsersAndSettings()
      setTimeout(() => setUserActionNotice(null), 3000)
    } catch (err) {
      setUserActionNotice(`删除失败：${err instanceof Error ? err.message : '未知错误'}`)
    }
  }

  const handleCreateUser = async () => {
    if (!newUserForm.username.trim() || !newUserForm.password.trim()) {
      alert('请填写用户名和密码')
      return false
    }
    setSavingUser(true)
    try {
      await api.createUser({
        username: newUserForm.username.trim(),
        password: newUserForm.password.trim(),
        display_name: newUserForm.display_name.trim() || newUserForm.username.trim(),
        feishu_user_id: newUserForm.feishu_user_id.trim(),
        feishu_name: newUserForm.feishu_name.trim() || newUserForm.display_name.trim(),
        role: newUserForm.role,
        permissions: ROLE_PRESETS[newUserForm.role].perms,
      })
      setShowAddUserModal(false)
      setNewUserForm({
        username: '',
        password: '',
        display_name: '',
        feishu_user_id: '',
        feishu_name: '',
        role: 'viewer',
      })
      setUserActionNotice('成员账号创建成功')
      await fetchUsersAndSettings()
      setTimeout(() => setUserActionNotice(null), 3000)
      return true
    } catch (err) {
      alert(`创建失败：${err instanceof Error ? err.message : '未知错误'}`)
      return false
    } finally {
      setSavingUser(false)
    }
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await testLLMConnection({
        provider,
        geminiKey,
        geminiModel,
        openaiBaseUrl,
        openaiKey,
        openaiModel,
      })
      setTestResult(res)
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : '连接测试失败',
      })
    } finally {
      setTesting(false)
    }
  }

  const handleFetchGeminiModels = async () => {
    setLoadingGeminiModels(true)
    try {
      const models = await listGeminiModels(geminiKey)
      setGeminiModels(models)
      if (models.length && !models.some((m) => m.name === geminiModel)) {
        setGeminiModel(models[0].name)
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: `读取 Gemini 模型失败：${err instanceof Error ? err.message : '未知错误'}`,
      })
    } finally {
      setLoadingGeminiModels(false)
    }
  }

  const handleFetchOpenaiModels = async () => {
    setLoadingOpenaiModels(true)
    try {
      const models = await listOpenAIModels(openaiBaseUrl, openaiKey)
      setOpenaiModels(models)
      if (models.length && !models.some((m) => m.name === openaiModel)) {
        setOpenaiModel(models[0].name)
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: `读取 OpenAI 模型失败：${err instanceof Error ? err.message : '未知错误'}`,
      })
    } finally {
      setLoadingOpenaiModels(false)
    }
  }

  const handleSave = () => {
    saveLLMConfig({
      provider,
      ifanrModel,
      geminiKey: geminiKey.trim(),
      geminiModel: geminiModel.trim(),
      openaiBaseUrl: openaiBaseUrl.trim(),
      openaiKey: openaiKey.trim(),
      openaiModel: openaiModel.trim(),
    })
    setSavedSuccess(true)
    const activeModelName = provider === 'ifanr'
      ? ifanrModel
      : provider === 'gemini' ? (geminiModel.trim() || defaultGeminiModel) : (openaiModel.trim() || defaultOpenaiModel)
    const providerLabel = provider === 'ifanr' ? 'ifanr' : provider === 'gemini' ? 'Google Gemini' : 'OpenAI 兼容'
    onSaveNotice?.(`设置已保存！当前 AI 引擎：${providerLabel} · ${activeModelName}`)
    setTimeout(() => {
      setSavedSuccess(false)
      onClose()
    }, 450)
  }

  return (
    <div className={`modal-backdrop ${closing ? 'closing' : ''}`} onClick={onClose}>
      <div
        className={`settings-dialog-card ${closing ? 'is-closing' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* 顶部标题栏 */}
        <header className="settings-dialog-header">
          <div className="header-title">
            <div className="settings-history-nav" title="历史导航 (快捷键: Cmd+[ / Cmd+])">
              <button
                type="button"
                className="settings-history-btn"
                disabled={!canGoBack}
                onClick={goBack}
                title="后退 (Cmd + [)"
                aria-label="后退"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                className="settings-history-btn"
                disabled={!canGoForward}
                onClick={goForward}
                title="前进 (Cmd + ])"
                aria-label="前进"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <Cpu size={19} style={{ color: 'var(--brand)' }} />
            <div>
              <h3>系统设置与 AI 配置</h3>
              <p>个性化偏好、AI 引擎与连接状态（ifanr 密钥由 VPS Worker 保管）</p>
            </div>
          </div>
          <button
            type="button"
            className="icon-button dialog-close-btn"
            aria-label="关闭设置"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>

        <div className="settings-dialog-body">
          {/* 左侧导航栏 */}
          <nav className="settings-nav-sidebar">
            <button
              type="button"
              className={`settings-nav-item ${activeTab === 'ai' ? 'active' : ''}`}
              onClick={() => navigateTo('ai')}
            >
              <Bot size={16} />
              <span>AI 写作引擎与大模型</span>
            </button>

            <button
              type="button"
              className={`settings-nav-item ${activeTab === 'worker' ? 'active' : ''}`}
              onClick={() => navigateTo('worker')}
            >
              <Server size={16} />
              <span>Worker 状态与数据源</span>
            </button>

            <button
              type="button"
              className={`settings-nav-item ${activeTab === 'appearance' ? 'active' : ''}`}
              onClick={() => navigateTo('appearance')}
            >
              <Palette size={16} />
              <span>外观与主题偏好</span>
            </button>

            <button
              type="button"
              className={`settings-nav-item ${activeTab === 'users' ? 'active' : ''}`}
              onClick={() => navigateTo('users', 'list')}
            >
              <Users size={16} />
              <span>团队账号与权限</span>
            </button>
          </nav>

          {/* 右侧设置主面板 */}
          <main className="settings-tab-content">
          <div key={settingsRouteKey} className="settings-route-stage">
            {/* Tab 4: 团队账号与权限管理 (普通成员个人中心与飞书授权) */}
            {activeTab === 'users' && !isSuperAdmin ? (
              <div className="settings-section-form">
                {!myAccount?.username || myAccount.username === 'Guest' ? (
                  <div style={{ textAlign: 'center', padding: '48px 24px' }}>
                    <div className="ui-true-circle" style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'color-mix(in srgb, var(--brand) 10%, var(--panel))', color: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                      <Lock size={22} />
                    </div>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '16px', color: 'var(--ink)' }}>需要登录账号</h4>
                    <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: 'var(--muted)', maxWidth: '380px', marginInline: 'auto', lineHeight: 1.5 }}>
                      请先登录采编账号以查看个人权限点并绑定独立飞书账号。
                    </p>
                    <button
                      type="button"
                      className="console-btn-primary"
                      onClick={() => {
                        onClose()
                        onOpenAuthDialog?.()
                      }}
                    >
                      <KeyRound size={14} /> 登录 / 注册新账号
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="settings-group-title">
                      <h4>个人采编账号与飞书绑定</h4>
                      <small>查看你已被授予的早报/快讯采编权限点，一键完成飞书账号授权绑定</small>
                    </div>

                    {/* 个人身份卡片 */}
                    <div className="settings-card-group" style={{ border: '1px solid var(--line)', borderRadius: '8px', padding: '14px', background: 'var(--panel)', marginBottom: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div className="ui-true-circle" style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--brand)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '14px' }}>
                            {(myAccount.display_name || myAccount.username)[0].toUpperCase()}
                          </div>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <strong style={{ fontSize: '14px', color: 'var(--ink)' }}>{myAccount.display_name || myAccount.username}</strong>
                              <span style={{ fontSize: '12px', color: 'var(--quiet)' }}>@{myAccount.username}</span>
                              <span style={{ fontSize: '10px', background: 'var(--warm)', color: 'var(--brand)', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                                {ROLE_PRESETS[myAccount.role as UserRole]?.label || myAccount.role}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: '10px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>已获得权限：</span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {(myAccount.permissions || []).map((p) => {
                            const item = ALL_PERMS.find((x) => x.key === p)
                            return (
                              <span key={p} style={{ fontSize: '11.5px', background: 'var(--paper)', border: '1px solid var(--line-soft)', padding: '2px 8px', borderRadius: '4px', color: 'var(--ink)' }}>
                                {item?.label || p}
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    </div>

                    {/* 飞书授权绑定卡片 */}
                    <div className="settings-card-group" style={{ border: '1px solid var(--line)', borderRadius: '8px', padding: '14px', background: 'var(--panel)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
                          <Globe size={15} style={{ color: 'var(--brand)' }} />
                          <span>飞书账号授权与绑定</span>
                        </div>
                        {myAccount.feishu_user_id ? (
                          <span style={{ fontSize: '11px', background: 'var(--warm)', color: 'var(--brand)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Check size={12} /> 已绑定
                          </span>
                        ) : (
                          <span style={{ fontSize: '11px', color: 'var(--muted)', background: 'var(--paper)', padding: '2px 8px', borderRadius: '4px' }}>
                            未绑定
                          </span>
                        )}
                      </div>

                      <p style={{ margin: '0 0 12px 0', fontSize: '12.5px', color: 'var(--muted)', lineHeight: 1.5 }}>
                        绑定飞书账号后，系统在生成早报与快讯时将自动识别你的采编身份，并接收专属通知与标题共选卡片。
                      </p>

                      {myAccount.feishu_user_id ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--paper)', padding: '10px 14px', borderRadius: '6px', border: '1px solid var(--line-soft)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div className="ui-true-circle" style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'var(--warm)', color: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '12px' }}>
                              飞
                            </div>
                            <div>
                              <strong style={{ fontSize: '13px', color: 'var(--ink)' }}>{myAccount.feishu_name || myAccount.feishu_user_id}</strong>
                              <span style={{ display: 'block', fontSize: '11px', color: 'var(--quiet)' }}>ID: {myAccount.feishu_user_id}</span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              type="button"
                              className="console-btn-secondary"
                              disabled={feishuLoading}
                              onClick={handleFeishuWebAuth}
                              title="重新发起飞书网页授权"
                            >
                              {feishuLoading ? <LoaderCircle size={12} className="spin" /> : <Globe size={12} />} 重新授权
                            </button>
                            <button
                              type="button"
                              className="console-btn-secondary danger"
                              disabled={feishuLoading}
                              onClick={handleFeishuUnbind}
                            >
                              解除绑定
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <button
                              type="button"
                              className="console-btn-primary"
                              disabled={feishuLoading}
                              onClick={handleFeishuWebAuth}
                            >
                              {feishuLoading ? <LoaderCircle size={13} className="spin" /> : <Globe size={13} />} 飞书网页一键授权绑定
                            </button>
                            <button
                              type="button"
                              className="console-btn-secondary"
                              onClick={() => setShowManualFeishu(!showManualFeishu)}
                            >
                              手动输入 ID
                            </button>
                          </div>

                          {showManualFeishu ? (
                            <div style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center' }}>
                              <input
                                type="text"
                                value={manualFeishuInput}
                                placeholder="输入飞书 Open ID（例如：ou_bb3a43...）"
                                style={{ flex: 1, padding: '6px 10px', fontSize: '12px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink)' }}
                                onChange={(e) => setManualFeishuInput(e.target.value)}
                              />
                              <button
                                type="button"
                                className="console-btn-primary"
                                disabled={feishuLoading || !manualFeishuInput.trim()}
                                onClick={handleManualFeishuBind}
                              >
                                {feishuLoading ? <LoaderCircle size={12} className="spin" /> : <Check size={12} />} 保存绑定
                              </button>
                            </div>
                          ) : null}
                        </div>
                      )}
                      {feishuNotice ? <small style={{ display: 'block', marginTop: '8px', color: 'var(--brand)' }}>{feishuNotice}</small> : null}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {activeTab === 'users' && isSuperAdmin ? (
              <div className="settings-section-form">
                {/* 子视图 2: 编辑成员权限 */}
                {userSubView === 'edit' && editingUser ? (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid var(--line)' }}>
                      <button
                        type="button"
                        className="console-btn-secondary"
                        onClick={() => (canGoBack ? goBack() : navigateTo('users', 'list'))}
                      >
                        <ArrowLeft size={13} /> 返回成员列表
                      </button>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
                        编辑成员权限 · {editingUser.display_name || editingUser.username}
                      </span>
                      <div style={{ width: '80px' }} />
                    </div>

                    {/* 用户概况 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '8px', marginBottom: '16px' }}>
                      {(() => {
                        const isShawn = editingUser.username.toLowerCase() === 'shawn rain' || editingUser.is_admin
                        const uAvatar = isShawn ? (avatarUrl || (editingUser.avatar_url ? resolveApiAssetUrl(editingUser.avatar_url) : null)) : (editingUser.avatar_url ? resolveApiAssetUrl(editingUser.avatar_url) : null)
                        return uAvatar ? (
                          <img className="ui-true-circle" src={uAvatar} alt="" style={{ width: '38px', height: '38px', borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--line-soft)' }} />
                        ) : (
                          <div className="member-avatar-placeholder" style={{ width: '38px', height: '38px' }}><User size={18} /></div>
                        )
                      })()}
                      <div style={{ flex: 1 }}>
                        <strong style={{ fontSize: '13.5px', color: 'var(--ink)', display: 'block' }}>{editingUser.display_name || editingUser.username}</strong>
                        <span style={{ fontSize: '11.5px', color: 'var(--quiet)' }}>@{editingUser.username}</span>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--ink)', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={editingUser.is_active}
                          onChange={(e) => setEditingUser({ ...editingUser, is_active: e.target.checked })}
                        />
                        <span>账号已启用</span>
                      </label>
                    </div>

                    {/* 角色预设模板 */}
                    <div style={{ marginBottom: '16px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '8px' }}>
                        角色模板快速设定
                      </label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {(Object.keys(ROLE_PRESETS) as UserRole[]).map((rKey) => {
                          const isSelected = editingUser.role === rKey
                          return (
                            <button
                              key={rKey}
                              type="button"
                              style={{
                                padding: '5px 11px',
                                fontSize: '12px',
                                borderRadius: '6px',
                                border: `1px solid ${isSelected ? 'var(--brand)' : 'var(--line)'}`,
                                background: isSelected ? 'color-mix(in srgb, var(--brand) 12%, var(--panel))' : 'var(--panel)',
                                color: isSelected ? 'var(--brand)' : 'var(--ink)',
                                cursor: 'pointer',
                                fontWeight: isSelected ? 600 : 400,
                                transition: 'all 0.15s ease',
                              }}
                              onClick={() => {
                                setEditingUser((prev) => {
                                  if (!prev) return null
                                  const presetPerms = ROLE_PRESETS[rKey]?.perms || []
                                  return {
                                    ...prev,
                                    role: rKey,
                                    permissions: rKey === 'custom' ? prev.permissions : presetPerms,
                                  }
                                })
                              }}
                            >
                              {ROLE_PRESETS[rKey].label}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* 细粒度权限清单 */}
                    <div style={{ marginBottom: '16px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: '8px' }}>
                        细粒度权限清单（逐项勾选）
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', maxHeight: '220px', overflowY: 'auto', padding: '10px', background: 'var(--panel)', borderRadius: '8px', border: '1px solid var(--line)' }}>
                        {ALL_PERMS.map((p) => {
                          const hasP = (editingUser.permissions || []).includes(p.key)
                          return (
                            <label
                              key={p.key}
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '8px',
                                padding: '6px 8px',
                                borderRadius: '6px',
                                background: hasP ? 'color-mix(in srgb, var(--brand) 6%, transparent)' : 'transparent',
                                cursor: 'pointer',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={hasP}
                                style={{ marginTop: '3px' }}
                                onChange={(e) => {
                                  const checked = e.target.checked
                                  setEditingUser((prev) => {
                                    if (!prev) return null
                                    const current = new Set(prev.permissions || [])
                                    if (checked) current.add(p.key)
                                    else current.delete(p.key)
                                    return {
                                      ...prev,
                                      role: 'custom',
                                      permissions: Array.from(current),
                                    }
                                  })
                                }}
                              />
                              <div style={{ fontSize: '12px' }}>
                                <strong style={{ color: 'var(--ink)' }}>{p.label}</strong>
                                <small style={{ display: 'block', color: 'var(--muted)', fontSize: '11px', lineHeight: 1.35 }}>{p.desc}</small>
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    </div>

                    {/* 基础信息与飞书绑定 */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                      <div>
                        <label style={{ fontSize: '12px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>显示姓名</label>
                        <input
                          type="text"
                          value={editingUser.display_name}
                          style={{ width: '100%', padding: '7px 10px', fontSize: '12.5px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink)' }}
                          onChange={(e) => setEditingUser({ ...editingUser, display_name: e.target.value })}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>飞书 User ID / 姓名</label>
                        <input
                          type="text"
                          value={editingUser.feishu_user_id}
                          placeholder="ou_..."
                          style={{ width: '100%', padding: '7px 10px', fontSize: '12.5px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink)' }}
                          onChange={(e) => setEditingUser({ ...editingUser, feishu_user_id: e.target.value })}
                        />
                      </div>
                    </div>

                    {/* 底部保存与取消按钮 */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid var(--line)', paddingTop: '14px' }}>
                      <button
                        type="button"
                        className="console-btn-secondary"
                        onClick={() => (canGoBack ? goBack() : navigateTo('users', 'list'))}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        className="console-btn-primary"
                        disabled={savingUser}
                        onClick={async () => {
                          await handleSaveEditUser()
                          navigateTo('users', 'list')
                        }}
                      >
                        {savingUser ? <LoaderCircle size={13} className="spin" /> : <Save size={13} />} 保存权限
                      </button>
                    </div>
                  </div>
                ) : null}

                {/* 子视图 3: 新增成员账号 */}
                {userSubView === 'add' ? (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid var(--line)' }}>
                      <button
                        type="button"
                        className="console-btn-secondary"
                        onClick={() => (canGoBack ? goBack() : navigateTo('users', 'list'))}
                      >
                        <ArrowLeft size={13} /> 返回成员列表
                      </button>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
                        新增团队成员账号
                      </span>
                      <div style={{ width: '80px' }} />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
                      <div>
                        <label style={{ fontSize: '12px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>用户名 *</label>
                        <input
                          type="text"
                          placeholder="例如：zhangsan"
                          value={newUserForm.username}
                          style={{ width: '100%', padding: '7px 10px', fontSize: '12.5px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink)' }}
                          onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>初始密码 *</label>
                        <input
                          type="password"
                          placeholder="不少于 6 位密码"
                          value={newUserForm.password}
                          style={{ width: '100%', padding: '7px 10px', fontSize: '12.5px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink)' }}
                          onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>显示姓名</label>
                        <input
                          type="text"
                          placeholder="例如：张三"
                          value={newUserForm.display_name}
                          style={{ width: '100%', padding: '7px 10px', fontSize: '12.5px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink)' }}
                          onChange={(e) => setNewUserForm({ ...newUserForm, display_name: e.target.value })}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>初始角色</label>
                        <select
                          value={newUserForm.role}
                          style={{ width: '100%', padding: '7px 10px', fontSize: '12.5px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink)' }}
                          onChange={(e) => setNewUserForm({ ...newUserForm, role: e.target.value as UserRole })}
                        >
                          {Object.entries(ROLE_PRESETS).filter(([k]) => k !== 'super_admin').map(([k, v]) => (
                            <option key={k} value={k}>{v.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', color: 'var(--muted)', display: 'block', marginBottom: '4px' }}>飞书 User ID / 姓名（可选）</label>
                        <input
                          type="text"
                          placeholder="例如：ou_..."
                          value={newUserForm.feishu_user_id}
                          style={{ width: '100%', padding: '7px 10px', fontSize: '12.5px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink)' }}
                          onChange={(e) => setNewUserForm({ ...newUserForm, feishu_user_id: e.target.value })}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid var(--line)', paddingTop: '14px' }}>
                      <button
                        type="button"
                        className="console-btn-secondary"
                        onClick={() => (canGoBack ? goBack() : navigateTo('users', 'list'))}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        className="console-btn-primary"
                        disabled={savingUser || !newUserForm.username.trim() || !newUserForm.password.trim()}
                        onClick={async () => {
                          if (await handleCreateUser()) navigateTo('users', 'list')
                        }}
                      >
                        {savingUser ? <LoaderCircle size={13} className="spin" /> : <UserPlus size={13} />} 创建成员
                      </button>
                    </div>
                  </div>
                ) : null}

                {/* 子视图 1: 成员列表与安全控制概览 */}
                {userSubView === 'list' ? (
                  <div>
                    <div className="settings-group-title">
                      <h4>团队账号与细粒度权限管理</h4>
                      <small>管理采编人员账号、独立飞书绑定、注册控制与细粒度权限分配（Shawn Rain 专属控制）</small>
                    </div>

                    {userActionNotice ? (
                      <div className="settings-notice-banner" style={{ padding: '8px 12px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '6px', fontSize: '12px', color: 'var(--brand)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Check size={13} /> {userActionNotice}
                      </div>
                    ) : null}

                    {/* 管理员个人飞书授权绑定卡片 */}
                    <div className="settings-card-group" style={{ border: '1px solid var(--line)', borderRadius: '8px', padding: '14px', background: 'var(--panel)', marginBottom: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
                          <Globe size={15} style={{ color: 'var(--brand)' }} />
                          <span>当前管理员飞书账号授权与绑定</span>
                        </div>
                        {myAccount?.feishu_user_id ? (
                          <span style={{ fontSize: '11px', background: 'var(--warm)', color: 'var(--brand)', padding: '2px 8px', borderRadius: '4px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Check size={12} /> 已绑定 ({myAccount.feishu_name || myAccount.feishu_user_id})
                          </span>
                        ) : (
                          <span style={{ fontSize: '11px', color: 'var(--muted)', background: 'var(--paper)', padding: '2px 8px', borderRadius: '4px' }}>
                            未绑定
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="console-btn-primary"
                          disabled={feishuLoading}
                          onClick={handleFeishuWebAuth}
                        >
                          {feishuLoading ? <LoaderCircle size={13} className="spin" /> : <Globe size={13} />} 飞书网页一键授权
                        </button>
                        <button
                          type="button"
                          className="console-btn-secondary"
                          onClick={() => setShowManualFeishu(!showManualFeishu)}
                        >
                          手动输入 ID
                        </button>
                        {myAccount?.feishu_user_id ? (
                          <button
                            type="button"
                            className="console-btn-secondary danger"
                            disabled={feishuLoading}
                            onClick={handleFeishuUnbind}
                          >
                            解除绑定
                          </button>
                        ) : null}
                      </div>

                      {showManualFeishu ? (
                        <div style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center' }}>
                          <input
                            type="text"
                            value={manualFeishuInput}
                            placeholder="输入飞书 Open ID（例如：ou_bb3a43...）"
                            style={{ flex: 1, padding: '6px 10px', fontSize: '12px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink)' }}
                            onChange={(e) => setManualFeishuInput(e.target.value)}
                          />
                          <button
                            type="button"
                            className="console-btn-primary"
                            disabled={feishuLoading || !manualFeishuInput.trim()}
                            onClick={handleManualFeishuBind}
                          >
                            {feishuLoading ? <LoaderCircle size={12} className="spin" /> : <Check size={12} />} 保存绑定
                          </button>
                        </div>
                      ) : null}
                      {feishuNotice ? <small style={{ display: 'block', marginTop: '6px', color: 'var(--brand)' }}>{feishuNotice}</small> : null}
                    </div>

                    {/* 开放注册与邀请码控制卡片 */}
                    <div className="settings-card-group" style={{ border: '1px solid var(--line)', borderRadius: '8px', padding: '14px', background: 'var(--panel)', marginBottom: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--ink)', marginBottom: '10px' }}>
                        <ShieldCheck size={15} style={{ color: 'var(--amber)' }} />
                        <span>账号注册安全控制</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', alignItems: 'center' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--ink)' }}>
                          <input
                            type="checkbox"
                            checked={allowRegistration}
                            onChange={(e) => setAllowRegistration(e.target.checked)}
                          />
                          <span>开放团队成员自行注册</span>
                        </label>

                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <input
                            type="text"
                            value={inviteCode}
                            placeholder="注册邀请码（可选，留空则免码）"
                            style={{ padding: '6px 10px', fontSize: '12px', flex: 1, borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink)' }}
                            onChange={(e) => setInviteCode(e.target.value)}
                          />
                          <button
                            type="button"
                            className="console-btn-primary"
                            disabled={savingRegSettings}
                            onClick={handleSaveRegistrationSettings}
                          >
                            {savingRegSettings ? <LoaderCircle size={12} className="spin" /> : <Save size={12} />} 保存设置
                          </button>
                        </div>
                      </div>
                      {registrationInviteLink ? (
                        <div className="registration-invite-link-row">
                          <input type="text" readOnly value={registrationInviteLink} aria-label="注册邀请链接" />
                          <button type="button" className="console-btn-secondary" onClick={() => void handleCopyRegistrationLink()}><Copy size={12} /> 复制邀请链接</button>
                        </div>
                      ) : null}
                      {regNotice ? <small style={{ display: 'block', marginTop: '6px', color: 'var(--brand)' }}>{regNotice}</small> : null}
                    </div>

                    {/* 成员列表与权限分配 */}
                    <div className="settings-card-group" style={{ border: '1px solid var(--line)', borderRadius: '8px', padding: '14px', background: 'var(--panel)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
                          <Users size={15} style={{ color: 'var(--brand)' }} />
                          <span>成员列表 ({users.length})</span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            className="console-btn-secondary"
                            onClick={() => void fetchUsersAndSettings()}
                            title="刷新列表"
                          >
                            <RefreshCw size={12} /> 刷新
                          </button>
                          <button
                            type="button"
                            className="console-btn-primary"
                            onClick={() => navigateTo('users', 'add')}
                          >
                            <UserPlus size={12} /> 新增成员
                          </button>
                        </div>
                      </div>

                      {loadingUsers ? (
                        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
                          <LoaderCircle size={16} className="spin" /> 正在加载团队成员列表…
                        </div>
                      ) : users.length === 0 ? (
                        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
                          暂无其他注册成员，Shawn Rain 为默认超级管理员
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {users.map((u) => {
                            const isShawn = u.username.toLowerCase() === 'shawn rain' || u.is_admin
                            const uAvatar = isShawn ? (avatarUrl || (u.avatar_url ? resolveApiAssetUrl(u.avatar_url) : null)) : (u.avatar_url ? resolveApiAssetUrl(u.avatar_url) : null)
                            return (
                              <div
                                key={u.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '10px 14px',
                                  borderRadius: '8px',
                                  background: 'var(--paper)',
                                  border: '1px solid var(--line-soft)',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                  {uAvatar ? (
                                    <img
                                      src={uAvatar}
                                      alt=""
                                      className="ui-true-circle"
                                      style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--line-soft)' }}
                                    />
                                  ) : (
                                    <div className="member-avatar-placeholder" style={{ width: '36px', height: '36px' }}><User size={17} /></div>
                                  )}
                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <strong style={{ fontSize: '13px', color: 'var(--ink)' }}>{u.display_name || u.username}</strong>
                                      <span style={{ fontSize: '11px', color: 'var(--quiet)' }}>@{u.username}</span>
                                      {isShawn ? <span style={{ fontSize: '10px', background: 'var(--warm)', color: 'var(--brand)', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>超级管理员</span> : null}
                                      {!u.is_active ? <span style={{ fontSize: '10px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '1px 6px', borderRadius: '4px' }}>已禁用</span> : null}
                                    </div>
                                    <div style={{ fontSize: '11.5px', color: 'var(--muted)', marginTop: '3px', display: 'flex', gap: '10px' }}>
                                      <span>角色：{ROLE_PRESETS[u.role]?.label || u.role}</span>
                                      {u.feishu_user_id ? <span>飞书：{u.feishu_name || u.feishu_user_id}</span> : null}
                                      <span>权限点数：{isShawn ? '全部 (11/11)' : `${(u.permissions || []).length} 项`}</span>
                                    </div>
                                  </div>
                                </div>

                                <div style={{ display: 'flex', gap: '6px' }}>
                                  <button
                                    type="button"
                                    className="console-btn-secondary"
                                    onClick={() => navigateTo('users', 'edit', JSON.parse(JSON.stringify(u)))}
                                  >
                                    <Edit3 size={12} /> 编辑权限
                                  </button>
                                  {!isShawn ? (
                                    <button
                                      type="button"
                                      className="console-btn-secondary danger"
                                      onClick={() => void handleDeleteUser(u.id, u.username)}
                                      title="删除成员"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Tab 1: AI 引擎与模型设置 */}
            {activeTab === 'ai' ? (
              <div className="settings-section-form">
                <div className="settings-group-title">
                  <h4>选择默认 AI 引擎</h4>
                  <small>用于快讯一键生成、品牌标题撰写与 AI 采编助手多轮修改</small>
                </div>

                {/* 引擎切换卡片 */}
                <div className="provider-selector-grid">
                  <div
                    className={`provider-card ${provider === 'ifanr' ? 'selected' : ''}`}
                    onClick={() => { setProvider('ifanr'); setTestResult(null) }}
                  >
                    <div className="provider-card-header">
                      <div className="provider-badge ifanr">Default</div>
                      <input
                        type="radio"
                        name="llm-provider-select"
                        checked={provider === 'ifanr'}
                        onChange={() => setProvider('ifanr')}
                      />
                    </div>
                    <strong>ifanr</strong>
                    <p>VPS Worker 内置引擎，无需配置 API 地址或密钥。</p>
                  </div>

                  <div
                    className={`provider-card ${provider === 'gemini' ? 'selected' : ''}`}
                    onClick={() => { setProvider('gemini'); setTestResult(null) }}
                  >
                    <div className="provider-card-header">
                      <div className="provider-badge gemini">Google AI</div>
                      <input
                        type="radio"
                        name="llm-provider-select"
                        checked={provider === 'gemini'}
                        onChange={() => setProvider('gemini')}
                      />
                    </div>
                    <strong>Google Gemini (直连)</strong>
                    <p>原生支持 Gemini 3.7 Flash 思考增强、Gemini 2.5 等，响应迅速。</p>
                  </div>

                  <div
                    className={`provider-card ${provider === 'openai' ? 'selected' : ''}`}
                    onClick={() => { setProvider('openai'); setTestResult(null) }}
                  >
                    <div className="provider-card-header">
                      <div className="provider-badge openai">API Compatible</div>
                      <input
                        type="radio"
                        name="llm-provider-select"
                        checked={provider === 'openai'}
                        onChange={() => setProvider('openai')}
                      />
                    </div>
                    <strong>OpenAI 兼容接口</strong>
                    <p>适配 cockpit-tools / 本地代理 / Claude / DeepSeek / GPT-4o 等。</p>
                  </div>
                </div>

                {provider === 'ifanr' ? (
                  <div className="settings-form-panel ifanr-provider-panel">
                    <div className="worker-status-line ok"><ShieldCheck size={16} /><strong>VPS Worker 统一管理连接与密钥</strong></div>
                    <p>快讯、品牌标题和 AI 采编助手均通过登录后的 Worker 请求调用，不从浏览器传递 Hub API Key。当前默认模型：<code>{ifanrModel}</code>。</p>
                  </div>
                ) : provider === 'gemini' ? (
                  <div className="settings-form-panel">
                    <div className="form-field">
                      <label>
                        <span>Gemini API Key</span>
                        <small>从 Google AI Studio 获取的 API 密钥</small>
                      </label>
                      <div className="input-with-action">
                        <KeyRound size={15} className="input-icon" />
                        <input
                          type={showGeminiKey ? 'text' : 'password'}
                          value={geminiKey}
                          placeholder="AIzaSy..."
                          autoComplete="off"
                          onChange={(e) => setGeminiKey(e.target.value)}
                        />
                        <button
                          type="button"
                          className="toggle-mask-btn"
                          title={showGeminiKey ? '隐藏密钥' : '显示密钥'}
                          onClick={() => setShowGeminiKey((p) => !p)}
                        >
                          {showGeminiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </div>

                    <div className="form-field">
                      <label>
                        <span>Gemini 模型</span>
                        <small>默认推荐使用 3.7-flash-high（思考增强）</small>
                      </label>
                      <div className="input-with-action">
                        <Bot size={15} className="input-icon" />
                        <input
                          type="text"
                          value={geminiModel}
                          list="gemini-preset-list"
                          placeholder={defaultGeminiModel}
                          onChange={(e) => setGeminiModel(e.target.value)}
                        />
                        <button
                          type="button"
                          className="field-action-btn"
                          disabled={loadingGeminiModels || !geminiKey.trim()}
                          onClick={handleFetchGeminiModels}
                        >
                          {loadingGeminiModels ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}
                          读取可用模型
                        </button>
                      </div>
                      <datalist id="gemini-preset-list">
                        {geminiModels.length
                          ? geminiModels.map((m) => <option key={m.name} value={m.name}>{m.displayName}</option>)
                          : PRESET_MODELS.gemini.map((m) => <option key={m.name} value={m.name}>{m.displayName}</option>)}
                      </datalist>
                    </div>
                  </div>
                ) : (
                  /* OpenAI 兼容端点专属配置 */
                  <div className="settings-form-panel">
                    <div className="form-field">
                      <label>
                        <span>API Base URL</span>
                        <small>服务端点（如 http://localhost:8000/v1 或 https://api.deepseek.com/v1）</small>
                      </label>
                      <div className="input-with-action">
                        <Globe size={15} className="input-icon" />
                        <input
                          type="text"
                          value={openaiBaseUrl}
                          placeholder={defaultOpenaiBaseUrl}
                          onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                        />
                      </div>
                      <div className="quick-url-presets">
                        <span className="preset-label">快捷预设:</span>
                        <button type="button" onClick={() => setOpenaiBaseUrl('http://localhost:8000/v1')}>cockpit-tools (本地:8000)</button>
                        <button type="button" onClick={() => setOpenaiBaseUrl('https://api.deepseek.com/v1')}>DeepSeek</button>
                        <button type="button" onClick={() => setOpenaiBaseUrl('https://openrouter.ai/api/v1')}>OpenRouter</button>
                        <button type="button" onClick={() => setOpenaiBaseUrl('https://api.openai.com/v1')}>OpenAI</button>
                      </div>
                    </div>

                    <div className="form-field">
                      <label>
                        <span>API Key（可选）</span>
                        <small>若本地代理不需要验证可留空</small>
                      </label>
                      <div className="input-with-action">
                        <KeyRound size={15} className="input-icon" />
                        <input
                          type={showOpenaiKey ? 'text' : 'password'}
                          value={openaiKey}
                          placeholder="sk-..."
                          autoComplete="off"
                          onChange={(e) => setOpenaiKey(e.target.value)}
                        />
                        <button
                          type="button"
                          className="toggle-mask-btn"
                          title={showOpenaiKey ? '隐藏密钥' : '显示密钥'}
                          onClick={() => setShowOpenaiKey((p) => !p)}
                        >
                          {showOpenaiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </div>

                    <div className="form-field">
                      <label>
                        <span>模型名称 (Model ID)</span>
                        <small>输入代理或平台支持的模型标示（如 3.7-flash-high, claude-3-7-sonnet, deepseek-chat）</small>
                      </label>
                      <div className="input-with-action">
                        <Bot size={15} className="input-icon" />
                        <input
                          type="text"
                          value={openaiModel}
                          list="openai-preset-list"
                          placeholder={defaultOpenaiModel}
                          onChange={(e) => setOpenaiModel(e.target.value)}
                        />
                        <button
                          type="button"
                          className="field-action-btn"
                          disabled={loadingOpenaiModels || !openaiBaseUrl.trim()}
                          onClick={handleFetchOpenaiModels}
                        >
                          {loadingOpenaiModels ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}
                          从端点探测模型
                        </button>
                      </div>
                      <datalist id="openai-preset-list">
                        {openaiModels.length
                          ? openaiModels.map((m) => <option key={m.name} value={m.name}>{m.displayName}</option>)
                          : PRESET_MODELS.openai.map((m) => <option key={m.name} value={m.name}>{m.displayName}</option>)}
                      </datalist>
                    </div>
                  </div>
                )}

                {/* 连通性测试按钮与反馈 */}
                <div className="settings-test-strip">
                  <button
                    type="button"
                    className="test-connect-btn"
                    disabled={testing || (provider === 'gemini' && !geminiKey.trim())}
                    onClick={handleTestConnection}
                  >
                    {testing ? <LoaderCircle size={14} className="spin" /> : <Activity size={14} />}
                    {testing ? '正在测试连接…' : '测试 API 连接'}
                  </button>

                  {testResult ? (
                    <div className={`test-result-badge ${testResult.ok ? 'success' : 'error'}`}>
                      {testResult.ok ? <Check size={14} /> : <CloudOff size={14} />}
                      <span>{testResult.message}</span>
                    </div>
                  ) : null}
                </div>

                {/* 安全与存储说明 */}
                <div className="security-notice-card">
                  <ShieldCheck size={16} style={{ color: 'var(--green)' }} />
                  <div>
                    <strong>本地私密存储保证</strong>
                    <p>{provider === 'ifanr'
                      ? '内置 API Key 只保存在 VPS Worker 的受限环境文件中，不会下发到浏览器。'
                      : '直连模式的 API Key 与端点地址仅保存在当前浏览器 LocalStorage 中。'}</p>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Tab 2: Worker 状态与诊断 */}
            {activeTab === 'worker' ? (
              <div className="settings-section-form">
                <div className="settings-group-title">
                  <h4>Worker 状态与数据同步</h4>
                  <small>早报主流程后端与自动化数据库状态</small>
                </div>

                <div className="worker-status-grid">
                  <div className="status-item">
                    <span className="label">连接状态</span>
                    <strong style={{ color: workerStatus?.status === 'connected' ? 'var(--green)' : 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <CircleDot size={13} /> {workerStatus?.detail || '正常运行中'}
                    </strong>
                  </div>

                  <div className="status-item">
                    <span className="label">当前刊期</span>
                    <strong>{issue?.publication_date || '未载入'}</strong>
                  </div>

                  <div className="status-item">
                    <span className="label">刊期内选题总数</span>
                    <strong>{issue?.stories?.length || 0} 篇</strong>
                  </div>

                  <div className="status-item">
                    <span className="label">Bot 已成稿</span>
                    <strong style={{ color: 'var(--brand)' }}>{issue?.selected_count || 0} 篇</strong>
                  </div>
                </div>

                <div className="settings-group-title" style={{ marginTop: '16px' }}>
                  <h4>飞书群协作与自动化</h4>
                </div>
                <p style={{ fontSize: '12.5px', color: 'var(--muted)', lineHeight: '1.6' }}>
                  工作台通过 <code>lark-cli</code> 与飞书 Bot 双向打通，支持一键创建独立快讯云文档及早报稿排版。
                </p>
              </div>
            ) : null}

            {/* Tab 3: 外观与主题偏好 */}
            {activeTab === 'appearance' ? (
              <div className="settings-section-form">
                <div className="settings-group-title">
                  <h4>界面主题外观</h4>
                  <small>选择您习惯的工作台视觉主题</small>
                </div>

                <div className="theme-options-grid">
                  <div
                    className={`theme-card ${theme === 'system' ? 'selected' : ''}`}
                    onClick={() => onThemeChange('system')}
                  >
                    <Laptop size={22} style={{ color: 'var(--muted)' }} />
                    <strong>跟随系统</strong>
                    <p>自动匹配 macOS / 操作系统的浅色或深色偏好</p>
                  </div>

                  <div
                    className={`theme-card ${theme === 'light' ? 'selected' : ''}`}
                    onClick={() => onThemeChange('light')}
                  >
                    <Sun size={22} style={{ color: '#d97706' }} />
                    <strong>浅色模式 (Light)</strong>
                    <p>清爽明亮的工作台纸质阅读质感</p>
                  </div>

                  <div
                    className={`theme-card ${theme === 'dark' ? 'selected' : ''}`}
                    onClick={() => onThemeChange('dark')}
                  >
                    <Moon size={22} style={{ color: '#818cf8' }} />
                    <strong>深色模式 (Dark)</strong>
                    <p>低眩光高对比度，适合夜间采编写稿</p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          </main>
        </div>

        {/* 底部操作条 */}
        <footer className="settings-dialog-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={savedSuccess}
            onClick={handleSave}
          >
            {savedSuccess ? <Check size={15} /> : <Save size={15} />}
            {savedSuccess ? '已保存！' : '保存设置'}
          </button>
        </footer>
      </div>
    </div>
  )
}
