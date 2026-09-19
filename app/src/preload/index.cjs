const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // 设置与密钥
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  getSecrets: () => ipcRenderer.invoke("secrets:get"),
  setSecrets: (patch) => ipcRenderer.invoke("secrets:set", patch),
  // 文章
  listArticles: () => ipcRenderer.invoke("articles:list"),
  saveArticle: (a) => ipcRenderer.invoke("articles:save", a),
  deleteArticle: (id) => ipcRenderer.invoke("articles:delete", id),
  // 素材库
  getMaterials: () => ipcRenderer.invoke("materials:get"),
  setMaterials: (list) => ipcRenderer.invoke("materials:set", list),
  // AI
  aiRewrite: (task, selText, customNote) => ipcRenderer.invoke("ai:rewrite", { task, selText, customNote }),
  aiChat: (messages) => ipcRenderer.invoke("ai:chat", { messages }),
  aiDraft: (prompt) => ipcRenderer.invoke("ai:draft", { prompt }),
  aiJson: (system, user) => ipcRenderer.invoke("ai:json", { system, user }),
  aiTitles: (topic, excerpt) => ipcRenderer.invoke("ai:titles", { topic, excerpt }),
  aiTest: (cfg) => ipcRenderer.invoke("ai:test", cfg),
  aiAgent: (agent, user) => ipcRenderer.invoke("ai:agent", { agent, user }),
  // 热榜
  hotFetch: (source, force) => ipcRenderer.invoke("hot:fetch", { source, force }),
  // 渲染与素材
  render: (md, theme) => ipcRenderer.invoke("preview:render", { md, theme }),
  themesList: () => ipcRenderer.invoke("themes:list"),
  themeSave: (theme) => ipcRenderer.invoke("themes:save", theme),
  themeDelete: (name) => ipcRenderer.invoke("themes:delete", name),
  pickImage: () => ipcRenderer.invoke("dialog:pickImage"),
  importAsset: (srcPath) => ipcRenderer.invoke("assets:import", srcPath),
  assetDataUrl: (name) => ipcRenderer.invoke("asset:dataUrl", name),
  // 微信
  wxSelfTest: () => ipcRenderer.invoke("wx:selftest"),
  wxSaveDraft: (article) => ipcRenderer.invoke("wx:saveDraft", article),
  wxPublish: (article) => ipcRenderer.invoke("wx:publish", article),
  detectIp: () => ipcRenderer.invoke("ip:detect"),
  // 队列
  queueList: () => ipcRenderer.invoke("queue:list"),
  queueAdd: (task) => ipcRenderer.invoke("queue:add", task),
  queueRemove: (id) => ipcRenderer.invoke("queue:remove", id),
  queueConfirm: (id) => ipcRenderer.invoke("queue:confirm", id),
  queueRunNow: (id) => ipcRenderer.invoke("queue:runNow", id),
  onSchedulerEvent: (cb) => ipcRenderer.on("scheduler-event", (e, evt) => cb(evt)),
});
