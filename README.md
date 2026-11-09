# care-rag-assistant

A question-answering assistant over care-center procedure documents that **cites its sources**.
It runs **fully locally**: data never leaves the server and no external LLM API is needed.

- **Local LLM:** [Ollama](https://ollama.com) (`gemma3:4b` for chat, multilingual `bge-m3` for embeddings)
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
| Multilingual `bge-m3` embeddings, threshold tuned on an eval set | See [Evaluation](#evaluation): the English-centric model could not separate on-topic from off-topic Turkish questions |

## Running

### Docker Compose

On **macOS**, run Ollama natively so it can use the GPU (inside Docker it is CPU-only and several times slower).
Postgres and the app run in Docker:

```bash
brew install ollama && ollama serve &          # or the Ollama desktop app
ollama pull gemma3:4b && ollama pull bge-m3    # ~4.5 GB
docker compose up -d --build
docker compose exec app node dist/ingest.js
```

On a **Linux server**, everything can run in containers; the `models` service pulls the models on first start:

```bash
OLLAMA_URL=http://ollama:11434 docker compose --profile ollama up -d --build
docker compose exec app node dist/ingest.js
```

```bash
curl -s localhost:3000/api/ask \
  -H 'content-type: application/json' \
  -d '{"question":"Yüksek riskli sakinler gece ne sıklıkla kontrol edilir?"}' | jq
```

Response (from a real run; wording can vary slightly between runs):

```json
{
  "answer": "Yüksek riskli sakinler gece boyunca iki saatte bir kontrol edilir [1].",
  "grounded": true,
  "sources": [
    { "id": 1, "source": "dusme-onleme-protokolu.md", "heading": "Düşme Önleme Protokolü > Gece Kontrolleri", "score": 0.719 },
    { "id": 2, "source": "dusme-onleme-protokolu.md", "heading": "Düşme Önleme Protokolü > Risk Değerlendirmesi", "score": 0.612 }
  ]
}
```

A question the documents do not cover (e.g. `"Otoparkın şifresi nedir?"`, "What is the parking lot password?") returns
`grounded: false` with a fixed "not found" answer.

### Local development

```bash
ollama pull gemma3:4b && ollama pull bge-m3
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
| `CHAT_MODEL` | `gemma3:4b` | Any Ollama chat model |
| `EMBED_MODEL` / `EMBED_DIM` | `bge-m3` / `1024` | When changing the model, update the dimension and run `npm run ingest -- --reset` |
| `TOP_K` | `4` | Number of chunks passed to the model |
| `MIN_SCORE` | `0.5` | Chunks below this similarity are discarded (tuned with `npm run eval`) |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | `800` / `150` | In characters |

## Evaluation

`eval/questions.json` holds 15 questions the documents answer (each with the section that should be retrieved) and
5 off-topic questions that must be rejected. `npm run eval` runs them against the real Ollama + Postgres stack.

| Embedding model | hit@1 | hit@4 | Off-topic rejected | Top score: on-topic | Top score: off-topic |
|---|---|---|---|---|---|
| `nomic-embed-text` (768) | 12/15 | 14/15 | 0/5 | 0.686–0.874 | 0.608–0.695 |
| **`bge-m3` (1024)** | **15/15** | **15/15** | **5/5** | 0.551–0.760 | 0.394–0.455 |

With `nomic-embed-text` the on-topic and off-topic score ranges overlap, so no threshold can separate them.
`bge-m3` leaves a clear gap, and `MIN_SCORE=0.5` sits in the middle of it.

For answer generation, `qwen2.5:3b` produced a contradictory answer to a yes/no question about medication
("can I give a make-up dose?"); `gemma3:4b` answered all spot-check questions correctly and consistently across runs.
Answers take about 1.5–3 s on an Apple Silicon Mac (first request after start loads the model and is slower).

## Tests

```bash
npm test          # chunking, RAG flow, HTTP validation and auth
npm run typecheck
```

Tests use fake LLM and vector store implementations; they do not need Ollama or Postgres.

## Roadmap

- Hybrid search (pgvector + PostgreSQL full-text) and reranking
- Answer-level evaluation (LLM-as-judge) in addition to retrieval metrics
- PDF / DOCX ingest
- Streaming answers (SSE)

## License

MIT
