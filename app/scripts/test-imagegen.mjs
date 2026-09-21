// 一键出图测试：假 fetch 离线跑通请求体/响应解析/错误映射，再检查主进程→预加载→界面接线与 HITL 确认
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IMAGE_PRESETS, buildImageBody, parseImageResponse, imageApiError, ImageGenClient, buildKeylessUrl, sniffImageExt, KeylessImageClient } from "../src/core/imagegen.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = [];
const T = (n, ok, d = "") => out.push(`${ok ? "OK  " : "FAIL"} ${n}${d ? "  [" + d + "]" : ""}`);

// --- 请求体：两家国产端点字段不同，水印要关 ---
const zp = buildImageBody({ model: "cogview-3-flash", prompt: "  一只橘猫  ", size: "1024x1024", sizeField: "size" });
T("智谱体含model+修剪后的prompt", zp.model === "cogview-3-flash" && zp.prompt === "一只橘猫");
T("智谱体用size字段并关水印", zp.size === "1024x1024" && zp.watermark_enabled === false);
const sf = buildImageBody({ model: "flux", prompt: "a", size: "768x1024", sizeField: "image_size" });
T("硅基流动体用image_size字段", sf.image_size === "768x1024" && !("size" in sf) && !("watermark_enabled" in sf));
let emptyErr = "";
try { buildImageBody({ model: "m", prompt: "   " }); } catch (e) { emptyErr = e.message; }
T("空提示词直接报错不发起请求", emptyErr === "画面提示词为空", emptyErr);

// --- 响应解析：data[]/images[]/b64/字符串数组/垃圾输入 ---
T("解析OpenAI data[].url", JSON.stringify(parseImageResponse({ data: [{ url: "https://x/a.png" }] })) === '[{"url":"https://x/a.png"}]');
T("解析硅基流动 images[].url", parseImageResponse({ images: [{ url: "https://x/b.jpg" }] })[0]?.url === "https://x/b.jpg");
T("解析b64_json", parseImageResponse({ data: [{ b64_json: "QUJD" }] })[0]?.base64 === "QUJD");
T("解析纯字符串数组", parseImageResponse({ data: ["https://x/c.png"] })[0]?.url === "https://x/c.png");
T("垃圾响应解析为空不崩", parseImageResponse(null).length === 0 && parseImageResponse({ data: [{}] }).length === 0);

// --- 错误映射：每个状态码都要给出可操作中文 ---
T("401指向重填Key", imageApiError(401, "bad key").includes("API Key 无效"));
T("404指向检查baseUrl/模型", imageApiError(404, "not found").includes("端点或模型名不对"));
T("429指向额度/限流", imageApiError(429, "").includes("额度用尽"));
T("其他状态给原文片段", imageApiError(500, "server busy").includes("500") && imageApiError(500, "server busy").includes("server busy"));

// --- 客户端：注入假 fetch，全链路离线可测 ---
function fakeRes({ ok = true, status = 200, json, text = "", buf } = {}) {
  return { ok, status, async text() { return text; }, async json() { return json; }, async arrayBuffer() { return buf ?? new ArrayBuffer(3); } };
}
async function runClient(responses, override = {}) {
  const calls = [];
  const cli = new ImageGenClient({
    baseUrl: "https://api.test/v1/", apiKey: "test-key", model: "m1", size: "1024x1024", sizeField: "size",
    fetchImpl: async (url, opts) => { calls.push({ url, opts }); const r = responses.shift(); if (r instanceof Error) throw r; return r; },
    ...override,
  });
  return { cli, calls };
}
const { cli: c1, calls: k1 } = await runClient([
  fakeRes({ json: { data: [{ url: "https://img.test/a.jpg" }] } }),
  fakeRes({ buf: new Uint8Array([1, 2, 3, 4]).buffer }),
]);
const g1 = await c1.generate("一只橘猫");
T("POST到/images/generations且去尾斜杠", k1[0].url === "https://api.test/v1/images/generations" && k1[0].opts.method === "POST");
T("Authorization走Bearer头", k1[0].opts.headers.Authorization === "Bearer test-key");
T("url图下载后给字节+扩展名", g1[0]?.buf?.length === 4 && g1[0]?.ext === "jpg");
const { cli: c2 } = await runClient([fakeRes({ json: { data: [{ b64_json: Buffer.from("PNGDATA").toString("base64") }] } })]);
const g2 = await c2.generate("x");
T("b64直出免二次下载", g2[0].buf.toString() === "PNGDATA" && g2[0].ext === "png");
const { cli: c3 } = await runClient([fakeRes({ ok: false, status: 401, text: "invalid key" })]);
let e3 = ""; try { await c3.generate("x"); } catch (e) { e3 = e.message; }
T("接口4xx抛可操作中文", e3.includes("API Key 无效"), e3);
const { cli: c4 } = await runClient([fakeRes({ json: { code: 1001 } })]);
let e4 = ""; try { await c4.generate("x"); } catch (e) { e4 = e.message; }
T("没返回图片时显形不空转", e4.includes("生图接口没返回图片"), e4);
const { cli: c5 } = await runClient([Object.assign(new Error("This operation was aborted"), { name: "AbortError" })]);
let e5 = ""; try { await c5.generate("x"); } catch (e) { e5 = e.message; }
T("超时/中断转成人话", e5.includes("生图超时"), e5);
let e6a = "", e6b = "";
try { new ImageGenClient({ baseUrl: "https://x/v1", apiKey: "" }); } catch (e) { e6a = e.message; }
try { new ImageGenClient({ baseUrl: "", apiKey: "k" }); } catch (e) { e6b = e.message; }
T("缺Key/缺端点在构造期就拦", e6a.includes("API Key") && e6b.includes("baseUrl"));

// --- 预设：只收国内可达端点 ---
T("预设含智谱与硅基流动", !!IMAGE_PRESETS["智谱 CogView"] && !!IMAGE_PRESETS["硅基流动 FLUX"]);
T("智谱免费模型在首位", IMAGE_PRESETS["智谱 CogView"].models[0] === "cogview-3-flash");
T("预设带拿Key指引", IMAGE_PRESETS["智谱 CogView"].keyHint.includes("open.bigmodel.cn") && IMAGE_PRESETS["硅基流动 FLUX"].keyHint.includes("siliconflow"));

// --- 免 Key 免费直连：URL 构建 / 魔数嗅探 / 客户端全链路（假 fetch）---
const ku = buildKeylessUrl({ baseUrl: "https://free.test/", prompt: "青竹 配图 & 特??", size: "1024x768", seed: 42 });
T("免费URL含编码提示词+宽高+种子+去水印+flux池", ku.startsWith("https://free.test/prompt/") && ku.includes(encodeURIComponent("特??")) && ku.includes("width=1024") && ku.includes("height=768") && ku.includes("seed=42") && ku.includes("nologo=true") && ku.endsWith("model=flux"));
let ke1 = ""; try { buildKeylessUrl({ baseUrl: "https://free.test", prompt: "  " }); } catch (e) { ke1 = e.message; }
T("免费源空提示词构造期就拦", ke1 === "画面提示词为空", ke1);
let ke2 = ""; try { buildKeylessUrl({ baseUrl: "https://free.test", prompt: "x", size: "大图" }); } catch (e) { ke2 = e.message; }
T("免费源坏尺寸显形报格式", ke2.includes("1024x1024"), ke2);
const MAGIC = { jpg: Buffer.from([0xff, 0xd8, 0xff, ...new Array(20).fill(1)]), png: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(20)]), webp: Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(20)]), gif: Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(20)]) };
T("魔数嗅探四种真图格式", sniffImageExt(MAGIC.jpg) === "jpg" && sniffImageExt(MAGIC.png) === "png" && sniffImageExt(MAGIC.webp) === "webp" && sniffImageExt(MAGIC.gif) === "gif");
T("伪装成200的错误页嗅探为null", sniffImageExt(Buffer.from("<html>rate limited</html>".padEnd(30))) === null && sniffImageExt(null) === null);
async function runKeyless(responses, override = {}) {
  const calls = [];
  const cli = new KeylessImageClient({
    baseUrl: "https://free.test", size: "1024x1024",
    fetchImpl: async (url, opts) => { calls.push(url); const r = responses.shift(); if (r instanceof Error) throw r; return r; },
    ...override,
  });
  return { cli, calls };
}
const { cli: k1c, calls: k1u } = await runKeyless([fakeRes({ buf: MAGIC.jpg.buffer.slice(MAGIC.jpg.byteOffset, MAGIC.jpg.byteOffset + MAGIC.jpg.length) })]);
const kg1 = await k1c.generate("一只橘猫");
T("免费通道走GET且无Authorization头", k1u[0].includes("/prompt/") && k1u[0].includes("https://free.test") && !k1u[0].includes("images/generations") && kg1[0].ext === "jpg");
const { cli: k2c } = await runKeyless([fakeRes({ buf: new TextEncoder().encode("<html>502 bad gateway</html>" + " ".repeat(30)).buffer })]);
let ke3 = ""; try { await k2c.generate("x"); } catch (e) { ke3 = e.message; }
T("免费源200返错误页时显形不静默", ke3.includes("没返回图片") && ke3.includes("502 bad gateway"), ke3);
const { cli: k3c } = await runKeyless([fakeRes({ ok: false, status: 429, text: "slow down" })]);
let ke4 = ""; try { await k3c.generate("x"); } catch (e) { ke4 = e.message; }
T("免费源4xx转可操作中文", ke4.includes("额度用尽"), ke4);
let ke5 = ""; try { new KeylessImageClient({ baseUrl: "" }); } catch (e) { ke5 = e.message; }
T("免费客户端缺端点构造期就拦", ke5.includes("baseUrl"), ke5);
T("免费预设标记keyless且无模型名", IMAGE_PRESETS["免费直连（免Key）"]?.keyless === true && IMAGE_PRESETS["免费直连（免Key）"].model === "");

// --- 接线：核心装载 / 主进程 / 预加载 / 设置页 / 配图页 ---
const loader = await readFile(path.join(root, "src/main/core-loader.cjs"), "utf8");
T("core-loader导出ImageGenClient", loader.includes("ImageGenClient") && loader.includes("imagegen.mjs"));
T("core-loader导出KeylessImageClient", loader.includes("KeylessImageClient"));
const services = await readFile(path.join(root, "src/main/services.cjs"), "utf8");
T("services默认imgGen指向免费直连", /imgGen:\s*{[^}]*免费直连/.test(services));
T("keyless分支免Key直连不要求Key", /preset\.keyless[\s\S]{0,220}KeylessImageClient/.test(services) && !/preset\.keyless[\s\S]{0,120}if \(!key\) throw/.test(services));
T("imgKey走DPAPI且支持GJ_IMG_KEY引导", services.includes("imgKeyEnc") && services.includes("GJ_IMG_KEY"));
T("未填Key时提示去设置而非直接请求", services.includes("未填生图 API Key"));
const ipc = await readFile(path.join(root, "src/main/ipc.cjs"), "utf8");
T("主进程有presets/test/run三通道", ipc.includes('"imgen:presets"') && ipc.includes('"imgen:test"') && ipc.includes('"imgen:run"'));
T("生成图落素材库带时间戳名", /imgen:run[\s\S]{0,700}ai-/.test(ipc) && /imgen:run[\s\S]{0,700}writeFile/.test(ipc));
const preload = await readFile(path.join(root, "src/preload/index.cjs"), "utf8");
T("预加载暴露imgen三方法", preload.includes("imgenPresets:") && preload.includes("imgenTest:") && preload.includes("imgenRun:"));
const wb = await readFile(path.join(root, "src/ui/js/workbench.js"), "utf8");
T("有demo-imgtest截图钩子真实点击测试出图", wb.includes('"demo-imgtest"') && /demo-imgtest[\s\S]{0,320}#btnImgTest\"\)\.click/.test(wb));
const set = await readFile(path.join(root, "src/ui/js/settings.js"), "utf8");
T("免费源下模型框placeholder明示无需模型名", /applyImgModelHint/.test(set) && set.includes("免费直连无需模型名") && /applyImgPreset[\s\S]{0,500}applyImgModelHint\(p\)/.test(set));
const html = await readFile(path.join(root, "src/ui/index.html"), "utf8");
T("设置页有生图服务卡片", html.includes('id="sImgPreset"') && html.includes('id="btnImgTest"') && html.includes("生图服务"));
const images = await readFile(path.join(root, "src/ui/js/images.js"), "utf8");
T("配图页有AI出图按钮", images.includes("AI 出图") && images.includes("window.api.imgenRun("));
// HITL：genimg 处理器里先出图 → 再给「用这张落正文」按钮 → 写正文只发生在该按钮的点击回调里
const gs = images.indexOf('(".genimg").onclick');
const genBlock = images.slice(gs, images.indexOf('(".picki").onclick', gs));
T("出图后需人工确认才落正文(HITL)", genBlock.includes("imgenRun") && genBlock.indexOf("用这张落正文") < genBlock.indexOf("ta.value = ta.value.replace") && genBlock.includes("待你确认") && genBlock.includes("keep.onclick"));

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL"));
console.log(`\n一键出图：${out.length - failed.length}/${out.length} 通过`);
if (failed.length) process.exit(1);
