import { config } from "./config.js";
import { OllamaClient } from "./llm.js";
import { RagService } from "./rag.js";
import { PgVectorStore } from "./store.js";

/** Wires the real dependencies together. Entry points call this; tests build their own. */
export function createApp() {
  const llm = new OllamaClient(config.OLLAMA_URL, config.CHAT_MODEL, config.EMBED_MODEL);
  const store = new PgVectorStore(config.DATABASE_URL, config.EMBED_DIM);
  const rag = new RagService(llm, store, { topK: config.TOP_K, minScore: config.MIN_SCORE });
  return { llm, store, rag };
}
