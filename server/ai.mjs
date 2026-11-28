import * as gemini from "./gemini.mjs";
import * as openai from "./openai.mjs";

export const normalizeBaseUrl = (value) => String(value || "").trim().replace(/\/+$/, "");
export const ENV_BASE_URL = normalizeBaseUrl(process.env.AI_BASE_URL);
export const ENV_KEY = (ENV_BASE_URL ? process.env.AI_API_KEY : process.env.GEMINI_API_KEY)?.trim();

let base = ENV_BASE_URL;
export const setBaseUrl = (url) => (base = normalizeBaseUrl(url) || ENV_BASE_URL);
export const baseUrl = () => base;

export const provider = (b = base) => (b ? openai.providerName(b) : "Gemini");
export const chatModel = (b = base) => (b ? openai.CHAT_MODEL : gemini.CHAT_MODEL);
// Vectors from a different endpoint may not be comparable, so its model id is tagged with the host.
export const embedModel = (b = base) =>
  !b ? gemini.EMBED_MODEL : b === ENV_BASE_URL ? openai.EMBED_MODEL : `${new URL(b).host}/${openai.EMBED_MODEL}`;
// Keys saved in the app are kept per provider so one provider's key is never sent to another.
export const configKey = (b = base) => (b ? "aiKey" : "geminiKey");

export const embed = (key, texts, task, b = base) => (b ? openai.embed(key, texts, b) : gemini.embed(key, texts, task));
export const generate = (key, options, b = base) => (b ? openai.generate(key, options, b) : gemini.generate(key, options));
