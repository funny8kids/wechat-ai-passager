// 发布终态轮询器行为测试：用假 wxClient/store/scheduler 真实执行 pipeline.startStatusPoller
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createPipeline } = require("../src/main/pipeline.cjs");

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? (pass++, console.log("PASS " + name + (extra ? "  [" + extra + "]" : ""))) : (fail++, console.log("FAIL " + name + "  " + extra)); };

function mk({ queue, statusResp, clientErr }) {
  const updates = [];
  const notes = [];
  let clientCalls = 0;
  const store = { dir: "x", load: async () => queue, save: async () => {} };
  const services = { store, getSettings: async () => ({}), renderHtml: async () => "", wxClient: async () => {
    if (clientErr) throw new Error(clientErr);
    clientCalls++;
    return { publishStatus: async (id) => ({ publish_status: statusResp.status, article_id: "ART_" + id, ...statusResp }) };
  } };
  const sch = { update: async (id, patch) => { updates.push({ id, patch }); } };
  const p = createPipeline({ lib: {}, services, getScheduler: () => sch, notify: (t, b) => notes.push([t, b]) });
  p.startStatusPoller(10);
  return { updates, notes, clientCalls: () => clientCalls, p };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) 发布成功(0)：回写终态 + 系统通知
{
  const q = [{ id: "t1", title: "A", publishId: "P1", status: "done" }];
  const h = mk({ queue: q, statusResp: { status: 0 } });
  await sleep(120);
  const u = h.updates.find((x) => x.id === "t1");
  ok(u && u.patch.pubStatus === "✓ 发布成功" && u.patch.pubFinal === true, "状态0→回写「✓ 发布成功」且终态", JSON.stringify(u?.patch));
  ok(h.notes.some(([t]) => t.includes("发布终态")), "终态触发系统通知");
}
// 2) 审核中(1)：非终态，不通知，下轮继续查
{
  const q = [{ id: "t2", title: "B", publishId: "P2", status: "done" }];
  const h = mk({ queue: q, statusResp: { status: 1 } });
  await sleep(120);
  const u = h.updates.filter((x) => x.id === "t2");
  ok(u.length && u[0].patch.pubFinal === false, "状态1→非终态等待下轮", JSON.stringify(u[0]?.patch));
  ok(!h.notes.length, "非终态不发通知");
  ok(u.length >= 2, "非终态下轮继续查询", `查询${u.length}次`);
}
// 3) 审核不通过(4)：终态+文案
{
  const q = [{ id: "t4", title: "D", publishId: "P4", status: "done" }];
  const h = mk({ queue: q, statusResp: { status: 4 } });
  await sleep(120);
  ok(h.updates[0]?.patch.pubStatus === "✗ 平台审核不通过" && h.updates[0]?.patch.pubFinal === true, "状态4→审核不通过终态");
}
// 4) 无 publishId 的任务不触发查询
{
  const q = [{ id: "t5", title: "E", status: "pending" }];
  const h = mk({ queue: q, statusResp: { status: 0 } });
  await sleep(120);
  ok(h.clientCalls() === 0 && !h.updates.length, "无 publishId：零查询零回写");
}
// 5) 已终态(pubFinal)不再重复查
{
  const q = [{ id: "t6", title: "F", publishId: "P6", status: "done", pubFinal: true, pubStatus: "✓ 发布成功" }];
  const h = mk({ queue: q, statusResp: { status: 0 } });
  await sleep(120);
  ok(h.clientCalls() === 0, "已终态任务不再查询");
}
// 6) 凭证缺失：回写 pubError 显形，不抛崩
{
  const q = [{ id: "t7", title: "G", publishId: "P7", status: "done" }];
  const h = mk({ queue: q, clientErr: "未配置 AppID / AppSecret（设置 → 公众号）", statusResp: { status: 0 } });
  await sleep(120);
  ok(h.updates.some((x) => /AppID/.test(x.patch.pubError || "")), "凭证缺失→pubError 显形", JSON.stringify(h.updates[0]?.patch));
}
// 7) 查询接口报错：pubError 记录且保留非终态（下轮重试）
{
  const q = [{ id: "t8", title: "H", publishId: "P8", status: "done" }];
  const store = { dir: "x", load: async () => q, save: async () => {} };
  const updates = [];
  const services = { store, getSettings: async () => ({}), renderHtml: async () => "", wxClient: async () => ({ publishStatus: async () => { throw Object.assign(new Error("40001 token失效"), { wxcode: 40001 }); } }) };
  createPipeline({ lib: {}, services, getScheduler: () => ({ update: async (id, patch) => updates.push({ id, patch }) }), notify: () => {} }).startStatusPoller(10);
  await sleep(120);
  ok(updates.some((x) => /40001/.test(x.patch.pubError || "")) && !updates.some((x) => x.patch.pubFinal === true), "接口报错→记录错误且不误判终态");
}

console.log(`\n结果: ${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);
