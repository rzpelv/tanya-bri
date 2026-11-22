const BASE = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/models";
export const CHAT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
export const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";
const DIMENSIONS = 768;

async function call(key, path, body) {
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data?.error?.message || `Gemini HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

export async function embed(key, texts, taskType = "RETRIEVAL_DOCUMENT") {
  const vectors = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const data = await call(key, `${EMBED_MODEL}:batchEmbedContents`, {
      requests: batch.map((text) => ({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: DIMENSIONS,
      })),
    });
    vectors.push(...data.embeddings.map((e) => e.values));
  }
  return vectors;
}

export async function generate(key, { system, contents, temperature = 0.2 }) {
  const data = await call(key, `${CHAT_MODEL}:generateContent`, {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature },
  });
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("").trim();
}
