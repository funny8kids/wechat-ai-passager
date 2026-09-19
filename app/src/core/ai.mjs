// OpenAI 兼容 Chat 客户端（支持流式），用于 Electron 主进程
// 兼容 DeepSeek / Kimi / OpenAI / Claude 代理等任何 /chat/completions 端点

export class AIClient {
  constructor({ baseUrl, apiKey, model }) {
    if (!apiKey) throw new Error("未配置 AI API Key（请到 设置 → AI 服务 填写）");
    this.baseUrl = (baseUrl || "https://api.deepseek.com/v1").replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.model = model || "deepseek-chat";
  }

  async chat(messages, { temperature = 0.7, json = false } = {}) {
    const body = { model: this.model, messages, temperature, stream: false };
    if (json) body.response_format = { type: "json_object" };
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`AI 接口 ${res.status}: ${text.slice(0, 300)}`);
    }
    const j = await res.json();
    return j.choices?.[0]?.message?.content ?? "";
  }

  async chatStream(messages, onDelta, { temperature = 0.7 } = {}) {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, messages, temperature, stream: true }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`AI 接口 ${res.status}: ${text.slice(0, 300)}`);
    }
    let full = "";
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            onDelta?.(delta);
          }
        } catch {
          /* 忽略半包 */
        }
      }
    }
    return full;
  }
}

// —— 预置任务 prompt（人在回路：全部产出"建议"，不直接改稿） ——

export const AI_TASKS = {
  口语化: "把用户给出的文字改得更口语、更像真人在公众号聊天，保留原意与长度量级。只输出改写后的文本本身，不要任何解释。",
  缩短: "把用户给出的文字压缩到约60%篇幅，保留最有信息量的部分。只输出改写后的文本本身。",
  展开: "把用户给出的文字适度扩写约1.5倍，补充一个具体场景或例子（用【可替换为你的经历：…】占位）。只输出改写后的文本本身。",
  去AI味: `按以下规则改写用户文字以去除AI味：1)拆散排比与"第一/第二/第三"列举腔；2)删掉"值得注意的是/总而言之/赋能/闭环"等套话；3)句长要有参差，允许口语碎句；4)保留事实与观点不变。只输出改写后的文本本身。`,
  换例子: "把用户文字中的例子换成一个更贴近日常生活的中文例子，其余不动。只输出改写后的文本本身。",
  生成初稿: "你是公众号写手。根据用户的选题与大纲生成初稿：Markdown 格式；在情绪转折或场景描写处插入一行 [图槽: 一句话配图意图] 作为配图槽位；语言要有个人视角，避免套话。直接输出 Markdown。",
};

export function buildRewriteMessages(task, selectedText, customNote = "") {
  const sys = AI_TASKS[task] || `按用户要求改写文字：${task}。只输出改写后的文本本身。`;
  const user = customNote
    ? `改写要求：${sys}\n附加人工要求：${customNote}\n原文：\n${selectedText}`
    : `${sys}\n原文：\n${selectedText}`;
  return [
    { role: "system", content: customNote ? `你收到一段带附加要求的改写指令，请全部满足。只输出改写后的文本。` : sys },
    { role: "user", content: customNote ? `附加要求：${customNote}\n原文：\n${selectedText}` : `原文：\n${selectedText}` },
  ];
}
