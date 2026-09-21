/* 发布页：立即存草稿 / 立即发布 / 定时入队 / 队列状态与人工放行 */
"use strict";

// ---------- 发布通道横幅：明确「复制富文本」是未接入/无权限时的正式方案 ----------
function gotoWriteCopy() {
  $('.tab[data-tab="write"]').click();
  setTimeout(() => $("#btnCopyRich")?.click(), 400);
}
async function updatePubBanner() {
  const b = $("#pubChannelBanner");
  if (!b) return;
  let s = { appSecretSet: false };
  try { s = await window.api.getSecrets(); } catch {}
  const chip = $("#apiChip")?.textContent || "未自检";
  b.className = "chanbanner show";
  if (!s.appSecretSet) {
    b.classList.add("warn");
    b.innerHTML = `<span class="grow"><b>未接入微信 API：正式发布方式为「复制富文本」</b><br>写作页点「复制富文本」→ 公众号后台编辑器 Ctrl+V，排版样式与正文图片全保留（个别图未显示时到配图页「复制此图」逐张补）。要一键送草稿箱/定时发布？到设置填 AppID/AppSecret 并自检。</span><button class="btn sm" id="bnGoSet">去设置</button><button class="btn sm primary" id="bnGoCopy">去写作页复制</button>`;
  } else if (chip === "API 异常") {
    b.classList.add("warn");
    b.innerHTML = `<span class="grow"><b>微信 API 自检未通过</b>（见状态栏「API 异常」）：常见为 IP 未加白名单（40164）或账号无草稿权限（48001，未认证个人订阅号）。修好前请用正式方案「复制富文本」发布。</span><button class="btn sm" id="bnGoSet">去重新自检</button><button class="btn sm primary" id="bnGoCopy">去写作页复制</button>`;
  } else if (chip === "API 正常") {
    b.classList.add("ok");
    b.innerHTML = `<span class="grow"><b>微信 API 正常</b>：可直接送草稿箱/定时发布；「复制富文本」仍可作备用方式。</span>`;
  } else {
    b.innerHTML = `<span class="grow">已保存微信凭证、尚未自检：到「设置 → 微信公众号」点「连通性自检」确认可用；自检不通时用正式方案「复制富文本」发布。</span><button class="btn sm" id="bnGoSet">去自检</button><button class="btn sm primary" id="bnGoCopy">去写作页复制</button>`;
  }
  $("#bnGoSet")?.addEventListener("click", () => $('.tab[data-tab="settings"]').click());
  $("#bnGoCopy")?.addEventListener("click", gotoWriteCopy);
}

async function refreshQueue() {
  updatePubBanner().catch(() => {});
  $("#pubTitle").textContent = cur ? cur.title || "（无题）" : "（未选择文章）";
  const list = await window.api.queueList();
  const box = $("#queueList");
  if (!list.length) { box.innerHTML = `<div class="empty"><b>队列为空</b><br>在写作页写好文章后，到上方选时间点了「定时发布」<br>到点会先推草稿箱并弹系统通知，最终由你放行</div>`; return; }
  box.innerHTML = "";
  for (const q of list) {
    const div = document.createElement("div");
    div.className = "qcard";
    const stMap = { pending: "排队中", running: "执行中", done: "完成", failed: "失败", awaiting_confirm: "到点·等你放行" };
    div.innerHTML = `<div class="qt">${esc(q.title || "文章")}<span class="stchip ${q.status}">${stMap[q.status] || q.status}</span>
        ${q.publishId ? `<span class="stchip ${q.pubFinal ? (/^✓/.test(q.pubStatus || "") ? "done" : "failed") : "running"}">${esc(q.pubStatus || "发布状态查询中…")}</span>` : ""}
        <span class="spacer"></span><span class="muted small">${fmtTime(q.publishAt)}</span></div>
      <div class="qm">模式:${q.mode === "draft" ? "仅草稿" : "草稿+发布"} · 创建 ${fmtTime(q.createdAt)}${q.draftMediaId ? " · 草稿ID " + q.draftMediaId.slice(0, 12) + "…" : ""}${q.pubCheckedAt ? " · 状态查询 " + fmtTime(q.pubCheckedAt) : ""}</div>
      ${q.pubError ? `<div class="qm" style="color:var(--warn)">发布状态查询受阻：${esc(q.pubError)}（不影响已提交内容，可在公众号后台查看）</div>` : ""}
      ${q.status === "failed" ? `<div class="qerr"><b>${esc(q.error || "未知错误")}</b><br>${q.wxcode === 40164 ? "→ 把状态栏的公网IP加入公众号后台白名单后点重试" : ""}</div>` : ""}
      <div class="pubrow">
        ${q.status === "awaiting_confirm" ? `<button class="btn sm primary cf">确认发布</button>` : ""}
        ${["pending", "failed", "awaiting_confirm"].includes(q.status) ? `<button class="btn sm rn">立即执行</button>` : ""}
        <button class="btn sm danger rm">取消任务</button>
      </div>`;
    div.querySelector(".rm").onclick = async () => { try { await window.api.queueRemove(q.id); toast("任务已取消"); } catch (e) { toast("取消失败：" + e.message); } refreshQueue(); };
    const cf = div.querySelector(".cf"); if (cf) cf.onclick = async () => { try { await window.api.queueConfirm(q.id); } catch (e) { toast("放行失败：" + e.message); } refreshQueue(); };
    const rn = div.querySelector(".rn"); if (rn) rn.onclick = async () => { toast("执行中…"); try { await window.api.queueRunNow(q.id); toast("✓ 执行完成"); } catch (e) { toast("失败：" + e.message); } refreshQueue(); };
    box.appendChild(div);
  }
}
$("#btnQueueRefresh").onclick = refreshQueue;
window.api.onSchedulerEvent((evt) => {
  if (evt.type === "scheduler-error") toast("调度器异常：" + evt.error + "（定时器仍在运行，可到发布页检查队列）");
  else if (evt.type === "app-alert") toast(`${evt.title}：${evt.body}`);
  else if (evt.type === "store-corrupted") toast(`数据文件损坏已备份：${evt.names.join("、")}——原内容在数据目录 .corrupted 文件里，可手工找回`, "打开数据目录", () => window.api.openDataDir?.());
  else if (evt.type === "scheduler-recovered") toast(`上次退出时有 ${evt.count} 个发布任务被中断，已标记为失败，可到发布页手动重试`);
  if (["publish-success", "publish-failed", "queue-update"].includes(evt.type)) refreshQueue();
});

async function guard(fn) {
  $("#pubResult").innerHTML = `<span class="muted">执行中…（图片转存→建草稿→发布）</span>`;
  try { const r = await fn(); $("#pubResult").innerHTML = `<span style="color:var(--accent)">✓ ${esc(r)}</span>`; toast(r); }
  catch (e) {
    // API 失败不静默：显形原因 + 一键切到正式方案「复制富文本」
    $("#pubResult").innerHTML = `<span style="color:var(--err)">✗ ${esc(e.message)}</span> <button class="btn sm ghost" id="prFallback">改用「复制富文本」发布</button>`;
    toast("失败：" + e.message);
    $("#prFallback").onclick = gotoWriteCopy;
  }
}
$("#btnToDraft").onclick = () => { if (!cur) return toast("未选择文章"); saveCur(true).then(() => guard(async () => { const r = await window.api.wxSaveDraft(cur); return "已存入草稿箱（media_id " + r.draftMediaId.slice(0, 10) + "…）"; })); };
$("#btnPubNow").onclick = () => { if (!cur) return toast("未选择文章"); saveCur(true).then(() => guard(async () => { const r = await window.api.wxPublish(cur); return "已提交发布（publish_id " + String(r.publishId).slice(0, 10) + "…），微信审核结果每分钟自动回写到下方队列"; })); };
$("#btnSched").onclick = async () => {
  if (!cur) return toast("未选择文章");
  const v = $("#schedAt").value;
  if (!v) return toast("先选择发布时间");
  const ts = new Date(v).getTime();
  if (ts < Date.now() + 60_000) return toast("定时时间需至少晚于现在 1 分钟");
  await saveCur(true);
  const mode = $("#schedMode").value === "draft" ? "draft" : "publish";
  await window.api.queueAdd({ articleId: cur.id, title: cur.title, publishAt: ts, mode, autoRetry: settings.autoRetry });
  toast(mode === "draft" ? "已入队：到点自动存入微信草稿箱并通知你（不会发布）" : "已入队：到点先推草稿并通知你，最终发布由你放行");
  $$('.tab[data-tab="publish"]').click();
};
