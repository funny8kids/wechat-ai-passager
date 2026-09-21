// IPC 注册：渲染进程的每一个调用都经 preload 白名单进入这里，本层只做参数转发与结果包装
// 依赖注入：services（设置/密钥/客户端）、pipeline（发布）、scheduler 与窗口由 index.cjs 提供
const path = require("path");
const fs = require("fs/promises");

const HOT_BASE = "https://60s-api.viki.moe/v2"; // 开源聚合热榜（vikiboss/60s）
const HOT_PLATFORMS = ["weibo", "zhihu", "toutiao", "douyin"];
const HOT_TTL_MS = 5 * 60 * 1000;

function registerIpc({ ipcMain, dialog, shell, lib, services, pipeline, getScheduled, getWindow }) {
  const { store, getSettings, setSettings, getSecrets, setSecrets, aiClient, wxClient, listThemes, saveTheme, deleteTheme, renderHtml } = services;

  // ---------- 设置与密钥 ----------
  ipcMain.handle("settings:get", getSettings);
  ipcMain.handle("settings:set", (e, patch) => setSettings(patch));
  ipcMain.handle("secrets:get", async () => {
    const s = await getSecrets();
    return { appId: s.appId, appSecretSet: !!s.appSecret, aiKeySet: !!s.aiKey };
  });
  ipcMain.handle("secrets:set", (e, patch) => setSecrets(patch));

  // ---------- 文章库 ----------
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

  // ---------- 渲染与 AI ----------
  // 预览也要能显示本地素材：把 md 里的 assets 名映射为 dataURL（带缓存，发布时才转 CDN）
  const _duCache = new Map();
  async function readAssetDataUrl(name) {
    const base = path.basename(String(name || "")); // 防目录穿越：只认 assets 下文件名
    const cacheKey = base;
    if (_duCache.has(cacheKey)) return _duCache.get(cacheKey);
    const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" }[base.split(".").pop()?.toLowerCase()];
    if (!mime) return null;
    try {
      const buf = await fs.readFile(path.join(store.dir, "assets", base));
      if (buf.length > 12_000_000) return null;
      const url = `data:${mime};base64,${buf.toString("base64")}`;
      _duCache.set(cacheKey, url);
      return url;
    } catch { return null; }
  }
  async function localImgMap(md) {
    const map = {};
    const names = [...md.matchAll(/!\[[^\]]*\]\(\s*([^)\s]+)[^)]*\)/g)].map((m) => m[1]).filter((s) => !/^https?:/i.test(s));
    for (const n of new Set(names)) {
      const u = await readAssetDataUrl(n);
      if (u) map[n] = u;
    }
    return map;
  }
  ipcMain.handle("preview:render", async (e, { md, theme }) => renderHtml(md || "", theme || "青竹绿", { imgMap: await localImgMap(md || "") }));
  ipcMain.handle("themes:list", () => listThemes());
  ipcMain.handle("themes:save", (e, theme) => saveTheme(theme));
  ipcMain.handle("themes:delete", (e, name) => deleteTheme(name));
  ipcMain.handle("ai:rewrite", async (e, { task, selText, customNote }) => {
    const client = await aiClient("改写");
    return { text: await client.chat(lib.buildRewriteMessages(task, selText, customNote)) };
  });
  ipcMain.handle("ai:chat", async (e, { messages }) => {
    const client = await aiClient();
    return { text: await client.chat(messages) };
  });
  ipcMain.handle("ai:json", async (e, { system, user }) => {
    const client = await aiClient("配图");
    const text = await client.chat([{ role: "system", content: system + "\n只输出合法 JSON。" }, { role: "user", content: user }], { json: true });
    try { return { json: JSON.parse(text) }; }
    catch { return { json: null, raw: text }; }
  });
  ipcMain.handle("ai:draft", async (e, { prompt }) => {
    const client = await aiClient("初稿");
    return { text: await client.chat([{ role: "system", content: lib.AI_TASKS.生成初稿 }, { role: "user", content: prompt }]) };
  });
  ipcMain.handle("ai:titles", async (e, { topic, excerpt } = {}) => {
    const client = await aiClient("标题");
    const m = lib.buildTitleMessages({ topic, excerpt });
    const text = await client.chat([{ role: "system", content: m.system }, { role: "user", content: m.user }], { json: true });
    try {
      const j = JSON.parse(text);
      const titles = (Array.isArray(j.titles) ? j.titles : [])
        .map((x) => ({ t: String(x.t || "").trim(), s: String(x.s || "").trim() }))
        .filter((x) => x.t);
      return titles.length ? { titles } : { titles: [], raw: text };
    } catch {
      // 模型没给合法 JSON：按行拆纯文本兜底
      const titles = text.split("\n").map((l) => l.replace(/^[-\d.、"\s]+/, "").replace(/["，,].*$/, "").trim()).filter((l) => l && l.length <= 40).slice(0, 7).map((t) => ({ t, s: "" }));
      return titles.length ? { titles } : { titles: [], raw: text };
    }
  });

  // ---------- 成稿向导：按 Agent 名跑一步（温度/模型走各 Agent 的设置） ----------
  ipcMain.handle("ai:agent", async (e, { agent, user } = {}) => {
    const task = lib.AI_TASKS[agent];
    if (!task) return { error: `未知 Agent：${agent}` };
    const client = await aiClient({ 调研: "调研", 大纲: "初稿", 审核: "审核" }[agent] || "改写");
    return { text: await client.chat([{ role: "system", content: task }, { role: "user", content: String(user || "") }]) };
  });

  // ---------- AI 连通测试（用当前表单值即可测，不必先保存） ----------
  ipcMain.handle("ai:test", async (e, { baseUrl, model, apiKey } = {}) => {
    const t0 = Date.now();
    try {
      const s = await getSettings();
      const sec = await getSecrets();
      const client = new lib.AIClient({
        baseUrl: baseUrl || s.baseUrl,
        apiKey: apiKey || sec.aiKey,
        model: model || s.model,
        temperature: 0.1,
      });
      const reply = await client.chat([{ role: "user", content: "请只回复两个字：正常" }]);
      return { ok: true, ms: Date.now() - t0, reply: String(reply).trim().slice(0, 40) };
    } catch (err) {
      return { ok: false, ms: Date.now() - t0, error: err.message };
    }
  });

  // ---------- 热榜（选题参考；主进程代拉，避免渲染进程 CORS） ----------
  ipcMain.handle("hot:fetch", async (e, { source, force } = {}) => {
    const key = String(source || "weibo").toLowerCase();
    if (!HOT_PLATFORMS.includes(key)) return { error: `不支持的热榜来源: ${key}` };
    const cacheKey = `hot-${key}`; // 注意：store 键即文件名，不能用冒号
    const cached = await store.load(cacheKey, null);
    if (!force && cached && Date.now() - cached.ts < HOT_TTL_MS) return { items: cached.items, ts: cached.ts, cached: true };
    try {
      const res = await fetch(`${HOT_BASE}/${key}`, { signal: AbortSignal.timeout(10_000) });
      const j = await res.json();
      if (j.code !== 200 || !Array.isArray(j.data)) return { error: `热榜接口返回异常 (code=${j.code})` };
      const items = j.data.slice(0, 30).map((x, i) => ({
        rank: i + 1,
        title: String(x.title || "").trim(),
        hot: Number.isFinite(x.hot_value) ? x.hot_value : null,
      })).filter((x) => x.title);
      await store.save(cacheKey, { ts: Date.now(), items });
      return { items, ts: Date.now() };
    } catch (err) {
      if (cached) return { items: cached.items, ts: cached.ts, cached: true, stale: true };
      return { error: `拉取失败：${err.message}` };
    }
  });

  // ---------- 素材与图片资产 ----------
  ipcMain.handle("materials:get", () => store.load("materials", []));
  ipcMain.handle("materials:set", async (e, list) => { await store.save("materials", list); return true; });
  ipcMain.handle("assets:import", async (e, srcPath) => {
    const name = Date.now().toString(36) + path.extname(srcPath || "").toLowerCase();
    await fs.copyFile(srcPath, path.join(store.dir, "assets", name));
    return name; // 相对 assets 目录的文件名，md 中写 ![](assets名)
  });
  ipcMain.handle("asset:dataUrl", (e, name) => readAssetDataUrl(name));

  // ---------- 崩溃保护：编辑中内容实时暂存，重启可恢复未保存修改 ----------
  ipcMain.handle("autosave:set", (e, data) => (data ? store.save("autosave", { ...data, ts: Date.now() }) : store.save("autosave", null)));
  ipcMain.handle("autosave:get", () => store.load("autosave", null));

  // ---------- 微信 ----------
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
  ipcMain.handle("wx:saveDraft", (e, article) => pipeline.saveDraft(article));
  ipcMain.handle("wx:publish", async (e, article) => {
    const r = await pipeline.publishArticle(article);
    // 立即发布也入队留痕（status 直接 done），让终态轮询器统一回写"审核中→成功/失败"
    const sch = getScheduled();
    if (sch) {
      await sch.add({ articleId: article.id, title: article.title, mode: "publish", publishAt: Date.now(), createdAt: Date.now(), status: "done", finishedAt: Date.now(), draftMediaId: r.draftMediaId, publishId: r.publishId });
    }
    return r;
  });
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

  // ---------- 定时队列 ----------
  ipcMain.handle("queue:list", () => getScheduled().all());
  ipcMain.handle("queue:add", (e, task) => getScheduled().add(task));
  ipcMain.handle("queue:remove", (e, id) => getScheduled().remove(id));
  ipcMain.handle("queue:confirm", async (e, id) => {
    await getScheduled().update(id, { confirmed: true, status: "pending", publishAt: Date.now() });
    return true;
  });
  ipcMain.handle("queue:runNow", async (e, id) => {
    const scheduler = getScheduled();
    const tasks = await scheduler.all();
    const t = tasks.find((x) => x.id === id);
    if (!t) throw new Error("任务不存在");
    await scheduler.update(id, { status: "pending", publishAt: Date.now(), confirmed: true });
    await scheduler.runOne(id); // 只跑这一个任务，不顺带执行其它到期任务
    return true;
  });

  // ---------- 系统对话框 ----------
  ipcMain.handle("app:openDataDir", () => shell.openPath(store.dir));
  ipcMain.handle("dialog:pickImage", async () => {
    const r = await dialog.showOpenDialog(getWindow(), { filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif"] }], properties: ["openFile"] });
    return r.canceled ? null : r.filePaths[0];
  });
}

module.exports = { registerIpc };
