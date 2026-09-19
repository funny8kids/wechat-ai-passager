/* 配图页：图槽解析、AI 生成配图提示词、本地图片落位 */
"use strict";

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
