// 稿匠 Electron 主进程
const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, safeStorage, dialog, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs/promises");

let win, tray, isQuitting = false;
const lib = {};

async function loadLibs() {
  const dir = path.join(__dirname, "lib");
  lib.WeChatClient = (await import(pathToFileUrl(path.join(dir, "wechat.mjs")))).WeChatClient;
  lib.explainError = (await import(pathToFileUrl(path.join(dir, "wechat.mjs")))).explainError;
  lib.AIClient = (await import(pathToFileUrl(path.join(dir, "ai.mjs")))).AIClient;
  lib.AI_TASKS = (await import(pathToFileUrl(path.join(dir, "ai.mjs")))).AI_TASKS;
  lib.buildRewriteMessages = (await import(pathToFileUrl(path.join(dir, "ai.mjs")))).buildRewriteMessages;
  lib.renderWeChatHtml = (await import(pathToFileUrl(path.join(dir, "md2wechat.mjs")))).renderWeChatHtml;
  lib.JsonStore = (await import(pathToFileUrl(path.join(dir, "store.mjs")))).JsonStore;
  lib.Scheduler = (await import(pathToFileUrl(path.join(dir, "scheduler.mjs")))).Scheduler;
}
const pathToFileUrl = (p) => "file:///" + String(p).replace(/\\/g, "/");

// ---------- 存储与密钥 ----------
let store;
const SETTINGS_KEY = "settings";
async function getSettings() {
  return store.load(SETTINGS_KEY, { model: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1", theme: "青竹绿", confirmBeforePublish: true, autoRetry: true });
}
async function setSettings(patch) {
  const s = { ...(await getSettings()), ...patch };
  await store.save(SETTINGS_KEY, s);
  return s;
}
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

// ---------- 发布流水线 ----------
const IMG_RE = /!\[[^\]]*\]\(([^)\s]+)/g;
async function buildDraftPayload(article) {
  const s = await getSettings();
  const client = await wxClient();
  const imgMap = {};
  for (const m of article.md.matchAll(IMG_RE)) {
    const src = m[1];
    if (/^https?:\/\//i.test(src)) continue; // 已是网络图（发布前需转存，这里提示）
    const p = path.isAbsolute(src) ? src : path.join(store.dir, "assets", src);
    try {
      const buf = await fs.readFile(p);
      if (buf.length > 950_000) throw new Error(`图片超过微信 1MB 限制: ${src}`);
      imgMap[src] = await client.uploadContentImage(buf, path.basename(p));
    } catch (e) {
      if (/限制/.test(e.message)) throw e;
      throw new Error(`本地图片读取失败: ${p}（${e.message}）`);
    }
  }
  const html = lib.renderWeChatHtml(article.md, article.theme || s.theme, { imgMap });
  // 封面：优先文章 coverPath，其次第一张本地图
  let coverPath = article.coverPath;
  if (!coverPath) {
    const first = [...article.md.matchAll(IMG_RE)].find((m) => !/^https?:\/\//i.test(m[1]));
    if (first) coverPath = path.isAbsolute(first[1]) ? first[1] : path.join(store.dir, "assets", first[1]);
  }
  if (!coverPath) throw new Error("缺少封面图：草稿必须有 thumb_media_id。请在文章里放一张本地图作为首图，或指定封面");
  const thumbMediaId = article.thumbMediaId || (await client.uploadThumb(await fs.readFile(coverPath), path.basename(coverPath)));
  const digest = article.digest || (article.md.replace(/[#>*!\[\]()`-]/g, "").replace(/\s+/g, " ").trim().slice(0, 100));
  return { client, payload: { title: article.title, html, digest, thumbMediaId }, thumbMediaId };
}

async function saveDraft(article) {
  const { client, payload, thumbMediaId } = await buildDraftPayload(article);
  const draftMediaId = await client.addDraft(payload);
  return { draftMediaId, thumbMediaId };
}
async function publishArticle(article) {
  const { draftMediaId } = await saveDraft(article);
  const client = await wxClient();
  const publishId = await client.publish(draftMediaId);
  return { draftMediaId, publishId };
}

let scheduler;
async function runScheduled(task) {
  const articles = await store.load("articles", []);
  const article = articles.find((a) => a.id === task.articleId);
  if (!article) throw new Error("队列关联的文章已删除");
  const s = await getSettings();
  if (task.mode === "draft") {
    const r = await saveDraft(article);
    await scheduler.update(task.id, { draftMediaId: r.draftMediaId });
    notify(`已按时存入草稿箱：${article.title}`, "打开稿匠可一键发布");
    return;
  }
  if (s.confirmBeforePublish && !task.confirmed) {
    // 人在回路：到点只提醒，不自动发布
    await scheduler.update(task.id, { status: "awaiting_confirm" });
    notify(`定时发布到点，等你放行：${article.title}`, "打开稿匠点击「确认发布」");
    return;
  }
  const r = await publishArticle(article);
  await scheduler.update(task.id, { draftMediaId: r.draftMediaId, publishId: r.publishId });
}

function notify(title, body) {
  try { new Notification({ title, body }).show(); } catch {}
  if (tray) try { tray.displayBalloon({ title, content: body }); } catch {}
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle("settings:get", getSettings);
  ipcMain.handle("settings:set", (e, patch) => setSettings(patch));
  ipcMain.handle("secrets:get", async () => {
    const s = await getSecrets();
    return { appId: s.appId, appSecretSet: !!s.appSecret, aiKeySet: !!s.aiKey };
  });
  ipcMain.handle("secrets:set", (e, patch) => setSecrets(patch));

  ipcMain.handle("articles:list", () => store.load("articles", []));
  ipcMain.handle("articles:save", async (e, article) => {
    const list = await store.load("articles", []);
    const i = list.findIndex((a) => a.id === article.id);
    article.updatedAt = Date.now();
    if (i >= 0) list[i] = article; else list.unshift(article);
    await store.save("articles", list);
    return article;
  });
  ipcMain.handle("articles:delete", async (e, id) => {
    await store.save("articles", (await store.load("articles", [])).filter((a) => a.id !== id));
    return true;
  });

  ipcMain.handle("preview:render", async (e, { md, theme }) => lib.renderWeChatHtml(md || "", theme || "青竹绿", {}));
  ipcMain.handle("ai:rewrite", async (e, { task, selText, customNote }) => {
    const client = await aiClient();
    return { text: await client.chat(lib.buildRewriteMessages(task, selText, customNote)) };
  });
  ipcMain.handle("ai:chat", async (e, { messages }) => {
    const client = await aiClient();
    return { text: await client.chat(messages) };
  });
  ipcMain.handle("ai:json", async (e, { system, user }) => {
    const client = await aiClient();
    const text = await client.chat([{ role: "system", content: system + "\n只输出合法 JSON。" }, { role: "user", content: user }], { json: true, temperature: 0.6 });
    try { return { json: JSON.parse(text) }; }
    catch { return { json: null, raw: text }; }
  });
  ipcMain.handle("materials:get", () => store.load("materials", []));
  ipcMain.handle("materials:set", async (e, list) => { await store.save("materials", list); return true; });
  ipcMain.handle("assets:import", async (e, srcPath) => {
    const name = Date.now().toString(36) + path.extname(srcPath || "").toLowerCase();
    await fs.copyFile(srcPath, path.join(store.dir, "assets", name));
    return name; // 相对 assets 目录的文件名，md 中写 ![](assets名)
  });
  ipcMain.handle("ai:draft", async (e, { prompt }) => {
    const client = await aiClient();
    return { text: await client.chat([{ role: "system", content: lib.AI_TASKS.生成初稿 }, { role: "user", content: prompt }], { temperature: 0.8 }) };
  });

  ipcMain.handle("wx:selftest", async () => {
    const steps = [];
    try {
      const c = await wxClient();
      await c.getToken(); steps.push(["获取 access_token", "ok"]);
      try { steps.push(["草稿箱权限", `ok（现有草稿 ${await c.draftCount()} 篇）`]); }
      catch (e) { steps.push(["草稿箱权限", `fail: ${e.message}`]); }
      try { const r = await fetch("https://api.ipify.org?format=json"); steps.push(["公网 IP", (await r.json()).ip]); }
      catch (e) { steps.push(["公网 IP", "探测失败：" + e.message]); }
    } catch (e) { steps.push(["获取 access_token", `fail: ${e.message}`]); }
    return steps;
  });
  ipcMain.handle("wx:saveDraft", async (e, article) => saveDraft(article));
  ipcMain.handle("wx:publish", async (e, article) => publishArticle(article));
  ipcMain.handle("ip:detect", async () => {
    for (const u of ["https://api.ipify.org?format=json", "https://api.ip.sb/geoip"]) {
      try {
        const r = await fetch(u);
        const j = await r.json();
        return j.ip || j.query || null;
      } catch {}
    }
    return null;
  });

  ipcMain.handle("queue:list", () => scheduler.all());
  ipcMain.handle("queue:add", (e, task) => scheduler.add(task));
  ipcMain.handle("queue:remove", (e, id) => scheduler.remove(id));
  ipcMain.handle("queue:confirm", async (e, id) => {
    await scheduler.update(id, { confirmed: true, status: "pending", publishAt: Date.now() });
    return true;
  });
  ipcMain.handle("queue:runNow", async (e, id) => {
    const tasks = await scheduler.all();
    const t = tasks.find((x) => x.id === id);
    if (!t) throw new Error("任务不存在");
    await scheduler.update(id, { status: "pending", publishAt: Date.now(), confirmed: true });
    await scheduler.tick();
    return true;
  });

  ipcMain.handle("dialog:pickImage", async () => {
    const r = await dialog.showOpenDialog(win, { filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif"] }], properties: ["openFile"] });
    return r.canceled ? null : r.filePaths[0];
  });
}

// ---------- 窗口 / 托盘 ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 600,
    title: "稿匠", backgroundColor: "#eef0f3", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.on("close", (e) => {
    if (!isQuitting && tray) { e.preventDefault(); win.hide(); }
  });
}
function createTray() {
  try {
    const img = nativeImage.createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAU0lEQVR4nO3OMQEAAAgDoC251a3g4QcM8OSIuV8HWuABHvAAAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABjw8v3gHZHfWv9AAAAABJRU5ErkJggg=="
    );
    tray = new Tray(img);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "打开稿匠", click: () => { win.show(); win.focus(); } },
      { label: "退出（停止定时发布）", click: () => { isQuitting = true; app.quit(); } },
    ]));
    tray.setToolTip("稿匠 · 定时发布调度运行中");
  } catch (e) { console.error("tray failed", e); }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(async () => {
    await loadLibs();
    store = new lib.JsonStore(path.join(app.getPath("userData"), "data"));
    await fs.mkdir(path.join(store.dir, "assets"), { recursive: true });
    if (process.env.GJ_AI_KEY || process.env.GJ_APPID || process.env.GJ_APPSECRET) {
      const patch = {};
      if (process.env.GJ_AI_KEY) patch.aiKey = process.env.GJ_AI_KEY;
      if (process.env.GJ_APPID) patch.appId = process.env.GJ_APPID;
      if (process.env.GJ_APPSECRET) patch.appSecret = process.env.GJ_APPSECRET;
      await setSecrets(patch);
    }
    registerIpc();
    scheduler = new lib.Scheduler(store, runScheduled, (evt) => {
      if (evt.type === "publish-failed") notify("定时发布失败：" + (evt.task.title || ""), evt.error);
      win?.webContents.send("scheduler-event", evt);
    });
    scheduler.start(20_000);
    createWindow();
    createTray();
    app.on("before-quit", () => { isQuitting = true; });
  });
}
app.on("window-all-closed", () => { if (!tray) app.quit(); });
