/* 热点选题面板：主进程代拉聚合热榜（5分钟缓存+失败降级），一键「用此选题」填入标题。
   HITL：只填选题，是否让 AI 生成初稿仍由人点击决定。 */
"use strict";

const HOT_NAMES = { weibo: "微博热搜", zhihu: "知乎热榜", toutiao: "今日头条", douyin: "抖音热榜" };
let hotCur = "weibo";
const hotData = {}; // source -> {items, ts, ...}

// ---------- 左栏 文章库/热点 面板切换 ----------
$$(".ptabs .pt").forEach((b) => b.addEventListener("click", () => {
  $$(".ptabs .pt").forEach((x) => x.classList.toggle("on", x === b));
  $$(".lpane").forEach((v) => v.classList.toggle("on", v.id === "lp-" + b.dataset.lp));
  if (b.dataset.lp === "hot" && !hotData[hotCur]) loadHot(hotCur);
}));

$$(".hs").forEach((b) => b.addEventListener("click", () => {
  hotCur = b.dataset.hot;
  $$(".hs").forEach((x) => x.classList.toggle("on", x === b));
  if (hotData[hotCur]) renderHot(hotCur); else loadHot(hotCur);
}));

$("#btnHotRefresh").addEventListener("click", () => loadHot(hotCur, true));

async function loadHot(source, force) {
  $("#hotMeta").textContent = `拉取${HOT_NAMES[source]}…`;
  $("#hotList").innerHTML = "";
  let r;
  try {
    r = await window.api.hotFetch(source, force);
  } catch (e) {
    r = { error: e.message };
  }
  if (!r || r.error) {
    $("#hotMeta").innerHTML = `<span class="bad">${esc(HOT_NAMES[source])}：${esc(r ? r.error : "接口无响应")}，稍后再试或点右上刷新</span>`;
    return;
  }
  hotData[source] = r;
  renderHot(source);
}

function fmtHot(n) {
  return n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, "") + " 万" : String(n);
}

function renderHot(source) {
  const { items, ts, stale } = hotData[source];
  $("#hotMeta").innerHTML = `${HOT_NAMES[source]} · ${fmtTime(ts)}${stale ? ' <b class="stale">（最新拉取失败，展示缓存）</b>' : ""}`;
  const ol = $("#hotList");
  ol.innerHTML = "";
  for (const it of items) {
    const liEl = document.createElement("li");
    liEl.className = "hotitem";
    liEl.innerHTML = `<span class="rk${it.rank <= 3 ? " top" : ""}">${it.rank}</span>
      <span class="ht">${esc(it.title)}</span>
      ${it.hot != null ? `<span class="hv">${fmtHot(it.hot)}</span>` : ""}
      <button class="btn sm use" title="新建文章并填入该选题（AI 是否动笔由你决定）"><svg class="ic"><use href="#i-plus"/></svg>用此选题</button>`;
    liEl.querySelector(".use").addEventListener("click", () => useTopic(it.title));
    ol.appendChild(liEl);
  }
}

function useTopic(title) {
  $('.ptabs .pt[data-lp="articles"]').click();
  newArticle();
  $("#fTitle").value = title;
  markDirty();
  toast("选题已填入新文章，可先改成你自己的角度", "AI 生成初稿", () => $("#btnGenDraft").click());
}
