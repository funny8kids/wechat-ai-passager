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
