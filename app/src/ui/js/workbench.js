/* 工作台增强：格式工具栏、布局切换、分栏拖拽、字数、富文本复制、快捷键、深链 */
"use strict";

// ---------- 字数统计 ----------
function updateWordCount(md) {
  md = md ?? $("#editor").value;
  const n = (md || "").replace(/\s/g, "").length;
  $("#wordCount").textContent = `${n} 字 · 约 ${Math.max(1, Math.round(n / 400))} 分钟`;
}

// ---------- 格式工具栏（对 textarea 选区做 Markdown 包装） ----------
function taApply(pre, post, { lineMode = false } = {}) {
  const ta = $("#editor");
  let s = ta.selectionStart, e = ta.selectionEnd;
  if (lineMode) {
    s = ta.value.lastIndexOf("\n", Math.max(0, s - 1)) + 1;
    e = ta.value.indexOf("\n", e); if (e < 0) e = ta.value.length;
    const seg = ta.value.slice(s, e).split("\n").map((l) => (l.startsWith(pre) ? l : pre + l)).join("\n");
    ta.value = ta.value.slice(0, s) + seg + ta.value.slice(e);
    ta.focus(); ta.setSelectionRange(s, s + seg.length);
  } else {
    const sel = ta.value.slice(s, e) || "文字";
    ta.value = ta.value.slice(0, s) + pre + sel + post + ta.value.slice(e);
    ta.focus(); ta.setSelectionRange(s + pre.length, s + pre.length + sel.length);
  }
  markDirty(); debounceRender(); updateScore();
}
const MD_ACTIONS = {
  bold: () => taApply("**", "**"),
  italic: () => taApply("*", "*"),
  h2: () => taApply("## ", "", { lineMode: true }),
  h3: () => taApply("### ", "", { lineMode: true }),
  quote: () => taApply("> ", "", { lineMode: true }),
  ul: () => taApply("- ", "", { lineMode: true }),
  code: () => taApply("`", "`"),
  link: () => taApply("[", "](https://)"),
  slot: () => {
    const ta = $("#editor");
    const s = ta.selectionStart;
    const line = "\n[图槽: 一句话说明这里要什么画面]\n";
    ta.value = ta.value.slice(0, s) + line + ta.value.slice(ta.selectionEnd);
    ta.focus(); ta.setSelectionRange(s + 5, s + 5 + 14);
    markDirty(); debounceRender(); updateScore();
  },
};
$$("[data-md]").forEach((b) => b.addEventListener("click", () => MD_ACTIONS[b.dataset.md]()));

// ---------- 布局切换（编辑 / 分栏 / 预览，参照 doocs） ----------
$$(".lay").forEach((b) => b.addEventListener("click", () => {
  $(".editorwrap").className = "editorwrap layout-" + b.dataset.layout;
  $$(".lay").forEach((x) => x.classList.toggle("on", x === b));
}));
$$(".lay").forEach((b) => b.classList.toggle("on", b.dataset.layout === "split"));

// ---------- 编辑/预览分隔条拖拽 ----------
(() => {
  const sp = $("#splitter"); if (!sp) return;
  let drag = false;
  sp.addEventListener("mousedown", (e) => { drag = true; sp.classList.add("drag"); document.body.style.userSelect = "none"; e.preventDefault(); });
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const wrap = $(".editorwrap"); const r = wrap.getBoundingClientRect();
    let w = e.clientX - r.left;
    w = Math.max(280, Math.min(w, r.width - 340));
    wrap.querySelector(".edcol").style.flex = `0 0 ${w}px`;
  });
  window.addEventListener("mouseup", () => { if (drag) { drag = false; sp.classList.remove("drag"); document.body.style.userSelect = ""; } });
})();

// ---------- 复制富文本（降级发布路径：直接粘贴进公众号后台） ----------
$("#btnCopyRich").addEventListener("click", async () => {
  const node = $("#preview .phoneish");
  if (!node || !node.textContent.trim()) return toast("先把「布局」切到含预览的档位，让右侧渲染出来再复制");
  // 经主进程写 HTML Format：不依赖窗口焦点，粘贴到公众号后台保留内联样式
  const err = await window.api.copyRich(node.innerHTML, node.innerText);
  toast(err ? err : "已复制排版好的富文本（正文图片已随带）→ 公众号后台编辑器 Ctrl+V。个别图若未显示：到配图页「复制此图」逐张补");
});

// ---------- 快捷键 ----------
document.addEventListener("keydown", (e) => {
  if (!e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "s") { e.preventDefault(); saveCur(); }
  else if (k === "n" && $('.tab[data-tab="write"]').classList.contains("on")) { e.preventDefault(); newArticle(); }
  else if (k === "b" && document.activeElement === $("#editor")) { e.preventDefault(); MD_ACTIONS.bold(); }
  else if (k === "i" && document.activeElement === $("#editor")) { e.preventDefault(); MD_ACTIONS.italic(); }
});

// ---------- 深链：file://…index.html#images 直达某页（自动化/截图验证用） ----------
{
  const h = (location.hash || "").slice(1);
  if (h === "demo-sugg") {
    // 界面 QA：注入一张示例建议卡片，检查视觉
    setTimeout(() => addSuggestion("去AI味", "首先，我们要认识到副业的重要性；其次，要建立现金流思维；最后，坚持长期主义。", "说白了就三步：翻数据看哪个需求是真的，挑一个周末能跑通的最小方案，跑完记账复盘。", null, 0, 0), 1500);
  } else if (["write", "images", "publish", "settings"].includes(h)) {
    setTimeout(() => $(`.tab[data-tab="${h}"]`)?.click(), 300);
  } else if (h === "demo-titles") {
    // 界面 QA：真实调用 AI 起标题并展开候选浮层
    setTimeout(() => $("#btnGenTitles")?.click(), 1200);
  } else if (h === "demo-aitest") {
    // 界面 QA：真实点击「测试 AI 连通」
    setTimeout(() => { $('.tab[data-tab="settings"]').click(); $("#btnAiTest").scrollIntoView({ block: "center" }); $("#btnAiTest").click(); }, 900);
  } else if (h.startsWith("demo-settings-end")) {
    // 界面 QA：滚动到设置页指定锚点（#demo-settings-end:<css选择器>，默认数据与备份卡片）
    setTimeout(() => {
      $('.tab[data-tab="settings"]').click();
      const sel = (h.split(":")[1] || "").trim();
      const el = (sel && $(sel)) || $("#btnClearAppSecret") || $("#btnOpenDataDir");
      el?.closest(".card")?.scrollIntoView({ block: "center" });
    }, 800);
  } else if (h === "demo-wxtest") {
    // 界面 QA：表单填入示例凭证（不落库）→ 真实点击「连通性自检」→ 微信服务器真实应答显形
    setTimeout(() => {
      $('.tab[data-tab="settings"]').click();
      $("#sAppId").value = "wxFACE00000000001";
      $("#sAppSecret").value = "selftest_wiring_probe";
      $("#btnSelfTest").scrollIntoView({ block: "center" });
      $("#btnSelfTest").click();
    }, 900);
  } else if (h === "demo-theme") {
    // 界面 QA：打开设置页样式编辑器并填入示例调色板
    setTimeout(() => {
      $('.tab[data-tab="settings"]').click();
      openThemeForm({ accent: "#7c3aed", heading: "#2e1065", body: "#1f2937", quote: "#6b7280", quoteBg: "#f5f3ff", border: "#e9d5ff", fontSize: 17, lineHeight: 1.8, letterSpacing: 0.5 }, null, false);
      $("#tfName").value = "深夜紫";
      $("#themeForm").scrollIntoView({ block: "center" });
    }, 800);
  } else if (h === "hot") {
    setTimeout(() => { $('.tab[data-tab="write"]').click(); $('.ptabs .pt[data-lp="hot"]').click(); }, 300);
  } else if (h === "demo-copyrich") {
    // 界面 QA：真实点击「复制富文本」→ 外部脚本回读 Windows 剪贴板 HTML 验证降级产物
    setTimeout(() => { $('.tab[data-tab="write"]').click(); $("#btnCopyRich").click(); }, 3500);
  } else if (h === "demo-apigate") {
    // 界面 QA：未配凭证时真实点「存草稿」→ apiGate 应短路显形指路（不发注定失败的请求）
    setTimeout(() => {
      $('.tab[data-tab="publish"]').click();
      setTimeout(() => $("#btnToDraft")?.click(), 2500);
    }, 600);
  } else if (h === "demo-copyimg") {
    // 界面 QA：配图页真实点「复制此图」→ 外部脚本回读剪贴板位图，验证逐张补图兜底通道
    setTimeout(() => {
      $('.tab[data-tab="images"]').click();
      const b = document.querySelector("#slotList .copyi");
      if (b) b.click(); else toast("QA 失败：配图页没有可复制的素材图");
    }, 4000);
  } else if (h.startsWith("demo-wiz")) {
    // 界面 QA：打开成稿向导；--gj-tab=demo-wiz-run-N 真实执行第 N 步（需 GJ_AI_KEY + 长 GJ_SHOT_WAIT）
    setTimeout(() => {
      $('.tab[data-tab="write"]').click();
      if (!$("#fTitle").value.trim()) $("#fTitle").value = "下班后的两小时，决定了你三年后的收入";
      wizOpen();
      const n = +((h.match(/^demo-wiz-run-(\d)$/) || [])[1] || 0);
      if (n) {
        wizData[0] = "选题：" + $("#fTitle").value.trim();
        // 回炉/审核需要初稿打底：用当前打开文章的真实正文做前置产物
        if (n >= 5 && ($("#editor").value || "").length > 200) wizData[3] = $("#editor").value;
        wizStep = n - 1; wizRender(); $("#wizRun").click();
      }
    }, 900);
  }
}
