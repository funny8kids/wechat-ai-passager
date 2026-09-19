// 微信公众号 API 客户端（Node 18+ fetch，运行于 Electron 主进程）
// 文档: https://developers.weixin.qq.com/doc/subscription/api/

const BASE = "https://api.weixin.qq.com/cgi-bin";

export const WX_ERRORS = {
  40001: "AppSecret 错误或不合法",
  40013: "AppID 不合法",
  40164: "调用方 IP 不在白名单。请把本机公网 IP 添加到：公众号后台 → 设置与权限 → 基本配置 → IP 白名单",
  41001: "缺少 access_token 参数",
  42001: "access_token 已过期，将自动刷新重试",
  45009: "接口调用超过当日限额",
  48001: "该 API 无权限：公众号可能未认证或不具备草稿箱/发布能力（个人未认证订阅号常见）。可先用「送草稿箱」验证，或降级为手动群发",
  53503: "第三方平台未授权",
  89503: "公众号隐私协议未签署：请到后台弹窗签署",
};

export function explainError(code) {
  return WX_ERRORS[code] || `微信返回错误 ${code}`;
}

export class WeChatClient {
  constructor({ appId, appSecret, onToken }) {
    this.appId = appId;
    this.appSecret = appSecret;
    this._token = null;
    this._expireAt = 0;
    this.onToken = onToken;
  }

  async getToken(force = false) {
    if (!force && this._token && Date.now() < this._expireAt - 120_000) return this._token;
    const r = await fetch(
      `${BASE}/token?grant_type=client_credential&appid=${encodeURIComponent(this.appId)}&secret=${encodeURIComponent(this.appSecret)}`
    );
    const j = await r.json();
    if (!j.access_token) {
      const err = new Error(explainError(j.errcode) + ` (errcode=${j.errcode})`);
      err.wxcode = j.errcode;
      throw err;
    }
    this._token = j.access_token;
    this._expireAt = Date.now() + j.expires_in * 1000;
    this.onToken?.(j.expires_in);
    return this._token;
  }

  async call(path, { method = "GET", query = {}, body, retry = true } = {}) {
    const token = await this.getToken();
    const url = new URL(BASE + path);
    url.searchParams.set("access_token", token);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res =
      body instanceof FormData
        ? await fetch(url, { method: "POST", body })
        : await fetch(url, {
            method,
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
    const j = await res.json();
    if (j.errcode && retry && (j.errcode === 42001 || j.errcode === 40001)) {
      await this.getToken(true);
      return this.call(path, { method, query, body, retry: false });
    }
    if (j.errcode) {
      const err = new Error(`${explainError(j.errcode)} (errcode=${j.errcode})`);
      err.wxcode = j.errcode;
      throw err;
    }
    return j;
  }

  /** 正文图片上传：返回微信 CDN url（不占永久素材配额，限 <1MB 的 jpg/png） */
  async uploadContentImage(buffer, filename = "img.png") {
    const fd = new FormData();
    fd.append(
      "media",
      new Blob([buffer], { type: guessMime(filename) }),
      filename
    );
    const j = await this.call("/media/uploadimg", { method: "POST", body: fd });
    return j.url;
  }

  /** 封面/永久图片素材：返回 media_id（草稿必填 thumb_media_id） */
  async uploadThumb(buffer, filename = "cover.jpg") {
    const fd = new FormData();
    fd.append("media", new Blob([buffer], { type: guessMime(filename) }), filename);
    const j = await this.call("/material/add_material", {
      method: "POST",
      query: { type: "image" },
      body: fd,
    });
    return j.media_id;
  }

  /** 新增草稿，返回草稿 media_id */
  async addDraft({ title, author = "", digest = "", html, contentSourceUrl = "", thumbMediaId, needComment = false }) {
    if (!title) throw new Error("草稿标题不能为空");
    if (!thumbMediaId) throw new Error("缺少封面素材 media_id（thumb_media_id 为必填）");
    const j = await this.call("/draft/add", {
      method: "POST",
      body: {
        articles: [
          {
            title,
            author,
            digest,
            content: html,
            content_source_url: contentSourceUrl,
            thumb_media_id: thumbMediaId,
            need_open_comment: needComment ? 1 : 0,
            only_fans_can_comment: 0,
          },
        ],
      },
    });
    return j.media_id;
  }

  /** 发布草稿（即时）。注意：微信无定时发布 API，定时由本地调度器到点调用本方法 */
  async publish(draftMediaId) {
    const j = await this.call("/freepublish/submit", {
      method: "POST",
      body: { media_id: draftMediaId },
    });
    return j.publish_id;
  }

  async publishStatus(publishId) {
    const j = await this.call("/freepublish/get", {
      method: "POST",
      body: { publish_id: publishId },
    });
    // publish_status: 0成功 1发布中 2原创失败 3常规失败 4平台审核不通过 5成功后用户删除 6成功后用户屏蔽
    return j;
  }

  async draftCount() {
    const j = await this.call("/draft/batchget", {
      method: "POST",
      body: { offset: 0, count: 1, no_content: 1 },
    });
    return j.total_count;
  }
}

function guessMime(name) {
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.gif$/i.test(name)) return "image/gif";
  return "image/png";
}
