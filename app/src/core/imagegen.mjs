// 文生图客户端：国产 OpenAI 兼容端点（智谱 CogView / 硅基流动 FLUX）+ 任意自定义端点
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
