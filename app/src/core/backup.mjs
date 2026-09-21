// 备份/迁移包：全量数据（文章/设置/样式/素材/队列）打成一个可搬运的 JSON 包
// 红线：密钥永远不进包（secrets 独立存储且导入导出都显式拒绝携带密钥字段）
import path from "node:path";

export const BACKUP_KIND = "gaojiang-backup";
export const BACKUP_VERSION = 1;
const SECRET_RE = /"(aiKey|appSecret|imgKey)(Enc)?\s*"/;

export function buildBundle({ data = {}, assets = {}, exportedAt = Date.now() }) {
  const clean = {};
  for (const [k, v] of Object.entries(data)) {
    if (k === "secrets" || k === "autosave") continue; // autosave 是崩溃暂存，不算数据资产
    if (SECRET_RE.test(JSON.stringify(v))) throw new Error(`备份字段 ${k} 里混入了密钥字段，已拒绝打包（密钥应只存 secrets）`);
    clean[k] = v;
  }
  const files = {};
  for (const [name, buf] of Object.entries(assets)) {
    if (!name || name !== path.basename(name) || name.includes("..")) throw new Error("素材文件名不合法：" + name);
    files[name] = Buffer.from(buf).toString("base64");
  }
  return JSON.stringify({ kind: BACKUP_KIND, v: BACKUP_VERSION, app: "稿匠", exportedAt, data: clean, assets: files });
}

export function parseBundle(text) {
  let j;
  try { j = JSON.parse(String(text)); } catch { throw new Error("备份文件不是有效 JSON：可能已损坏，或这不是稿匠备份包"); }
  if (j?.kind !== BACKUP_KIND) throw new Error("这不是稿匠备份包（标识不符），不敢乱动你的数据");
  if (j.v !== BACKUP_VERSION) throw new Error("备份版本 v" + j.v + " 暂不支持（当前支持 v" + BACKUP_VERSION + "），请升级稿匠后再导入");
  const blob = JSON.stringify(j);
  if (SECRET_RE.test(blob)) throw new Error("该备份包里混有密钥字段：拒绝导入（稿匠的正规备份包绝不含密钥）");
  const assets = {};
  for (const [name, b64] of Object.entries(j.assets || {})) {
    if (!name || name !== path.basename(name) || name.includes("..")) throw new Error("备份包含非法素材文件名：" + name);
    assets[name] = Buffer.from(String(b64), "base64");
  }
  return { data: j.data || {}, assets, exportedAt: j.exportedAt || 0 };
}

// ---- 样式包：自定义排版样式的导出/导入（对标 mdnice/墨滴 的样式分享，但走本地文件不经网络） ----
export const THEMEPACK_KIND = "gaojiang-themes";
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const THEME_COLORS = ["accent", "heading", "body", "quote", "quoteBg", "border"];

function checkTheme(t) {
  if (!t || typeof t !== "object") return "不是对象";
  const name = String(t.name || "").trim();
  if (!name || name.length > 30) return "样式名缺失或过长";
  for (const k of THEME_COLORS) if (t[k] != null && t[k] !== "" && !COLOR_RE.test(String(t[k]))) return `${k} 不是合法颜色`;
  if (t.fontSize != null && !(Number(t.fontSize) >= 12 && Number(t.fontSize) <= 24)) return "fontSize 需在 12~24";
  if (t.lineHeight != null && !(Number(t.lineHeight) >= 1.2 && Number(t.lineHeight) <= 2.5)) return "lineHeight 需在 1.2~2.5";
  if (t.letterSpacing != null && !(Number(t.letterSpacing) >= 0 && Number(t.letterSpacing) <= 2)) return "letterSpacing 需在 0~2";
  return null;
}

export function buildThemePack({ themes = [], exportedAt = Date.now() }) {
  const clean = [];
  for (const t of themes) {
    const bad = checkTheme(t);
    if (bad) throw new Error(`样式「${t?.name || "?"}」不合法：${bad}`);
    const o = { name: String(t.name).trim() };
    for (const k of [...THEME_COLORS, "fontSize", "lineHeight", "letterSpacing"]) if (t[k] != null && t[k] !== "") o[k] = t[k];
    clean.push(o);
  }
  return JSON.stringify({ kind: THEMEPACK_KIND, v: BACKUP_VERSION, app: "稿匠", exportedAt, themes: clean }, null, 2);
}

export function parseThemePack(text, builtinNames = []) {
  let j;
  try { j = JSON.parse(String(text)); } catch { throw new Error("样式文件不是有效 JSON：可能已损坏，或这不是稿匠样式包"); }
  if (j?.kind !== THEMEPACK_KIND) throw new Error("这不是稿匠样式包（标识不符）");
  const blob = JSON.stringify(j);
  if (SECRET_RE.test(blob)) throw new Error("样式包里混有密钥字段：拒绝导入");
  if (j.v !== BACKUP_VERSION) throw new Error("样式包版本 v" + j.v + " 暂不支持（当前 v" + BACKUP_VERSION + "），请升级稿匠后再导入");
  if (!Array.isArray(j.themes)) throw new Error("样式包里没有样式列表");
  const taken = new Set(builtinNames);
  const themes = [], skipped = [];
  const seen = new Set();
  for (const t of j.themes) {
    const bad = checkTheme(t);
    const name = String(t?.name || "").trim();
    if (bad) { skipped.push(`${name || "未命名"}：${bad}`); continue; }
    if (taken.has(name)) { skipped.push(`「${name}」与内置样式重名`); continue; }
    if (seen.has(name)) { skipped.push(`「${name}」包内重复，取后一份`); themes.splice(themes.findIndex((x) => x.name === name), 1); }
    seen.add(name);
    const o = { name };
    for (const k of [...THEME_COLORS, "fontSize", "lineHeight", "letterSpacing"]) if (t[k] != null && t[k] !== "") o[k] = t[k];
    themes.push(o);
  }
  return { themes, skipped, exportedAt: j.exportedAt || 0 };
}
