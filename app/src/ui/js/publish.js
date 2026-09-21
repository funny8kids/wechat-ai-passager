/* 发布页：立即存草稿 / 立即发布 / 定时入队 / 队列状态与人工放行 */
"use strict";

async function refreshQueue() {
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
        <span class="spacer"></span><span class="muted small">${fmtTime(q.publishAt)}</span></div>
      <div class="qm">模式:${q.mode === "draft" ? "仅草稿" : "草稿+发布"} · 创建 ${fmtTime(q.createdAt)}${q.draftMediaId ? " · 草稿ID " + q.draftMediaId.slice(0, 12) + "…" : ""}</div>
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
  $$('.tab[data-tab="publish"]').click();
};
