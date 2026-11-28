// OpenAI-compatible provider (e.g. ClassAI router), same interface as gemini.mjs.
export const CHAT_MODEL = process.env.AI_MODEL || "qwen3.7-plus";
export const EMBED_MODEL = process.env.AI_EMBED_MODEL || "text-embedding-3-small";
export const providerName = (base) =>
  process.env.AI_PROVIDER_NAME || (/classai/i.test(base) ? "ClassAI" : "OpenAI-compatible");

async function call(base, key, path, body) {
  const res = await fetch(`${base}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data?.error?.message || `${providerName(base)} HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

export async function embed(key, texts, base) {
  const vectors = [];
  for (let i = 0; i < texts.length; i += 100) {
    const data = await call(base, key, "embeddings", { model: EMBED_MODEL, input: texts.slice(i, i + 100) });
    vectors.push(...[...data.data].sort((a, b) => a.index - b.index).map((d) => d.embedding));
  }
  return vectors;
}

export const toMessages = (system, contents) => [
  { role: "system", content: system },
  ...contents.map((c) => ({
    role: c.role === "model" ? "assistant" : "user",
    content: c.parts.map((p) => p.text || "").join(""),
  })),
];

export async function generate(key, { system, contents, temperature = 0.2 }, base) {
  const data = await call(base, key, "chat/completions", {
    model: CHAT_MODEL,
    messages: toMessages(system, contents),
    temperature,
  });
  return (data?.choices?.[0]?.message?.content || "").trim();
}
