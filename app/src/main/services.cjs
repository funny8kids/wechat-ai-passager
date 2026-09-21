// 应用服务层：本地存储、设置、加密密钥、AI/微信客户端工厂
// 依赖注入：core 模块集合(lib) 与 safeStorage 由 index.cjs 传入，本模块不触碰 Electron 生命周期
const path = require("path");
const fs = require("fs/promises");

const DEFAULT_SETTINGS = {
  model: "deepseek-chat",
  baseUrl: "https://api.deepseek.com/v1",
  theme: "青竹绿",
  confirmBeforePublish: true,
  autoRetry: true,
  temperature: 0.7,
  maxTokens: 0, // 0 = 不限制，交给服务商默认
  agentParams: {
    初稿: { model: "", temperature: 0.8 },
    改写: { model: "", temperature: 0.7 },
    标题: { model: "", temperature: 0.9 },
    配图: { model: "", temperature: 0.6 },
    调研: { model: "", temperature: 0.5 },
    审核: { model: "", temperature: 0.3 },
  },
  // 生图：默认指向国内可达的免费端点，Key 由用户自带（加密存储，绝不落明文）
  imgGen: { provider: "智谱 CogView", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "cogview-3-flash", size: "1024x1024" },
};

function createServices({ lib, safeStorage, dataDir }) {
  const store = new lib.JsonStore(dataDir);

  async function init() {
    await fs.mkdir(path.join(store.dir, "assets"), { recursive: true });
  }

  // ---------- 设置（明文 JSON） ----------
  async function getSettings() {
    return store.load("settings", DEFAULT_SETTINGS);
  }
  async function setSettings(patch) {
    const s = { ...(await getSettings()), ...patch };
    await store.save("settings", s);
    return s;
  }

  // ---------- 密钥（safeStorage / Windows DPAPI 加密，磁盘只存密文） ----------
  async function getSecrets() {
    const raw = await store.load("secrets", {});
    const dec = (v) => (v && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v, "base64")) : v);
    return { appId: raw.appId || "", appSecret: dec(raw.appSecretEnc) || "", aiKey: dec(raw.aiKeyEnc) || "", imgKey: dec(raw.imgKeyEnc) || "" };
  }
  async function setSecrets(patch) {
    const raw = await store.load("secrets", {});
    const enc = (v) => (v && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(v).toString("base64") : v);
    // undefined=不动；空串=明确清除（否则密钥一旦填入就再也删不掉）
    if (patch.appId !== undefined) raw.appId = patch.appId;
    if (patch.appSecret !== undefined) raw.appSecretEnc = patch.appSecret ? enc(patch.appSecret) : undefined;
    if (patch.aiKey !== undefined) raw.aiKeyEnc = patch.aiKey ? enc(patch.aiKey) : undefined;
    if (patch.imgKey !== undefined) raw.imgKeyEnc = patch.imgKey ? enc(patch.imgKey) : undefined;
    if (!raw.appSecretEnc) delete raw.appSecretEnc;
    if (!raw.aiKeyEnc) delete raw.aiKeyEnc;
    if (!raw.imgKeyEnc) delete raw.imgKeyEnc;
    await store.save("secrets", raw);
    return { ok: true, encrypted: safeStorage.isEncryptionAvailable() };
  }
  // 首次启动引导：允许用环境变量注入密钥，避免明文进配置文件
  async function bootstrapSecretsFromEnv(env) {
    const patch = {};
    if (env.GJ_AI_KEY) patch.aiKey = env.GJ_AI_KEY;
    if (env.GJ_APPID) patch.appId = env.GJ_APPID;
    if (env.GJ_APPSECRET) patch.appSecret = env.GJ_APPSECRET;
    if (env.GJ_IMG_KEY) patch.imgKey = env.GJ_IMG_KEY;
    if (Object.keys(patch).length) await setSecrets(patch);
  }

  // ---------- 排版样式（内置 + 用户存的公众号样式） ----------
  async function listThemes() {
    const builtin = Object.entries(lib.BUILTIN_THEMES).map(([name, p]) => ({ name, builtin: true, ...p }));
    const custom = await store.load("themes", []);
    return { builtin, custom };
  }
  async function saveTheme(theme) {
    const name = String(theme?.name || "").trim();
    if (!name) throw new Error("样式名不能为空");
    if (lib.BUILTIN_THEMES[name]) throw new Error(`不能与内置样式重名：${name}`);
    const list = (await store.load("themes", [])).filter((x) => x.name !== name);
    list.push({ ...theme, name, builtin: false });
    await store.save("themes", list);
    return list;
  }
  async function deleteTheme(name) {
    const list = (await store.load("themes", [])).filter((x) => x.name !== name);
    await store.save("themes", list);
    return list;
  }
  // 统一渲染入口：theme 可为样式名（内置或自定义）或直接传调色板对象（设置页实时预览）
  const THEME_KEYS = ["accent", "heading", "body", "quote", "quoteBg", "border", "fontSize", "lineHeight", "letterSpacing"];
  const sanitizeTheme = (o) => Object.fromEntries(THEME_KEYS.filter((k) => o[k] != null && o[k] !== "").map((k) => [k, o[k]]));
  async function renderHtml(md, theme, opts = {}) {
    let name = typeof theme === "string" && theme ? theme : (await getSettings()).theme || "青竹绿";
    let override;
    if (theme && typeof theme === "object") override = sanitizeTheme(theme);
    else {
      const custom = await store.load("themes", []);
      const c = custom.find((x) => x.name === name);
      if (c) override = sanitizeTheme(c);
    }
    return lib.renderWeChatHtml(md, override ? "青竹绿" : name, { ...opts, themeOverride: override });
  }

  // ---------- 客户端工厂 ----------
  function wxClient(override) {
    // override：表单直测（未保存也能测）；留空字段回落到已保存凭证
    if (override && (override.appId || override.appSecret)) {
      return getSecrets().then(({ appId, appSecret }) => {
        const id = (override.appId || "").trim() || appId;
        const sec = (override.appSecret || "").trim() || appSecret;
        if (!id || !sec) throw new Error("AppID / AppSecret 未填全（或先「保存设置」再自检）");
        return new lib.WeChatClient({ appId: id, appSecret: sec });
      });
    }
    return getSecrets().then(({ appId, appSecret }) => {
      if (!appId || !appSecret) throw new Error("未配置 AppID / AppSecret（设置 → 公众号）");
      return new lib.WeChatClient({ appId, appSecret });
    });
  }
  async function aiClient(agentKey) {
    const [s, sec] = await Promise.all([getSettings(), getSecrets()]);
    const ap = agentKey ? (s.agentParams || DEFAULT_SETTINGS.agentParams)[agentKey] : null;
    return new lib.AIClient({
      baseUrl: s.baseUrl, apiKey: sec.aiKey,
      model: ap?.model || s.model,
      temperature: ap?.temperature ?? s.temperature ?? DEFAULT_SETTINGS.temperature,
      maxTokens: s.maxTokens ?? 0,
    });
  }

  // 生图客户端：override = 设置页表单直测（未保存也能测），留空字段回落已保存配置
  async function imgClient(override = {}) {
    const [s, sec] = await Promise.all([getSettings(), getSecrets()]);
    const cfg = { ...(DEFAULT_SETTINGS.imgGen || {}), ...(s.imgGen || {}) };
    const preset = lib.IMAGE_PRESETS[override.provider || cfg.provider] || lib.IMAGE_PRESETS[cfg.provider] || {};
    const baseUrl = (override.baseUrl || "").trim() || cfg.baseUrl || preset.baseUrl || "";
    const model = (override.model || "").trim() || cfg.model || preset.model || "";
    const key = (override.imgKey || "").trim() || sec.imgKey;
    if (!key) throw new Error("未填生图 API Key（设置 → 生图服务，Key 只加密存本机）");
    if (!baseUrl || !model) throw new Error("生图端点或模型名为空：选一个服务商预设，或在「自定义」里填 baseUrl + model");
    return new lib.ImageGenClient({
      baseUrl, model, apiKey: key,
      size: override.size || cfg.size || preset.sizes?.[0],
      sizeField: preset.sizeField || "size",
    });
  }

  return { store, init, getSettings, setSettings, getSecrets, setSecrets, bootstrapSecretsFromEnv, listThemes, saveTheme, deleteTheme, renderHtml, wxClient, aiClient, imgClient };
}

module.exports = { createServices, DEFAULT_SETTINGS };
