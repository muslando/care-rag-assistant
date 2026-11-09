export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** The two model operations the app needs. Swappable so tests run without Ollama. */
export interface LLM {
  embed(texts: string[]): Promise<number[][]>;
  chat(messages: ChatMessage[]): Promise<string>;
}

export class OllamaClient implements LLM {
  constructor(
    private readonly baseUrl: string,
    private readonly chatModel: string,
    private readonly embedModel: string,
    private readonly timeoutMs = 120_000,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.post<{ embeddings: number[][] }>("/api/embed", {
      model: this.embedModel,
      input: texts,
    });
    if (res.embeddings.length !== texts.length) {
      throw new Error(`Ollama returned ${res.embeddings.length} embeddings for ${texts.length} inputs`);
    }
    return res.embeddings;
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const res = await this.post<{ message: { content: string } }>("/api/chat", {
      model: this.chatModel,
      messages,
      stream: false,
      // Low temperature: answers should stick to the retrieved text.
      options: { temperature: 0.1 },
    });
    return res.message.content.trim();
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`Ollama ${path} failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as T;
  }
}
