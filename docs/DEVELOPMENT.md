# 开发指南

## 环境要求

| 项 | 值 |
|---|---|
| OS | Windows 10+（开发机为 Win11 24H2） |
| Node | ≥ 20（当前 v24） |
| npm 镜像 | **必须** `--registry=https://registry.npmmirror.com`（官方源本机超时，见 ADR-010） |
| Electron | 33.x（devDependency，勿随意升级） |

## 安装与运行

```bash
cd app
npm install --registry=https://registry.npmmirror.com
# 若 electron 二进制下载失败，补：
#   set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
#   node node_modules/electron/install.js
npm start
```

## 常用命令（均在 app/ 下）

| 命令 | 说明 |
|---|---|
| `npm start` | 开发运行（每次改 ui/core/main 代码后重启生效） |
| `npm run lint` | 语法门禁（提交前必跑，见 ADR-009） |
| `npm test` | 离线全量单测链（零网络零密钥）：test-stability / poller / schedule / richcopy / imagegen / noapi / backup / ux 共 8 套 192 项断言 |
| `npm run verify` | 端到端文章质量验证（真实调用 AI，21 项断言，需环境变量 `GJ_AI_KEY`） |
| `npm run check <AppID> <AppSecret>` | 微信 API 权限只读探测（不做任何写操作） |
| `npm run qa:clipboard` | 真实剪贴板留证：起应用真点「复制富文本/复制此图」，断言产物带图（需桌面会话，自备并清理留证数据） |
| `npm run dist` | 打包便携 exe → `dist/gaojiang-<ver>-portable.exe` |

打包镜像变量（首次需设置）：
```bash
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

## 密钥与环境变量注入

应用启动时识别（仅用于首次写入加密存储，之后可清除）：
`GJ_AI_KEY`、`GJ_APPID`、`GJ_APPSECRET` → 经 safeStorage(DPAPI) 加密进
`%APPDATA%\gaojiang\data\secrets.json`。**任何情况下不得把明文密钥写进代码、文档或 git。**

## 数据目录（运行时）

```
%APPDATA%\gaojiang\data\
  settings.json   明文设置（模型/baseUrl/主题/开关）
  secrets.json    仅密文（aiKeyEnc/appSecretEnc）
  articles.json   文章库
  queue.json      定时任务
  materials.json  素材库（去AI味引用）
  assets\         导入的本地图片
```

## 代码规范

- **分层依赖单向**：ui → preload → main → core；core 内禁止 `require("electron")`（保证纯 Node 可测）
- core：ESM（.mjs），零依赖；main：CJS（.cjs，Electron 主进程约束）；ui：经典脚本，
  顶层声明不得跨文件重名（见 ADR-009）
- 注释只写"为什么"，不写"是什么"；中文注释
- 新增 AI 任务 → 只改 `src/core/ai.mjs` 的 `AI_TASKS` 注册表
- 新增排版主题 → 只改 `src/core/md2wechat.mjs` 的 `THEMES`
- 新增 IPC → ipc.cjs 加路由 + preload 加白名单方法，两处同步

## 提交流程

1. `npm run lint` + `npm test` 通过
2. 改了生成链路 → `npm run verify` 21/21；改了复制/配图链路 → `npm run qa:clipboard` 6/6
3. 界面改动需实际启动应用确认动态渲染（列表/评分/预览有内容），**不接受"窗口出现=正常"**
4. git 提交（仓库根），信息写清动机；重要设计变化 → docs/DECISIONS.md 补 ADR
5. 发版：改 `package.json` version → `npm run dist` → 实测 exe → 更新 CHANGELOG

## 排障速查

| 症状 | 根因位置 |
|---|---|
| 界面在但全部失灵 | 渲染脚本语法错误 → `npm run lint`；底部应有红色显形条 |
| 双击 exe 无反应 | 单实例锁被占（托盘/其他实例），任务管理器结束全部 稿匠/gaojiang 进程 |
| 40164 | 公网 IP 变更，重新加入公众号白名单 |
| 48001 | 账号无草稿 API 权限 → 降级模式（ADR-008） |
| AI 报 401/404 | baseUrl 少了 `/v1`（AIClient 拼 `/chat/completions`） |
| npm install 超时 | 未走 npmmirror |
