# 稿匠 · 公众号 AI 创作单机工具

一款 **Windows 桌面工具**（非网站、无服务器）：AI 辅助写作微信公众号文章，人在回路（Human-in-the-Loop）改稿，本地定时发布。用户自带任意 OpenAI 兼容 API Key（默认适配 DeepSeek）。

## 核心原则（不可违背）

1. **单机**：全部数据存本机，不租任何服务器；密钥经 Windows DPAPI 加密落盘
2. **人在回路**：AI 永远只产出"建议卡片"，逐段应用或忽略，绝不整篇重写
3. **活人感优先**：内置 AI 味规则评分（套话命中 + 句长均匀度 + 列举腔），去味是产品主线
4. **配图三源**：AI 生图提示词 / 本地图 / 网图（外链图发布前强制提醒版权与过滤风险）

## 快速开始

```bash
cd app
npm install --registry=https://registry.npmmirror.com   # 官方源在本机网络超时，必须走镜像
npm start                                              # 开发运行
npm run dist                                           # 打包免安装 exe → app/dist/
```

首次使用 10 分钟配置（设置页内完成）：AI 服务（Base URL + Key + 模型）→ 公众号 AppID/AppSecret → 点「连通性自检」。用户手册与故障排查表见 [docs/USER-GUIDE.md](docs/USER-GUIDE.md)（不看代码也能配好），开发相关见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 目录地图

```
AI公众号/
├─ README.md                ← 你在这里
├─ docs/                    ← 文档体系（唯一权威来源）
│  ├─ PRD.md                产品需求（用户故事 / 功能清单 / 验收标准）
│  ├─ ARCHITECTURE.md       技术架构（分层、模块边界、数据流）
│  ├─ DECISIONS.md          架构决策记录（ADR，为什么这么设计）
│  ├─ UI-DESIGN.md          界面与交互规范（含 HITL 五定律）
│  ├─ DEVELOPMENT.md        开发指南（环境 / 命令 / 测试 / 打包）
│  └─ CHANGELOG.md          版本变更记录
├─ app/                     ← 软件本体（Electron）
│  ├─ src/
│  │  ├─ core/              第①层 核心引擎：平台无关纯 ESM 模块，可独立单测
│  │  │   ai.mjs            OpenAI 兼容客户端 + 预置任务 prompt 库
│  │  │   wechat.mjs        微信开放 API 客户端（token/传图/草稿/发布/错误码表）
│  │  │   md2wechat.mjs     Markdown → 微信内联样式 HTML（多主题/角注/图槽）
│  │  │   store.mjs         原子写 JSON 存储
│  │  │   └─ scheduler.mjs  本地定时调度器
│  │  ├─ main/              第②层 应用服务：Electron 主进程装配与业务编排
│  │  │   index.cjs         入口：生命周期/窗口/托盘/依赖装配
│  │  │   services.cjs      设置/加密密钥/客户端工厂
│  │  │   pipeline.cjs      发布流水线 + 定时任务执行体
│  │  │   ipc.cjs           IPC 路由（薄层，只做转发）
│  │  │   └─ core-loader.cjs 动态装载 core 层
│  │  ├─ preload/index.cjs  第③层 安全桥：contextBridge 白名单
│  │  └─ ui/                第④层 界面：零依赖经典脚本，按功能域分文件
│  │      index.html  css/main.css
│  │      └─ js/ util.js editor.js images.js publish.js settings.js boot.js
│  ├─ resources/            图标等资源
│  ├─ scripts/              工程脚本：lint.mjs / check-wechat.mjs / verify-article.mjs
│  └─ dist/                 打包产物（不入库）
└─ prototype/               历史交互原型 v0.2（设计参考，非运行代码）
```

## 质量门禁

| 命令 | 作用 |
|---|---|
| `npm run lint` | 全部 JS/CJS/MJS 语法检查（曾发生渲染脚本一个括号导致整站静默失效） |
| `npm run verify` | 真实调用 AI 生成整篇文章，19 项质量断言（图槽位置/去味/HITL 零改动保证/渲染合规） |
| `npm run check <AppID> <Secret>` | 微信 API 权限探测，不产生任何线上写操作 |

## 已知边界

- 微信 API 无"定时发布"字段 → 定时靠本机调度器，到点推草稿 + 系统通知，**最终发布由人放行**
- 未认证个人订阅号可能报 48001（无草稿 API 权限）→ 工具自动降级为"排版导出 + 手动粘贴"
- exe 未代码签名：新机器首跑可能被 SmartScreen 拦截；DPAPI 密钥不随 exe 迁移
