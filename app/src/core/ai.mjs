// OpenAI 兼容 Chat 客户端（支持流式），用于 Electron 主进程
// 兼容 DeepSeek / Kimi / OpenAI / Claude 代理等任何 /chat/completions 端点

export class AIClient {
  constructor({ baseUrl, apiKey, model, temperature = 0.7, maxTokens = 0 }) {
    if (!apiKey) throw new Error("未配置 AI API Key（请到 设置 → AI 服务 填写）");
    this.baseUrl = (baseUrl || "https://api.deepseek.com/v1").replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.model = model || "deepseek-chat";
    this.temperature = Number.isFinite(+temperature) ? +temperature : 0.7;
    this.maxTokens = Number(maxTokens) > 0 ? Number(maxTokens) : 0;
  }

  async chat(messages, { temperature = this.temperature, json = false, maxTokens = this.maxTokens } = {}) {
    const body = { model: this.model, messages, temperature, stream: false };
    if (maxTokens) body.max_tokens = maxTokens;
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
  调研: "你是公众号选题研究员。针对用户选题：1) 给出3-5个可写的切入角度，每个附一句「读者为什么关心」；2) 列出需要作者核实或补充的事实、数据、个人经历清单；3) 指出这个选题最容易撞的1-2个俗套角度以及怎么避开。输出简洁的 Markdown 列表，不要客套话。",
  大纲: "你是公众号编辑。根据选题与调研笔记输出初稿大纲（Markdown）：开头钩子1行；正文3-4节，每节一行小标题+一句该节核心内容；结尾1行。在需要作者个人经历的位置标【要素材：…】。只输出大纲本身。",
  审核: "你是公众号发布前审核员。检查用户文字，按四类输出短列表：1) 疑似编造的数据/引用/经历（逐条指出并说明为什么可疑）；2) 平台敏感或营销味过重的表达；3) AI味最重的1-3处及改法建议；4) 一句话总评：现在发出去，读者会觉得像真人吗。不要空话客套。",
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

// AI 生成标题候选：产出结构化建议，采用与否由人点击决定（HITL）
export function buildTitleMessages({ topic = "", excerpt = "" } = {}) {
  const system = `你是公众号写手的标题搭子。根据选题与正文摘录，给 7 个标题候选，风格尽量拉开：悬念、数字清单、对比冲突、口语吐槽、利益承诺、提问式、热点嫁接。硬性要求：每条不超过 24 个汉字；禁用「震惊/揭秘/必看/错过后悔」等易被平台限流的词；不许用对仗排比的 AI 腔；标题必须与正文内容事实一致，不得编造正文没有的信息。只输出 JSON：{"titles":[{"t":"标题文本","s":"风格标签（2-4字）"}]}`;
  const user = `选题/当前标题：${topic || "（无，请从正文提炼）"}\n\n正文摘录：\n${excerpt.slice(0, 900) || "（正文为空，仅按选题起标题）"}`;
  return { system, user };
}
