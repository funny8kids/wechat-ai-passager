// 稳定性修复的行为级测试：store 损坏备份/并发写、scheduler 卡死复位/runOne 隔离
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { JsonStore } from "../src/core/store.mjs";
import { Scheduler } from "../src/core/scheduler.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gj-stab-"));
const out = [];
const T = (n, ok, d = "") => out.push(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  [" + d + "]" : ""}`);

// --- store: 损坏文件 -> 备份 + fallback + corrupted 记录 ---
const store = new JsonStore(dir);
await fs.writeFile(path.join(dir, "articles.json"), "{broken json,,,", "utf8");
const fb = await store.load("articles", []);
T("损坏JSON返回fallback而非崩溃", Array.isArray(fb) && fb.length === 0);
T("损坏文件名记入corrupted", store.corrupted.includes("articles"), store.corrupted.join());
const bads = (await fs.readdir(dir)).filter((f) => f.startsWith("articles.json.corrupted-"));
T("损坏原文已备份为.corrupted-*", bads.length === 1, bads.join());
const bak = await fs.readFile(path.join(dir, bads[0]), "utf8");
T("备份内容与损坏原文一致", bak.includes("broken json"));

// --- store: 并发 save 不产生半截 JSON ---
await Promise.all(Array.from({ length: 12 }, (_, i) => store.save("queue", { seq: i, pad: "x".repeat(2000) })));
const q = await store.load("queue", null);
T("并发写12次后文件仍是合法JSON", q && typeof q.seq === "number" && q.pad.length === 2000);
const leftovers = (await fs.readdir(dir)).filter((f) => f.endsWith(".tmp"));
T("无残留.tmp文件", leftovers.length === 0, leftovers.join());

// --- scheduler: running 卡死任务启动时复位为 failed ---
const s2 = new JsonStore(path.join(dir, "s"));
await s2.save("queue", [
  { id: "a1", status: "running", title: "卡死任务" },
  { id: "a2", status: "pending", title: "正常任务", publishAt: Date.now() + 9999999 },
]);
const events = [];
let execCalls = [];
const sch = new Scheduler(s2, async (t) => { execCalls.push(t.id); }, (e) => events.push(e.type));
await sch.recoverStuck();
const after = await s2.load("queue", []);
T("卡死running复位为failed", after.find((t) => t.id === "a1").status === "failed");
T("复位带可操作错误信息", /中断|重试/.test(after.find((t) => t.id === "a1").error || ""));
T("复位事件已通知", events.includes("scheduler-recovered"));

// --- scheduler: runOne 只执行指定任务，失败显形并可再跑 ---
execCalls = []; events.length = 0;
await sch.runOne("a1");
T("runOne只跑目标任务", execCalls.length === 1 && execCalls[0] === "a1", execCalls.join());
T("runOne成功后状态done", (await s2.load("queue", [])).find((t) => t.id === "a1").status === "done");
const sch2 = new Scheduler(s2, async (t) => { if (t.id === "a2") throw new Error("微信炸了48001"); }, (e) => events.push(e.type));
try { await sch2.runOne("a2"); T("runOne失败要向上抛", false); }
catch (e) { T("runOne失败要向上抛", /48001/.test(e.message)); }
const a2 = (await s2.load("queue", [])).find((t) => t.id === "a2");
T("失败任务状态failed且带错误", a2.status === "failed" && a2.error.includes("48001"));
T("失败不影响其它任务状态", (await s2.load("queue", [])).find((t) => t.id === "a1").status === "done");

// --- tick 不再吞错：executor 抛错时 notify 收到 publish-failed ---
events.length = 0;
await s2.save("queue", [{ id: "b1", status: "pending", publishAt: Date.now() - 1, autoRetry: false }]);
const sch3 = new Scheduler(s2, async () => { throw new Error("boom"); }, (e) => events.push(e.type));
await sch3.tick();
T("tick失败发publish-failed事件", events.includes("publish-failed"), events.join());

console.log(out.join("\n"));
const fails = out.filter((l) => l.startsWith("FAIL")).length;
console.log(`\n结果: ${out.length - fails}/${out.length} 通过`);
await fs.rm(dir, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
