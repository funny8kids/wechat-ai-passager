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
  $("#sImgKey").placeholder = sec.imgKeySet ? "已设置（留空=不修改）" : "填入生图 API Key";
  await loadImgSettings();
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
  $("#aiTestResult").className = "small muted";
  try {
    const r = await window.api.aiTest({ baseUrl: $("#sBaseUrl").value.trim(), model: $("#sModel").value.trim(), apiKey: $("#sAiKey").value.trim() });
    $("#aiTestResult").textContent = r.ok ? `✓ ${r.ms}ms，模型回复「${r.reply}」` : `✗ ${r.ms}ms：${r.error}`;
    $("#aiTestResult").className = "small " + (r.ok ? "ok-text" : "bad-text");
  } catch (e) {
    $("#aiTestResult").textContent = "✗ 测试请求本身失败：" + e.message;
    $("#aiTestResult").className = "small bad-text";
  } finally { b.disabled = false; }
});

// ---------- 生图服务：预设取自核心模块（国内可达端点），表单直测不必先保存 ----------
let IMG_PRESETS = [];
function imgPreset(name) { return IMG_PRESETS.find((p) => p.name === name) || {}; }
function imgKeyHintText(p) { return p.keyless ? "免 Key 免费源：不用填 Key 直接测。注意免费档带水印、中文长提示词偏弱（简短英文更稳）" : "去哪拿 Key：" + (p.keyHint || ""); }
function fillImgSizes(presets, cur) {
  const sizes = presets.sizes || ["1024x1024"];
  $("#sImgSize").innerHTML = sizes.map((s) => `<option value="${s}"${s === cur ? " selected" : ""}>${s}</option>`).join("");
}
function applyImgPreset() {
  const p = imgPreset($("#sImgPreset").value);
  if (!p.baseUrl && !p.models) return;
  if (p.baseUrl) $("#sImgBaseUrl").value = p.baseUrl;
  if (p.model) $("#sImgModel").value = p.model;
  $("#imgModelList").innerHTML = (p.models || []).map((m) => `<option value="${esc(m)}">`).join("");
  $("#imgKeyHint").textContent = imgKeyHintText(p);
  fillImgSizes(p, p.sizes?.[0]);
  toast(`已填入 ${$("#sImgPreset").value} 的端点与默认模型，点「保存设置」生效`);
}
async function loadImgSettings() {
  if (!IMG_PRESETS.length) {
    try { IMG_PRESETS = await window.api.imgenPresets(); } catch (e) { IMG_PRESETS = []; }
  }
  if (!IMG_PRESETS.length) { $("#imgKeyHint").textContent = "生图预设加载失败：重启应用重试"; return; }
  $("#sImgPreset").innerHTML = IMG_PRESETS.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("");
  const g = settings.imgGen || {};
  if (g.provider && IMG_PRESETS.some((p) => p.name === g.provider)) $("#sImgPreset").value = g.provider;
  $("#sImgBaseUrl").value = g.baseUrl || imgPreset($("#sImgPreset").value).baseUrl || "";
  $("#sImgModel").value = g.model || imgPreset($("#sImgPreset").value).model || "";
  const p = imgPreset($("#sImgPreset").value);
  $("#imgModelList").innerHTML = (p.models || []).map((m) => `<option value="${esc(m)}">`).join("");
  $("#imgKeyHint").textContent = imgKeyHintText(p);
  fillImgSizes(p, g.size);
}
$("#sImgPreset").addEventListener("change", applyImgPreset);
$("#btnImgTest").addEventListener("click", async () => {
  const b = $("#btnImgTest"); b.disabled = true;
  $("#imgTestResult").textContent = "正在真实生成一张图（约 5~60 秒）…";
  $("#imgTestResult").className = "small muted";
  try {
    const r = await window.api.imgenTest({
      provider: $("#sImgPreset").value, baseUrl: $("#sImgBaseUrl").value,
      model: $("#sImgModel").value, size: $("#sImgSize").value, imgKey: $("#sImgKey").value,
    });
    $("#imgTestResult").textContent = `✓ ${r.ms}ms，出图 ${(r.bytes / 1024).toFixed(0)}KB（.${r.ext}）→ 可以到配图页一键出图了`;
    $("#imgTestResult").className = "small ok-text";
  } catch (e) {
    $("#imgTestResult").textContent = "✗ " + e.message;
    $("#imgTestResult").className = "small bad-text";
  } finally { b.disabled = false; }
});
$("#btnClearImgKey").onclick = async () => {
  if (!confirm("删除本机保存的生图 Key？免费直连源不受影响；自带 Key 的源需重填后才能用")) return;
  await window.api.setSecrets({ imgKey: "" });
  toast("生图 Key 已从本机删除");
  loadSettings();
};

$("#btnSaveSettings").onclick = async () => {
  await window.api.setSettings({
    baseUrl: $("#sBaseUrl").value.trim(), model: $("#sModel").value.trim(),
    temperature: Number($("#sTempRange").value), maxTokens: Number($("#sMaxTokens").value) || 0,
    agentParams: collectAgentParams(),
    confirmBeforePublish: $("#sConfirm").checked, autoRetry: $("#sRetry").checked,
    imgGen: {
      provider: $("#sImgPreset").value, baseUrl: $("#sImgBaseUrl").value.trim(),
      model: $("#sImgModel").value.trim(), size: $("#sImgSize").value,
    },
  });
  const patch = {};
  if ($("#sAiKey").value.trim()) patch.aiKey = $("#sAiKey").value.trim();
  if ($("#sAppSecret").value.trim()) patch.appSecret = $("#sAppSecret").value.trim();
  if ($("#sAppId").value.trim()) patch.appId = $("#sAppId").value.trim();
  if ($("#sImgKey").value.trim()) patch.imgKey = $("#sImgKey").value.trim();
  let encNote = "";
  if (Object.keys(patch).length) {
    const r = await window.api.setSecrets(patch);
    encNote = r.encrypted ? "（已加密存储）" : "（⚠ 本机加密不可用，密钥以明文存在本地，请注意电脑安全）";
    $("#sAiKey").value = ""; $("#sAppSecret").value = ""; $("#sImgKey").value = "";
  }
  toast("设置已保存" + encNote);
  loadSettings();
};
$("#btnIp").onclick = detectIp;
$("#btnOpenDataDir").onclick = async () => {
  const r = await window.api.openDataDir(); // shell.openPath：成功返回空串，失败返回错误文本
  if (r) toast("打开失败：" + r);
};
$("#btnBackupExport").onclick = async (e) => {
  const b = e.target; b.disabled = true; b.textContent = "导出中…";
  $("#backupResult").textContent = "";
  try {
    const r = await window.api.backupExport();
    if (r) {
      $("#backupResult").textContent = `已导出 ${r.articles} 篇文章 / ${r.assets} 个素材（${r.mb}MB）`;
      toast("备份包已保存：" + r.path);
    }
  } catch (err) {
    $("#backupResult").textContent = ""; toast("导出失败：" + err.message);
  } finally { b.disabled = false; b.textContent = "导出备份包"; }
};
$("#btnBackupImport").onclick = async (e) => {
  const b = e.target; b.disabled = true; b.textContent = "导入中…";
  try {
    const r = await window.api.backupImport();
    if (r) {
      $("#backupResult").textContent = `已导入 ${r.articles} 篇文章 / ${r.assets} 个素材`;
      toast("备份已恢复。密钥不在备份包里：AI/微信/生图 Key 请重新填一次", "去填 Key", () => $("#sAiKey").focus());
      await Promise.all([loadSettings(), loadArticles(), renderMaterials(), refreshQueue(), updatePubBanner()]);
    }
  } catch (err) {
    toast("导入失败：" + err.message + "（当前数据未被改动）");
  } finally { b.disabled = false; b.textContent = "导入备份包"; }
};
$("#btnClearAiKey").onclick = async () => {
  if (!confirm("删除本机保存的 API Key？AI 功能将不可用，直到重新填入")) return;
  await window.api.setSecrets({ aiKey: "" });
  toast("API Key 已从本机删除");
  loadSettings();
};
$("#btnClearAppSecret").onclick = async () => {
  if (!confirm("删除本机保存的 AppSecret？发布/自检将不可用，直到重新填入")) return;
  await window.api.setSecrets({ appSecret: "" });
  toast("AppSecret 已从本机删除");
  loadSettings();
};
$("#btnSelfTest").onclick = async () => {
  $("#testResult").innerHTML = li("none", "自检中：token → 草稿权限 → 公网IP…（用表单当前值，未保存也能测）");
  try {
    const steps = await window.api.wxSelfTest({ appId: $("#sAppId").value, appSecret: $("#sAppSecret").value });
    $("#testResult").innerHTML = steps.map(([n, r]) => li(r === "ok" || /^ok/.test(r) ? "ok" : String(r).startsWith("fail") ? "bad" : "none", `${n}：${r}`)).join("");
    const allOk = steps.every(([, r]) => !String(r).startsWith("fail"));
    $("#apiChip").textContent = allOk ? "API 正常" : "API 异常";
    $("#apiChip").className = "chip " + (allOk ? "ok" : "bad");
  } catch (e) {
    $("#testResult").innerHTML = li("bad", "自检异常：" + e.message);
    $("#apiChip").textContent = "API 异常"; $("#apiChip").className = "chip bad";
  }
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

// ---------- 样式包导出/导入（分享自己的公众号样式 / 换机恢复） ----------
$("#btnThemeExport").onclick = async (e) => {
  const b = e.target; b.disabled = true;
  try {
    const r = await window.api.themeExport();
    if (r) {
      $("#themePackResult").textContent = `已导出 ${r.count} 份「我的」样式`;
      toast("样式包已保存：" + r.path);
    }
  } catch (err) { toast("导出失败：" + err.message); }
  finally { b.disabled = false; }
};
$("#btnThemeImport").onclick = async (e) => {
  const b = e.target; b.disabled = true;
  try {
    const r = await window.api.themeImport();
    if (r) {
      $("#themePackResult").textContent = `已导入 ${r.count} 份：${r.names.join("、")}` + (r.skipped.length ? `（跳过 ${r.skipped.length} 份）` : "");
      toast("样式已导入，在「默认样式」和写作页下拉里即可选" + (r.skipped.length ? "；跳过：" + r.skipped.join("；") : ""));
      await refreshThemeSelect();
      fillDefaultTheme(); renderThemes();
    }
  } catch (err) { toast("导入失败：" + err.message); }
  finally { b.disabled = false; }
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
