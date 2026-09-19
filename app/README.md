# 稿匠 · 公众号 AI 创作单机工具

配套文档：`../docs/PRD.md`（产品需求）｜`../prototype/index.html`（交互原型）

## 启动
```bash
cd app
npm start          # 若依赖缺失：npm i -D electron@33 --registry=https://registry.npmmirror.com
```

## 打包为 exe
```bash
# 依赖：npm i -D electron-builder --registry=https://registry.npmmirror.com
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
npx electron-builder --win portable
# 产物：release/gaojiang-<版本>-portable.exe（免安装，双击即用；数据仍存 %APPDATA%\gaojiang）
```
注意：密钥用 Windows DPAPI 加密，exe 拷到另一台电脑后需重新填一次 API Key / AppSecret；未签名 exe 首次运行可能被 SmartScreen 拦截，点「仍要运行」即可。

## 第一次使用（10 分钟）
1. **设置 → 公众号**：填 AppID / AppSecret → 点「连通性自检」
   - 三项全 OK → 支持全自动"定时→草稿→放行发布"
   - 报 48001 → 账号无草稿/发布 API 权限（未认证个人订阅号常见），工具仍可用于写作，发布降级为导出 Markdown 手动粘贴
   - 报 40164 → 把状态栏显示的公网 IP 加入：公众号后台 → 设置与权限 → IP 白名单
2. **设置 → AI 服务**：填任意 OpenAI 兼容端点（DeepSeek/Kimi/GLM/OpenAI 代理…）的 Base URL + Key + 模型名
3. **设置 → 个人素材库**：写几条你的真实经历/口头禅/立场（去 AI 味的弹药）

也可以先不开软件，用命令行验证权限：
```bash
node scripts/check-wechat.mjs <AppID> <AppSecret>
```

## 核心工作流
写作页 →「AI 生成初稿」（自动在情绪转折处埋 `[图槽: 意图]`）→
选中文字用右侧「AI 改写」（只改选区，建议卡片需你点"应用"）→
「段落回炉」勾选段落批量出建议 →「体检」看 AI 味评分与审核报告 →
配图页逐槽位生成提示词/选本地图 → 发布页：立即送草稿 / 立即发布 / 定时（到点先推草稿+通知，最终由你放行）。

## 人在回路铁律（软件层面的硬约束）
- 不存在"全文重写"操作；AI 一切产出=建议卡片，点"应用"才生效
- 应用即快照，toast 里可撤销
- 定时发布默认到点提醒、人工确认；关闭该开关需进设置明确勾选

## 已知限制（单机方案的代价）
- 定时发布那一刻电脑必须开机联网（App 可最小化到托盘）
- 家宽 IP 变化后需重新加白名单（状态栏常显当前 IP，点击可复制）
- 正文外链图片会被微信过滤：发布时本地图自动转存 CDN，外链图请换掉
- 封面必填：正文第一张本地图自动作为封面，可在文章对象中指定 coverPath
- uploadimg 有日限额（约 100 张/日），图片多时留意

## 目录结构
```
app/
├─ main.cjs            Electron 主进程（IPC/托盘/调度/发布流水线）
├─ preload.cjs         安全桥（contextIsolation）
├─ lib/
│  ├─ wechat.mjs       微信API客户端（token/图/草稿/发布+错误码人话）
│  ├─ ai.mjs           OpenAI兼容客户端（chat/流式/改写任务prompt）
│  ├─ md2wechat.mjs    Markdown→微信内联样式（3主题，外链转角注）
│  ├─ scheduler.mjs    本地定时调度（重试/awaiting_confirm 状态机）
│  └─ store.mjs        JSON 持久化（原子写）
├─ renderer/           界面（写作/配图/发布/设置 四页）
└─ scripts/check-wechat.mjs   API 权限自检
```
数据位置：`%APPDATA%/gaojiang/data`（文章/队列/素材/图片 assets）；密钥经 Windows DPAPI 加密。
