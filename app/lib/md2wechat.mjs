// Markdown → 微信公众号 HTML（内联样式，参考 doocs/md 思路的精简实现）
// 微信规则：样式必须全部内联；正文外链图片会被过滤（须替换为 mmbiz/qpic CDN）；<a> 外链受限（转为角注）

const THEMES = {
  青竹绿: { accent: "#0a9953", heading: "#17372a", body: "#26313f", quote: "#5b6773", quoteBg: "#f4f8f6", border: "#e3e8e6" },
  杂志灰: { accent: "#374151", heading: "#111827", body: "#1f2937", quote: "#6b7280", quoteBg: "#f3f4f6", border: "#e5e7eb" },
  暖橙手账: { accent: "#c2571b", heading: "#4a2511", body: "#3b3630", quote: "#78716c", quoteBg: "#faf5f0", border: "#eee6de" },
};

export function renderWeChatHtml(md, themeName = "青竹绿", opts = {}) {
  const t = THEMES[themeName] || THEMES["青竹绿"];
  const bodyStyle = `font-size:16px;line-height:1.75;color:${t.body};letter-spacing:0.4px;word-break:break-word;`;
  const imgMap = opts.imgMap || {}; // 本地路径/URL -> 微信CDN url
  const footnotes = [];
  const esc = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let html = md.replace(/\r\n/g, "\n");

  // 行内元素处理函数
  const inline = (raw) => {
    let s = esc(raw);
    // 图片
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, src) => {
      const url = imgMap[src] || src;
      const warn = /^(f|file|http:\/\/localhost)/i.test(src) && !imgMap[src];
      return `<img src="${url}" alt="${alt}" style="max-width:100%;height:auto;border-radius:8px;display:block;margin:14px auto;" ${warn ? 'data-local="1"' : ""}>${alt ? `<span style="display:block;font-size:12px;color:${t.quote};text-align:center;margin-top:4px;">${alt}</span>` : ""}`;
    });
    // 链接 → 角注（微信正文外链不可点）
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, txt, href) => {
      footnotes.push({ txt, href });
      return `${txt}<sup style="color:${t.accent};font-size:12px;">[${footnotes.length}]</sup>`;
    });
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, `<strong style="color:${t.accent};font-weight:700;">$1</strong>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, `<strong style="font-weight:700;">$1</strong>`);
    s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, `<em>$1</em>`);
    s = s.replace(/`([^`]+)`/g, `<code style="background:#f6f7f8;border:1px solid ${t.border};border-radius:4px;padding:1px 5px;font-size:14px;">$1</code>`);
    s = s.replace(/==([^=]+)==/g, `<span style="background:rgba(255,212,0,.35);padding:0 2px;">$1</span>`);
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
      out.push(`<p style="${bodyStyle}margin:0 0 1.1em;text-align:justify;">${inline(para.join("<br>"))}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (listType) {
      out.push(listType === "ul" ? `</ul>` : `</ol>`);
      listType = null;
    }
  };

  for (const line of lines) {
    const hr = line.match(/^\s*(-{3,}|\*{3,})\s*$/);
    const h = line.match(/^(#{1,4})\s+(.*)$/);
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
      out.push(`<blockquote style="margin:0 0 1.1em;padding:10px 14px;border-left:3px solid ${t.accent};background:${t.quoteBg};color:${t.quote};font-size:15px;line-height:1.7;">${inline(quote[1])}</blockquote>`);
      continue;
    }
    if (ul || ol) {
      flushPara();
      const want = ul ? "ul" : "ol";
      if (listType !== want) { closeList(); out.push(want === "ul" ? `<ul style="margin:0 0 1.1em;padding-left:1.4em;">` : `<ol style="margin:0 0 1.1em;padding-left:1.4em;">`); listType = want; }
      out.push(`<li style="${bodyStyle}margin-bottom:.4em;">${inline((ul || ol)[1])}</li>`);
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
