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
    return { appId: raw.appId || "", appSecret: dec(raw.appSecretEnc) || "", aiKey: dec(raw.aiKeyEnc) || "" };
  }
  async function setSecrets(patch) {
    const raw = await store.load("secrets", {});
    const enc = (v) => (v && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(v).toString("base64") : v);
    if (patch.appId !== undefined) raw.appId = patch.appId;
    if (patch.appSecret) raw.appSecretEnc = enc(patch.appSecret);
    if (patch.aiKey) raw.aiKeyEnc = enc(patch.aiKey);
    await store.save("secrets", raw);
    return { ok: true, encrypted: safeStorage.isEncryptionAvailable() };
  }
  // 首次启动引导：允许用环境变量注入密钥，避免明文进配置文件
  async function bootstrapSecretsFromEnv(env) {
    const patch = {};
    if (env.GJ_AI_KEY) patch.aiKey = env.GJ_AI_KEY;
    if (env.GJ_APPID) patch.appId = env.GJ_APPID;
    if (env.GJ_APPSECRET) patch.appSecret = env.GJ_APPSECRET;
    if (Object.keys(patch).length) await setSecrets(patch);
  }

  // ---------- 客户端工厂 ----------
  function wxClient() {
    return getSecrets().then(({ appId, appSecret }) => {
      if (!appId || !appSecret) throw new Error("未配置 AppID / AppSecret（设置 → 公众号）");
      return new lib.WeChatClient({ appId, appSecret });
    });
  }
  async function aiClient() {
    const [s, sec] = await Promise.all([getSettings(), getSecrets()]);
    return new lib.AIClient({ baseUrl: s.baseUrl, apiKey: sec.aiKey, model: s.model });
  }

  return { store, init, getSettings, setSettings, getSecrets, setSecrets, bootstrapSecretsFromEnv, wxClient, aiClient };
}

module.exports = { createServices, DEFAULT_SETTINGS };
