# 技术架构

> 设计对标 OBS Studio 的分层思想：**核心引擎与界面彻底分离**，界面只是引擎的一层薄壳；
> 每层只能调用比自己低的一层，禁止反向依赖。规模虽小，边界必须真实存在——
> 这决定了后期加"网图搜索源 / 截图源 / 手机同步"时是插模块，不是拆房子。

## 分层总览

```
┌──────────────────────────────────────────────────────┐
│  ④ UI 层  src/ui/          纯展示与交互，零 Node 能力 │
│      index.html + css/ + js/(9 个功能域脚本)           │
├──────────────────────────────────────────────────────┤
│  ③ 安全桥  src/preload/    contextBridge 白名单        │
│      渲染进程只能调用这里显式列出的方法                 │
├──────────────────────────────────────────────────────┤
│  ② 应用服务层  src/main/    Electron 主进程             │
│      index.cjs     生命周期/窗口/托盘/单实例            │
│      services.cjs  设置存取/DPAPI 密钥/客户端工厂       │
│      pipeline.cjs  发布流水线/定时执行体                │
│      ipc.cjs       IPC 路由（薄转发，不含业务）         │
│      core-loader.cjs 动态装载 core 层                  │
├──────────────────────────────────────────────────────┤
│  ① 核心引擎  src/core/      平台无关纯 ESM，可独立单测  │
│      ai.mjs        LLM 客户端 + 任务 prompt 注册表      │
│      wechat.mjs    微信 API 客户端 + 错误码解释表       │
│      md2wechat.mjs Markdown→微信 HTML 渲染器（主题化）  │
│      imagegen.mjs  生图客户端（免Key免费源+自带Key源）  │
│      backup.mjs    备份/迁移包（密钥双向硬拒）          │
│      store.mjs     原子写 JSON 存储                     │
│      scheduler.mjs 定时调度状态机                       │
└──────────────────────────────────────────────────────┘
```

**依赖规则**：④→③→②→① 单向。core 层不得出现 `require("electron")`；
main 层不含任何 DOM/界面知识；ui 层不含任何文件系统/网络知识。
这条规则让 core 可以被 `scripts/verify-article.mjs` 在纯 Node 下直接调用——
验证脚本与应用走**同一份代码**，这是"验证即真"的前提。

## 关键数据流

### 写作 → 发布
```
编辑器 textarea (Markdown 源，唯一事实)
  ├─ 实时预览:  ui → ipc → core/md2wechat.renderWeChatHtml(theme, imgMap)
  ├─ AI 建议:   ui 选区/勾选段落 → ipc → core/ai.chat → 建议卡片
  │             （人点"应用"才写回 textarea，pushSnapshot 可撤销）
  └─ 发布:      pipeline.buildDraftPayload
                  1. 扫描 ![](本地路径) → wechat.uploadContentImage → imgMap(CDN)
                  2. md2wechat 渲染内联样式 HTML（外链→文末角注）
                  3. 封面: coverPath 或首张本地图 → uploadThumb → thumb_media_id
                  4. draft/add → (人放行) → freepublish/submit
```

### 定时发布（人在回路的降级设计）
```
ui 入队 → scheduler 持久化 queue.json，20s tick
  到点 → runScheduled:
     mode=draft          → 推草稿箱 + 系统通知
     confirmBeforePublish → 状态置 awaiting_confirm + 通知（绝不自动发）
     人已放行/关闭确认     → 真实发布，失败自动重试 ≤3 次
```

### 密钥生命周期
```
输入(设置页/环境变量引导) → safeStorage(DPAPI) → secrets.json 只存 base64 密文
读取 → 解密仅存在于主进程内存 → 渲染进程永远拿不到明文（只拿到"已设置"布尔）
```

## 模块边界与扩展点

| 未来需求 | 插入位置 | 是否动现有代码 |
|---|---|---|
| 网图搜索配图源 | core 新增 `image-search.mjs` + ipc 一条路由 + ui 配图页一个 tab | 几乎不动 |
| 网页截图（Playwright） | 同上，作为独立可选依赖 | 不动 |
| AI 生图直连 | core 新增 `imagegen.mjs`，配图地图同源 | 不动 |
| 多 Agent 流水线 | main 新增 `agents.cjs` 编排 core/ai 多次调用 | 不动 ui |
| 手机/局域网同步 | 新增 core 层导出服务，ui 加设置项 | 不动发布链 |
| 新格式主题 | core/md2wechat 的 THEMES 表加一行 | 不动 |

## 进程与安全模型

- Electron 双进程：渲染进程 `contextIsolation: true`、`nodeIntegration: false`，
  所有能力经 preload 白名单（约 25 个方法）注入 `window.api`
- 单实例锁：定时调度器必须唯一进程持有，第二个实例唤起已有窗口后退出
- 关窗不退出：隐藏到托盘，调度器驻留（"退出"必须走托盘菜单显式动作）
- 数据全部位于 `%APPDATA%\gaojiang\data\`（settings/secrets/articles/queue/materials.json + assets/）

## 打包

electron-builder → portable 单文件 exe（NSIS 自解压，免安装、不写注册表）。
`asar: false`：core 层是动态 import 的 ESM，关 asar 规避 Electron 对 asar 内
ESM 解析的历史坑，代价是文件可见（本工具无闭源资产，可接受）。
