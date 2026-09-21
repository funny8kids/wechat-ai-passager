// 真实剪贴板留证（需桌面会话，手动跑：npm run qa:clipboard）
// 自备留证数据（样例图 + 带图文章）→ 起应用真实点「复制富文本」「复制此图」→ 断言落盘产物 → 清理自备数据
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(os.homedir(), "AppData", "Roaming", "gaojiang", "data");
const ASSET = "gj-qa-sample.png";
const QA_ID = "gj-qa-evidence";
const dump = path.join(os.tmpdir(), "gj-qa-clip.html");
const out = [];
const T = (n, ok, d = "") => out.push(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  [" + d + "]" : ""}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const electronExe = path.join(root, "node_modules", "electron", "dist", (await fs.readFile(path.join(root, "node_modules", "electron", "path.txt"), "utf8")).trim());

async function waitForFile(p, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const s = await fs.stat(p); if (s.size > 0) return true; } catch {}
    await wait(300);
  }
  return false;
}
async function runTab(tab) {
  await fs.rm(dump, { force: true });
  await fs.rm(dump + ".img", { force: true });
  const child = spawn(electronExe, [".", `--gj-tab=${tab}`], {
    cwd: root,
    stdio: "ignore",
    env: { ...process.env, GJ_CLIP_DUMP: dump, GJ_SHOT: path.join(os.tmpdir(), "gj-qa-clip.png"), GJ_SHOT_WAIT: "20000" },
  });
  const ok = await waitForFile(tab === "demo-copyimg" ? dump + ".img" : dump, 30_000);
  await wait(1200);
  try { child.kill(); } catch {}
  await wait(2500); // 等单实例锁释放
  return ok;
}

// ---- 自备留证数据（跑完即清理） ----
const articlesPath = path.join(DATA, "articles.json");
const original = await fs.readFile(articlesPath, "utf8");
await fs.mkdir(path.join(DATA, "assets"), { recursive: true });
await fs.writeFile(path.join(DATA, "assets", ASSET), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const arr = JSON.parse(original);
arr.unshift({ id: QA_ID, title: "【留证】带图复制自检", md: `# 带图复制留证\n\n下面这张图应随剪贴板 HTML 一起进入微信后台。\n\n![测试图](${ASSET})\n\n[图槽: 测试槽位]\n`, theme: "青竹绿", updatedAt: Date.now(), coverPath: "" });
await fs.writeFile(articlesPath, JSON.stringify(arr));

try {
  if (!(await runTab("demo-copyrich"))) {
    T("复制富文本产物落盘", false, "超时未生成 " + dump);
  } else {
    const html = await fs.readFile(dump, "utf8");
    T("复制富文本产物落盘", true, `${html.length}B`);
    T("HTML 自带 data:image 图片", /<img src="data:image\//.test(html));
    T("HTML 不含未随带提示", !html.includes("图片未随带"));
    T("HTML 保留内联样式", /style="[^"]*font-size/.test(html));
    T("HTML 无外链样式块", !/<style/.test(html));
  }
  if (!(await runTab("demo-copyimg"))) {
    T("复制此图产物落盘", false, "超时未生成 " + dump + ".img");
  } else {
    const copied = await fs.readFile(dump + ".img");
    const origin = await fs.readFile(path.join(DATA, "assets", ASSET));
    T("复制此图与原素材逐字节一致", copied.length === origin.length && copied.equals(origin), `${copied.length}B`);
  }
} finally {
  await fs.writeFile(articlesPath, original);
  await fs.rm(path.join(DATA, "assets", ASSET), { force: true });
  await fs.rm(dump, { force: true });
  await fs.rm(dump + ".img", { force: true });
}

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL"));
console.log(`\n剪贴板留证：${out.length - failed.length}/${out.length} 通过（留证数据已清理）`);
process.exit(failed.length ? 1 : 0);
