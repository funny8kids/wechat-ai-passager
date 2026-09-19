// 公众号 API 权限自检（M0 地基验证）
// 用法: node scripts/check-wechat.mjs <AppID> <AppSecret>
// 或设环境变量 WX_APPID / WX_APPSECRET
import { WeChatClient } from "../lib/wechat.mjs";

const [appId, appSecret] = [process.argv[2] || process.env.WX_APPID, process.argv[3] || process.env.WX_APPSECRET];
if (!appId || !appSecret) {
  console.log("用法: node scripts/check-wechat.mjs <AppID> <AppSecret>");
  process.exit(1);
}
// 先探测本机公网 IP（白名单要用）
try {
  const ip = await (await fetch("https://api.ipify.org?format=json")).json();
  console.log(`本机公网 IP: ${ip.ip}  ← 确认此 IP 已在公众号后台白名单中`);
} catch { console.log("公网 IP 探测失败（不影响后续测试）"); }

const c = new WeChatClient({ appId, appSecret });
const step = async (name, fn) => {
  try { const r = await fn(); console.log(`[OK]   ${name}${r ? " → " + r : ""}`); return true; }
  catch (e) { console.log(`[FAIL] ${name} → ${e.message}`); return false; }
};

console.log("\n== 逐步权限验证 ==\n");
const t1 = await step("1. 获取 access_token", async () => { await c.getToken(); return "成功（IP 白名单正确）"; });
if (!t1) { console.log("\n终止：token 都拿不到，后续接口必然失败。多为 40164(IP白名单) 或 40001(AppSecret错)。"); process.exit(2); }
await step("2. 草稿箱-批量获取草稿", async () => { const n = await c.draftCount(); return `现有草稿 ${n} 篇（draft 权限 OK）`; });
await step("3. 永久素材-新增（发布必需 thumb_media_id）", async () => {
  // 1x1 png
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z1Dwn5EBBgG+/P/7LF9mGQAAAABJRU5ErkJggg==", "base64");
  const id = await c.uploadThumb(png, "test.png");
  return `media_id=${id}`;
});
await step("4. 新增草稿", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z1Dwn5EBBgG+/P/7LF9mGQAAAABJRU5ErkJggg==", "base64");
  const thumb = await c.uploadThumb(png, "test.png");
  const mediaId = await c.addDraft({ title: "【自检】稿匠 API 权限测试，可删除", html: "<p>这是稿匠工具的权限自检草稿，可直接删除。</p>", digest: "自检", thumbMediaId: thumb });
  return `draft media_id=${mediaId}（可去后台删除）`;
});
console.log("\n说明：freepublish（正式发布）未在此测试，避免真的发出文章。");
console.log("若上面 2-4 全部 OK，工具即可走「定时→草稿→人工确认发布」完整链路；");
console.log("若 4 报 48001，说明账号无草稿 API 权限（常见于未认证个人订阅号），工具将降级为导出 Markdown 手动粘贴。");
