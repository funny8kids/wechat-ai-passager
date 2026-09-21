/* 应用启动：加载设置 → 加载文章 → 恢复未保存暂存（崩溃保护）→ 打开最近一篇 */
"use strict";

(async () => {
  try {
    await loadSettings();
    await loadArticles();
    if (!articles.length && !settings.sampleSeeded) await seedSample();
    if (articles.length) openArticle(articles[0]); else newArticle();
    await restoreAutosave();
    firstRunGuide();
  } catch (e) { showFatal("启动失败：" + (e?.message || e)); }
  setInterval(() => { if ($('.tab[data-tab="publish"]').classList.contains("on")) refreshQueue(); }, 30_000);
})();

// ---------- 首启样例：一台空机器上，写作页不该是一片空白 ----------
const SAMPLE_MD = `## 3 分钟看懂稿匠

这是一篇**示例文章**：写作页能演示的元素都装在这里，改它或删它都行。

> 引用块长这样。写得像说话，读者才肯听完。

### 排版元素

- **加粗**、*斜体*、\`行内代码\`、==高亮==、~~删除线~~，全按右上「样式」下拉的配色渲染
- 换几套内置样式试试（青竹绿 / 杂志灰 / 暖橙手账 / 静墨蓝 / 宣纸古雅 / 桃夭文艺 / 深海科技 / 暮山紫）；不顺手就到设置页「复制并修改」做一份自己的
- 链接自动变角注（微信正文外链不可点）：[举个例子](https://github.com)
- Markdown 表格直接渲染，「复制富文本」照样带走：

| 元素 | 写法 |
|:-----|:----:|
| 加粗 | \`**文字**\` |
| 高亮 | \`==文字==\` |

### 待办清单

- [x] 读完这篇示例
- [ ] 点「新建」开始你自己的文章

### 配图与 AI

[图槽:本文头图，深夜书桌、凉掉的咖啡]

配图页可给图槽「AI 出图」或选本地图；写作页选中段落可让 AI 只改这一段——所有 AI 结果都要你点「采用」才落稿。

### 发出去

不配任何微信 API 也能发：写完点「复制富文本」，去公众号后台 Ctrl+V，排版原样带过去。配了凭证才有草稿箱/定时发布。

改完这篇，点「新建」开始你自己的文章。
`;
async function seedSample() {
  const a = { id: "sample-" + Date.now().toString(36), title: "示例：3 分钟看懂稿匠（可删）", md: SAMPLE_MD, theme: settings.theme || "青竹绿", updatedAt: Date.now(), coverPath: "" };
  try {
    await window.api.saveArticle(a);
    settings = await window.api.setSettings({ sampleSeeded: true });
    await loadArticles();
    toast("已放了一篇示例文章，把排版/配图/AI 元素都演示了一遍——改它或删它都行");
  } catch { /* 种不进示例就算了，不影响正常首启 */ }
}

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
