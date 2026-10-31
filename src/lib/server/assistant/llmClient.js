// A chat client for any OpenAI-compatible endpoint with tool calling. OpenAI and Gemini both speak it, so the
// provider is configuration, not code:
//   ASSISTANT_PROVIDER = 'gemini' | 'openai'   (default: gemini when GEMINI_API_KEY is set, else openai)
//   ASSISTANT_MODEL, ASSISTANT_BASE_URL         (optional overrides)

const PROVIDERS = {
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.8-flash',
    keyVar: 'GEMINI_API_KEY'
  },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', keyVar: 'OPENAI_API_KEY' }
};

/** Resolve the provider from the environment, or null when no key is configured. */
export function assistantConfig(env = {}) {
  const wanted = String(env.ASSISTANT_PROVIDER || '').toLowerCase();
  const name = PROVIDERS[wanted] ? wanted : env.GEMINI_API_KEY ? 'gemini' : 'openai';
  const preset = PROVIDERS[name];
  const apiKey = env[preset.keyVar];
  if (!apiKey) return null;
  return {
    provider: name,
    apiKey,
    baseUrl: env.ASSISTANT_BASE_URL || preset.baseUrl,
    model: env.ASSISTANT_MODEL || preset.model
  };
}

/** Our neutral message shape -> chat-completions messages. */
export function toWireMessages(system, messages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      out.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
          ...(c.extra ? { extra_content: c.extra } : {})
        }))
      });
    } else if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    else out.push({ role: m.role, content: m.content });
  }
  return out;
}

export function parseReply(payload) {
  const message = payload?.choices?.[0]?.message;
  if (!message) throw new Error('The model returned no message.');
  const toolCalls = (message.tool_calls || []).map((c, i) => {
    let args = {};
    try {
      args = JSON.parse(c.function?.arguments || '{}');
    } catch {
      args = {};
    }
    // Gemini 3 attaches a signed "thought" to each tool call and rejects the next request if it is not sent back.
    return {
      id: c.id || `call_${i}`,
      name: c.function?.name,
      args,
      ...(c.extra_content ? { extra: c.extra_content } : {})
    };
  });
  return { text: typeof message.content === 'string' ? message.content : '', toolCalls };
}

export function makeCallModel(config, fetchImpl = fetch) {
  return async ({ system, messages, tools }) => {
    const body = { model: config.model, messages: toWireMessages(system, messages), temperature: 0.2 };
    if (tools?.length) body.tools = tools.map((t) => ({ type: 'function', function: t }));
    const response = await fetchImpl(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000)
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`The model service answered ${response.status}. ${detail}`.trim());
    }
    return parseReply(await response.json());
  };
}
