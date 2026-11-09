# care-rag-assistant

A question-answering assistant over care-center procedure documents that **cites its sources**.
It runs **fully locally**: data never leaves the server and no external LLM API is needed.

- **Local LLM:** [Ollama](https://ollama.com) (`qwen2.5:3b` for chat, `nomic-embed-text` for embeddings)
- **RAG:** PostgreSQL + [pgvector](https://github.com/pgvector/pgvector) (HNSW index, cosine similarity)
- **API:** TypeScript, Node.js, Hono, Zod
- **MCP server:** The same RAG pipeline exposed as MCP tools, so any MCP-capable AI client can query the documents
- **Infrastructure:** One command with Docker Compose

The sample documents, the system prompt and the answers are in **Turkish**. The project doubles as an example of a
RAG pipeline working on a non-English corpus with a small local model.

> The documents under `docs/` are **fictional demo data**. They are not the procedures of any real organization and are not medical advice.

## Architecture

```
                 ┌──────────── ingest (CLI) ─────────────┐
 docs/*.md ──▶ chunk (heading-aware, overlap) ──▶ Ollama embed ──▶ PostgreSQL + pgvector
                                                                        │
 question ──▶ Ollama embed ──▶ vector search (top-k, min score) ◀───────┘
                                   │
                    below score threshold ──▶ "not found" (model is not called)
                                   │
                    sources + question ──▶ Ollama chat ──▶ answer with [1], [2] citations
                                   │
                    HTTP API (/api/ask, /api/search)  ·  MCP (stdio)
```

## Design decisions

| Decision | Why |
|---|---|
| Chunks carry their Markdown heading path (`Protocol > Night Checks`) | Citations are readable, and embedding the heading with the text improves retrieval |
| Split on paragraph boundaries with overlap | Context is not lost by cutting sentences in half |
| The model is never called below the similarity threshold | Hallucination on unrelated questions is prevented structurally, not by prompting |
| Retrieved text sits in a `<kaynaklar>` block marked as "data, not instructions" | First line of defense against prompt injection hidden in documents |
| SHA-256 checksum per document, rewritten inside a transaction | Ingest is idempotent: unchanged files are skipped and a failed run never leaves half a document |
| `LLM` and `VectorStore` interfaces | Tests run without Ollama or Postgres; swapping the model or vector DB is one class |
| Local model | Sensitive data such as health records is never sent to a third-party API |

## Running

### Docker Compose (recommended)

```bash
docker compose up -d --build        # models are downloaded on first start (~2.5 GB)
docker compose exec app node dist/ingest.js
```

```bash
curl -s localhost:3000/api/ask \
  -H 'content-type: application/json' \
  -d '{"question":"Yüksek riskli sakinler gece ne sıklıkla kontrol edilir?"}' | jq
```

Example response shape (illustrative; wording and scores vary by model):

```json
{
  "answer": "- Yüksek riskli sakinler gece boyunca iki saatte bir kontrol edilir [1].\n- Kontrol saati ve gözlem notu gece kontrol formuna yazılır [1].",
  "grounded": true,
  "sources": [
    { "id": 1, "source": "dusme-onleme-protokolu.md", "heading": "Düşme Önleme Protokolü > Gece Kontrolleri", "score": 0.78 }
  ]
}
```

A question the documents do not cover (e.g. `"Otoparkın şifresi nedir?"`, "What is the parking lot password?") returns
`grounded: false` with a fixed "not found" answer.

### Local development

```bash
ollama pull qwen2.5:3b && ollama pull nomic-embed-text
docker compose up -d db
cp .env.example .env
npm install
npm run ingest
npm run dev
```

## API

| Endpoint | Description |
|---|---|
| `GET /health` | Health check |
| `POST /api/ask` `{ "question": string }` | Answer with sources |
| `GET /api/search?q=...&k=4` | Vector search only (no LLM call) |

When `API_KEY` is set, `/api/*` requires `Authorization: Bearer <key>` (constant-time comparison).

## MCP server

Exposes two tools: `search_care_documents` and `ask_care_assistant`. Add it to your MCP client configuration:

```json
{
  "mcpServers": {
    "care-rag": {
      "command": "npx",
      "args": ["tsx", "/path/to/care-rag-assistant/src/mcp.ts"],
      "env": { "DATABASE_URL": "postgres://rag:rag@localhost:5432/rag" }
    }
  }
}
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `CHAT_MODEL` | `qwen2.5:3b` | Any Ollama chat model |
| `EMBED_MODEL` / `EMBED_DIM` | `nomic-embed-text` / `768` | Update the dimension when changing the embedding model |
| `TOP_K` | `4` | Number of chunks passed to the model |
| `MIN_SCORE` | `0.35` | Chunks below this similarity are discarded |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | `800` / `150` | In characters |

## Tests

```bash
npm test          # chunking, RAG flow, HTTP validation and auth
npm run typecheck
```

Tests use fake LLM and vector store implementations; they do not need Ollama or Postgres.

## Roadmap

- Hybrid search (pgvector + PostgreSQL full-text) and reranking
- An evaluation set of questions and answers to measure retrieval quality
- PDF / DOCX ingest
- Streaming answers (SSE)

## License

MIT
