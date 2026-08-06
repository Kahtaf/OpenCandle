/**
 * Browser-safe compatibility surface for ddg-kit.
 *
 * The canonical DDG provider uses undici. In a WebContainer, its requests
 * must use the hosted global fetch so they cross the bounded provider relay
 * instead of opening a second, unmediated network path.
 */
type BrowserRequestOptions = {
  body?: BodyInit | null;
  dispatcher?: unknown;
  headers?: HeadersInit;
  method?: string;
  signal?: AbortSignal;
};

type BrowserResponseBody = AsyncIterable<Uint8Array> & {
  destroy(): void;
  dump(): Promise<void>;
};

export class ProxyAgent {
  constructor(_proxy: string | URL) {}

  async close(): Promise<void> {}
}

export async function request(
  input: string | URL,
  options: BrowserRequestOptions = {},
): Promise<{
  body: BrowserResponseBody;
  headers: Record<string, string>;
  statusCode: number;
}> {
  const response = await globalThis.fetch(input, {
    ...(options.body === undefined ? {} : { body: options.body }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(options.method === undefined ? {} : { method: options.method }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return {
    body: browserResponseBody(response.body),
    headers: Object.fromEntries(response.headers.entries()),
    statusCode: response.status,
  };
}

function browserResponseBody(stream: ReadableStream<Uint8Array> | null): BrowserResponseBody {
  const reader = stream?.getReader();
  return {
    async *[Symbol.asyncIterator]() {
      if (!reader) return;
      while (true) {
        const next = await reader.read();
        if (next.done) return;
        yield next.value;
      }
    },
    destroy() {
      void reader?.cancel();
    },
    async dump() {
      await reader?.cancel();
    },
  };
}
