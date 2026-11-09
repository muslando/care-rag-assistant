import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import type { RagService } from "./rag.js";

const askSchema = z.object({ question: z.string().trim().min(3).max(500) });
const searchSchema = z.object({
  q: z.string().trim().min(2).max(500),
  k: z.coerce.number().int().min(1).max(20).default(4),
});

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Builds the HTTP API. Kept separate from the server bootstrap so it can be tested with app.request(). */
export function createHttpApp(rag: RagService, opts: { apiKey?: string } = {}) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  // Optional bearer-token auth for everything except /health.
  app.use("/api/*", async (c, next) => {
    if (!opts.apiKey) return next();
    const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!safeEqual(token, opts.apiKey)) return c.json({ error: "unauthorized" }, 401);
    return next();
  });

  app.post("/api/ask", async (c) => {
    const parsed = askSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    return c.json(await rag.ask(parsed.data.question));
  });

  app.get("/api/search", async (c) => {
    const parsed = searchSchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "invalid_request", issues: parsed.error.issues }, 400);
    return c.json({ hits: await rag.retrieve(parsed.data.q, parsed.data.k) });
  });

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
