/* 稿匠渲染端逻辑 */
"use strict";
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function showFatal(msg) {
  const d = document.createElement("div");
  d.style.cssText = "position:fixed;left:0;right:0;bottom:0;background:#b91c1c;color:#fff;font-size:12px;padding:6px 12px;z-index:9999";
  d.textContent = "渲染错误：" + msg;
  document.body.appendChild(d);
}
window.addEventListener("error", (e) => showFatal(`${e.message} @ ${e.filename?.split("/").pop()}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => showFatal(String(e.reason?.message || e.reason)));

let articles = [], cur = null;
let snapshots = []; // 内存快照栈（撤销用）
let settings = null;

/* ---------- 通用 ---------- */
function toast(msg, actionLabel, actionFn) {
  const t = $("#toast");
  t.innerHTML = "";
  const s = document.createElement("span"); s.textContent = msg; t.appendChild(s);
  if (actionFn) {
    const b = document.createElement("button"); b.textContent = actionLabel;
    b.onclick = () => { actionFn(); t.classList.remove("show"); };
    t.appendChild(b);
  }
  t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), actionFn ? 6000 : 3000);
}
const esc = (s) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtTime = (ts) => new Date(ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

/* ---------- Tab 切换 ---------- */
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

/* ---------- 文章 ---------- */
async function loadArticles() {
  articles = await window.api.listArticles();
  const ul = $("#articleList"); ul.innerHTML = "";
  for (const a of articles) {
    const li = document.createElement("li");
    li.className = cur && a.id === cur.id ? "on" : "";
    li.innerHTML = `<div class="t">${esc(a.title || "无题")}</div><div class="d">${fmtTime(a.updatedAt)} · ${(a.md || "").length} 字</div>`;
    li.onclick = () => { openArticle(a); };
    ul.appendChild(li);
  }
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
  for (const a of articles) {
    const li = document.createElement("li");
    li.className = cur && a.id === cur.id ? "on" : "";
    li.innerHTML = `<div class="t">${esc(a.title || "无题")}</div><div class="d">${fmtTime(a.updatedAt)} · ${(a.md || "").length} 字</div>`;
    li.onclick = () => openArticle(a);
    ul.appendChild(li);
  }
}
async function saveCur(silent) {
  if (!cur) { toast("请先新建或选择文章"); return; }
  cur.title = $("#fTitle").value.trim(); cur.md = $("#editor").value; cur.theme = $("#fTheme").value;
  await window.api.saveArticle(cur);
  $("#saveState").textContent = "已保存 " + new Date().toLocaleTimeString("zh-CN");
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
function markDirty() { $("#saveState").textContent = "未保存"; }

$("#btnNew").onclick = newArticle;
$("#btnSave").onclick = () => saveCur();
$("#editor").addEventListener("input", () => { markDirty(); debounceRender(); updateScore(); });
$("#fTitle").addEventListener("input", markDirty);
$("#fTheme").addEventListener("change", () => { markDirty(); renderPreview(); });

let _rh;
function debounceRender() { clearTimeout(_rh); _rh = setTimeout(renderPreview, 350); }
async function renderPreview() {
  const md = $("#editor").value;
  const html = await window.api.render(md || "*（开始写作，右侧为公众号样式预览）*", $("#fTheme").value || "青竹绿");
  $("#preview").innerHTML = `<div class="phoneish">${html}</div>`;
}

/* ---------- 段落块 / 回炉 ---------- */
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

/* ---------- 选区 AI 改写（核心 HITL） ---------- */
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

/* ---------- AI 味评分（规则） ---------- */
const CLICHES = ["总而言之", "综上所述", "值得注意的是", "不难发现", "赋能", "闭环", "抓手", "无独有偶", "在这个快节奏的时代", "在这个信息爆炸", "首先", "其次", "最后", "不仅", "而且", "与此同时", "更重要的是", "可以说"];
function updateScore() {
  const md = $("#editor").value;
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
  $("#scoreBig").textContent = score; $("#scoreBig").style.color = score > 55 ? "var(--err)" : score > 30 ? "var(--warn)" : "var(--accent)";
  $("#scoreDetail").innerHTML =
    li(hits.length ? "warn" : "ok", `套话/列举腔命中 ${hits.length} 个${hits.length ? "：" + hits.slice(0, 6).join("、") : ""}`) +
    li(evenness > 0.6 ? "warn" : "ok", `句长均匀度 ${(evenness * 100) | 0}%（越高越像 AI 的匀速句）`) +
    li("none", "参考去味清单：拆排比、删套话、句长参差、注入个人经历（设置→素材库）");
}
const li = (cls, txt) => `<li class="${cls}">${esc(txt)}</li>`;

/* ---------- 审核 Agent（规则版） ---------- */
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
  const digest = (md.replace(/[#>*!\[\]()`|，。\s]/g, "").length);
  out.push(li(digest >= 20 ? "ok" : "warn", `摘要将由正文前100字自动生成`));
  const risky = ["扫码", "加微", "免费领取", "转发抽奖"].filter((w) => md.includes(w));
  out.push(li(risky.length ? "warn" : "ok", risky.length ? `含营销敏感词：${risky.join("、")}（可能触发平台审核）` : "无常见营销敏感词"));
  $("#auditList").innerHTML = out.join("");
  toast("审核 Agent 完成（规则检查；LLM 事实核查在流水线版提供）");
});

/* ---------- 配图页 ---------- */
const SLOT_RE = /\[图槽:\s*([^\]]+)\]/g;
async function renderSlots() {
  const box = $("#slotList"); box.innerHTML = "";
  if (!cur) { box.innerHTML = `<p class="muted">先在写作页选择/新建一篇文章</p>`; $("#imgWarn").style.display = "none"; return; }
  const md = $("#editor").value;
  const slots = [...md.matchAll(SLOT_RE)];
  const extImgs = [...md.matchAll(/!\[[^\]]*\]\((https?:[^)\s]+)/g)].filter((m) => !/mmbiz|qpic|weixin/.test(m[1]));
  const w = $("#imgWarn");
  if (extImgs.length) { w.style.display = "block"; w.innerHTML = `<b>版权与稳定提醒：</b>正文有 ${extImgs.length} 张外链网图。微信发布时外链图会被过滤，且来源图片可能侵权。建议逐张替换：AI 生图 / 你自己的图 / 已获授权的图。`; }
  else w.style.display = "none";
  if (!slots.length && !extImgs.length) {
    box.innerHTML = `<p class="muted">当前文章没有配图槽位。用「AI 生成初稿」会自动在情绪转折处埋槽位；或手动在正文插入一行：<code>[图槽: 一句话配图意图]</code></p>`;
    return;
  }
  slots.forEach((m, i) => {
    const intent = m[1].trim();
    const div = document.createElement("div");
    div.className = "slot";
    div.innerHTML = `<div class="thumb">槽位 ${i + 1}</div>
      <div class="meta">
        <div class="intent">意图：${esc(intent)}</div>
        <div class="prompt" contenteditable="true" spellcheck="false">（点「生成提示词」让 AI 按上下文写画面描述；可手动改）</div>
        <div class="ops">
          <button class="btn sm ai genp">生成提示词</button>
          <button class="btn sm picki">选本地图片</button>
          <button class="btn sm danger delslot">删掉槽位</button>
        </div>
      </div>`;
    div.querySelector(".genp").onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = "生成中…";
      try {
        const { json } = await window.api.aiJson(
          "你是公众号美术指导。根据文章上下文与配图意图，输出 JSON：{\"prompt\": \"一段适合文生图的中文画面提示词：主体+场景+光线+构图+风格，情绪克制不摆拍，避免文字水印\"}",
          `文章节选：\n${md.slice(0, 2500)}\n\n配图意图：${intent}`
        );
        div.querySelector(".prompt").textContent = json?.prompt || "AI 返回异常：" + (JSON.stringify(json) || "").slice(0, 80);
      } catch (err) { div.querySelector(".prompt").textContent = "失败：" + err.message; }
      e.target.disabled = false; e.target.textContent = "生成提示词";
    };
    div.querySelector(".picki").onclick = async () => {
      const p = await window.api.pickImage();
      if (!p) return;
      const name = await window.api.importAsset(p);
      const ta = $("#editor");
      ta.value = ta.value.replace(m[0], `![${intent}](${name})`);
      pushSnapshot(); markDirty(); renderSlots(); renderPreview();
      toast("已插入本地图片（发布时自动转存为微信CDN图）");
    };
    div.querySelector(".delslot").onclick = () => {
      const ta = $("#editor");
      ta.value = ta.value.replace(m[0], "");
      pushSnapshot(); markDirty(); renderSlots(); renderPreview();
    };
    box.appendChild(div);
  });
}

/* ---------- 发布页 ---------- */
async function refreshQueue() {
  $("#pubTitle").textContent = cur ? cur.title || "（无题）" : "（未选择文章）";
  const list = await window.api.queueList();
  const box = $("#queueList");
  if (!list.length) { box.innerHTML = `<p class="muted">队列为空。定时任务到点时会先推草稿箱并弹系统通知，由你最终放行发布。</p>`; return; }
  box.innerHTML = "";
  for (const q of list) {
    const div = document.createElement("div");
    div.className = "qcard";
    const stMap = { pending: "排队中", running: "执行中", done: "完成", failed: "失败", awaiting_confirm: "到点·等你放行" };
    div.innerHTML = `<div class="qt">${esc(q.title || "文章")}<span class="stchip ${q.status}">${stMap[q.status] || q.status}</span>
        <span class="spacer"></span><span class="muted small">${fmtTime(q.publishAt)}</span></div>
      <div class="qm">模式:${q.mode === "draft" ? "仅草稿" : "草稿+发布"} · 创建 ${fmtTime(q.createdAt)}${q.draftMediaId ? " · 草稿ID " + q.draftMediaId.slice(0, 12) + "…" : ""}</div>
      ${q.status === "failed" ? `<div class="qerr"><b>${esc(q.error || "未知错误")}</b><br>${q.wxcode === 40164 ? "→ 把状态栏的公网IP加入公众号后台白名单后点重试" : ""}</div>` : ""}
      <div class="pubrow">
        ${q.status === "awaiting_confirm" ? `<button class="btn sm primary cf">确认发布</button>` : ""}
        ${["pending", "failed", "awaiting_confirm"].includes(q.status) ? `<button class="btn sm rn">立即执行</button>` : ""}
        <button class="btn sm danger rm">取消任务</button>
      </div>`;
    div.querySelector(".rm").onclick = async () => { await window.api.queueRemove(q.id); refreshQueue(); };
    const cf = div.querySelector(".cf"); if (cf) cf.onclick = async () => { await window.api.queueConfirm(q.id); refreshQueue(); };
    const rn = div.querySelector(".rn"); if (rn) rn.onclick = async () => { toast("执行中…"); try { await window.api.queueRunNow(q.id); } catch (e) { toast("失败：" + e.message); } refreshQueue(); };
    box.appendChild(div);
  }
}
$("#btnQueueRefresh").onclick = refreshQueue;
window.api.onSchedulerEvent((evt) => {
  if (["publish-success", "publish-failed", "queue-update"].includes(evt.type)) refreshQueue();
});

async function guard(fn) {
  $("#pubResult").innerHTML = `<span class="muted">执行中…（图片转存→建草稿→发布）</span>`;
  try { const r = await fn(); $("#pubResult").innerHTML = `<span style="color:var(--accent)">✓ ${esc(r)}</span>`; toast(r); }
  catch (e) { $("#pubResult").innerHTML = `<span style="color:var(--err)">✗ ${esc(e.message)}</span>`; toast("失败：" + e.message); }
}
$("#btnToDraft").onclick = () => { if (!cur) return toast("未选择文章"); saveCur(true).then(() => guard(async () => { const r = await window.api.wxSaveDraft(cur); return "已存入草稿箱（media_id " + r.draftMediaId.slice(0, 10) + "…）"; })); };
$("#btnPubNow").onclick = () => { if (!cur) return toast("未选择文章"); saveCur(true).then(() => guard(async () => { const r = await window.api.wxPublish(cur); return "已提交发布（publish_id " + String(r.publishId).slice(0, 10) + "…），微信审核数分钟后生效"; })); };
$("#btnSched").onclick = async () => {
  if (!cur) return toast("未选择文章");
  const v = $("#schedAt").value;
  if (!v) return toast("先选择发布时间");
  const ts = new Date(v).getTime();
  if (ts < Date.now() + 60_000) return toast("定时时间需至少晚于现在 1 分钟");
  await saveCur(true);
  await window.api.queueAdd({ articleId: cur.id, title: cur.title, publishAt: ts, mode: "publish", autoRetry: settings.autoRetry });
  toast("已入队：到点先推草稿并通知你，最终发布由你放行");
  $("#view-publish .tab")?.click();
  $$('.tab[data-tab="publish"]').click();
};

/* ---------- AI 初稿 ---------- */
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

/* ---------- 设置页 ---------- */
async function loadSettings() {
  settings = await window.api.getSettings();
  const sec = await window.api.getSecrets();
  $("#sBaseUrl").value = settings.baseUrl || "";
  $("#sModel").value = settings.model || "";
  $("#sConfirm").checked = settings.confirmBeforePublish !== false;
  $("#sRetry").checked = settings.autoRetry !== false;
  $("#sAppId").value = sec.appId || "";
  $("#sAiKey").placeholder = sec.aiKeySet ? "已设置（留空=不修改）" : "填入 API Key";
  $("#sAppSecret").placeholder = sec.appSecretSet ? "已设置（留空=不修改）" : "填入 AppSecret";
  renderMaterials();
  $("#ipChip").onclick = detectIp;
  detectIp();
}
$("#btnSaveSettings").onclick = async () => {
  await window.api.setSettings({ baseUrl: $("#sBaseUrl").value.trim(), model: $("#sModel").value.trim(), confirmBeforePublish: $("#sConfirm").checked, autoRetry: $("#sRetry").checked });
  const patch = {};
  if ($("#sAiKey").value.trim()) patch.aiKey = $("#sAiKey").value.trim();
  if ($("#sAppSecret").value.trim()) patch.appSecret = $("#sAppSecret").value.trim();
  if ($("#sAppId").value.trim()) patch.appId = $("#sAppId").value.trim();
  if (Object.keys(patch).length) await window.api.setSecrets(patch);
  $("#sAiKey").value = ""; $("#sAppSecret").value = "";
  toast("设置已保存（密钥已加密存储）");
  loadSettings();
};
$("#btnSelfTest").onclick = async () => {
  $("#testResult").innerHTML = li("none", "自检中：token → 草稿权限 → 公网IP…");
  const steps = await window.api.wxSelfTest();
  $("#testResult").innerHTML = steps.map(([n, r]) => li(r === "ok" || /^ok/.test(r) ? "ok" : r.startsWith("fail") ? "bad" : "none", `${n}：${r}`)).join("");
  const ok = steps.every(([, r]) => !String(r).startsWith("fail"));
  $("#apiChip").textContent = ok ? "API 正常" : "API 异常";
  $("#apiChip").className = "chip " + (ok ? "ok" : "bad");
};
async function detectIp() {
  $("#ipChip").textContent = "IP 探测中…";
  const ip = await window.api.detectIp();
  $("#ipChip").textContent = ip ? `公网IP ${ip}` : "IP 探测失败";
  $("#ipChip").title = ip ? "点击复制；确认它已在公众号后台 IP 白名单中" : "";
  if (ip) $("#ipChip").onclick = () => { navigator.clipboard.writeText(ip); toast("已复制 IP，去公众号后台加入白名单"); };
}

/* ---------- 素材库 ---------- */
async function renderMaterials() {
  const mats = await window.api.getMaterials();
  const box = $("#matList");
  box.innerHTML = "";
  mats.forEach((m, i) => {
    const div = document.createElement("div");
    div.className = "mat";
    div.innerHTML = `<span class="mt">${esc(m.type)}</span><span style="flex:1">${esc(m.text)}</span><button class="btn sm ghost">删</button>`;
    div.querySelector("button").onclick = async () => { mats.splice(i, 1); await window.api.setMaterials(mats); renderMaterials(); };
    box.appendChild(div);
  });
  if (!mats.length) box.innerHTML = `<p class="muted small">暂无素材。写得越具体越好（时间/地点/感受），去 AI 味改写时 AI 会引用。</p>`;
}
$("#btnMatAdd").onclick = async () => {
  const text = $("#matText").value.trim();
  if (!text) return;
  const mats = await window.api.getMaterials();
  mats.unshift({ type: $("#matType").value, text, at: Date.now() });
  await window.api.setMaterials(mats);
  $("#matText").value = "";
  renderMaterials();
};

/* ---------- 启动 ---------- */
(async () => {
  try {
    await loadSettings();
    await loadArticles();
    if (articles.length) openArticle(articles[0]); else newArticle();
  } catch (e) { showFatal("启动失败：" + (e?.message || e)); }
  setInterval(() => { if ($('.tab[data-tab="publish"]').classList.contains("on")) refreshQueue(); }, 30_000);
})();
