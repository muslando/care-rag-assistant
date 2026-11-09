import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createApp } from "./container.js";
import type { RagService } from "./rag.js";

/** Exposes the RAG pipeline as MCP tools so any MCP client (AI desktop apps, IDEs) can query the documents. */
export function createMcpServer(rag: RagService) {
  const server = new McpServer({ name: "care-rag-assistant", version: "1.0.0" });

  server.registerTool(
    "search_care_documents",
    {
      title: "Bakım dokümanlarında ara",
      description:
        "Bakım merkezi prosedür dokümanlarında anlamsal arama yapar ve en ilgili parçaları kaynaklarıyla döndürür.",
      inputSchema: {
        query: z.string().min(2).max(500).describe("Aranacak konu veya soru"),
        limit: z.number().int().min(1).max(10).default(4),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit }) => {
      const hits = await rag.retrieve(query, limit);
      const text = hits.length
        ? hits
            .map((h, i) => `[${i + 1}] ${h.source} — ${h.heading} (benzerlik ${h.score.toFixed(2)})\n${h.content}`)
            .join("\n\n---\n\n")
        : "İlgili doküman bulunamadı.";
      return { content: [{ type: "text", text }] };
    },
  );

  server.registerTool(
    "ask_care_assistant",
    {
      title: "Bakım asistanına sor",
      description:
        "Soruyu lokal LLM ile, yalnızca bakım dokümanlarına dayanarak ve kaynak göstererek cevaplar.",
      inputSchema: { question: z.string().min(3).max(500) },
      annotations: { readOnlyHint: true },
    },
    async ({ question }) => {
      const result = await rag.ask(question);
      const sources = result.sources.map((s) => `[${s.id}] ${s.source} — ${s.heading}`).join("\n");
      return {
        content: [{ type: "text", text: sources ? `${result.answer}\n\nKaynaklar:\n${sources}` : result.answer }],
      };
    },
  );

  return server;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { rag } = createApp();
  // stdout is the MCP channel; logs must go to stderr.
  await createMcpServer(rag).connect(new StdioServerTransport());
  console.error("care-rag-assistant MCP sunucusu stdio üzerinde çalışıyor");
}
