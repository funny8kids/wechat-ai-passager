# 变更记录

格式遵循 Keep a Changelog；版本号遵循语义化版本。

## [0.3.0] - 2026-09-20 — 界面重设计（对标 doocs/md 与付费编辑器）

### 变更
- 外壳从"顶栏标签"改为**左侧深色图标导航栏 + 全宽工作区 + 底部状态栏**（工具心智，去网站感）
- 写作页编辑器成为主角：文档大标题头、格式工具条（加粗/斜体/标题/引用/列表/代码/链接/插图槽）、
  布局三态切换（仅编辑/分栏/仅预览，参照 doocs）、编辑预览分隔条可拖拽、字数与阅读时长实时显示
- 新增**复制富文本**：预览一键复制为带样式 HTML，直接粘贴公众号后台——48001 权限不通时的正式降级路径
- 配图页升级为"槽位→已成图"正文顺序时间线；已成图显示真实缩略图（新增 `asset:dataUrl` IPC，文件名白名单防穿越）
- 发布页新增四步流程图示；队列/配图/文章库补设计内空状态；`awaiting_confirm` 状态呼吸提示
- 文章库支持搜索过滤与悬停删除；AI 味评分环随分数变色；状态栏集中保存/IP/自检信息

### 新增
- 快捷键：Ctrl+S / Ctrl+N / Ctrl+B / Ctrl+I
- 深链 `#write|#images|#publish|#settings`；`--gj-tab` 启动参数与 `GJ_SHOT` 自截图模式（界面回归验证用）
- `js/workbench.js` UI 增强模块

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
