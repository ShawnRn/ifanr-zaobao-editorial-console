# 早报编辑台

Worker 可用时，编辑台加载并保存真实刊期；Worker 不可达时自动显示明确标识的当日 Bot 正式稿只读快照。公开 Pages 不包含候选库、排除项、本地路径、文件 token、账号或密钥。

稿件详情里的「配图」支持上传本地 JPEG、PNG、GIF、WebP 原图，粘贴图片 URL 交给 Worker 下载，或直接按 `⌘V` 粘贴剪贴板图片；已有配图可以替换或删除。图片变更需要连接 Worker。

React + TypeScript + Vite 编辑台。生产工作台与 Worker API 同在 VPS，统一使用 [HTTPS 编辑台](https://111.228.56.220/)。VPS 上的 Caddy 在 443 终止 TLS，再转发到回环地址 `127.0.0.1:8765`。工作台在生产域名下始终请求同源 API。

```bash
pnpm install
pnpm dev
```

本机开发地址为 `http://127.0.0.1:5173/`。默认 Worker 地址为 `https://111.228.56.220`。GitHub Pages 继续提供脱敏的只读快照。

公共页面：https://shawnrn.github.io/ifanr-zaobao-editorial-console/

编辑台只提供筛选、编辑、核验、Markdown 导出和审稿单导出，不直接发布飞书、公众号或 Etherpad。原有 AI 主编到飞书云文档及群卡片的链路始终独立运行。

## 跨设备审稿

在任意设备打开生产 HTTPS 入口，登录同一个工作台账号即可访问 VPS 上的同一刊期。Worker 不可达时，公共 Pages 仍可供只读查看脱敏快照。导出可下载 Markdown 或 handoff 留档。

主 Mac 每次成功发布飞书后会运行 `.agent/tools/publish_editorial_pages_snapshot.py`；该脚本同步前端源码与脱敏的当日正式稿快照，再触发 Pages 构建。Pages 更新失败只作为同步告警，不影响已经验证通过的飞书发布链路。

## AI 生成与 VPS 内置端点

双品牌页的标题生成由访问页面的浏览器直接调用 Gemini 3.5 Flash。API Key 只保存在该浏览器的 `localStorage` 中，不会写入 Worker、SQLite、导出文件或 GitHub Pages 构建产物。换一台设备或换一个浏览器时，需要在设置中分别配置。

「ifanr」是默认且独立的 AI 引擎，快讯、品牌标题和 AI 采编助手会经 VPS Worker 调用内置上游。Worker 通过 `EDITORIAL_LLM_BASE_URL` / `EDITORIAL_LLM_API_KEY` / `EDITORIAL_LLM_MODEL` 读取固定配置，密钥只保存在权限为 `600` 的服务器环境文件，不会下发到浏览器。该代理需要工作台登录，前端不能指定任意上游 URL。Gemini 和 OpenAI 兼容直连作为另外两种独立选项保留。

主页「最近稿件」中的快讯草稿由 Worker SQLite 按登录账号保存，同一账号在不同设备登录后会读取同一份记录。浏览器缓存只用于网络中断时暂存；升级前保存在 `editorial_flash_drafts` 的旧草稿会在账号首次成功连接 Worker 时自动迁入服务端，迁移成功后删除旧缓存。

未登录用户首次打开 Worker 工作台时会看到登录/注册卡片，可关闭后以只读模式继续。管理员可在团队设置中复制 `#register/<invite>` 邀请链接，打开后直达注册并预填邀请码。账号头像按 `user_id` 独立保存，未上传时统一显示人形占位符。
