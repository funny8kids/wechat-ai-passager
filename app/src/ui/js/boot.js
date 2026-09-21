/* 应用启动：加载设置 → 加载文章 → 恢复未保存暂存（崩溃保护）→ 打开最近一篇 */
"use strict";

(async () => {
  try {
    await loadSettings();
    await loadArticles();
    if (articles.length) openArticle(articles[0]); else newArticle();
    await restoreAutosave();
  } catch (e) { showFatal("启动失败：" + (e?.message || e)); }
  setInterval(() => { if ($('.tab[data-tab="publish"]').classList.contains("on")) refreshQueue(); }, 30_000);
})();

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
