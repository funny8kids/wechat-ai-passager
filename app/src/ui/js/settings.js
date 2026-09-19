/* 设置页：AI 服务、公众号凭证与自检、公网IP、素材库 */
"use strict";

async function loadSettings() {
  settings = await window.api.getSettings();
  const sec = await window.api.getSecrets();
  $("#sBaseUrl").value = settings.baseUrl || "";
  $("#sModel").value = settings.model || "";
  $("#sPreset").value = "";
  $("#sTempRange").value = settings.temperature ?? 0.7;
  $("#sTempOut").textContent = $("#sTempRange").value;
  $("#sMaxTokens").value = settings.maxTokens || 0;
  const ap = settings.agentParams || DEFAULT_AGENT_PARAMS;
  for (const [key, f] of Object.entries(AGENT_FIELDS)) {
    $("#" + f.model).value = ap[key]?.model || "";
    $("#" + f.temp).value = ap[key]?.temperature ?? "";
  }
  $("#sConfirm").checked = settings.confirmBeforePublish !== false;
  $("#sRetry").checked = settings.autoRetry !== false;
  $("#sAppId").value = sec.appId || "";
  $("#sAiKey").placeholder = sec.aiKeySet ? "已设置（留空=不修改）" : "填入 API Key";
  $("#sAppSecret").placeholder = sec.appSecretSet ? "已设置（留空=不修改）" : "填入 AppSecret";
  await refreshThemeSelect();
  fillDefaultTheme();
  renderThemes();
  renderMaterials();
  $("#ipChip").onclick = detectIp;
  detectIp();
}

// ---------- AI 高级配置：服务商预设 / 全局参数 / 每 Agent 参数 / 连通测试 ----------
const PRESETS = {
  deepseek: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  kimi: { baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  ollama: { baseUrl: "http://localhost:11434/v1", model: "qwen2.5:14b" },
};
$("#sPreset").addEventListener("change", () => {
  const p = PRESETS[$("#sPreset").value];
  if (!p) return;
  $("#sBaseUrl").value = p.baseUrl;
  $("#sModel").value = p.model;
  toast(`已填入 ${$("#sPreset").selectedOptions[0].textContent} 的端点与默认模型，点「保存设置」生效`);
});
$("#sTempRange").addEventListener("input", () => { $("#sTempOut").textContent = $("#sTempRange").value; });

const DEFAULT_AGENT_PARAMS = { 初稿: { temperature: 0.8 }, 改写: { temperature: 0.7 }, 标题: { temperature: 0.9 }, 配图: { temperature: 0.6 }, 调研: { temperature: 0.5 }, 审核: { temperature: 0.3 } };
const AGENT_FIELDS = {
  初稿: { model: "agDraftModel", temp: "agDraftTemp" },
  改写: { model: "agRewriteModel", temp: "agRewriteTemp" },
  标题: { model: "agTitleModel", temp: "agTitleTemp" },
  配图: { model: "agImageModel", temp: "agImageTemp" },
  调研: { model: "agResearchModel", temp: "agResearchTemp" },
  审核: { model: "agAuditModel", temp: "agAuditTemp" },
};
function collectAgentParams() {
  const out = {};
  for (const [key, f] of Object.entries(AGENT_FIELDS)) {
    const t = $("#" + f.temp).value;
    out[key] = { model: $("#" + f.model).value.trim(), temperature: t === "" ? undefined : Number(t) };
  }
  return out;
}
$("#btnAiTest").addEventListener("click", async () => {
  const b = $("#btnAiTest"); b.disabled = true;
  $("#aiTestResult").textContent = "正在请求…";
  const r = await window.api.aiTest({ baseUrl: $("#sBaseUrl").value.trim(), model: $("#sModel").value.trim(), apiKey: $("#sAiKey").value.trim() });
  b.disabled = false;
  $("#aiTestResult").textContent = r.ok ? `✓ ${r.ms}ms，模型回复「${r.reply}」` : `✗ ${r.ms}ms：${r.error}`;
  $("#aiTestResult").className = "small " + (r.ok ? "ok-text" : "bad-text");
});

$("#btnSaveSettings").onclick = async () => {
  await window.api.setSettings({
    baseUrl: $("#sBaseUrl").value.trim(), model: $("#sModel").value.trim(),
    temperature: Number($("#sTempRange").value), maxTokens: Number($("#sMaxTokens").value) || 0,
    agentParams: collectAgentParams(),
    confirmBeforePublish: $("#sConfirm").checked, autoRetry: $("#sRetry").checked,
  });
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

// ---------- 排版样式：默认样式 + 自定义样式存储 ----------
const TF_FIELDS = { accent: "#tfAccent", heading: "#tfHeading", body: "#tfBody", quote: "#tfQuote", quoteBg: "#tfQuoteBg", border: "#tfBorder", fontSize: "#tfFontSize", lineHeight: "#tfLineHeight", letterSpacing: "#tfLetterSpacing" };
const THEME_SAMPLE_MD = "## 小标题示例：我试了三个方法\n\n正文示例：那年夏天我把闹钟砸了，才发现睡眠债是要还的。\n\n> 引用示例：写得像说话，读者才肯听完。\n\n- 列表项一\n- 列表项二";
let tfEditing = null; // 正在编辑的自定义样式名；null=新建/复制

function fillDefaultTheme() {
  const sel = $("#sDefaultTheme");
  const all = [...themeCatalog.builtin, ...themeCatalog.custom];
  sel.innerHTML = all.map((t) => `<option ${settings.theme === t.name ? "selected" : ""}>${esc(t.name)}</option>`).join("");
}
$("#sDefaultTheme").addEventListener("change", async () => {
  settings = await window.api.setSettings({ theme: $("#sDefaultTheme").value });
  renderThemes();
  toast(`新文章将默认使用「${settings.theme}」（已建文章不受影响）`);
});

function renderThemes() {
  const box = $("#themeList");
  box.innerHTML = "";
  for (const t of [...themeCatalog.builtin, ...themeCatalog.custom]) {
    const div = document.createElement("div");
    div.className = "trow";
    const dots = ["accent", "heading", "body", "quote"].map((k) => `<i style="background:${esc(String(t[k] || "#ccc"))}"></i>`).join("");
    div.innerHTML = `<span class="sw">${dots}</span><b>${esc(t.name)}</b>
      <span class="stchip">${t.builtin ? "内置" : "我的"}</span>
      ${settings.theme === t.name ? `<span class="stchip def">默认</span>` : ""}
      <span class="spacer"></span>
      <button class="btn sm ghost cp" title="以这份样式为底稿，做一份自己的">复制并修改</button>
      ${t.builtin ? "" : `<button class="btn sm ghost ed">编辑</button><button class="btn sm ghost rm">删除</button>`}`;
    div.querySelector(".cp").onclick = () => openThemeForm(t, null, true);
    if (!t.builtin) {
      div.querySelector(".ed").onclick = () => openThemeForm(t, t.name, false);
      div.querySelector(".rm").onclick = async () => {
        if (!confirm(`删除样式「${t.name}」？用到它的文章会回退到内置默认`)) return;
        themeCatalog.custom = await window.api.themeDelete(t.name);
        if (settings.theme === t.name) settings = await window.api.setSettings({ theme: "青竹绿" });
        refreshThemeSelect(); fillDefaultTheme(); renderThemes();
      };
    }
    box.appendChild(div);
  }
}

function openThemeForm(t, editing, asNew) {
  tfEditing = editing;
  $("#tfTitle").textContent = asNew ? `复制自「${t.name}」` : editing ? `编辑「${editing}」` : "新建样式";
  for (const [k, sel] of Object.entries(TF_FIELDS)) $(sel).value = t[k] ?? $(sel).defaultValue;
  $("#tfName").value = asNew ? `${t.name} 副本` : editing || "";
  $("#themeForm").hidden = false;
  $("#tfErr").textContent = "";
  themePv();
}
$("#btnThemeNew").onclick = () => openThemeForm({}, null, false);
$("#btnThemeCancel").onclick = () => { $("#themeForm").hidden = true; };

function themeFormPalette() {
  const p = { name: $("#tfName").value.trim() };
  for (const [k, sel] of Object.entries(TF_FIELDS)) p[k] = $(sel).value;
  return p;
}
let _tpv;
function themePv() {
  clearTimeout(_tpv);
  _tpv = setTimeout(async () => {
    try { $("#themePv").innerHTML = await window.api.render(THEME_SAMPLE_MD, themeFormPalette()); } catch {}
  }, 300);
}
$$(".themeform input").forEach((i) => i.addEventListener("input", themePv));

$("#btnThemeSave").onclick = async () => {
  const p = themeFormPalette();
  if (!p.name) { $("#tfErr").textContent = "样式名必填"; return; }
  try {
    themeCatalog.custom = await window.api.themeSave(p);
  } catch (e) { $("#tfErr").textContent = e.message; return; }
  $("#themeForm").hidden = true;
  await refreshThemeSelect();
  fillDefaultTheme(); renderThemes();
  toast(`样式「${p.name}」已保存；在写作页主题下拉或上方「默认样式」里选它`);
};

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
