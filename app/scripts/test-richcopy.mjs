// 带图复制闭环的行为级测试：渲染层带 dataURL、缺图显形、主进程/预加载/界面三处接线不丢
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderWeChatHtml } from "../src/core/md2wechat.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = [];
const T = (n, ok, d = "") => out.push(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  [" + d + "]" : ""}`);

const DATA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const md = "# 标题\n\n![测试图](gj-test.png)\n\n[图槽: 待落图]\n";

// --- 渲染层：本地图有 dataURL 时，复制出的 HTML 自带图片 ---
const withMap = renderWeChatHtml(md, "青竹绿", { imgMap: { "gj-test.png": DATA } });
T("带图HTML含data:image", withMap.includes('<img src="' + DATA), withMap.slice(0, 60));
T("带图HTML不出现未随带提示", !withMap.includes("图片未随带"));
T("图题作为说明保留", withMap.includes(">测试图</span>"));

// --- 渲染层：素材缺失时显形，不静默产出坏图 ---
const noMap = renderWeChatHtml(md, "青竹绿", {});
T("缺素材时给可见补图提示", noMap.includes("图片未随带：测试图") && noMap.includes("复制此图"));
T("缺素材时不留坏img标签", !/<img src="gj-test\.png"/.test(noMap));
T("槽位渲染为可见虚线标签", noMap.includes("图槽：待落图"));
const ext = renderWeChatHtml("![外链](https://cdn.example.com/a.png)", "青竹绿", {});
T("外链图原样保留不误伤", ext.includes('<img src="https://cdn.example.com/a.png"'));

// --- 渲染层：GFM 表格（对标 doocs/mdnice 基础能力，粘贴后台不能变竖线乱码） ---
const tbl = renderWeChatHtml("前\n\n| 列A | 列B |\n|:---|---:|\n| 1 | **2** |\n| 4 | 5 |\n\n价格 1|2 元", "青竹绿");
T("表格渲染为<table>而非字面竖线段落", tbl.includes("<table") && tbl.includes("<th") && !/<p[^>]*>[^<]*\| 列A/.test(tbl));
T("表格样式全内联且无style块", tbl.includes("border-collapse:collapse") && !tbl.includes("<style"));
T("列对齐按分隔行(:---左 / ---:右)", /<th style="[^"]*text-align:left[^"]*">列A/.test(tbl) && /<th style="[^"]*text-align:right[^"]*">列B/.test(tbl));
T("单元格内加粗生效", /<td[^>]*><strong/.test(tbl));
T("含竖线的普通文字不误判为表格", /<p[^>]*>价格 1\|2 元<\/p>/.test(tbl));
const ext2 = renderWeChatHtml("~~删除线~~ 文字\n\n- [ ] 未完成\n- [x] 已完成\n- 普通项", "青竹绿");
T("删除线渲染为del且不留字面波浪线", ext2.includes("<del") && ext2.includes("删除线") && !ext2.includes("~~"));
T("任务清单变勾选符号", ext2.includes("☐") && ext2.includes("☑") && !/\[ \]|\[x\]/.test(ext2));
T("普通列表项不加勾选前缀", /<li[^>]*>普通项<\/li>/.test(ext2));
const soft = renderWeChatHtml("第一行\n第二行\n\n##### 五级标题\n\n> > 嵌套引用", "青竹绿");
T("段内软换行产出真实<br>而非字面文本", soft.includes("第一行<br>第二行") && !soft.includes("&lt;br&gt;"));
T("五级标题不再漏出井号字面", soft.includes("<h3") && !soft.includes("#####"));
T("嵌套引用剥掉多余尖括号", soft.includes("<blockquote") && !soft.includes("&gt; 嵌套"));

// --- 接线：主进程两条剪贴板通道 + 体积闸门 ---
const ipc = await readFile(path.join(root, "src/main/ipc.cjs"), "utf8");
T("主进程有clipboard:writeRich", ipc.includes('"clipboard:writeRich"'));
T("主进程有clipboard:writeImage逐张补图通道", ipc.includes('"clipboard:writeImage"'));
T("writeImage只认素材库文件名(防穿越)", /clipboard:writeImage[\s\S]{0,400}path\.basename/.test(ipc));
T("复制前有8MB体积闸门", /html\.length > 8_000_000/.test(ipc));

// --- 接线：预加载白名单 + 配图页按钮 ---
const preload = await readFile(path.join(root, "src/preload/index.cjs"), "utf8");
T("预加载暴露copyRich/copyImage", preload.includes("copyRich:") && preload.includes("copyImage:"));
const images = await readFile(path.join(root, "src/ui/js/images.js"), "utf8");
T("配图页每张图有复制此图按钮", images.includes("复制此图") && images.includes("window.api.copyImage("));
const workbench = await readFile(path.join(root, "src/ui/js/workbench.js"), "utf8");
T("复制成功文案承诺带图+逐张补", workbench.includes("正文图片已随带") && workbench.includes("复制此图"));
T("demo-copyimg钩子轮询到按钮出现(防打包exe慢启动假失败)", /demo-copyimg[\s\S]{0,600}setInterval[\s\S]{0,300}#slotList \.copyi/.test(workbench));

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL"));
console.log(`\n带图复制：${out.length - failed.length}/${out.length} 通过`);
if (failed.length) process.exit(1);
