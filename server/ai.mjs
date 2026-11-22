import * as gemini from "./gemini.mjs";
import * as openai from "./openai.mjs";

const provider = process.env.AI_BASE_URL ? openai : { ...gemini, PROVIDER: "Gemini" };
export const { embed, generate, CHAT_MODEL, PROVIDER } = provider;
