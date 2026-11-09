import { readFile } from "node:fs/promises";
import { config } from "./config.js";
import { createApp } from "./container.js";

/**
 * Retrieval evaluation against a real Ollama + Postgres.
 *
 * For each question it checks whether the expected section is the top hit
 * (hit@1) or among the top-k (hit@k), and whether off-topic questions are
 * rejected by the MIN_SCORE threshold. Use it to tune MIN_SCORE and to
 * compare embedding models.
 */
interface Case {
  q: string;
  /** Heading suffix of the section that should be retrieved; null = should be rejected. */
  expect: string | null;
}

async function main() {
  const cases: Case[] = JSON.parse(await readFile("eval/questions.json", "utf8"));
  const { llm, store } = createApp();

  let hit1 = 0;
  let hitK = 0;
  let rejected = 0;
  const inScope = cases.filter((c) => c.expect !== null).length;
  const outScope = cases.length - inScope;
  const relevantTop: number[] = [];
  const offTopicTop: number[] = [];

  for (const c of cases) {
    const [embedding] = await llm.embed([c.q]);
    const hits = await store.search(embedding, config.TOP_K);
    const top = hits[0];
    const kept = hits.filter((h) => h.score >= config.MIN_SCORE);

    if (c.expect === null) {
      offTopicTop.push(top?.score ?? 0);
      const ok = kept.length === 0;
      if (ok) rejected++;
      console.log(`${ok ? "✓" : "✗"} [red] ${c.q}  → top ${top?.score.toFixed(3)} ${top?.heading}`);
      continue;
    }

    relevantTop.push(top?.score ?? 0);
    const rank = kept.findIndex((h) => h.heading.endsWith(c.expect!));
    if (rank === 0) hit1++;
    if (rank >= 0) hitK++;
    console.log(
      `${rank === 0 ? "✓" : rank > 0 ? "~" : "✗"} [#${rank >= 0 ? rank + 1 : "-"}] ${c.q}  → ${top?.score.toFixed(3)} ${top?.heading}`,
    );
  }

  const min = (a: number[]) => Math.min(...a).toFixed(3);
  const max = (a: number[]) => Math.max(...a).toFixed(3);
  console.log(`\nmodel=${config.EMBED_MODEL} MIN_SCORE=${config.MIN_SCORE} TOP_K=${config.TOP_K}`);
  console.log(`hit@1      ${hit1}/${inScope}`);
  console.log(`hit@${config.TOP_K}      ${hitK}/${inScope}`);
  console.log(`rejected   ${rejected}/${outScope}`);
  console.log(`top score  relevant ${min(relevantTop)}–${max(relevantTop)} | off-topic ${min(offTopicTop)}–${max(offTopicTop)}`);
  await store.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
