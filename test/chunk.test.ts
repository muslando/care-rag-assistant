import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "../src/chunk.js";

describe("chunkMarkdown", () => {
  it("attaches the heading path to each chunk", () => {
    const md = "# Protokol\n\nGiriş metni.\n\n## Gece Kontrolleri\n\nİki saatte bir kontrol edilir.";
    const chunks = chunkMarkdown(md, 800, 100);
    expect(chunks.map((c) => c.heading)).toEqual(["Protokol", "Protokol > Gece Kontrolleri"]);
    expect(chunks[1].content).toBe("İki saatte bir kontrol edilir.");
  });

  it("resets deeper heading levels when a higher one starts", () => {
    const md = "# A\n## B\n### C\nmetin c\n## D\nmetin d";
    expect(chunkMarkdown(md).map((c) => c.heading)).toEqual(["A > B > C", "A > D"]);
  });

  it("respects the size limit and overlaps consecutive chunks", () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) => `Paragraf ${i} ` + "kelime ".repeat(20));
    const chunks = chunkMarkdown(`# T\n\n${paragraphs.join("\n\n")}`, 400, 80);

    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(400 + 80);
    // The start of each chunk repeats the end of the previous one.
    for (let i = 1; i < chunks.length; i++) {
      const head = chunks[i].content.slice(0, 20);
      expect(chunks[i - 1].content).toContain(head);
    }
  });

  it("splits a single oversized paragraph on sentence boundaries", () => {
    const long = "Bu bir cümledir. ".repeat(100);
    const chunks = chunkMarkdown(long, 300, 0);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(300);
  });

  it("numbers chunks sequentially and drops empty sections", () => {
    const chunks = chunkMarkdown("# Boş\n\n# Dolu\n\nmetin");
    expect(chunks).toEqual([{ heading: "Dolu", content: "metin", index: 0 }]);
  });

  it("rejects overlap >= size", () => {
    expect(() => chunkMarkdown("x", 100, 100)).toThrow();
  });

  it("chunks the bundled sample documents", async () => {
    const md = await readFile(new URL("../docs/dusme-onleme-protokolu.md", import.meta.url), "utf8");
    const chunks = chunkMarkdown(md, 800, 150);
    expect(chunks.some((c) => c.heading === "Düşme Önleme Protokolü > Gece Kontrolleri")).toBe(true);
  });
});
