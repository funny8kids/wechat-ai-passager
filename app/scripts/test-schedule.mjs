// 定时发布执行体（pipeline.runScheduled / buildDraftPayload）行为测试：mock 微信客户端，真实跑流水线逻辑
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createPipeline } = require("../src/main/pipeline.cjs");

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? (pass++, console.log("PASS " + name + (extra ? "  [" + extra + "]" : ""))) : (fail++, console.log("FAIL " + name + "  " + extra)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gj-pipe-"));
await fs.mkdir(path.join(dir, "assets"), { recursive: true });
await fs.writeFile(path.join(dir, "assets", "pic1.png"), Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"));

function mk({ article, settings = {}, clientOver = {}, secrets = { appId: "wx1", appSecret: "s1" } }) {
  const calls = { uploads: [], drafts: [], publishes: [], thumbs: [] };
  const updates = [];
  const notes = [];
  const client = {
    uploadContentImage: async (buf, name) => { calls.uploads.push(name); return "https://mmbiz.qpic.cn/cdn/" + name; },
    uploadThumb: async (buf, name) => { calls.thumbs.push(name); return "THUMB_MID"; },
    addDraft: async (p) => { calls.drafts.push(p); return "DRAFT_MID_1"; },
    publish: async (mid) => { calls.publishes.push(mid); return "PUB_ID_9"; },
    ...clientOver,
  };
  const services = {
    store: { dir, load: async (name) => (name === "articles" ? (article ? [article] : []) : []), save: async () => {} },
    getSettings: async () => settings,
    getSecrets: async () => secrets,
    wxClient: async () => client,
    renderHtml: async (md, theme, opts = {}) => { calls.renderOpts = opts; return "<div>" + (opts.imgMap?.["pic1.png"] || "") + "</div>"; },
  };
  const sch = { update: async (id, patch) => updates.push({ id, ...patch }) };
  const p = createPipeline({ lib: {}, services, getScheduler: () => sch, notify: (t, b) => notes.push([t, b]) });
  return { p, calls, updates, notes };
}

// 1) 本地图转存 CDN、外链不转存、封面自动取首图
{
  const art = { id: "a1", title: "T", md: "正文\n\n![图一](pic1.png)\n\n![外链](https://ex.com/a.png)", theme: "青竹绿" };
  const h = mk({ article: art });
  const r = await h.p.saveDraft(art);
  ok(h.calls.uploads.length === 1 && h.calls.uploads[0] === "pic1.png", "仅本地图转存，外链跳过", h.calls.uploads.join());
  ok(r.draftMediaId === "DRAFT_MID_1" && h.calls.drafts[0].html.includes("mmbiz.qpic.cn/cdn/pic1.png"), "草稿HTML里本地图已换成CDN地址");
  ok(h.calls.thumbs.length === 1 && h.calls.drafts[0].thumbMediaId === "THUMB_MID", "首图自动作为封面上传");
}
// 2) 缺封面显式报错
{
  const art = { id: "a2", title: "T", md: "纯文字没有图", theme: "青竹绿" };
  const h = mk({ article: art });
  await h.p.saveDraft(art).then(() => ok(false, "缺封面应报错"), (e) => ok(/封面/.test(e.message), "缺封面→明确报错不静默", e.message));
}
// 3) 超 1MB 图片直接失败（不上传必挂的图）
{
  const big = path.join(dir, "assets", "big.png");
  await fs.writeFile(big, Buffer.alloc(960_001));
  const art = { id: "a3", title: "T", md: "![大](big.png)", theme: "青竹绿" };
  const h = mk({ article: art });
  await h.p.saveDraft(art).then(() => ok(false, "超限图应报错"), (e) => ok(/1MB/.test(e.message), "超1MB图→明确报限制", e.message));
  await fs.rm(big, { force: true });
}
// 4) mode=draft：到点只推草稿箱 + 通知，不发布
{
  const art = { id: "a4", title: "草稿任务", md: "![图](pic1.png)", theme: "青竹绿" };
  const h = mk({ article: art });
  await h.p.runScheduled({ id: "t4", articleId: "a4", mode: "draft" });
  ok(h.updates.some((u) => u.draftMediaId === "DRAFT_MID_1") && h.calls.publishes.length === 0, "draft模式：只入草稿箱不发布");
  ok(h.notes.some(([t]) => t.includes("草稿箱")), "draft模式：系统通知已发");
}
// 5) confirmBeforePublish 且未放行 → awaiting_confirm，不自动发
{
  const art = { id: "a5", title: "待放行", md: "![图](pic1.png)", theme: "青竹绿" };
  const h = mk({ article: art, settings: { confirmBeforePublish: true } });
  await h.p.runScheduled({ id: "t5", articleId: "a5", mode: "publish" });
  ok(h.updates.some((u) => u.status === "awaiting_confirm") && h.calls.publishes.length === 0, "到点先等人工放行，不自动发布");
  ok(h.notes.some(([t, b]) => (t + b).includes("放行")), "放行提醒已通知");
}
// 6) 已放行 → 草稿+发布全链路，publishId 回写
{
  const art = { id: "a6", title: "放行后", md: "![图](pic1.png)", theme: "青竹绿" };
  const h = mk({ article: art, settings: { confirmBeforePublish: true } });
  await h.p.runScheduled({ id: "t6", articleId: "a6", mode: "publish", confirmed: true });
  ok(h.calls.publishes[0] === "DRAFT_MID_1", "放行后：用刚建的草稿执行发布");
  ok(h.updates.some((u) => u.publishId === "PUB_ID_9" && u.draftMediaId === "DRAFT_MID_1"), "publishId+draftMediaId 回写任务（供终态轮询）");
}
// 7) 关联文章被删 → 明确报错
{
  const h = mk({ article: null });
  await h.p.runScheduled({ id: "t7", articleId: "gone", mode: "publish" }).then(() => ok(false, "文章删除应报错"), (e) => ok(/已删除/.test(e.message), "文章被删→报错进任务failed", e.message));
}
// 8) 未配微信凭证 → 到点转「提醒模式」：awaiting_confirm+manual，不碰API、不报错
{
  const art = { id: "a8", title: "无凭证定时", md: "![图](pic1.png)", theme: "青竹绿" };
  const h = mk({ article: art, secrets: {} });
  await h.p.runScheduled({ id: "t8", articleId: "a8", mode: "publish" });
  ok(h.updates.some((u) => u.status === "awaiting_confirm" && u.manual === true), "无凭证到点→提醒模式(awaiting_confirm+manual)");
  ok(h.calls.drafts.length === 0 && h.calls.publishes.length === 0, "无凭证：不发起任何微信API调用");
  ok(h.notes.some(([t, b]) => t.includes("未接微信API") && b.includes("复制")), "提醒通知指路「复制富文本」");
}
// 9) 调度器不得覆盖执行体的转态（awaiting_confirm 被冲成 done 曾是真实缺陷）
{
  const { Scheduler } = await import("../src/core/scheduler.mjs");
  let tasks = [{ id: "s1", status: "pending", publishAt: Date.now() - 1000 }];
  const store = { load: async () => tasks.map((t) => ({ ...t })), save: async (name, data) => { tasks = data; } };
  const sch = new Scheduler(store, async (t) => { await sch.update(t.id, { status: "awaiting_confirm", manual: true }); }, () => {});
  await sch.tick();
  ok(tasks[0].status === "awaiting_confirm" && tasks[0].manual === true, "tick：执行体转awaiting_confirm后不被覆盖成done", tasks[0].status);
  const sch2 = new Scheduler(store, async (t) => { await sch2.update(t.id, { status: "awaiting_confirm" }); }, () => {});
  tasks = [{ id: "s2", status: "failed", publishAt: Date.now() - 1000 }];
  await sch2.runOne("s2");
  ok(tasks[0].status === "awaiting_confirm", "runOne：同样尊重执行体转态", tasks[0].status);
}

// 10) 错过显形：大幅迟到的 publish 任务不擅自补发 → awaiting_confirm+late；draft 照补
{
  const art = { id: "a10", title: "迟到的发布", md: "![图](pic1.png)", theme: "青竹绿" };
  const h = mk({ article: art });
  await h.p.runScheduled({ id: "t10", articleId: "a10", mode: "publish", publishAt: Date.now() - 40 * 60_000 });
  ok(h.updates.some((u) => u.status === "awaiting_confirm" && u.late === true), "错过40分钟→等用户决定(late)，不擅自补发");
  ok(h.calls.publishes.length === 0, "错过时零发布调用");
  ok(h.notes.some(([t, b]) => t.includes("错过") && b.includes("仍要发布")), "错过通知给出补救选项");
  const h2 = mk({ article: { ...art, id: "a10b", title: "迟到的草稿" } });
  await h2.p.runScheduled({ id: "t10b", articleId: "a10b", mode: "draft", publishAt: Date.now() - 40 * 60_000 });
  ok(h2.calls.drafts.length === 1 && !h2.updates.some((u) => u.late), "draft迟到无风险：照常补进草稿箱");
  const h3 = mk({ article: art });
  await h3.p.runScheduled({ id: "t10c", articleId: "a10", mode: "publish", publishAt: Date.now() - 2 * 60_000 });
  ok(h3.calls.publishes.length === 1, "小幅延迟(≤10分钟)视为正常执行，不误伤");
}

console.log(`\n结果: ${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);
