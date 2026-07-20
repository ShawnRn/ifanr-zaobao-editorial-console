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

export type CoverCandidate = {
  id: string
  story_id?: string
  url: string
  source: string
  title?: string
}

export type BrandPackage = {
  headline_options: string[]
  selected_headline: string
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
}
