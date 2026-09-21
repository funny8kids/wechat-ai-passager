// 发布流水线：Markdown → 图片转存微信CDN → 内联样式HTML → 草稿 → 发布
// 以及定时任务执行体（含"人在回路"到点确认逻辑）
const path = require("path");
const fs = require("fs/promises");

const IMG_RE = /!\[[^\]]*\]\(([^)\s]+)/g;

function createPipeline({ lib, services, getScheduler, notify }) {
  const { store, getSettings, getSecrets, wxClient, renderHtml } = services;

  async function buildDraftPayload(article) {
    const s = await getSettings();
    const client = await wxClient();
    const imgMap = {};
    for (const m of article.md.matchAll(IMG_RE)) {
      const src = m[1];
      if (/^https?:\/\//i.test(src)) continue; // 外链图不转存（审核规则会提示风险）
      const p = path.isAbsolute(src) ? src : path.join(store.dir, "assets", src);
      try {
        const buf = await fs.readFile(p);
        if (buf.length > 950_000) throw new Error(`图片超过微信 1MB 限制: ${src}`);
        imgMap[src] = await client.uploadContentImage(buf, path.basename(p));
      } catch (e) {
        if (/限制/.test(e.message)) throw e;
        throw new Error(`本地图片读取失败: ${p}（${e.message}）`);
      }
    }
    const html = await renderHtml(article.md, article.theme || s.theme, { imgMap });
    // 封面：优先显式 coverPath，其次正文第一张本地图（微信草稿必须有 thumb_media_id）
    let coverPath = article.coverPath;
    if (!coverPath) {
      const first = [...article.md.matchAll(IMG_RE)].find((m) => !/^https?:\/\//i.test(m[1]));
      if (first) coverPath = path.isAbsolute(first[1]) ? first[1] : path.join(store.dir, "assets", first[1]);
    }
    if (!coverPath) throw new Error("缺少封面图：草稿必须有 thumb_media_id。请在文章里放一张本地图作为首图，或指定封面");
    const thumbMediaId = article.thumbMediaId || (await client.uploadThumb(await fs.readFile(coverPath), path.basename(coverPath)));
    const digest = article.digest || (article.md.replace(/[#>*!\[\]()`-]/g, "").replace(/\s+/g, " ").trim().slice(0, 100));
    return { client, payload: { title: article.title, html, digest, thumbMediaId }, thumbMediaId };
  }

  async function saveDraft(article) {
    const { client, payload, thumbMediaId } = await buildDraftPayload(article);
    const draftMediaId = await client.addDraft(payload);
    return { draftMediaId, thumbMediaId };
  }

  async function publishArticle(article) {
    const { draftMediaId } = await saveDraft(article);
    const client = await wxClient();
    const publishId = await client.publish(draftMediaId);
    return { draftMediaId, publishId };
  }

  async function runScheduled(task) {
    const articles = await store.load("articles", []);
    const article = articles.find((a) => a.id === task.articleId);
    if (!article) throw new Error("队列关联的文章已删除");
    // 未配微信凭证：定时功能照常可用——到点转「提醒模式」，引导走正式方案「复制富文本」
    const sec = await getSecrets();
    if (!sec.appId || !sec.appSecret) {
      await getScheduler().update(task.id, { status: "awaiting_confirm", manual: true });
      notify(`定时到点（未接微信API）：${article.title}`, "打开稿匠发布页 →「去写作页复制」→ 公众号后台 Ctrl+V 发布");
      return;
    }
    const s = await getSettings();
    if (task.mode === "draft") {
      const r = await saveDraft(article);
      await getScheduler().update(task.id, { draftMediaId: r.draftMediaId });
      notify(`已按时存入草稿箱：${article.title}`, "打开稿匠可一键发布");
      return;
    }
    if (s.confirmBeforePublish && !task.confirmed) {
      // 人在回路：到点只提醒，不自动发布
      await getScheduler().update(task.id, { status: "awaiting_confirm" });
      notify(`定时发布到点，等你放行：${article.title}`, "打开稿匠点击「确认发布」");
      return;
    }
    const r = await publishArticle(article);
    await getScheduler().update(task.id, { draftMediaId: r.draftMediaId, publishId: r.publishId });
  }

  // ---- 发布终态轮询：submit 只代表"已提交"，微信审核结果要查 /freepublish/get ----
  const PUB_STATUS = {
    0: ["✓ 发布成功", true], 1: ["微信审核中…", false], 2: ["✗ 原创声明失败", true],
    3: ["✗ 发布失败（常规）", true], 4: ["✗ 平台审核不通过", true],
    5: ["发布后已被删除", true], 6: ["发布后已被屏蔽", true],
  };
  function startStatusPoller(intervalMs = 60_000) {
    const tick = async () => {
      const tasks = await store.load("queue", []);
      const pend = tasks.filter((t) => t.publishId && !t.pubFinal);
      if (!pend.length) return;
      let client;
      try { client = await wxClient(); } catch (e) {
        for (const t of pend) await getScheduler().update(t.id, { pubError: e.message });
        return;
      }
      for (const t of pend) {
        try {
          const j = await client.publishStatus(t.publishId);
          const [text, isFinal] = PUB_STATUS[j.publish_status] || [`未知发布状态 ${j.publish_status}`, false];
          await getScheduler().update(t.id, { pubStatus: text, pubFinal: isFinal, pubCheckedAt: Date.now(), pubError: null });
          if (isFinal) notify("发布终态：" + (t.title || ""), text);
        } catch (e) {
          await getScheduler().update(t.id, { pubError: String(e.message || e), pubCheckedAt: Date.now() });
        }
      }
    };
    setInterval(() => tick().catch(() => {}), intervalMs);
    tick().catch(() => {});
  }

  return { buildDraftPayload, saveDraft, publishArticle, runScheduled, startStatusPoller };
}

module.exports = { createPipeline };
