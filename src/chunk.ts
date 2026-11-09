export interface Chunk {
  /** Closest Markdown heading above the chunk, used as a citation anchor. */
  heading: string;
  content: string;
  index: number;
}

/**
 * Splits a Markdown document into overlapping chunks.
 *
 * Paragraphs are kept intact where possible so a chunk never cuts a
 * sentence in half. Each chunk remembers the heading it belongs to, which
 * the answer uses as a citation ("Düşme Önleme Protokolü > Gece Kontrolleri").
 */
export function chunkMarkdown(text: string, size = 800, overlap = 150): Chunk[] {
  if (overlap >= size) throw new Error("overlap must be smaller than size");

  const sections = splitByHeadings(text);
  const chunks: Chunk[] = [];

  for (const { heading, body } of sections) {
    const paragraphs = body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .flatMap((p) => (p.length > size ? hardSplit(p, size) : [p]));

    let current = "";
    for (const paragraph of paragraphs) {
      if (current && current.length + paragraph.length + 2 > size) {
        chunks.push({ heading, content: current, index: chunks.length });
        current = tail(current, overlap);
      }
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
    if (current) chunks.push({ heading, content: current, index: chunks.length });
  }

  return chunks;
}

function splitByHeadings(text: string): { heading: string; body: string }[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const path: string[] = [];
  const sections: { heading: string; body: string }[] = [];
  let body: string[] = [];

  const flush = () => {
    const joined = body.join("\n").trim();
    if (joined) sections.push({ heading: path.filter(Boolean).join(" > "), body: joined });
    body = [];
  };

  for (const line of lines) {
    const match = /^(#{1,3})\s+(.+)$/.exec(line);
    if (match) {
      flush();
      const level = match[1].length;
      path.length = level - 1;
      path[level - 1] = match[2].trim();
    } else {
      body.push(line);
    }
  }
  flush();
  return sections;
}

/** Last `overlap` characters, starting at a word boundary. */
function tail(text: string, overlap: number): string {
  if (overlap === 0) return "";
  const slice = text.slice(-overlap);
  const space = slice.indexOf(" ");
  return space === -1 ? slice : slice.slice(space + 1);
}

/** Splits an oversized paragraph on sentence boundaries, falling back to hard cuts. */
function hardSplit(paragraph: string, size: number): string[] {
  const sentences = paragraph.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [paragraph];
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > size) {
      if (current) parts.push(current.trim());
      current = "";
      for (let i = 0; i < sentence.length; i += size) parts.push(sentence.slice(i, i + size).trim());
      continue;
    }
    if (current.length + sentence.length > size) {
      parts.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
