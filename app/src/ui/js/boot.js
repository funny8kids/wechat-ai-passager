/* 应用启动：加载设置 → 加载文章 → 打开最近一篇 */
"use strict";

(async () => {
  try {
    await loadSettings();
    await loadArticles();
    if (articles.length) openArticle(articles[0]); else newArticle();
  } catch (e) { showFatal("启动失败：" + (e?.message || e)); }
  setInterval(() => { if ($('.tab[data-tab="publish"]').classList.contains("on")) refreshQueue(); }, 30_000);
})();
