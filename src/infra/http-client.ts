import { currentAbortSignal } from "./abort-context.js";

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
  // A stopped run aborts its in-flight request and is never retried.
  const runSignal = currentAbortSignal();
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    runSignal?.throwIfAborted();
    let retryDelayMs: number | undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);
    const signal = runSignal ? AbortSignal.any([controller.signal, runSignal]) : controller.signal;

    try {
      const response = await fetch(url, {
        method: opts.method,
        signal,
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
      if (runSignal?.aborted || !isRetryableError(error)) {
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
      await sleep(retryDelayMs, runSignal);
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

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  // Never called with an already-aborted signal: the retry loop checks the
  // run signal synchronously right before choosing a delay.
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
