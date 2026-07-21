# 早报编辑台

React + TypeScript + Vite 编辑台。GitHub Pages 只承载无数据的静态界面；主 Mac 连接本机 Editorial Worker，其他设备通过 Tailscale Serve HTTPS 连接同一 Worker。

```bash
pnpm install
pnpm dev
```

本机开发地址为 `http://127.0.0.1:5173/`。页面会先尝试连接 `http://127.0.0.1:8765`；Worker 不可达时明确显示离线，不会回退到过期静态稿。顶栏持续显示 Worker 的连接状态，设置面板会区分「正在检测」「已通过 Tailscale Serve 连接」「Pages 模式」和「Worker 未连接」。

从其他设备连接主 Mac 时，使用 Tailscale Serve 的 HTTPS 根地址，例如 `https://shawn-rains-macbook-pro.tail42e7aa.ts.net`。不要填写 Worker 的本地裸端口 `:8765`，也不要在 HTTPS Pages 中使用 `http://`；页面会规范化旧格式并在连接失败时显示原因。Tailscale Serve 注入的用户身份由 Worker 验证，Worker 本身仍只监听本机回环地址。

公共页面：https://shawnrn.github.io/ifanr-zaobao-editorial-console/

编辑台只提供筛选、编辑、核验、Markdown 导出和审稿单导出，不直接发布飞书、公众号或 Etherpad。原有 AI 主编到飞书云文档及群卡片的链路始终独立运行。

## 跨设备审稿

任何加入同一 Tailnet 的电脑、手机或平板都可以打开公共页面，在连接设置中填入主 Mac 的 Tailscale Serve HTTPS 根地址。连接成功后，页面直接读写本机 Worker 的同一刊期状态；顶栏会显示「Worker 已连接」，设置面板还会显示访问方式与 Tailscale 登录身份。

点击「导出」仍可下载 Markdown 或 handoff 作为留档。Worker 不可达、主 Mac 休眠或当前设备没有 Tailnet 权限时，页面只显示连接错误，不加载新闻数据，也不会把本地旧缓存当作当前稿。

主 Mac 每次成功发布飞书后，仍会运行 `.agent/tools/publish_editorial_pages_snapshot.py`；该脚本现在只同步前端源码并触发 Pages 构建，绝不导出刊期数据。Pages 更新失败只作为同步告警，不影响已经验证通过的飞书发布链路。
