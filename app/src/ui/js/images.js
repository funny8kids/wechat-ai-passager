/* 配图页：按正文顺序呈现「图槽 → 已成图」时间线；AI 生成画面提示词；本地图片落位 */
"use strict";

const SLOT_RE = /\[图槽:\s*([^\]]+)\]/g;
const LOCAL_IMG_RE = /!\[([^\]]*)\]\((?!https?:)([^)\s]+)\)/g;
const EXT_IMG_RE = /!\[[^\]]*\]\((https?:[^)\s]+)\)/g;

async function renderSlots() {
  const box = $("#slotList"); box.innerHTML = "";
  if (!cur) {
    box.innerHTML = `<div class="empty"><b>还没有选择文章</b><br>先到「写作」页打开或新建一篇文章</div>`;
    $("#imgWarn").style.display = "none";
    return;
  }
  const md = $("#editor").value;
  const items = [];
  for (const m of md.matchAll(SLOT_RE)) items.push({ type: "slot", idx: m.index, full: m[0], intent: m[1].trim() });
  for (const m of md.matchAll(LOCAL_IMG_RE)) items.push({ type: "img", idx: m.index, full: m[0], alt: m[1], name: m[2] });
  const extImgs = [...md.matchAll(EXT_IMG_RE)].filter((m) => !/mmbiz|qpic|weixin/.test(m[1]));
  const w = $("#imgWarn");
  if (extImgs.length) {
    w.style.display = "flex";
    w.innerHTML = `<svg class="ic"><use href="#i-warn"/></svg><div><b>版权与稳定提醒：</b>正文有 ${extImgs.length} 张外链网图。微信发布时外链图会被过滤，且来源图片可能侵权。建议逐张替换为你自己的图或 AI 生图。</div>`;
  } else w.style.display = "none";
  if (!items.length && !extImgs.length) {
    box.innerHTML = `<div class="empty"><b>本文暂无配图槽位与图片</b><br>「AI 生成初稿」会自动在情绪转折处埋下槽位<br>也可在正文手动插入一行：<code>[图槽: 一句话说明画面意图]</code></div>`;
    return;
  }
  items.sort((a, b) => a.idx - b.idx);
  let slotNo = 0;
  for (const it of items) box.appendChild(it.type === "slot" ? slotCard(it, ++slotNo, md) : imgCard(it));
}

const PROMPT_PH = "（点「AI 生成提示词」按上下文写画面描述；生成后可手动改）";

function rememberPrompt(slotFull, text) {
  if (!cur) return;
  cur.slotPrompts = cur.slotPrompts || {};
  if (text && text !== PROMPT_PH) cur.slotPrompts[slotFull] = text;
  else delete cur.slotPrompts[slotFull];
}

function slotCard(it, no, md) {
  const div = document.createElement("div");
  div.className = "slot";
  const saved = (cur.slotPrompts || {})[it.full] || "";
  div.innerHTML = `<div class="thumb idx"><span class="badge">槽位 ${no} · 待落图</span>配图意图<br>等待图片</div>
    <div class="meta">
      <div class="intent">${esc(it.intent)}</div>
      <div class="prompt" contenteditable="true" spellcheck="false">${esc(saved || PROMPT_PH)}</div>
      <div class="ops">
        <button class="btn sm ai genp">AI 生成提示词</button>
        <button class="btn sm picki">选本地图片</button>
        <button class="btn sm danger delslot">删掉槽位</button>
      </div>
    </div>`;
  const promptEl = div.querySelector(".prompt");
  if (!saved) promptEl.classList.add("ph");
  promptEl.addEventListener("focus", () => { if (promptEl.classList.contains("ph")) { promptEl.textContent = ""; promptEl.classList.remove("ph"); } });
  promptEl.addEventListener("blur", () => {
    if (promptEl.classList.contains("ph")) { promptEl.textContent = PROMPT_PH; return; }
    const t = promptEl.textContent.trim();
    if (!t) { promptEl.textContent = PROMPT_PH; promptEl.classList.add("ph"); rememberPrompt(it.full, ""); }
    else rememberPrompt(it.full, t);
  });
  div.querySelector(".genp").onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = "生成中…";
    try {
      const { json } = await window.api.aiJson(
        "你是公众号美术指导。根据文章上下文与配图意图，输出 JSON：{\"prompt\": \"一段适合文生图的中文画面提示词：主体+场景+光线+构图+风格，情绪克制不摆拍，避免文字水印\"}",
        `文章节选：\n${md.slice(0, 2500)}\n\n配图意图：${it.intent}`
      );
      const t = json?.prompt;
      if (t) { promptEl.textContent = t; promptEl.classList.remove("ph"); rememberPrompt(it.full, t); markDirty(); }
      else { promptEl.textContent = "AI 返回异常：" + (JSON.stringify(json) || "").slice(0, 80); promptEl.classList.add("ph"); }
    } catch (err) { promptEl.textContent = "失败：" + err.message; promptEl.classList.add("ph"); }
    e.target.disabled = false; e.target.textContent = "AI 生成提示词";
  };
  div.querySelector(".picki").onclick = async () => {
    const p = await window.api.pickImage();
    if (!p) return;
    const name = await window.api.importAsset(p);
    const ta = $("#editor");
    ta.value = ta.value.replace(it.full, `![${it.intent}](${name})`);
    pushSnapshot(); markDirty(); renderSlots(); renderPreview();
    toast("已落图（发布时自动转存为微信 CDN 图）", "撤销", undoSnapshot);
  };
  div.querySelector(".delslot").onclick = () => {
    const ta = $("#editor");
    ta.value = ta.value.replace(it.full, "");
    pushSnapshot(); markDirty(); renderSlots(); renderPreview();
  };
  return div;
}

function imgCard(it) {
  const div = document.createElement("div");
  div.className = "slot done";
  div.innerHTML = `<div class="thumb idx"><span class="badge stchip done">已成图</span><span class="muted small">加载中…</span></div>
    <div class="meta">
      <div class="intent">${esc(it.alt || "图片")}</div>
      <div class="prompt muted small" style="min-height:0">素材文件：${esc(it.name)} · 发布时自动转存微信 CDN</div>
      <div class="ops">
        <button class="btn sm copyi">复制此图</button>
        <button class="btn sm replacei">更换图片</button>
        <button class="btn sm danger deletei">移除图片</button>
      </div>
    </div>`;
  window.api.assetDataUrl(it.name).then((url) => {
    const th = div.querySelector(".thumb");
    th.innerHTML = url ? `<img src="${url}" alt="${esc(it.alt || "配图")}">` : `<span class="muted small">素材文件缺失</span>`;
    th.prepend(Object.assign(document.createElement("span"), { className: "badge stchip done", textContent: "已成图" }));
  });
  div.querySelector(".copyi").onclick = async () => {
    const err = await window.api.copyImage(it.name);
    toast(err || "已复制这张图 → 公众号后台图片位置直接 Ctrl+V 即上传");
  };
  div.querySelector(".replacei").onclick = async () => {
    const p = await window.api.pickImage();
    if (!p) return;
    const name = await window.api.importAsset(p);
    const ta = $("#editor");
    ta.value = ta.value.replace(it.full, `![${it.alt} ](${name})`.replace("] ]", "]"));
    pushSnapshot(); markDirty(); renderSlots(); renderPreview();
    toast("已更换（旧图仍在素材库，可随时找回）", "撤销", undoSnapshot);
  };
  div.querySelector(".deletei").onclick = () => {
    const ta = $("#editor");
    ta.value = ta.value.replace(it.full, "");
    pushSnapshot(); markDirty(); renderSlots(); renderPreview();
  };
  return div;
}
