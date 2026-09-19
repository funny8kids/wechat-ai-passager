/* 写作页：文章库、编辑器、预览、段落回炉、选区改写（HITL 核心）、AI味评分、审核 */
"use strict";

// ---------- 全局状态 ----------
let articles = [], cur = null;
let snapshots = []; // 内存快照栈（撤销用）
let settings = null;

// ---------- Tab 切换 ----------
$$(".tab").forEach((b) => b.addEventListener("click", () => {
  $$(".tab").forEach((x) => x.classList.toggle("on", x === b));
  $$(".view").forEach((v) => v.classList.toggle("on", v.id === "view-" + b.dataset.tab));
  if (b.dataset.tab === "images") renderSlots();
  if (b.dataset.tab === "publish") refreshQueue();
}));
$$(".rtabs button").forEach((b) => b.addEventListener("click", () => {
  $$(".rtabs button").forEach((x) => x.classList.toggle("on", x === b));
  $$(".rbody").forEach((v) => v.classList.toggle("on", v.id === "rt-" + b.dataset.rt));
}));

// ---------- 文章库 ----------
async function loadArticles() {
  articles = await window.api.listArticles();
  renderArticleListOnly();
}
function newArticle() {
  cur = { id: Date.now().toString(36), title: "", md: "", theme: settings?.theme || "青竹绿", updatedAt: Date.now(), coverPath: "" };
  $("#fTitle").value = ""; $("#editor").value = ""; $("#fTheme").value = cur.theme;
  snapshots = []; renderArticleListOnly(); renderPreview(); renderBlocks(); updateScore();
}
function openArticle(a) {
  cur = JSON.parse(JSON.stringify(a));
  $("#fTitle").value = cur.title; $("#editor").value = cur.md; $("#fTheme").value = cur.theme || "青竹绿";
  snapshots = [];
  renderArticleListOnly(); renderPreview(); renderBlocks(); updateScore();
}
function renderArticleListOnly() {
  const ul = $("#articleList"); ul.innerHTML = "";
  const q = ($("#articleSearch").value || "").trim().toLowerCase();
  for (const a of articles) {
    if (q && !((a.title || "").toLowerCase().includes(q) || (a.md || "").toLowerCase().includes(q))) continue;
    const liEl = document.createElement("li");
    liEl.className = cur && a.id === cur.id ? "on" : "";
    liEl.innerHTML = `<div class="t">${esc(a.title || "无题")}</div><div class="d">${fmtTime(a.updatedAt)} · ${(a.md || "").length} 字</div>
      <button class="del" title="删除文章"><svg class="ic"><use href="#i-trash"/></svg></button>`;
    liEl.onclick = () => openArticle(a);
    liEl.querySelector(".del").onclick = async (ev) => {
      ev.stopPropagation();
      if (!confirm(`删除《${a.title || "无题"}》？此操作不可恢复`)) return;
      await window.api.deleteArticle(a.id);
      await loadArticles();
      if (cur && cur.id === a.id) newArticle();
    };
    ul.appendChild(liEl);
  }
}
$("#articleSearch").addEventListener("input", renderArticleListOnly);
async function saveCur(silent) {
  if (!cur) { toast("请先新建或选择文章"); return; }
  cur.title = $("#fTitle").value.trim(); cur.md = $("#editor").value; cur.theme = $("#fTheme").value;
  await window.api.saveArticle(cur);
  const st = $("#saveState"); st.textContent = "已保存 " + new Date().toLocaleTimeString("zh-CN"); st.classList.remove("dirty");
  await loadArticles();
  if (!silent) toast("已保存到本地库");
}
function pushSnapshot() {
  snapshots.push($("#editor").value);
  if (snapshots.length > 50) snapshots.shift();
}
function undoSnapshot() {
  if (!snapshots.length) return toast("没有可撤销的步骤");
  $("#editor").value = snapshots.pop();
  renderPreview(); renderBlocks(); updateScore(); markDirty();
}
function markDirty() { const el = $("#saveState"); el.textContent = "未保存"; el.classList.add("dirty"); }

$("#btnNew").onclick = newArticle;
$("#btnSave").onclick = () => saveCur();
$("#editor").addEventListener("input", () => { markDirty(); debounceRender(); updateScore(); });
$("#fTitle").addEventListener("input", markDirty);
$("#fTheme").addEventListener("change", () => { markDirty(); renderPreview(); });

// ---------- 预览 ----------
let _rh;
function debounceRender() { clearTimeout(_rh); _rh = setTimeout(renderPreview, 350); }
async function renderPreview() {
  const md = $("#editor").value;
  if (!md.trim()) {
    $("#preview").innerHTML = `<div class="phoneish"><div class="pv-empty"><b>公众号排版预览</b><span>开始写作后，这里实时呈现所选主题的成稿效果</span></div></div>`;
    return;
  }
  const html = await window.api.render(md, $("#fTheme").value || "青竹绿");
  $("#preview").innerHTML = `<div class="phoneish">${html}</div>`;
}

// ---------- 段落块 / 回炉 ----------
function mdBlocks() { return $("#editor").value.split(/\n{2,}/); }
function renderBlocks() {
  const box = $("#blockList"); box.innerHTML = "";
  mdBlocks().forEach((b, i) => {
    if (!b.trim()) return;
    const kind = /^#{1,4}\s/.test(b) ? "标题" : /^>/.test(b) ? "引用" : /^!?\[/.test(b) ? "图片" : "段落";
    const div = document.createElement("div");
    div.className = "blk";
    div.innerHTML = `<input type="checkbox" data-i="${i}" aria-label="标记回炉"><span class="kind">${kind}</span><span class="tx">${esc(b.slice(0, 80))}</span>`;
    div.querySelector("input").addEventListener("change", (e) => { div.classList.toggle("flag", e.target.checked); });
    div.addEventListener("click", (e) => { if (e.target.tagName !== "INPUT") { const p = e.target.closest(".blk").querySelector("input"); p.checked = !p.checked; p.dispatchEvent(new Event("change")); } });
    box.appendChild(div);
  });
}
$("#btnFlagged").addEventListener("click", async () => {
  const idxs = $$("#blockList input:checked").map((x) => +x.dataset.i);
  if (!idxs.length) return toast("先勾选要回炉的段落（AI 不碰你没标记的文字）");
  toast("回炉 Agent 正在逐段生成建议…");
  for (const i of idxs) {
    const text = mdBlocks()[i];
    try {
      const { text: neu } = await window.api.aiRewrite("去AI味", text, "");
      addSuggestion(`回炉·第${i + 1}段`, text, neu, i);
    } catch (e) { toast("AI 失败：" + e.message); }
  }
});

// ---------- 选区 AI 改写（核心 HITL：AI 只出建议，应用与否由人决定） ----------
$$("[data-task]").forEach((b) => b.addEventListener("click", () => runSelRewrite(b.dataset.task, "")));
$("#btnCustom").addEventListener("click", () => {
  const note = $("#customNote").value.trim();
  if (!note) return toast("先输入你的改写要求——人给意图，AI 给结果");
  runSelRewrite("按要求改写", note);
});
async function runSelRewrite(task, note) {
  const ta = $("#editor");
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  if (sel.trim().length < 2) return toast("先在正文里选中一段文字，AI 只改你圈定的范围");
  toast("AI 正在改写选区…");
  try {
    const { text: neu } = await window.api.aiRewrite(task, sel, note);
    addSuggestion(task, sel, neu, null, ta.selectionStart, ta.selectionEnd);
  } catch (e) { toast("AI 失败：" + e.message); }
}

function addSuggestion(name, oldT, newT, blockIdx, selStart, selEnd) {
  const card = document.createElement("div");
  card.className = "sugg";
  card.innerHTML = `<div class="sh">${esc(name)}<span class="target">${esc(oldT.slice(0, 12))}…</span></div>
    <div class="diff"><span class="old">${esc(oldT.slice(0, 400))}</span><br><span class="new">${esc(newT.slice(0, 400))}</span></div>
    <div class="acts"><button class="btn sm primary ap">应用</button><button class="btn sm ig">忽略</button><span class="res"></span></div>`;
  $("#suggList").prepend(card);
  card.querySelector(".ap").onclick = () => {
    pushSnapshot();
    const ta = $("#editor");
    if (blockIdx != null) {
      const bs = mdBlocks(); bs[blockIdx] = newT; ta.value = bs.join("\n\n");
    } else {
      ta.value = ta.value.slice(0, selStart) + newT + ta.value.slice(selEnd);
    }
    card.classList.add("applied"); card.querySelector(".res").textContent = "已应用";
    card.querySelector(".ap").disabled = true;
    renderPreview(); renderBlocks(); updateScore(); markDirty();
    toast("已应用（仅该段，其余未动）", "撤销", undoSnapshot);
  };
  card.querySelector(".ig").onclick = () => { card.classList.add("dismissed"); card.querySelector(".res").textContent = "已忽略"; };
}

// ---------- AI 味评分（规则版，与 scripts/verify-article.mjs 保持同一算法） ----------
const CLICHES = ["总而言之", "综上所述", "值得注意的是", "不难发现", "赋能", "闭环", "抓手", "无独有偶", "在这个快节奏的时代", "在这个信息爆炸", "首先", "其次", "最后", "不仅", "而且", "与此同时", "更重要的是", "可以说"];
function updateScore() {
  const md = $("#editor").value;
  updateWordCount(md);
  if (md.length < 40) { $("#aiScore").textContent = "AI味 --"; $("#scoreBig").textContent = "--"; $("#scoreDetail").innerHTML = ""; return; }
  const hits = CLICHES.filter((c) => md.includes(c));
  const sentences = md.split(/[。！？!?；\n]/).map((s) => s.trim()).filter((s) => s.length > 3);
  const lens = sentences.map((s) => s.length);
  const mean = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / (lens.length || 1));
  const evenness = mean > 0 ? Math.max(0, 1 - sd / mean) : 0; // 句长越均匀越像AI
  const enumHits = (md.match(/(第一[，,]|第二[，,]|第三[，,])/g) || []).length;
  let score = Math.min(100, Math.round(hits.length * 8 + evenness * 45 + enumHits * 6));
  const el = $("#aiScore"); el.textContent = `AI味 ${score}`;
  el.className = "chip " + (score > 55 ? "bad" : score > 30 ? "" : "ok");
  const ringColor = score > 55 ? "var(--err)" : score > 30 ? "var(--warn)" : "var(--accent)";
  $("#scoreBig").textContent = score; $("#scoreBig").style.color = ringColor;
  $(".sc-ring").style.borderColor = ringColor;
  $("#scoreDetail").innerHTML =
    li(hits.length ? "warn" : "ok", `套话/列举腔命中 ${hits.length} 个${hits.length ? "：" + hits.slice(0, 6).join("、") : ""}`) +
    li(evenness > 0.6 ? "warn" : "ok", `句长均匀度 ${(evenness * 100) | 0}%（越高越像 AI 的匀速句）`) +
    li("none", "参考去味清单：拆排比、删套话、句长参差、注入个人经历（设置→素材库）");
}

// ---------- 审核 Agent（规则版） ----------
$("#btnAudit").addEventListener("click", async () => {
  const md = $("#editor").value;
  const out = [];
  const extImgs = [...md.matchAll(/!\[[^\]]*\]\((https?:[^)\s]+)/g)].filter((m) => !/mmbiz|qpic|weixin/.test(m[1]));
  out.push(li(extImgs.length ? "bad" : "ok", extImgs.length ? `发现 ${extImgs.length} 张外链图片，微信会过滤——请到配图页换本地图/生图` : "正文图片均为本地素材（发布时自动转存微信CDN）"));
  const links = [...md.matchAll(/(?<!\!)\[[^\]]+\]\((https?:[^)\s]+)\)/g)];
  out.push(li(links.length ? "warn" : "ok", links.length ? `${links.length} 个正文外链（微信仅可点自家链接，将自动转为文末角注）` : "无受限外链"));
  const hasLocal = /!\[[^\]]*\]\((?!https?:)[^)\s]+\)/.test(md) || cur?.coverPath;
  out.push(li(hasLocal ? "ok" : "bad", hasLocal ? "封面可用（首张本地图将自动作为封面素材）" : "缺封面：正文至少放一张本地图，或指定封面"));
  const slots = [...md.matchAll(/\[图槽:[^\]]+\]/g)];
  out.push(li(slots.length ? "warn" : "ok", slots.length ? `还有 ${slots.length} 个配图槽位未落图` : "无未落实的配图槽位"));
  const title = $("#fTitle").value.trim();
  out.push(li(title && title.length <= 64 ? "ok" : "bad", title ? `标题 ${title.length} 字（上限64）` : "缺标题"));
  out.push(li("ok", `摘要将由正文前100字自动生成`));
  const risky = ["扫码", "加微", "免费领取", "转发抽奖"].filter((w) => md.includes(w));
  out.push(li(risky.length ? "warn" : "ok", risky.length ? `含营销敏感词：${risky.join("、")}（可能触发平台审核）` : "无常见营销敏感词"));
  $("#auditList").innerHTML = out.join("");
  toast("审核 Agent 完成（规则检查；LLM 事实核查在流水线版提供）");
});

// ---------- AI 初稿 ----------
$("#btnGenDraft").addEventListener("click", async () => {
  const title = $("#fTitle").value.trim();
  if (!title) return toast("先填标题/选题，AI 按它生成初稿");
  const b = $("#btnGenDraft"); b.disabled = true; b.textContent = "生成中…";
  try {
    const mats = await window.api.getMaterials();
    const matHint = mats.length ? `\n可自然融入的作者真实素材（选1-2条，勿堆砌）：\n${mats.slice(0, 8).map((m) => `- [${m.type}] ${m.text}`).join("\n")}` : "";
    const { text } = await window.api.aiDraft(`选题：${title}${matHint}`);
    const ta = $("#editor");
    pushSnapshot();
    if (ta.value.trim() && !confirm("正文已有内容：确定【追加】AI 初稿到文末？（取消=不操作）")) return;
    ta.value += (ta.value ? "\n\n" : "") + text.trim();
    markDirty(); renderPreview(); renderBlocks(); updateScore();
    toast("初稿已生成（含配图槽位）。你手动写过的段落不会被覆盖", "撤销", undoSnapshot);
  } catch (e) { toast("生成失败：" + e.message); }
  finally { b.disabled = false; b.textContent = "AI 生成初稿"; }
});
