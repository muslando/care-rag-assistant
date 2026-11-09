import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { chunkMarkdown } from "./chunk.js";
import { config } from "./config.js";
import { createApp } from "./container.js";

const BATCH = 16;

async function listMarkdown(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && /\.(md|txt)$/i.test(e.name))
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

async function main() {
  const force = process.argv.includes("--force");
  const { llm, store } = createApp();
  if (process.argv.includes("--reset")) {
    await store.reset();
    console.log("Tablolar silindi, baştan oluşturuluyor.");
  }
  await store.migrate();

  const files = await listMarkdown(config.DOCS_DIR);
  const sources: string[] = [];
  let ingested = 0;

  for (const file of files) {
    const source = relative(config.DOCS_DIR, file);
    sources.push(source);
    const text = await readFile(file, "utf8");
    const checksum = createHash("sha256").update(text).digest("hex");

    // Unchanged files are skipped, so re-running ingest is cheap.
    if (!force && (await store.documentChecksum(source)) === checksum) {
      console.log(`= ${source} (değişmedi)`);
      continue;
    }

    const chunks = chunkMarkdown(text, config.CHUNK_SIZE, config.CHUNK_OVERLAP);
    const embeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      // Heading is embedded with the text so "gece kontrolü" also matches chunks under that heading.
      embeddings.push(...(await llm.embed(batch.map((c) => `${c.heading}\n${c.content}`))));
    }

    if (embeddings[0] && embeddings[0].length !== config.EMBED_DIM) {
      throw new Error(
        `Embedding boyutu ${embeddings[0].length}, EMBED_DIM ise ${config.EMBED_DIM}. EMBED_DIM ayarını modele göre düzeltin.`,
      );
    }

    await store.replaceDocument(source, checksum, chunks, embeddings);
    ingested++;
    console.log(`+ ${source} (${chunks.length} parça)`);
  }

  const removed = await store.removeMissing(sources);
  const stats = await store.stats();
  console.log(
    `\nTamamlandı: ${ingested} doküman işlendi, ${removed} silindi. Toplam ${stats.documents} doküman / ${stats.chunks} parça.`,
  );
  await store.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
