import type { Issue, Story } from './types'

const makeStory = (id: string, category: string, title: string, body: string, position: number, selected = true): Story => ({
  id,
  issue_id: 'demo-issue',
  fingerprint: `demo-${id}`,
  title,
  body,
  category,
  status: selected ? 'ready' : 'needs_review',
  selected,
  position,
  score: selected ? 90 - position : 72,
  source_url: 'https://example.com/editorial-console-demo',
  source_name: '界面演示来源',
  source_type: 'demo',
  source_quality: 'primary',
  confidence: 1,
  event_date: '2026-07-21',
  disclosed_at: '2026-07-21 09:00',
  published_at: '2026-07-21 09:00',
  cross_day_status: 'current',
  rumor: false,
  fact_status: 'verified',
  changed_since_review: false,
  image_url: '',
  image_path: '',
  image_token: '',
  editorial_reason: selected ? '用于展示正式稿件排版。' : '用于展示候选采用与排除流程。',
  metadata: { demo: true, source_line: '🔗 来源：https://example.com/editorial-console-demo' },
  sources: [{
    url: 'https://example.com/editorial-console-demo',
    title: '早报编辑台演示来源',
    publisher: '演示来源',
    source_type: 'demo',
    authority: 'primary',
    is_paywalled: false,
    is_original: true,
  }],
  claims: [
    { text: '这是公开 Pages 的界面演示内容，不是当天新闻。', source_url: 'https://example.com/editorial-console-demo', status: 'supported', evidence: '演示数据标记' },
  ],
  updated_at: '2026-07-21T09:00:00Z',
})

const stories = [
  makeStory('demo-lead', '重磅', '示例重磅｜一条信息完整的头部新闻', '这一段展示重磅稿件的正文密度。真实刊期会由 AI 主编追到一手或强来源，完成事实核验后再进入编辑台。\n\n第二段用于展示多段正文、标题层级和来源行之间的阅读节奏。', 0),
  makeStory('demo-company', '大公司', '示例公司动态｜正文围绕明确事实展开', '大公司栏目承载公司战略、业务动作、组织变化和重要合作。稿件需要给出具体事实，避免用空泛背景补足篇幅。', 0),
  makeStory('demo-opinion', '大公司', '💡 示例观点｜观点稿集中放在「大公司」末尾', '观点稿首先说明发言者是谁、在什么场合作出表达，再完整呈现其判断、理由和边界。\n\n> 这里展示经过翻译与核对的原话引用位置。', 1),
  makeStory('demo-product', '新产品', '示例新产品｜价格、规格与产品能力写清楚', '新产品稿会根据实际产品组织信息，写清售价、关键规格、功能变化与发售安排，不机械套用固定段落。', 0),
  makeStory('demo-consumer', '新消费', '示例新消费｜品牌动作与消费场景同时交代', '新消费栏目覆盖零售、餐饮、美妆、时尚、户外、文旅和本地生活。入选稿件需要有明确产品、经营数据或品牌动作。', 0),
  makeStory('demo-watch', '好看的', '示例好看的｜作品信息与看点直接呈现', '好看的栏目会说明作品、主创、档期和内容看点，并追到片方、平台或可靠影视媒体确认。', 0),
  makeStory('demo-candidate', '新产品', '示例候选｜等待追源和事实复核', '候选内容不会直接进入正式早报稿。', 1, false),
]

export const demoIssue: Issue = {
  id: 'demo-issue',
  publication_date: '演示刊期',
  title: '早报编辑台演示',
  state: 'demo',
  runtime_path: '',
  draft_path: '',
  revision: 0,
  selected_count: 6,
  review_count: 1,
  ready_count: 6,
  updated_at: '2026-07-21T09:00:00Z',
  stories,
  brand_packages: {
    appso: {
      headline_options: [
        'AI 产品完成重要更新 / 一款新设备正式发布 / 大公司公布新动作',
        '新模型能力进入产品 / 消费电子迎来新品 / 行业人物回应关键问题',
        '开发者工具迎来变化 / 新产品公布价格 / 公司业务出现新进展',
      ],
      selected_headline: 'AI 产品完成重要更新 / 一款新设备正式发布 / 大公司公布新动作',
      cover_candidates: [],
      selected_cover: '',
    },
    ifanr: {
      headline_options: [
        '新设备正式发布 / 汽车行业迎来新进展 / 消费品牌公布重要动作',
        '旗舰产品完成更新 / 大公司调整业务 / 一部新片公布档期',
        '消费电子迎来新品 / 本地生活出现新变化 / 行业人物发表观点',
      ],
      selected_headline: '新设备正式发布 / 汽车行业迎来新进展 / 消费品牌公布重要动作',
      cover_candidates: [],
      selected_cover: '',
    },
  },
  diagnostics: { demo: true },
}

export const demoWeekend = {
  one_fun_thing: { label: 'One Fun Thing', candidates: [{ id: 'demo-oft', title: '示例 OFT｜一个真正有意思的产品或项目', why: '介绍它具体好玩在哪里，以及用户实际能体验到什么。', score: 9, source_date: '本周', status: 'active' }] },
  book: { label: '买书不读指南', candidates: [{ id: 'demo-book', title: '示例书目｜围绕一本书详细介绍', why: '直接介绍作者、内容与写作特点。', score: 8.8, source_date: '本周', status: 'active' }] },
  watch: { label: '周末看什么', candidates: [{ id: 'demo-film', title: '示例电影｜剧情、主创与评价', why: '作品不必是新报道，但需要可靠资料和明确推荐理由。', score: 8.6, source_date: '本周', status: 'active' }] },
  game: { label: '游戏推荐', candidates: [{ id: 'demo-game', title: '示例游戏｜玩法、内容与玩家评价', why: '核对官方中文名、平台、玩法、价格与口碑。', score: 8.7, source_date: '本周', status: 'active' }] },
}
