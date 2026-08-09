# 早报编辑台

Worker 可用时，编辑台加载并保存真实刊期；Worker 不可达时自动显示明确标识的当日 Bot 正式稿只读快照。公开 Pages 不包含候选库、排除项、本地路径、文件 token、账号或密钥。

稿件详情里的「配图」支持上传本地 JPEG、PNG、GIF、WebP 原图，粘贴图片 URL 交给 Worker 下载，或直接按 `⌘V` 粘贴剪贴板图片；已有配图可以替换或删除。图片变更需要连接 Worker。

React + TypeScript + Vite 编辑台。GitHub Pages 承载静态界面和脱敏的当日正式稿只读快照；主 Mac 连接本机 Editorial Worker，其他设备通过 Tailscale Serve HTTPS 或家庭局域网连接同一 Worker。

```bash
pnpm install
pnpm dev
```

本机开发地址为 `http://127.0.0.1:5173/`。页面会先尝试连接 `http://127.0.0.1:8765`；Worker 不可达时显示 Pages 随最近一次成功发布同步的当日正式稿只读快照。顶栏持续显示 Worker 的连接状态，设置面板会区分「正在检测」「已通过 Tailscale Serve 连接」「Pages 快照」和「Worker 未连接」。

从其他设备连接主 Mac 时，直接打开 Tailscale Serve 的 HTTPS 根地址，例如 `https://shawn-rains-macbook-pro.tail42e7aa.ts.net`。该地址同时提供编辑台页面和 Worker API，避免 GitHub Pages 跨域访问私网被浏览器拦截。不要使用 `https://100.x.x.x`，因为 Tailscale IP 无法匹配 `.ts.net` HTTPS 证书；也不要附加 `:8765`。Tailscale Serve 注入的用户身份由 Worker 验证。

当两台 Mac 位于同一家庭局域网时，可直接打开 `http://shawn-rains-macbook-pro.local:8765/`。这条路径不经过 Tailscale Serve，适合路由器加入 Tailnet，但终端没有独立 Tailnet 身份的情况。Worker 仅允许回环、RFC 1918 私网和 Tailscale CGNAT 网段访问。

公共页面：https://shawnrn.github.io/ifanr-zaobao-editorial-console/

编辑台只提供筛选、编辑、核验、Markdown 导出和审稿单导出，不直接发布飞书、公众号或 Etherpad。原有 AI 主编到飞书云文档及群卡片的链路始终独立运行。

## 跨设备审稿

任何加入同一 Tailnet 的电脑、手机或平板都可以打开公共页面，在连接设置中填入主 Mac 的 Tailscale Serve HTTPS 根地址。连接成功后，页面直接读写本机 Worker 的同一刊期状态；顶栏会显示「Worker 已连接」，设置面板还会显示访问方式与 Tailscale 登录身份。

点击「导出」仍可下载 Markdown 或 handoff 作为留档。Worker 不可达、主 Mac 休眠或当前设备没有 Tailnet 权限时，页面显示脱敏后的当日正式稿只读快照；该快照不能编辑，也不会反向覆盖 Worker 或飞书稿。

主 Mac 每次成功发布飞书后会运行 `.agent/tools/publish_editorial_pages_snapshot.py`；该脚本同步前端源码与脱敏的当日正式稿快照，再触发 Pages 构建。Pages 更新失败只作为同步告警，不影响已经验证通过的飞书发布链路。

## Gemini 标题生成

双品牌页的标题生成由访问页面的浏览器直接调用 Gemini 3.5 Flash。API Key 只保存在该浏览器的 `localStorage` 中，不会写入 Worker、SQLite、导出文件或 GitHub Pages 构建产物。换一台设备或换一个浏览器时，需要在设置中分别配置。
