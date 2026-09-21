// 核心引擎装载：主进程以动态 import 引入平台无关的 ESM 核心模块（src/core）
const path = require("path");

const pathToFileUrl = (p) => "file:///" + String(p).replace(/\\/g, "/");

async function loadCore() {
  const dir = path.join(__dirname, "..", "core");
  const url = (f) => pathToFileUrl(path.join(dir, f));
  const wechat = await import(url("wechat.mjs"));
  const ai = await import(url("ai.mjs"));
  const md = await import(url("md2wechat.mjs"));
  const store = await import(url("store.mjs"));
  const sched = await import(url("scheduler.mjs"));
  const img = await import(url("imagegen.mjs"));
  return {
    WeChatClient: wechat.WeChatClient,
    explainError: wechat.explainError,
    AIClient: ai.AIClient,
    AI_TASKS: ai.AI_TASKS,
    buildRewriteMessages: ai.buildRewriteMessages,
    buildTitleMessages: ai.buildTitleMessages,
    renderWeChatHtml: md.renderWeChatHtml,
    BUILTIN_THEMES: md.BUILTIN_THEMES,
    JsonStore: store.JsonStore,
    Scheduler: sched.Scheduler,
    ImageGenClient: img.ImageGenClient,
    IMAGE_PRESETS: img.IMAGE_PRESETS,
  };
}

module.exports = { loadCore };
