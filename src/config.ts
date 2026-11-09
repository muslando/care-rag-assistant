import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().default("postgres://rag:rag@localhost:5432/rag"),
  OLLAMA_URL: z.string().url().default("http://localhost:11434"),
  CHAT_MODEL: z.string().default("gemma3:4b"),
  EMBED_MODEL: z.string().default("bge-m3"),
  EMBED_DIM: z.coerce.number().int().positive().default(1024),
  TOP_K: z.coerce.number().int().min(1).max(20).default(4),
  MIN_SCORE: z.coerce.number().min(0).max(1).default(0.5),
  CHUNK_SIZE: z.coerce.number().int().min(200).default(800),
  CHUNK_OVERLAP: z.coerce.number().int().min(0).default(150),
  DOCS_DIR: z.string().default("docs"),
  PORT: z.coerce.number().int().default(3000),
  API_KEY: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

export const config: Config = schema.parse(process.env);
