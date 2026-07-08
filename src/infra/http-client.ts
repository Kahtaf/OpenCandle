export interface HttpClientOptions {
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  maxRetryAfterMs?: number;
  headers?: Record<string, string>;
}

const DEFAULT_OPTIONS: Required<HttpClientOptions> = {
  timeoutMs: 10_000,
  maxRetries: 2,
  retryDelayMs: 1_000,
  maxRetryAfterMs: 5_000,
  headers: {},
};

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: string,
    public readonly retryAfterMs?: number,
  ) {
    super(`HTTP ${status} ${statusText}`);
    this.name = "HttpError";
  }
}

export async function httpGet<T>(url: string, options: HttpClientOptions = {}): Promise<T> {
  return httpRequest<T>(url, { ...options, method: "GET" });
}

export async function httpPost<T>(
  url: string,
  body: unknown,
  options: HttpClientOptions = {},
): Promise<T> {
  return httpRequest<T>(url, {
    ...options,
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

interface HttpRequestOptions extends HttpClientOptions {
  method: "GET" | "POST";
  body?: string;
}

async function httpRequest<T>(url: string, options: HttpRequestOptions): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    let retryDelayMs: number | undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

    try {
      const response = await fetch(url, {
        method: opts.method,
        signal: controller.signal,
        headers: opts.headers,
        ...(opts.body !== undefined && { body: opts.body }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new HttpError(
          response.status,
          response.statusText,
          body,
          parseRetryAfterMs(response.headers?.get?.("retry-after") ?? null),
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error as Error;
      if (!isRetryableError(error)) {
        throw error; // Don't retry client errors
      }
      if (attempt < opts.maxRetries) {
        retryDelayMs =
          error instanceof HttpError && error.status === 429 && error.retryAfterMs !== undefined
            ? capRetryAfterMs(error.retryAfterMs, opts.maxRetryAfterMs)
            : opts.retryDelayMs * (attempt + 1);
      }
    } finally {
      clearTimeout(timeout);
    }

    if (retryDelayMs !== undefined) {
      await sleep(retryDelayMs);
    }
  }

  throw lastError ?? new Error("HTTP request failed without an error");
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof HttpError)) return true;
  if (error.status === 429) return true;
  return error.status < 400 || error.status >= 500;
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}

function capRetryAfterMs(retryAfterMs: number, maxRetryAfterMs: number | undefined): number {
  if (maxRetryAfterMs === undefined) return retryAfterMs;
  return Math.min(retryAfterMs, Math.max(0, maxRetryAfterMs));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
