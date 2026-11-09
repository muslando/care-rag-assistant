import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { createApp } from "./container.js";
import { createHttpApp } from "./http.js";

const { rag, store, llm } = createApp();
await store.migrate();

// Warn early instead of failing on the first question.
await llm
  .missingModels()
  .then((missing) => {
    if (missing.length) console.warn(`UYARI: Ollama'da eksik model(ler): ${missing.join(", ")}. "ollama pull <model>" ile indirin.`);
  })
  .catch((err) => console.warn(`UYARI: Ollama'ya ${config.OLLAMA_URL} adresinden ulaşılamadı: ${err.message}`));

const server = serve({ fetch: createHttpApp(rag, { apiKey: config.API_KEY }).fetch, port: config.PORT }, (info) =>
  console.log(`care-rag-assistant http://localhost:${info.port}`),
);

const shutdown = () => {
  server.close();
  void store.close().then(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
