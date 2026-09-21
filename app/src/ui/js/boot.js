/* 应用启动：加载设置 → 加载文章 → 恢复未保存暂存（崩溃保护）→ 打开最近一篇 */
"use strict";

(async () => {
  try {
    await loadSettings();
    await loadArticles();
    if (articles.length) openArticle(articles[0]); else newArticle();
    await restoreAutosave();
    firstRunGuide();
  } catch (e) { showFatal("启动失败：" + (e?.message || e)); }
  setInterval(() => { if ($('.tab[data-tab="publish"]').classList.contains("on")) refreshQueue(); }, 30_000);
})();

// ---------- 首启引导：缺什么配置就指哪条路（AI Key 必配；微信凭证可选，不配走复制富文本） ----------
async function firstRunGuide() {
  let sec = {};
  try { sec = await window.api.getSecrets(); } catch { return; }
  const goSettings = () => $('.tab[data-tab="settings"]').click();
  if (!sec.aiKeySet) {
    toast("欢迎用稿匠。第一步：到「设置 → AI 服务」选服务商、填入 API Key（只加密存本机）", "去设置", goSettings);
  } else if (!sec.appId || !sec.appSecretSet) {
    toast("AI 已就绪，可以直接写作。想一键发草稿/定时发布？到「设置 → 微信公众号」填 AppID/AppSecret 并点自检；不配置也能用写作页「复制富文本」粘贴发布", "去设置", goSettings);
  }
}

async function restoreAutosave() {
  let as = null;
  try { as = await window.api.autosaveGet(); } catch { return; }
  if (!as || !(as.md || "").trim()) return;
  const saved = articles.find((a) => a.id === as.id);
  const dirty = !saved || saved.md !== as.md || (saved.title || "") !== (as.title || "");
  if (!dirty) return;
  if (saved) openArticle(saved); else newArticle();
  $("#fTitle").value = as.title || "";
  $("#editor").value = as.md;
  if (as.theme) $("#fTheme").value = as.theme;
  markDirty(); renderPreview(); renderBlocks(); updateScore();
  toast("检测到上次未保存的修改，已恢复到编辑器（点保存落库）", "丢弃恢复", async () => {
    await window.api.autosaveSet(null);
    if (saved) openArticle(saved); else newArticle();
  });
}
