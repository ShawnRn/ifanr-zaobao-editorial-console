# 早报编辑台

React + TypeScript + Vite 编辑台。主 Mac 可连接本机 Editorial Worker；其他设备直接读取 GitHub Pages 上最近一次发布的静态刊期包，不需要安装项目、登录 iCloud 或连接主 Mac。

```bash
pnpm install
pnpm dev
```

本机开发地址为 `http://127.0.0.1:5173/`。页面会先尝试连接 `http://127.0.0.1:8765`；本地 Worker 不可达时，自动读取 Pages 的静态刊期包。顶栏持续显示 Worker 的连接状态，设置面板会区分「正在检测」「已通过 Tailscale Serve 连接」「Pages 静态模式」和「Worker 未连接」。

从其他设备连接主 Mac 时，使用 Tailscale Serve 的 HTTPS 根地址，例如 `https://shawn-rains-macbook-pro.tail42e7aa.ts.net`。不要填写 Worker 的本地裸端口 `:8765`，也不要在 HTTPS Pages 中使用 `http://`；页面会规范化旧格式并在连接失败时显示原因。Tailscale Serve 注入的用户身份由 Worker 验证，Worker 本身仍只监听本机回环地址。

公共页面：https://shawnrn.github.io/ifanr-zaobao-editorial-console/?static=1

编辑台只提供筛选、编辑、核验、Markdown 导出和审稿单导出，不直接发布飞书、公众号或 Etherpad。原有 AI 主编到飞书云文档及群卡片的链路始终独立运行。

## 跨设备审稿

任何电脑、手机或平板都可以直接打开公共页面。主编完成采用、排除、改标题、改正文、改分类或排序后：

1. 点击「导出」。
2. 下载 `ifanr-editorial-review-*.json`。
3. 把该 JSON 文件发送到早报飞书群。
4. 主 Mac 下一轮定时任务会读取并合并显式修改。

审稿单不是全量替换稿。它只记录显式操作，未列出的新闻不会被解释为删除；刊期、基础版本、故事指纹或旧标题发生冲突时，自动化保留现有正文并要求复核。同一浏览器审稿会话以最后一份导出为准，因此恢复选题可以撤销较早的删除操作；不同编辑的最新审稿单再按时间合并，不会因为某个人打开了较旧页面就把后续新增新闻一起删掉。

主 Mac 每次成功发布飞书后，会运行 `.agent/tools/publish_editorial_pages_snapshot.py` 更新 Pages。Pages 更新失败只作为同步告警，不影响已经验证通过的飞书发布链路。
