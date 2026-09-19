// 终验脚本：真实走一遍应用生成链路，验证文章质量与系统设计
// 用法: GJ_AI_KEY=xxx node scripts/verify-article.mjs [选题]
import { AIClient, AI_TASKS, buildRewriteMessages } from "../src/core/ai.mjs";
import { renderWeChatHtml } from "../src/core/md2wechat.mjs";

const KEY = process.env.GJ_AI_KEY;
if (!KEY) { console.error("缺少 GJ_AI_KEY"); process.exit(1); }
const client = new AIClient({ baseUrl: "https://api.deepseek.com/v1", apiKey: KEY, model: "deepseek-v4-pro" });
const TOPIC = process.argv[2] || "用AI写公众号文章这件事，我踩过的三个坑";

/* —— 与应用 renderer 完全相同的体检算法 —— */
const CLICHES = ["总而言之", "综上所述", "值得注意的是", "不难发现", "赋能", "闭环", "抓手", "无独有偶", "在这个快节奏的时代", "在这个信息爆炸", "首先", "其次", "最后", "不仅", "而且", "与此同时", "更重要的是", "可以说"];
function score(md) {
  const hits = CLICHES.filter((c) => md.includes(c));
  const sentences = md.split(/[。！？!?；\n]/).map((s) => s.trim()).filter((s) => s.length > 3);
  const lens = sentences.map((s) => s.length);
  const mean = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / (lens.length || 1));
  const evenness = mean > 0 ? Math.max(0, 1 - sd / mean) : 0;
  const enumHits = (md.match(/(第一[，,]|第二[，,]|第三[，,])/g) || []).length;
  return { total: Math.min(100, Math.round(hits.length * 8 + evenness * 45 + enumHits * 6)), hits, evenness: Math.round(evenness * 100), enumHits };
}
const ok = (b) => b ? "PASS" : "FAIL";
const checks = [];
const T = (name, pass, detail = "") => checks.push({ name, pass, detail });

// ===== 1. 生成初稿（同 ai:draft）=====
console.log(">>> [1/5] AI 生成初稿:", TOPIC);
const draft = await client.chat(
  [{ role: "system", content: AI_TASKS.生成初稿 }, { role: "user", content: `选题：${TOPIC}\n要求：1200字左右，第一人称经验贴口吻，含具体数字和场景细节` }],
  { temperature: 0.8 }
);

T("初稿非空且篇幅达标(>800字)", draft.length > 800, `${draft.length} 字`);
const slotRe = /\[图槽:[^\]]{4,60}\]/g;
const slots = draft.match(slotRe) || [];
T("含图槽标记(≥2个)", slots.length >= 2, `图槽 ${slots.length} 个`);
T("图槽带配图意图(非空)", slots.every((s) => s.replace(/\[图槽:\s*|\]/g, "").trim().length >= 6));
// 位置合理性：不在文首第一段、不连续两个叠放
const paras = draft.split(/\n{2,}/);
const slotIdx = paras.map((p, i) => slotRe.test(p) ? (slotRe.lastIndex = 0, i) : -1).filter((i) => i >= 0);
T("图槽未在开头两段", slotIdx.every((i) => i >= 2), `槽位段落索引: ${slotIdx.join(",")}`);
T("图槽无连续叠放", slotIdx.every((i, k) => k === 0 || i - slotIdx[k - 1] > 1));
T("图槽意图具体(含场景词)", slots.some((s) => /[人在路桌屏幕窗街店]|特写|视角|画面/.test(s)), slots.slice(0, 3).join(" / ").slice(0, 120));

// ===== 2. 体检评分 =====
console.log(">>> [2/5] 初稿体检:", JSON.stringify(score(draft)));
const s0 = score(draft);

// ===== 3. 段落级回炉（HITL：只改命中段落，其余必须一字不动）=====
console.log(">>> [3/5] 段落级去AI味回炉");
const blocks = draft.split(/\n{2,}/);
const flagged = [];
for (let i = 0; i < blocks.length; i++) {
  const b = blocks[i];
  if (b.length > 60 && score(b).total > 30) flagged.push(i);
}
const before = blocks.map((b) => b);
for (const i of flagged.slice(0, 6)) {
  blocks[i] = (await client.chat(buildRewriteMessages("去AI味", blocks[i], ""))).trim();
}
const md2 = blocks.join("\n\n");
const s2 = score(md2);
const untouchedSame = before.length === blocks.length && before.every((b, i) => flagged.includes(i) || b === blocks[i]);
T("回炉仅改命中段落，未标记段落零改动", flagged.length === 0 || untouchedSame, `命中${flagged.length}段, 改动${blocks.filter((b, i) => b !== before[i]).length}段`);
T("回炉后AI味分下降", s2.total <= s0.total, `初稿 ${s0.total} → 回炉后 ${s2.total}（套话${s0.hits.length}→${s2.hits.length}, 均匀度${s0.evenness}%→${s2.evenness}%）`);
T("回炉后AI味≤55(可用线)", s2.total <= 55, `当前 ${s2.total}`);
T("回炉后图槽仍在", (md2.match(slotRe) || []).length >= 2);

// ===== 4. 双主题渲染 =====
console.log(">>> [4/5] 渲染两主题");
const htmlA = renderWeChatHtml(md2, "青竹绿", {});
const htmlB = renderWeChatHtml(md2, "暖橙手账", {});
T("青竹绿渲染成功", htmlA.length > md2.length * 0.5, `${htmlA.length} 字节`);
T("暖橙手账渲染成功且样式不同", htmlB.length > 1000 && htmlA !== htmlB);
T("全内联样式(无class依赖)", /style="/.test(htmlA) && !/<link|@import|<style/.test(htmlA));
T("图槽渲染为虚线占位chip", /虚线|图槽/.test(htmlA) && /border:\s*[^"]*dashed/.test(htmlA));
T("无脚本注入", !/<script/i.test(htmlA));

// 自定义样式（用户存的公众号样式 → themeOverride）
const htmlC = renderWeChatHtml(md2, "青竹绿", { themeOverride: { accent: "#7c3aed", heading: "#2e1065", body: "#1f2937", quote: "#6b7280", quoteBg: "#f5f3ff", border: "#e9d5ff", fontSize: 17, lineHeight: 1.9, letterSpacing: 0.6 } });
T("自定义样式覆盖生效(色/字号/行距)", htmlC.includes("#7c3aed") && htmlC.includes("font-size:17px") && htmlC.includes("line-height:1.9"));
T("自定义与内置互不污染", htmlA !== htmlC && !htmlA.includes("#7c3aed"));

// 外链→角注
const withLink = "测试段落文字。\n\n参考：[官方文档](https://developers.weixin.qq.com/doc)\n\n![本地图](myimg1)";
const htmlL = renderWeChatHtml(withLink, "青竹绿", { imgMap: { myimg1: "https://mmbiz.qpic.cn/test/x.png" } });
T("正文外链转文末角注", htmlL.includes("参考链接") || /\[\d+\]/.test(htmlL), "");
T("本地图映射为CDN地址", htmlL.includes("mmbiz.qpic.cn"));

// ===== 5. 摘要/封面可用性 =====
const titleLine = (md2.match(/^#{1,2}\s+(.+)$/m) || [])[1] || "";
T("有可提取标题(≤64字)", !!titleLine && titleLine.length <= 64, titleLine);
const digest = md2.replace(/[#>*!\[\]()（）\s\[图槽:[^\]]+\]/g, "").slice(0, 100);
T("摘要自动生成非空", digest.length >= 40, digest.slice(0, 50) + "…");

// ===== 报告 =====
console.log("\n========== 验证报告 ==========");
let fail = 0;
for (const c of checks) { if (!c.pass) fail++; console.log(`${ok(c.pass)}  ${c.name}${c.detail ? "  [" + c.detail + "]" : ""}`); }
console.log("结果: " + (checks.length - fail) + "/" + checks.length + " 通过");
console.log("AI味评分: 初稿", s0.total, "→ 回炉后", s2.total);
if (fail === 0) {
  const { default: fsSync } = await import("node:fs");
  const file = process.env.APPDATA + "\\gaojiang\\data\\articles.json";
  const list = fsSync.existsSync(file) ? JSON.parse(fsSync.readFileSync(file, "utf8")) : [];
  list.unshift({ id: "verify-" + Date.now().toString(36), title: titleLine, md: md2, theme: "青竹绿", updatedAt: Date.now(), coverPath: "" });
  fsSync.writeFileSync(file, JSON.stringify(list, null, 2));
  console.log("已写入应用文章列表:", file);
}
console.log("\n---- 生成文章(回炉后) ----\n");
console.log(md2);
process.exit(fail ? 2 : 0);
