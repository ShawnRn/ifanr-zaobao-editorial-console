# 早报编辑台

React + TypeScript + Vite 静态前端。候选、稿件和编辑操作由本机 Editorial Worker 提供，构建物不含稿件、Cookie、Token 或账号信息。

```bash
pnpm install
pnpm dev
```

本机开发地址为 `http://127.0.0.1:5173/`，GitHub Pages 与本地开发版都默认连接 `http://127.0.0.1:8765`。Worker 仅监听回环地址：静态页面可以公开部署，新闻内容、登录态与发布能力不会进入 GitHub Pages 构建物。

公共页面：https://shawnrn.github.io/ifanr-zaobao-editorial-console/

编辑台只提供筛选、编辑、核验、Markdown 导出和自动化 handoff，不直接发布飞书、公众号或 Etherpad。原有 AI 主编到飞书云文档及群卡片的链路始终独立运行。

## 同一 iCloud 的另一台 Mac

另一台 Mac 不需要启用早报定时任务，只需在 iCloud 已经同步该项目后运行：

```bash
cd "/Users/shawnrain/Documents/ifanr/早报"
./scripts/editorial-console/install_local_worker.sh
```

安装脚本会导入 iCloud 目录中最新的 fresh runtime 和 `.state/editorial-console/handoffs/` 完整快照。此后直接打开 GitHub Pages；页面连接该 Mac 自己的 `127.0.0.1:8765`。审稿结果写回 iCloud handoff，由主 Mac 的下一轮自动化合并到飞书 Bot 稿。两台 Mac 不要同时编辑同一刊期，以避免 iCloud 最后写入者覆盖前一份 handoff。
