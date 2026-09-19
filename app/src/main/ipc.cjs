// IPC 注册：渲染进程的每一个调用都经 preload 白名单进入这里，本层只做参数转发与结果包装
// 依赖注入：services（设置/密钥/客户端）、pipeline（发布）、scheduler 与窗口由 index.cjs 提供
const path = require("path");
const fs = require("fs/promises");

function registerIpc({ ipcMain, dialog, lib, services, pipeline, getScheduled, getWindow }) {
  const { store, getSettings, setSettings, getSecrets, setSecrets, aiClient, wxClient } = services;

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
  ipcMain.handle("ai:draft", async (e, { prompt }) => {
    const client = await aiClient();
    return { text: await client.chat([{ role: "system", content: lib.AI_TASKS.生成初稿 }, { role: "user", content: prompt }], { temperature: 0.8 }) };
  });

  // ---------- 素材与图片资产 ----------
  ipcMain.handle("materials:get", () => store.load("materials", []));
  ipcMain.handle("materials:set", async (e, list) => { await store.save("materials", list); return true; });
  ipcMain.handle("assets:import", async (e, srcPath) => {
    const name = Date.now().toString(36) + path.extname(srcPath || "").toLowerCase();
    await fs.copyFile(srcPath, path.join(store.dir, "assets", name));
    return name; // 相对 assets 目录的文件名，md 中写 ![](assets名)
  });

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
  ipcMain.handle("wx:publish", (e, article) => pipeline.publishArticle(article));
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
    await scheduler.tick();
    return true;
  });

  // ---------- 系统对话框 ----------
  ipcMain.handle("dialog:pickImage", async () => {
    const r = await dialog.showOpenDialog(getWindow(), { filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif"] }], properties: ["openFile"] });
    return r.canceled ? null : r.filePaths[0];
  });
}

module.exports = { registerIpc };
