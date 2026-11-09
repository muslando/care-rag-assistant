import pg from "pg";
import type { Chunk } from "./chunk.js";

export interface SearchHit {
  source: string;
  heading: string;
  content: string;
  /** Cosine similarity, 0..1 (higher is closer). */
  score: number;
}

/** Retrieval backend. The Postgres implementation is the real one; tests use an in-memory fake. */
export interface VectorStore {
  search(embedding: number[], topK: number): Promise<SearchHit[]>;
}

const toVector = (v: number[]) => `[${v.join(",")}]`;

export class PgVectorStore implements VectorStore {
  readonly pool: pg.Pool;

  constructor(connectionString: string, private readonly dim: number) {
    this.pool = new pg.Pool({ connectionString, max: 5 });
  }

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE EXTENSION IF NOT EXISTS vector;
      CREATE TABLE IF NOT EXISTS documents (
        id          SERIAL PRIMARY KEY,
        source      TEXT NOT NULL UNIQUE,
        checksum    TEXT NOT NULL,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS chunks (
        id          SERIAL PRIMARY KEY,
        document_id INT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        chunk_index INT NOT NULL,
        heading     TEXT NOT NULL,
        content     TEXT NOT NULL,
        embedding   vector(${this.dim}) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw
        ON chunks USING hnsw (embedding vector_cosine_ops);
    `);
  }

  async documentChecksum(source: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ checksum: string }>(
      "SELECT checksum FROM documents WHERE source = $1",
      [source],
    );
    return rows[0]?.checksum ?? null;
  }

  /** Replaces all chunks of a document in one transaction, so a failed ingest never leaves half a document. */
  async replaceDocument(
    source: string,
    checksum: string,
    chunks: Chunk[],
    embeddings: number[][],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM documents WHERE source = $1", [source]);
      const { rows } = await client.query<{ id: number }>(
        "INSERT INTO documents (source, checksum) VALUES ($1, $2) RETURNING id",
        [source, checksum],
      );
      for (const [i, chunk] of chunks.entries()) {
        await client.query(
          `INSERT INTO chunks (document_id, chunk_index, heading, content, embedding)
           VALUES ($1, $2, $3, $4, $5)`,
          [rows[0].id, chunk.index, chunk.heading, chunk.content, toVector(embeddings[i])],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async removeMissing(keep: string[]): Promise<number> {
    const { rowCount } = await this.pool.query(
      "DELETE FROM documents WHERE NOT (source = ANY($1::text[]))",
      [keep],
    );
    return rowCount ?? 0;
  }

  async search(embedding: number[], topK: number): Promise<SearchHit[]> {
    const { rows } = await this.pool.query<SearchHit>(
      `SELECT d.source, c.heading, c.content, 1 - (c.embedding <=> $1) AS score
         FROM chunks c JOIN documents d ON d.id = c.document_id
        ORDER BY c.embedding <=> $1
        LIMIT $2`,
      [toVector(embedding), topK],
    );
    return rows.map((r) => ({ ...r, score: Number(r.score) }));
  }

  async stats(): Promise<{ documents: number; chunks: number }> {
    const { rows } = await this.pool.query<{ documents: string; chunks: string }>(
      "SELECT (SELECT count(*) FROM documents) AS documents, (SELECT count(*) FROM chunks) AS chunks",
    );
    return { documents: Number(rows[0].documents), chunks: Number(rows[0].chunks) };
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}
