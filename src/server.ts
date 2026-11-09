import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { createApp } from "./container.js";
import { createHttpApp } from "./http.js";

const { rag, store } = createApp();
await store.migrate();

const server = serve({ fetch: createHttpApp(rag, { apiKey: config.API_KEY }).fetch, port: config.PORT }, (info) =>
  console.log(`care-rag-assistant http://localhost:${info.port}`),
);

const shutdown = () => {
  server.close();
  void store.close().then(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
