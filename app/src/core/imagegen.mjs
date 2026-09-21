// 文生图客户端：国产 OpenAI 兼容端点（智谱 CogView / 硅基流动 FLUX）+ 免 Key 免费直连源 + 任意自定义端点
// 设计约束：密钥只从主进程传入（DPAPI 解密后），本模块不落盘、不打印密钥；fetch 可注入以便离线测试

export const IMAGE_PRESETS = {
  "智谱 CogView": {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "cogview-3-flash",
    sizeField: "size",
    sizes: ["1024x1024", "768x1344", "1344x768"],
    models: ["cogview-3-flash", "cogview-4", "cogview-4-250304"],
    keyHint: "在 https://open.bigmodel.cn 注册后 → API Keys 新建（cogview-3-flash 免费）",
  },
  "硅基流动 FLUX": {
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "black-forest-labs/FLUX.1-schnell",
    sizeField: "image_size",
    sizes: ["1024x1024", "768x1024", "1024x768"],
    models: ["black-forest-labs/FLUX.1-schnell", "Kwai-Kolors/Kolors"],
    keyHint: "在 https://cloud.siliconflow.cn 注册后 → API 密钥新建（FLUX.1-schnell 有免费额度）",
  },
  "免费直连（免Key）": {
    baseUrl: "https://image.pollinations.ai",
    model: "",
    keyless: true,
    sizes: ["1024x1024", "1024x768", "768x1024", "1280x720"],
    models: [],
    keyHint: "内置免费端点，无需任何 Key，装好即可出图。免费档三条如实限制：右下角带 pollinations 水印（发布前建议换图或裁掉）；对中文长提示词理解偏弱，用简短英文或短语更稳；高峰时段共享池会拥堵——工具会自动重试一次，仍堵会明说，等 1-2 分钟再试即可。正式配图建议切自带 Key 的源",
  },
  自定义: {
    baseUrl: "",
    model: "",
    sizeField: "size",
    sizes: ["1024x1024", "768x1024", "1024x768"],
    models: [],
    keyHint: "填任何 OpenAI 兼容的 images 端点，例如 https://api.openai.com/v1 或本地代理地址",
  },
};

export function buildImageBody({ model, prompt, size, sizeField = "size" }) {
  const body = { model, prompt: String(prompt || "").trim() };
  if (!body.prompt) throw new Error("画面提示词为空");
  if (size) body[sizeField] = size;
  if (sizeField === "size") body.watermark_enabled = false; // 智谱：默认带水印，公众号配图不需要
  return body;
}

// 各家响应形状不一：OpenAI 的 data[]、硅基流动的 images[]，条目可能是 url 也可能是 b64_json
export function parseImageResponse(json) {
  const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.images) ? json.images : [];
  const items = [];
  for (const it of list) {
    if (it?.url) items.push({ url: it.url });
    else if (it?.b64_json) items.push({ base64: it.b64_json });
    else if (typeof it === "string" && /^https?:/i.test(it)) items.push({ url: it });
  }
  return items;
}

export function imageApiError(status, text) {
  const raw = String(text || "").slice(0, 200);
  const code = {
    401: "生图接口 401：API Key 无效或未填（设置 → 生图服务 重新填 Key）",
    403: "生图接口 403：Key 无该模型权限或未开通",
    404: "生图接口 404：端点或模型名不对（检查 baseUrl 是否以 /v1 或 /api/paas/v4 结尾）",
    429: "生图接口 429：额度用尽或被限流，稍后再试或换模型",
  }[status];
  return code ? `${code}  [${raw}]` : `生图接口 ${status || "网络失败"}: ${raw || "请求没通，检查网络/代理或 baseUrl"}`;
}

export class ImageGenClient {
  constructor({ baseUrl, apiKey, model, size, sizeField, fetchImpl, timeoutMs = 120_000 }) {
    if (!apiKey) throw new Error("未配置生图 API Key（设置 → 生图服务，只用你自己的 Key，本机加密存储）");
    if (!baseUrl) throw new Error("未配置生图端点 baseUrl（设置 → 生图服务 选服务商预设）");
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.model = model;
    this.size = size;
    this.sizeField = sizeField || "size";
    this.fetch = fetchImpl || fetch;
    this.timeoutMs = timeoutMs;
  }

  async #post(url, opts = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      return await this.fetch(url, { ...opts, signal: ctl.signal });
    } catch (e) {
      throw new Error(e?.name === "AbortError" ? `生图超时（>${Math.round(this.timeoutMs / 1000)}s）：换小图或稍后重试` : `生图请求失败：${e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  // 返回 [{ url } | { buf, ext }]：url 需再下载落素材库；b64 直接给字节
  async generate(prompt) {
    const res = await this.#post(`${this.baseUrl}/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(buildImageBody({ model: this.model, prompt, size: this.size, sizeField: this.sizeField })),
    });
    if (!res.ok) throw new Error(imageApiError(res.status, await res.text().catch(() => "")));
    const json = await res.json().catch(() => null);
    const items = parseImageResponse(json);
    if (!items.length) {
      throw new Error("生图接口没返回图片：" + JSON.stringify(json || {}).slice(0, 200));
    }
    const out = [];
    for (const it of items) {
      if (it.base64) {
        out.push({ buf: Buffer.from(it.base64, "base64"), ext: "png" });
        continue;
      }
      const dl = await this.#post(it.url);
      if (!dl.ok) throw new Error(imageApiError(dl.status, await dl.text().catch(() => "")));
      const buf = Buffer.from(await dl.arrayBuffer());
      const ext = (it.url.split("?")[0].match(/\.(png|jpe?g|webp|gif)$/i) || [, "png"])[1].toLowerCase().replace("jpeg", "jpg");
      out.push({ buf, ext });
    }
    return out;
  }
}

// ---------- 免 Key 免费直连：GET 即返图片字节，无需注册/无需密钥 ----------

export function buildKeylessUrl({ baseUrl, prompt, size, seed = Math.floor(Math.random() * 1e6) }) {
  const text = String(prompt || "").trim();
  if (!text) throw new Error("画面提示词为空");
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(String(size || "1024x1024"));
  if (!m) throw new Error(`免费源的尺寸格式不对：应形如 1024x1024，收到 "${size}"`);
  const base = String(baseUrl || "").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) throw new Error("免费生图端点缺失：设置 → 生图服务 选「免费直连（免Key）」预设");
  // model=flux：显式指定模型池，避开默认后端高峰期共享限流（实测默认池会 429→500）
  return `${base}/prompt/${encodeURIComponent(text)}?width=${m[1]}&height=${m[2]}&seed=${seed}&nologo=true&model=flux`;
}

// 只认文件头魔数，不信 Content-Type：免费端点可能把错误页伪装成 200 图片返回
export function sniffImageExt(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  const head = buf.subarray(0, 6).toString("latin1");
  if (head === "GIF87a" || head === "GIF89a") return "gif";
  return null;
}

// 免费池共享限流（实测高峰 429→500，且 500 正文常内嵌上游 429 详情）
function isKeylessBusy(status, body) {
  if (status === 429 || status === 500 || status === 502 || status === 503) return true;
  return /429|rate.?limit|per-user limit/i.test(String(body || ""));
}

export class KeylessImageClient {
  constructor({ baseUrl, size, fetchImpl, timeoutMs = 120_000, retryDelayMs = 4000, sleepImpl } = {}) {
    if (!/^https?:\/\//i.test(String(baseUrl || ""))) throw new Error("未配置免费生图端点 baseUrl（选「免费直连（免Key）」预设）");
    this.baseUrl = baseUrl;
    this.size = size || "1024x1024";
    this.fetch = fetchImpl || fetch;
    this.timeoutMs = timeoutMs;
    this.retryDelayMs = retryDelayMs;
    this.sleep = sleepImpl || ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async generate(prompt) {
    let r = await this._attempt(prompt);
    if (!r.busy) return r.out;
    // 拥堵自动换 seed 重试一次（每次 buildKeylessUrl 随机 seed），仍堵则人话显形
    await this.sleep(this.retryDelayMs);
    r = await this._attempt(prompt);
    if (!r.busy) return r.out;
    throw new Error(`免费档这会儿拥挤（源站共享池限流），自动重试一次仍未挤进去：等 1-2 分钟再点一次「AI 出图」；急用可在设置 → 生图服务切「智谱 CogView」等自带 Key 的源${r.detail ? "  [" + r.detail + "]" : ""}`);
  }

  // 成功：{busy:false, out:[{buf,ext}]}；限流类失败：{busy:true, detail}（可换 seed 重试）
  async _attempt(prompt) {
    const url = buildKeylessUrl({ baseUrl: this.baseUrl, prompt, size: this.size });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    let res;
    try {
      res = await this.fetch(url);
    } catch (e) {
      throw new Error(e?.name === "AbortError" ? `免费生图超时（>${Math.round(this.timeoutMs / 1000)}s）：换自带 Key 的源或稍后重试` : `免费生图请求失败：${e.message}（本机到免费端点网络不通时，切「智谱 CogView」等自带 Key 源）`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (isKeylessBusy(res.status, body)) return { busy: true, detail: `${res.status}: ` + String(body).slice(0, 80).replace(/[\r\n]+/g, " ") };
      throw new Error(imageApiError(res.status, body));
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = sniffImageExt(buf);
    if (!ext) throw new Error("免费生图源没返回图片（可能被限流或网络被劫持）：稍后重试，或切自带 Key 的源  [" + buf.subarray(0, 80).toString("utf8").replace(/[\r\n]+/g, " ") + "]");
    return { busy: false, out: [{ buf, ext }] };
  }
}
