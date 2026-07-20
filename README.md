# 早报编辑台

React + TypeScript + Vite 静态前端。候选和发布能力来自本机 Editorial Worker，构建物不含稿件、Cookie、Token 或账号信息。

```bash
pnpm install
pnpm dev
```

本机开发地址为 `http://127.0.0.1:5173/`，GitHub Pages 与本地开发版都默认连接 `http://127.0.0.1:8765`。Worker 仅监听回环地址：静态页面可以公开部署，新闻内容、登录态与发布能力不会进入 GitHub Pages 构建物。

## 部署

`main` 分支每次更新由 GitHub Actions 执行测试、构建并发布到 GitHub Pages。仓库只包含前端源码，不保存任何编辑数据。
