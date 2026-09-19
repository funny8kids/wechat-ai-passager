/* 设置页：AI 服务、公众号凭证与自检、公网IP、素材库 */
"use strict";

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
  $("#testResult").innerHTML = steps.map(([n, r]) => li(r === "ok" || /^ok/.test(r) ? "ok" : String(r).startsWith("fail") ? "bad" : "none", `${n}：${r}`)).join("");
  const allOk = steps.every(([, r]) => !String(r).startsWith("fail"));
  $("#apiChip").textContent = allOk ? "API 正常" : "API 异常";
  $("#apiChip").className = "chip " + (allOk ? "ok" : "bad");
};
async function detectIp() {
  $("#ipChip").textContent = "IP 探测中…";
  const ip = await window.api.detectIp();
  $("#ipChip").textContent = ip ? `公网IP ${ip}` : "IP 探测失败";
  $("#ipChip").title = ip ? "点击复制；确认它已在公众号后台 IP 白名单中" : "";
  if (ip) $("#ipChip").onclick = () => { navigator.clipboard.writeText(ip); toast("已复制 IP，去公众号后台加入白名单"); };
}

// ---------- 素材库（作者真实经历，供去AI味改写引用） ----------
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
