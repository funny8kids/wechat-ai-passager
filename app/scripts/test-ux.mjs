// ⑤UX超越项：8套内置主题真实渲染 + 样式包接线 + 首启样例 + Ctrl+S
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = [];
const T = (n, ok, d = "") => out.push(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  [" + d + "]" : ""}`);

const { BUILTIN_THEMES, renderWeChatHtml } = await import("../src/core/md2wechat.mjs");
const names = Object.keys(BUILTIN_THEMES);
T("内置主题≥8套(对标mdnice/墨滴的样式量级)", names.length >= 8, names.join("/"));
T("每套主题六色齐全", names.every((n) => ["accent", "heading", "body", "quote", "quoteBg", "border"].every((k) => /^#[0-9a-fA-F]{6}$/.test(BUILTIN_THEMES[n][k]))));
{
  const md = "## 标题\n\n正文**加粗**与==高亮==\n\n> 引用一行\n\n- 列表\n";
  const accents = new Set();
  let allOk = true;
  for (const n of names) {
    const h = renderWeChatHtml(md, n, {});
    if (!h.includes(BUILTIN_THEMES[n].accent) || !h.includes("style=")) allOk = false;
    accents.add(BUILTIN_THEMES[n].accent);
  }
  T("全部主题真实渲染且各用各的强调色", allOk && accents.size === names.length, `${accents.size}/${names.length} 色`);
  T("未知主题名回落默认不崩", renderWeChatHtml(md, "不存在的主题", {}).includes(BUILTIN_THEMES["青竹绿"].accent));
}

const boot = await readFile(path.join(root, "src/ui/js/boot.js"), "utf8");
T("首启空库自动种示例文章", /!articles\.length && !settings\.sampleSeeded/.test(boot) && boot.includes("seedSample()"));
T("示例只种一次(sampleSeeded落库)", boot.includes("sampleSeeded: true") && boot.includes("saveArticle"));
T("示例文章演示全元素", boot.includes("[图槽:") && boot.includes("==高亮==") && boot.includes("复制富文本") && boot.includes("暮山紫") && boot.includes("Markdown 表格直接渲染") && boot.includes("~~删除线~~") && boot.includes("- [ ]"));
T("示例明示可删(HITL)", boot.includes("改它或删它"));
T("种样例失败不阻塞启动", /catch \{[\s\S]{0,40}示例/.test(boot));

const ed = await readFile(path.join(root, "src/ui/js/editor.js"), "utf8");
const wb = await readFile(path.join(root, "src/ui/js/workbench.js"), "utf8");
T("Ctrl+S即存且全局唯一注册(对标同类肌肉记忆)", /ctrlKey[\s\S]{0,160}["']s["'][\s\S]{0,80}saveCur\(\)/.test(wb) && !/keydown[\s\S]{0,160}saveCur/.test(ed), "编辑器快捷键统一在 workbench");
T("打开已存文章即显已保存(首启不假告警)", ed.includes('st.textContent = "已保存 " + fmtTime(cur.updatedAt)'));

const html = await readFile(path.join(root, "src/ui/index.html"), "utf8");
T("样式卡有导出/导入按钮与结果位", html.includes("btnThemeExport") && html.includes("btnThemeImport") && html.includes("themePackResult"));

const set = await readFile(path.join(root, "src/ui/js/settings.js"), "utf8");
T("导出按钮接线", /#btnThemeExport[\s\S]{0,500}themeExport\(\)/.test(set));
T("导入后刷新样式目录/默认下拉/列表", /#btnThemeImport[\s\S]{0,900}themeImport\(\)[\s\S]{0,900}refreshThemeSelect\(\)[\s\S]{0,200}fillDefaultTheme\(\)[\s\S]{0,200}renderThemes\(\)/.test(set));
T("导入跳过项如实告知", set.includes("跳过："));

const preload = await readFile(path.join(root, "src/preload/index.cjs"), "utf8");
T("preload暴露themeExport/Import", preload.includes("themeExport") && preload.includes("themeImport"));

const ipc = await readFile(path.join(root, "src/main/ipc.cjs"), "utf8");
T("IPC注册themes:export/import", ipc.includes('"themes:export"') && ipc.includes('"themes:import"'));
T("空自定义库导出先指路", ipc.includes("还没有自定义样式"));
T("导入走saveTheme(内置重名必拒)", /themes:import[\s\S]{0,700}saveTheme\(t\)/.test(ipc));

const loader = await readFile(path.join(root, "src/main/core-loader.cjs"), "utf8");
T("core-loader导出样式包函数", loader.includes("buildThemePack") && loader.includes("parseThemePack"));

const ver = await readFile(path.join(root, "scripts/verify-article.mjs"), "utf8");
T("verify回炉抖动有第二轮补救", /round <= 2/.test(ver) && /s2\.total <= 55\) break/.test(ver));
T("verify回炉升分自动回退（终稿绝不劣于初稿）", /sc\.total < s2\.total/.test(ver) && /s2\.total > s0\.total[\s\S]{0,200}touched\.clear\(\)/.test(ver));
T("verify仍守HITL零改动红线", /touched\.has\(i\) \|\| b === blocks\[i\]/.test(ver));

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL"));
console.log(`\nUX超越项：${out.length - failed.length}/${out.length} 通过`);
if (failed.length) process.exit(1);
