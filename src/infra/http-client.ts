export interface HttpClientOptions {
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  headers?: Record<string, string>;
}

const DEFAULT_OPTIONS: Required<HttpClientOptions> = {
  timeoutMs: 10_000,
  maxRetries: 2,
  retryDelayMs: 1_000,
  headers: {},
};

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: string,
  ) {
    super(`HTTP ${status} ${statusText}`);
    this.name = "HttpError";
  }
}

export async function httpGet<T>(
  url: string,
  options: HttpClientOptions = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(opts.retryDelayMs * attempt);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: opts.headers,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new HttpError(response.status, response.statusText, body);
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error as Error;
      if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
        throw error; // Don't retry client errors
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
