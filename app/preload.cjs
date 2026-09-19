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
  // 渲染与素材
  render: (md, theme) => ipcRenderer.invoke("preview:render", { md, theme }),
  pickImage: () => ipcRenderer.invoke("dialog:pickImage"),
  importAsset: (srcPath) => ipcRenderer.invoke("assets:import", srcPath),
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
