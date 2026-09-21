// ③无API权限账号无死角：发布页引导接线测试（清单横幅、凭证短路、提醒模式卡片、入队预告）
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = [];
const T = (n, ok, d = "") => out.push(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  [" + d + "]" : ""}`);

const pub = await readFile(path.join(root, "src/ui/js/publish.js"), "utf8");
T("横幅给四步发布清单", pub.includes("pubcheck") && pub.includes("第 1 步：去复制"));
T("清单承诺定时可用(提醒模式)", pub.includes("定时发布可用本页排队"));
T("未配凭证点存草稿/发布被短路", pub.includes("async function apiGate") && /btnToDraft[\s\S]{0,200}apiGate/.test(pub) && /btnPubNow[\s\S]{0,200}apiGate/.test(pub));
T("短路文案给正式方案+双出口", pub.includes("复制富文本」→ 公众号后台粘贴") && pub.includes("prGateCopy") && pub.includes("prGateSet"));
T("提醒模式卡片专属文案", pub.includes("到点·等你复制发布") && pub.includes("去写作页复制"));
T("提醒模式不给必败的确认/立即执行", /q\.status === "awaiting_confirm" && !q\.manual/.test(pub) && /"pending", "failed"\]\.includes/.test(pub));
T("失败卡片一键改道复制", pub.includes("改用「复制富文本」") && /querySelectorAll\("\.cp"\)/.test(pub));
T("48001失败给无权限人话", pub.includes("未认证个人订阅号常见"));
T("入队时预告提醒模式", pub.includes("到点走「提醒模式」"));
T("空队列也说明无凭证可用", pub.includes("未接微信API也能用"));

const pipe = await readFile(path.join(root, "src/main/pipeline.cjs"), "utf8");
T("流水线到点先查凭证再决定路线", /runScheduled[\s\S]{0,600}getSecrets\(\)/.test(pipe));
T("无凭证走manual提醒不抛错", /manual:\s*true/.test(pipe) && pipe.includes("未接微信API"));

const sched = await readFile(path.join(root, "src/core/scheduler.mjs"), "utf8");
T("调度器尊重执行体转态(不覆盖done)", (sched.match(/status !== "running"/g) || []).length === 2);

const css = await readFile(path.join(root, "src/ui/css/main.css"), "utf8");
T("清单样式已定义", css.includes(".pubcheck") && css.includes(".chanbanner{flex-wrap:wrap}"));

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL"));
console.log(`\n无死角引导：${out.length - failed.length}/${out.length} 通过`);
if (failed.length) process.exit(1);
