/* 多智能体成稿向导：选题→调研→大纲→初稿→回炉→审核
 * HITL 铁律：AI 每一步的输出先进向导文本框，由你编辑/重做/跳过，点「确认」才算数；定稿也要你手动保存 */
"use strict";

const WIZ_STEPS = [
  { name: "选题", run: "（本步手写）", desc: "写下选题或一句话方向，可补充读者对象、你想立的观点。热点面板「用此选题」会自动带过来。", manual: true },
  { name: "调研", run: "调研 Agent 执行", desc: "AI 给切入角度、需要你核实/补充的事实清单、要避开的俗套。改完点确认。", agent: "调研" },
  { name: "大纲", run: "大纲 Agent 执行", desc: "AI 按「选题+调研笔记」列大纲，需要你的个人经历处会标【要素材：…】——那些位置最好你来写。", agent: "大纲" },
  { name: "初稿", run: "初稿 Agent 执行", desc: "按大纲生成整篇 Markdown（含 [图槽] 占位）。生成后可继续在本框里改，也可回上一步改大纲再重来。", draft: true },
  { name: "回炉", run: "去AI味回炉", desc: "改写 Agent 只处理初稿：删套话、拆排比、句长打散。不满意点「恢复原稿」。", rewrite: true },
  { name: "审核", run: "审核 Agent 执行", desc: "审核 Agent 指出疑似编造内容、平台敏感表达、AI 味最重处。确认后定稿送入编辑器，保存与发布仍由你操作。", agent: "审核" },
];

let wizStep = 0, wizData = [], wizDone = [], wizRunning = false, wizBefore = "";

function wizHint(msg, bad) {
  const el = $("#wizHint");
  el.textContent = msg;
  el.style.color = bad ? "var(--err)" : "";
}

function wizOpen() {
  const t = $("#fTitle").value.trim();
  wizStep = 0; wizData = []; wizDone = []; wizRunning = false; wizBefore = "";
  if (t) wizData[0] = "选题：" + t;
  $("#wiz").hidden = false;
  wizRender();
}
function wizClose() { $("#wiz").hidden = true; }

function wizCommit() {
  const v = $("#wizOut").value;
  if (v.trim()) { wizData[wizStep] = v; if (!wizDone.includes(wizStep)) wizDone.push(wizStep); }
}

function wizRender() {
  const nav = $("#wizSteps");
  nav.innerHTML = "";
  WIZ_STEPS.forEach((s, i) => {
    const b = document.createElement("button");
    b.className = "wstep" + (i === wizStep ? " on" : "") + (wizDone.includes(i) && i !== wizStep ? " done" : "");
    b.textContent = `${i + 1} ${s.name}`;
    b.title = wizDone.includes(i) ? "已确认，点击可回来修改" : "点击跳转到这一步";
    b.onclick = () => { if (!wizRunning) wizJump(i); };
    nav.appendChild(b);
  });
  const s = WIZ_STEPS[wizStep];
  $("#wizDesc").textContent = s.desc;
  $("#wizOut").value = wizData[wizStep] || "";
  $("#wizRunLabel").textContent = s.manual ? "本步手写" : s.name;
  $("#wizRun").disabled = wizRunning || !!s.manual;
  $("#wizRun .ic").style.visibility = s.manual ? "hidden" : "";
  $("#wizRestore").hidden = !(s.rewrite && wizBefore);
  $("#wizNext").textContent = wizStep === WIZ_STEPS.length - 1 ? "定稿，送入编辑器" : "确认并进入下一步 →";
  wizHint(wizRunning ? s.name + " Agent 正在工作，可直接阅读上方输出…" : "");
}

function wizJump(i) {
  if (i === wizStep) return;
  wizCommit();
  wizStep = i;
  wizRender();
}

async function wizRun() {
  if (wizRunning) return;
  const s = WIZ_STEPS[wizStep];
  if (s.manual) return;
  wizCommit();
  const topic = wizData[0] || "";
  if (wizStep > 0 && !topic) { wizJump(0); return wizHint("先完成第 1 步：选题", true); }
  if (s.rewrite && !(wizData[3] || "").trim()) return wizHint("没有初稿可回炉——先执行「初稿」步，或跳过本步", true);

  wizRunning = true;
  wizRender();
  try {
    let out = "";
    if (s.agent === "调研") {
      out = (await window.api.aiAgent("调研", topic)).text;
    } else if (s.agent === "大纲") {
      out = (await window.api.aiAgent("大纲", topic + "\n\n## 调研笔记\n" + ((wizData[1] || "").trim() || "（作者跳过了调研）"))).text;
    } else if (s.agent === "审核") {
      const draft = (wizData[4] || wizData[3] || wizData[2] || "").trim();
      if (!draft) throw new Error("没有可审核的正文");
      out = (await window.api.aiAgent("审核", draft)).text;
    } else if (s.draft) {
      const mats = await window.api.getMaterials();
      const matHint = mats.length ? `\n\n可自然融入的作者真实素材（选1-2条，勿堆砌）：\n${mats.slice(0, 8).map((m) => `- [${m.type}] ${m.text}`).join("\n")}` : "";
      out = (await window.api.aiDraft(topic + "\n\n## 大纲\n" + ((wizData[2] || "").trim() || "（无大纲，自行组织结构）") + matHint)).text;
    } else if (s.rewrite) {
      wizBefore = wizData[3];
      out = (await window.api.aiRewrite("去AI味", wizData[3], "")).text;
    }
    if (!out || !out.trim()) throw new Error("Agent 返回为空，可重试");
    wizData[wizStep] = out;
    if (!wizDone.includes(wizStep)) wizDone.push(wizStep);
    $("#wizOut").value = out;
    wizHint("✓ 输出已就绪——直接在上方编辑修改，满意后点确认");
  } catch (e) {
    wizHint("失败：" + e.message, true);
  } finally {
    wizRunning = false;
    $("#wizRun").disabled = false;
  }
}

function wizRestore() {
  if (!wizBefore) return;
  wizData[wizStep] = wizBefore;
  $("#wizOut").value = wizBefore;
  wizBefore = "";
  $("#wizRestore").hidden = true;
  wizHint("已恢复回炉前的初稿");
}

async function wizNext() {
  if (wizRunning) return;
  wizCommit();
  if (!(wizData[wizStep] || "").trim()) {
    return wizHint("本步还是空的：写点内容、执行本步，或点「跳过本步」", true);
  }
  if (wizStep === WIZ_STEPS.length - 1) return wizFinish();
  wizStep++;
  wizRender();
}

function wizSkip() {
  if (wizRunning) return;
  wizData[wizStep] = "";
  wizDone = wizDone.filter((i) => i !== wizStep);
  if (wizStep === WIZ_STEPS.length - 1) return wizFinish();
  wizStep++;
  wizRender();
}

function wizFinish() {
  wizCommit();
  const md = String(wizData[4] || wizData[3] || "").trim();
  newArticle();
  const heading = (md.match(/^#{1,2}\s+(.+)$/m) || [])[1] || "";
  const fromTopic = String(wizData[0] || "").replace(/^\s*选题[：:]\s*/, "").split("\n")[0].trim();
  $("#fTitle").value = (heading || fromTopic || "未命名成稿").slice(0, 64);
  $("#editor").value = md;
  markDirty(); renderPreview(); renderBlocks(); updateScore();
  wizClose();
  toast(md ? "成稿已送入编辑器（含审核意见在向导记录里）——人工过目后再保存/发布" : "向导结束：未产出正文", "保存", () => saveCur(true));
}

$("#btnWizard").addEventListener("click", wizOpen);
$("#wizRun").addEventListener("click", wizRun);
$("#wizRestore").addEventListener("click", wizRestore);
$("#wizNext").addEventListener("click", wizNext);
$("#wizSkip").addEventListener("click", wizSkip);
$("#wizAbort").addEventListener("click", () => {
  if (wizRunning) return;
  if ((wizData[3] || "").trim() && !confirm("退出向导？本向导生成的内容不会进入编辑器")) return;
  wizClose();
});
