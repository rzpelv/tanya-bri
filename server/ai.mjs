import * as gemini from "./gemini.mjs";
import * as openai from "./openai.mjs";

const provider = process.env.AI_BASE_URL ? openai : { ...gemini, PROVIDER: "Gemini" };
export const { embed, generate, CHAT_MODEL, EMBED_MODEL, PROVIDER } = provider;
export const ENV_KEY = (process.env.AI_BASE_URL ? process.env.AI_API_KEY : process.env.GEMINI_API_KEY)?.trim();
// Keys saved in the app are kept per provider so one provider's key is never sent to another.
export const CONFIG_KEY = process.env.AI_BASE_URL ? "aiKey" : "geminiKey";
