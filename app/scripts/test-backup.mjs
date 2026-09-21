// ④备份/迁移包：buildBundle/parseBundle 真实往返 + 密钥红线 + 越权文件名 + 全链路接线
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = [];
const T = (n, ok, d = "") => out.push(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  [" + d + "]" : ""}`);
const throws = (fn, re, n) => { try { fn(); T(n, false, "没报错"); } catch (e) { T(n, re.test(e.message), e.message); } };

const { buildBundle, parseBundle, buildThemePack, parseThemePack, BACKUP_KIND, BACKUP_VERSION, THEMEPACK_KIND } = await import("../src/core/backup.mjs");
T("导出包带稿匠标识与版本", BACKUP_KIND === "gaojiang-backup" && BACKUP_VERSION === 1 && THEMEPACK_KIND === "gaojiang-themes");

// 1) 全量往返：五类数据 + 素材字节级一致
{
  const data = {
    articles: [{ id: "a1", title: "测试文章", md: "正文![图](pic.png)" }],
    settings: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat", theme: "青竹绿" },
    themes: [{ name: "自定义A", css: ".t{}" }],
    materials: [{ id: "m1", text: "素材" }],
    queue: [{ id: "t1", articleId: "a1", mode: "publish", publishAt: 123 }],
  };
  const assets = { "pic.png": Buffer.from("89504e47", "hex"), "封面.jpg": Buffer.from("ffd8ff", "hex") };
  const text = buildBundle({ data, assets, exportedAt: 1777000000000 });
  const j = JSON.parse(text);
  T("包含文章/设置/样式/素材/队列", ["articles", "settings", "themes", "materials", "queue"].every((k) => k in j.data));
  T("导出文本不含密钥字段", !/"(aiKey|appSecret|imgKey)(Enc)?"\s*:/.test(text));
  const r = parseBundle(text);
  T("解析回数据与原值一致", JSON.stringify(r.data) === JSON.stringify(data));
  T("素材解码回Buffer且字节一致", Buffer.compare(r.assets["pic.png"], assets["pic.png"]) === 0 && Buffer.compare(r.assets["封面.jpg"], assets["封面.jpg"]) === 0);
  assert.strictEqual(r.exportedAt, 1777000000000);
  T("导出时间戳往返", true);
}
// 2) secrets/autosave 永不进包
{
  const text = buildBundle({ data: { articles: [], secrets: { aiKeyEnc: "!!" }, autosave: { md: "暂存" } }, assets: {} });
  const j = JSON.parse(text);
  T("secrets/autosave被剔除出包", !("secrets" in j.data) && !("autosave" in j.data) && !text.includes("!!"));
}
// 3) 密钥红线：构造期与解析期双向拒绝
{
  throws(() => buildBundle({ data: { articles: [{ aiKey: "sk-x" }] }, assets: {} }), /混入/, "打包时：数据里混入aiKey→拒绝");
  throws(() => buildBundle({ data: { settings: { appSecret: "s" } }, assets: {} }), /混入/, "打包时：设置里混入appSecret→拒绝");
  const tainted = JSON.stringify({ kind: BACKUP_KIND, v: 1, data: { settings: { imgKey: "k" } }, assets: {} });
  throws(() => parseBundle(tainted), /密钥/, "导入时：包里含imgKey→拒绝");
  // appSecretSet 这类状态标志不得误伤
  const fine = buildBundle({ data: { settings: { appSecretSet: true, appId: "wx1" } }, assets: {} });
  T("非密钥的状态标志不误伤", parseBundle(fine).data.settings.appSecretSet === true);
}
// 4) 非法包与非法文件名
{
  throws(() => parseBundle("not json{{{"), /JSON/, "损坏文件→人话报错");
  throws(() => parseBundle(JSON.stringify({ kind: "other-app", v: 1, data: {} })), /不是稿匠备份包/, "别人的JSON→拒收");
  throws(() => parseBundle(JSON.stringify({ kind: BACKUP_KIND, v: 99, data: {} })), /备份版本/, "未来版本→拒收不瞎猜");
  throws(() => buildBundle({ data: {}, assets: { "../evil.png": Buffer.from("x") } }), /不合法/, "打包时：路径穿越文件名→拒绝");
  const traversal = JSON.stringify({ kind: BACKUP_KIND, v: 1, data: {}, assets: { "sub/../evil.png": "eA==" } });
  throws(() => parseBundle(traversal), /非法素材文件名/, "导入时：路径穿越→拒绝");
}

// 5) 样式包：往返 + 校验 + 内置重名跳过 + 密钥红线
{
  const themes = [
    { name: "我的深夜蓝", accent: "#1d4ed8", heading: "#0f172a", body: "#1e293b", quote: "#64748b", quoteBg: "#f1f5f9", border: "#e2e8f0", fontSize: 17, lineHeight: 1.9, letterSpacing: 0.6, builtin: false, junk: "丢" },
    { name: "只改强调色", accent: "#e11d48" },
  ];
  const text = buildThemePack({ themes, exportedAt: 42 });
  const r = parseThemePack(text, ["青竹绿"]);
  T("样式包往返保留字段", r.themes.length === 2 && r.themes[0].fontSize === 17 && r.themes[1].accent === "#e11d48" && r.exportedAt === 42);
  T("非样式字段(junk/builtin)不带进包", !text.includes("丢") && !text.includes("builtin"));
  throws(() => buildThemePack({ themes: [{ name: "坏", accent: "red" }] }), /合法颜色/, "打包时：非hex颜色→拒绝");
  throws(() => buildThemePack({ themes: [{ name: "坏", fontSize: 99 }] }), /fontSize/, "打包时：字号越界→拒绝");
  throws(() => parseThemePack("{{{", []), /JSON/, "损坏样式文件→人话报错");
  throws(() => parseThemePack(JSON.stringify({ kind: BACKUP_KIND, v: 1, themes: [] }), []), /不是稿匠样式包/, "备份包当样式包→拒收");
  throws(() => parseThemePack(JSON.stringify({ kind: THEMEPACK_KIND, v: 1, data: { settings: { aiKey: "x" } } }), []), /密钥/, "样式包混入密钥→拒收");
  const mixed = parseThemePack(buildThemePack({ themes: [{ name: "青竹绿 撞名", accent: "#000000" }] }), ["青竹绿 撞名"]);
  T("与内置重名→跳过不覆盖", mixed.themes.length === 0 && mixed.skipped.join().includes("重名"));
  const bad = parseThemePack(JSON.stringify({ kind: THEMEPACK_KIND, v: 1, themes: [{ name: "坏色", accent: "notacolor" }, { name: "好色", accent: "#111111" }] }), []);
  T("坏样式单份跳过，好样式照常导入", bad.themes.length === 1 && bad.themes[0].name === "好色" && bad.skipped.length === 1);
  const dup = parseThemePack(JSON.stringify({ kind: THEMEPACK_KIND, v: 1, themes: [{ name: "重复", accent: "#111111" }, { name: "重复", accent: "#222222" }] }), []);
  T("包内重名取后一份", dup.themes.length === 1 && dup.themes[0].accent === "#222222");
}

// ---- 接线（导出/导入/换机全链路每一环都有断言） ----
const ipc = await readFile(path.join(root, "src/main/ipc.cjs"), "utf8");
T("IPC注册backup:export/import", ipc.includes('"backup:export"') && ipc.includes('"backup:import"'));
T("备份键清单不含secrets/autosave", /BACKUP_KEYS\s*=\s*\[[^\]]*\]/.test(ipc) && !/BACKUP_KEYS[^;]*(secrets|autosave)/.test(ipc));
T("导入前先存.pre-import找回副本", ipc.includes(".pre-import.json") && ipc.includes("copyFile"));
T("导入需主进程确认框(HITL)", /showMessageBox[\s\S]{0,300}替换并导入/.test(ipc));
T("导入后作废素材缓存", ipc.includes("_duCache.clear()"));
T("导出走系统保存框且取消返回null", /showSaveDialog[\s\S]{0,300}canceled[\s\S]{0,120}return null/.test(ipc));
T("QA门控GJ_BACKUP_DIR在导出与导入两处都在", (ipc.match(/GJ_BACKUP_DIR/g) || []).length >= 3);
T("门控开启才跳确认框，正常路径HITL确认框原样保留", /if \(!process\.env\.GJ_BACKUP_DIR\) \{[\s\S]{0,160}showMessageBox/.test(ipc));
T("门控导出导入走同一固定包文件", /GJ_BACKUP_DIR[^;\n]*gj-export\.json/.test(ipc) && (ipc.match(/gj-export\.json/g) || []).length === 2);
const wbk = await readFile(path.join(root, "src/ui/js/workbench.js"), "utf8");
T("备份QA钩子真实点设置页导出/导入按钮", wbk.includes("demo-bexport") && wbk.includes("demo-bimport") && wbk.includes("#btnBackupExport") && wbk.includes("#btnBackupImport"));

const loader = await readFile(path.join(root, "src/main/core-loader.cjs"), "utf8");
T("core-loader导出build/parseBundle", loader.includes("buildBundle") && loader.includes("parseBundle"));

const preload = await readFile(path.join(root, "src/preload/index.cjs"), "utf8");
T("preload白名单暴露backupExport/Import", preload.includes("backupExport") && preload.includes("backupImport"));

const html = await readFile(path.join(root, "src/ui/index.html"), "utf8");
T("设置页有导出/导入按钮与结果位", html.includes("btnBackupExport") && html.includes("btnBackupImport") && html.includes("backupResult"));
T("备份卡明文承诺密钥不进包", /绝不进备份包/.test(html));

const set = await readFile(path.join(root, "src/ui/js/settings.js"), "utf8");
T("导出按钮接线且失败显形", /#btnBackupExport[\s\S]{0,600}backupExport\(\)[\s\S]{0,600}导出失败/.test(set));
T("导入成功后刷新设置/文章/素材/队列", /#btnBackupImport[\s\S]{0,900}backupImport\(\)[\s\S]{0,900}loadSettings\(\)[\s\S]{0,300}loadArticles\(\)/.test(set));
T("导入完成提醒重填Key", set.includes("生图 Key 请重新填一次"));

const pipe = await readFile(path.join(root, "src/main/pipeline.cjs"), "utf8");
T("流水线：发布错过10分钟转人工", /late:\s*true/.test(pipe) && /lateMin > 10/.test(pipe) && pipe.includes("未擅自发布"));
const pub = await readFile(path.join(root, "src/ui/js/publish.js"), "utf8");
T("队列卡显形错过并给仍要发布", pub.includes("错过时间·等你决定") && pub.includes("仍要发布"));
T("错过提示只在等待决定时显示", pub.includes('q.late && q.status === "awaiting_confirm"'));

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL"));
console.log(`\n备份/迁移：${out.length - failed.length}/${out.length} 通过`);
if (failed.length) process.exit(1);
