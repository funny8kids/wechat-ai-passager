# 变更记录

格式遵循 Keep a Changelog；版本号遵循语义化版本。

## [0.2.0] - 2026-09-20 — 工程化重构

### 新增
- git 版本管理（基线提交 7b146e4 → 重构提交）
- 文档体系：README（项目总览+目录地图）、ARCHITECTURE（四层架构与数据流）、
  DECISIONS（10 条 ADR）、UI-DESIGN（人在回路五定律+视觉规范）、DEVELOPMENT、CHANGELOG
- `scripts/lint.mjs` 语法门禁（`npm run lint`）
- `scripts/verify-article.mjs` 端到端文章质量验证（`npm run verify`，19 项断言）
- 渲染层全局错误显形条（未捕获异常不再静默）
- 便携版 exe 产物（electron-builder portable，免安装）

### 变更
- 目录按 OBS 分层思想重排：`lib/ → src/core/`（引擎）、`main.cjs → src/main/` 四模块
  （index/services/pipeline/ipc + core-loader）、`renderer/ → src/ui/`（js 按功能域拆 6 文件）、
  `build/ → resources/`、打包输出 `release/ → dist/`
- 主进程启动失败不再静默退出：catch 后弹错误框并退出
- 环境变量注入密钥逻辑收敛进 services.bootstrapSecretsFromEnv

### 修复
- **致命**：渲染层 app.js 两处多余右括号导致整个脚本语法错误、界面沦为静态壳
  （用户报"无法使用"的直接原因）——已修复并被 lint 门禁永久覆盖

## [0.1.0] - 2026-09-19 — 首个完整可用版

### 新增
- Electron 单机应用：写作（文章库/Markdown 编辑/实时预览/AI 建议卡片）、
  配图（图槽协议 + AI 提示词 + 本地图落位）、发布（存草稿/立即发布/定时队列）、
  设置（AI 服务/公众号凭证/连通性自检/公网 IP/素材库）
- core 引擎：wechat.mjs（token/传图/草稿/发布/错误码表）、ai.mjs（OpenAI 兼容 +
  AI_TASKS）、md2wechat.mjs（三主题内联样式渲染/外链转角注/图槽虚线占位）、
  store.mjs（原子写）、scheduler.mjs（20s tick/重试≤3/awaiting_confirm）
- 密钥 DPAPI 加密存储；单实例锁；托盘驻留
- 微信 API 只读探测脚本 check-wechat.mjs
- PRD v0.1、交互原型 v0.2
