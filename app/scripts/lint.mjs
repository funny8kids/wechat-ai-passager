// 语法门禁：对全部 .cjs / .mjs / ui 下的 .js 执行 node --check
// 背景：曾因渲染层一个多余括号导致整站 JS 静默失效（GUI 只剩静态壳），此脚本防止同类事故
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "release") continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(cjs|mjs|js)$/.test(name)) files.push(p);
  }
}
walk(ROOT);

let fail = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
    console.log("OK   " + path.relative(ROOT, f));
  } catch (e) {
    fail++;
    console.error("FAIL " + path.relative(ROOT, f) + "\n" + e.stderr.toString().split("\n").slice(0, 4).join("\n"));
  }
}
console.log(fail ? `\n${fail} 个文件语法错误` : `\n全部 ${files.length} 个文件语法通过`);
process.exit(fail ? 1 : 0);
