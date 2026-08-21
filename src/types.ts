export type StoryStatus =
  | 'discovered'
  | 'source_chasing'
  | 'fulltext_ready'
  | 'fact_checking'
  | 'drafting'
  | 'ready'
  | 'needs_review'
  | 'excluded'

export type Source = {
  id?: number
  url: string
  title: string
  publisher: string
  source_type: string
  authority: 'primary' | 'strong' | 'secondary' | 'lead' | 'unknown'
  is_paywalled: boolean
  is_original: boolean
  fetched_at?: string
}

export type Claim = {
  id?: number
  text: string
  source_url: string
  status: 'unverified' | 'supported' | 'conflicted' | 'rejected'
  evidence: string
}

export type Story = {
  id: string
  issue_id: string
  fingerprint: string
  title: string
  body: string
  category: string
  status: StoryStatus
  selected: boolean
  position: number
  score: number
  source_url: string
  source_name: string
  source_type: string
  source_quality: string
  confidence: number
  event_date?: string
  disclosed_at?: string
  published_at?: string
  cross_day_status: string
  rumor: boolean
  fact_status: string
  changed_since_review: boolean
  image_url: string
  image_path: string
  image_token: string
  editorial_reason: string
  metadata: Record<string, unknown>
  sources: Source[]
  claims: Claim[]
  updated_at?: string
}

export type StoryCreateInput = {
  title: string
  body: string
  category: string
  selected: boolean
  source_urls: string[]
  source_name: string
  source_type: string
  source_quality: 'primary' | 'strong' | 'secondary' | 'lead' | 'unknown'
  confidence: number
  event_date?: string
  disclosed_at?: string
  published_at?: string
  rumor: boolean
  editorial_reason: string
}

export type CoverCandidate = {
  id: string
  story_id?: string
  url: string
  source: string
  title?: string
}

export type HeadlineHistoryEntry = {
  id: string
  created_at: string
  source: string
  model?: string
  headline_options: string[]
  selected_headline: string
}

export type BrandPackage = {
  headline_options: string[]
  selected_headline: string
  headline_history?: HeadlineHistoryEntry[]
  generation_source?: string
  generation_model?: string
  generated_at?: string
  cover_candidates: CoverCandidate[]
  selected_cover: string
}

export type Issue = {
  id: string
  publication_date: string
  title: string
  state: string
  runtime_path: string
  draft_path: string
  revision: number
  selected_count: number
  review_count: number
  ready_count: number
  updated_at: string
  stories: Story[]
  brand_packages: Record<'appso' | 'ifanr', BrandPackage>
  diagnostics: Record<string, unknown>
}

export type Job = {
  id: string
  issue_id: string
  story_id?: string
  action: string
  state: string
  progress: number
  message: string
  result: Record<string, unknown>
  error: string
}

export type AutomationHandoff = {
  issue_id: string
  revision: number
  markdown_path: string
  manifest_path: string
  selected_count: number
  publication_date: string
  created_at: string
  status: string
  requires_ai_headline_rewrite?: boolean
  headline_quality_warnings?: Array<{ title: string; reason: string }>
  requires_ai_body_write?: boolean
  empty_body_titles?: string[]
}

export type Permission =
  | 'zaobao.view'
  | 'zaobao.edit'
  | 'zaobao.publish'
  | 'flash.view'
  | 'flash.create'
  | 'flash.publish'
  | 'brands.view'
  | 'brands.generate'
  | 'weekend.view'
  | 'settings.manage'
  | 'admin.users'

export type UserRole =
  | 'super_admin'
  | 'morning_chief'
  | 'morning_editor'
  | 'flash_editor'
  | 'full_editor'
  | 'viewer'
  | 'custom'

export type User = {
  id: string
  username: string
  display_name: string
  feishu_user_id: string
  feishu_name: string
  avatar_url?: string | null
  role: UserRole
  permissions: Permission[]
  is_active: boolean
  is_admin: boolean
  created_at: string
  last_login_at?: string
}

export type RegistrationSettings = {
  allow_registration: boolean
  registration_invite_code: string
}

