// Markdown → 微信公众号 HTML（内联样式，参考 doocs/md 思路的精简实现）
// 微信规则：样式必须全部内联；正文外链图片会被过滤（须替换为 mmbiz/qpic CDN）；<a> 外链受限（转为角注）

const THEMES = {
  青竹绿: { accent: "#0a9953", heading: "#17372a", body: "#26313f", quote: "#5b6773", quoteBg: "#f4f8f6", border: "#e3e8e6" },
  杂志灰: { accent: "#374151", heading: "#111827", body: "#1f2937", quote: "#6b7280", quoteBg: "#f3f4f6", border: "#e5e7eb" },
  暖橙手账: { accent: "#c2571b", heading: "#4a2511", body: "#3b3630", quote: "#78716c", quoteBg: "#faf5f0", border: "#eee6de" },
  静墨蓝: { accent: "#2b5cad", heading: "#16283f", body: "#2a3441", quote: "#64748b", quoteBg: "#f2f6fb", border: "#dfe7f0" },
  宣纸古雅: { accent: "#8b5e34", heading: "#4a3320", body: "#3d3227", quote: "#8d7b68", quoteBg: "#f8f3e9", border: "#e8ddc9" },
  桃夭文艺: { accent: "#d1547e", heading: "#58202f", body: "#3f2d33", quote: "#9b7a84", quoteBg: "#fbf1f4", border: "#f0dde4" },
  深海科技: { accent: "#0e7490", heading: "#0c3344", body: "#22343c", quote: "#6b8794", quoteBg: "#eef6f8", border: "#d9e9ee" },
  暮山紫: { accent: "#6d5bd0", heading: "#2f2654", body: "#3a3550", quote: "#7d7694", quoteBg: "#f4f2fb", border: "#e4dff5" },
};
export const BUILTIN_THEMES = THEMES;

// opts.themeOverride：自定义样式（用户存的公众号样式），字段与 THEMES 相同，另支持 fontSize/lineHeight/letterSpacing
export function renderWeChatHtml(md, themeName = "青竹绿", opts = {}) {
  const t = { ...(THEMES[themeName] || THEMES["青竹绿"]), ...(opts.themeOverride || {}) };
  const bodyStyle = `font-size:${Number(t.fontSize) || 16}px;line-height:${Number(t.lineHeight) || 1.75};color:${t.body};letter-spacing:${t.letterSpacing ?? 0.4}px;word-break:break-word;`;
  const imgMap = opts.imgMap || {}; // 本地路径/URL -> 微信CDN url
  const footnotes = [];
  const esc = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let html = md.replace(/\r\n/g, "\n");
  // 引用式链接定义行 [id]: url 先收集并从正文剥掉（同类工具均支持，此前漏成字面）
  const refs = {};
  html = html.replace(/^[ \t]*\[([^\]]+)\]:[ \t]*(\S+)[ \t]*$/gm, (_, id, url) => { refs[id.toLowerCase()] = url; return ""; });

  // 行内元素处理函数
  const inline = (raw) => {
    let s = esc(raw);
    // 图片
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, src) => {
      const mapped = imgMap[src];
      // 本地图没拿到 dataURL/CDN：输出可见提示，绝不留一个微信必然吃掉的坏 src（静默丢图）
      if (!mapped && !/^https?:/i.test(src)) {
        return `<span style="display:block;border:1px dashed ${t.accent};color:${t.accent};border-radius:8px;padding:10px 8px;text-align:center;font-size:13px;margin:14px auto;background:rgba(0,0,0,.02);">图片未随带：${esc(alt || src)}（到配图页「复制此图」补上）</span>`;
      }
      const url = mapped || src;
      return `<img src="${url}" alt="${alt}" style="max-width:100%;height:auto;border-radius:8px;display:block;margin:14px auto;">${alt ? `<span style="display:block;font-size:12px;color:${t.quote};text-align:center;margin-top:4px;">${alt}</span>` : ""}`;
    });
    // 链接 → 角注（微信正文外链不可点）
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, txt, href) => {
      footnotes.push({ txt, href });
      return `${txt}<sup style="color:${t.accent};font-size:12px;">[${footnotes.length}]</sup>`;
    });
    // 引用式 [文字][id]（id 省略时按文字查）→ 同一套角注
    s = s.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (m0, txt, id) => {
      const url = refs[(id || txt).toLowerCase()];
      if (!url) return m0;
      footnotes.push({ txt, href: url });
      return `${txt}<sup style="color:${t.accent};font-size:12px;">[${footnotes.length}]</sup>`;
    });
    // 自动链接 <https://…> → 可见 URL 文本 + 角注
    s = s.replace(/&lt;((?:https?:\/\/|www\.)[^\s<>]+)&gt;/g, (_, url) => {
      footnotes.push({ txt: url, href: /^https?:/i.test(url) ? url : "https://" + url });
      return `${esc(url)}<sup style="color:${t.accent};font-size:12px;">[${footnotes.length}]</sup>`;
    });
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, `<strong style="color:${t.accent};font-weight:700;">$1</strong>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, `<strong style="font-weight:700;">$1</strong>`);
    s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, `<em>$1</em>`);
    s = s.replace(/`([^`]+)`/g, `<code style="background:#f6f7f8;border:1px solid ${t.border};border-radius:4px;padding:1px 5px;font-size:14px;">$1</code>`);
    s = s.replace(/==([^=]+)==/g, `<span style="background:rgba(255,212,0,.35);padding:0 2px;">$1</span>`);
    s = s.replace(/~~([^~]+)~~/g, `<del style="color:${t.quote};">$1</del>`);
    // 图槽占位（AI 生成的配图意图）
    s = s.replace(/\[图槽:([^\]]+)\]/g, (_, intent) =>
      `<span style="display:inline-block;border:1px dashed ${t.accent};color:${t.accent};border-radius:6px;padding:1px 8px;font-size:12px;background:rgba(10,153,83,.06);">图槽：${esc(intent.trim())}</span>`);
    return s;
  };

  const lines = html.split("\n");
  const out = [];
  let para = [];
  let listType = null;
  const flushPara = () => {
    if (para.length) {
      out.push(`<p style="${bodyStyle}margin:0 0 1.1em;text-align:justify;">${para.map(inline).join("<br>")}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (listType) {
      out.push(listType === "ul" ? `</ul>` : `</ol>`);
      listType = null;
    }
  };

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const hr = line.match(/^\s*(-{3,}|\*{3,})\s*$/);
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const quote = line.match(/^>\s?(.*)$/);
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const fence = line.match(/^```/);

    if (fence) { flushPara(); closeList(); out.push(out._fence ? `</pre>` : `<pre style="background:#0f172a;color:#e2e8f0;border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.6;overflow-x:auto;margin:0 0 1.1em;">`); out._fence = !out._fence; continue; }
    if (out._fence) { out.push(esc(line)); continue; }
    if (h) {
      flushPara(); closeList();
      const lvl = h[1].length;
      if (lvl >= 3) {
        out.push(`<h3 style="font-size:17px;font-weight:700;color:${t.heading};margin:1.6em 0 .8em;line-height:1.4;border-left:4px solid ${t.accent};padding-left:10px;">${inline(h[2])}</h3>`);
      } else {
        out.push(`<h2 style="font-size:19px;font-weight:700;color:${t.heading};margin:1.8em 0 .9em;line-height:1.4;text-align:center;"><span style="border-bottom:3px solid ${t.accent};padding-bottom:4px;">${inline(h[2])}</span></h2>`);
      }
      continue;
    }
    if (hr) { flushPara(); closeList(); out.push(`<hr style="border:none;border-top:1px dashed ${t.border};margin:1.8em 0;">`); continue; }
    if (quote) {
      flushPara(); closeList();
      out.push(`<blockquote style="margin:0 0 1.1em;padding:10px 14px;border-left:3px solid ${t.accent};background:${t.quoteBg};color:${t.quote};font-size:15px;line-height:1.7;">${inline(quote[1].replace(/^(?:>\s*)+/, ""))}</blockquote>`);
      continue;
    }
    if (ul || ol) {
      flushPara();
      const want = ul ? "ul" : "ol";
      if (listType !== want) { closeList(); out.push(want === "ul" ? `<ul style="margin:0 0 1.1em;padding-left:1.4em;">` : `<ol style="margin:0 0 1.1em;padding-left:1.4em;">`); listType = want; }
      let raw = (ul || ol)[1];
      const box = raw.match(/^\[( |x|X)\]\s+/); // GFM 任务清单：☐/☑ 前缀，微信正文没有 checkbox 控件只能用字符
      if (box) raw = raw.slice(box[0].length);
      const boxHtml = box ? `<span style="color:${t.accent};font-weight:700;margin-right:4px;">${box[1].toLowerCase() === "x" ? "☑" : "☐"}</span>` : "";
      out.push(`<li style="${bodyStyle}margin-bottom:.4em;">${boxHtml}${inline(raw)}</li>`);
      continue;
    }
    // GFM 表格：表头行 + 分隔行（只含 | : - 空格且带 -）才成立，避免误伤含竖线的普通文字
    const sep = lines[li + 1];
    if (line.trim().startsWith("|") && sep && /-/.test(sep) && /^[\s|:-]+$/.test(sep)) {
      flushPara(); closeList();
      const cells = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const aligns = cells(sep).map((s) => (s.startsWith(":") && s.endsWith(":") ? "center" : s.endsWith(":") ? "right" : "left"));
      const head = cells(line);
      const n = head.length;
      const rows = [];
      let r = li + 2;
      while (r < lines.length && lines[r].trim() && lines[r].includes("|")) { rows.push(cells(lines[r])); r++; }
      const th = (i) => `<th style="border:1px solid ${t.border};background:${t.quoteBg};color:${t.heading};font-weight:700;padding:6px 10px;text-align:${aligns[i] || "left"};">${inline(head[i] || "")}</th>`;
      const td = (s, i, even) => `<td style="border:1px solid ${t.border};padding:6px 10px;text-align:${aligns[i] || "left"};${even ? `background:${t.quoteBg};` : ""}${bodyStyle}">${inline(s || "")}</td>`;
      out.push(`<section style="overflow-x:auto;margin:0 0 1.1em;"><table style="border-collapse:collapse;width:100%;font-size:14px;line-height:1.6;"><thead><tr>${Array.from({ length: n }, (_, i) => th(i)).join("")}</tr></thead><tbody>${
        rows.map((row, ri) => `<tr>${Array.from({ length: n }, (_, i) => td(row[i], i, ri % 2 === 1)).join("")}</tr>`).join("")
      }</tbody></table></section>`);
      li = r - 1;
      continue;
    }
    if (!line.trim()) { flushPara(); closeList(); continue; }
    para.push(line);
  }
  flushPara(); closeList();
  if (out._fence) out.push(`</pre>`);

  let fnHtml = "";
  if (footnotes.length) {
    fnHtml = `<section style="margin-top:2em;padding-top:12px;border-top:1px solid ${t.border};font-size:13px;color:${t.quote};line-height:1.8;">` +
      footnotes.map((f, i) => `<p style="margin:0;">[${i + 1}] ${esc(f.txt)}：${esc(f.href)}</p>`).join("") +
      `</section>`;
  }
  return `<section data-tool="稿匠" style="${bodyStyle}padding:4px 0;">${out.join("")}${fnHtml}</section>`;
}
