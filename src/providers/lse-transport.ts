import { createHash } from "node:crypto";
import { getConfig } from "../config.js";
import { currentAbortSignal, withCurrentAbortSignal } from "../infra/abort-context.js";
import { cache, runWithStaleMetadata } from "../infra/cache.js";
import {
  getUsage,
  isOverSoftThreshold,
  lseCredentialId,
  markExhausted,
  recordBytes,
  syncLseUsage,
} from "../infra/lse-byte-budget.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import { ProviderCredentialError } from "./provider-credential-error.js";

export const LSE_BASE_URL = "https://download.londonstrategicedge.com/v3";
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_WAIT_MS = 5_000;
let downloadTail: Promise<unknown> = Promise.resolve();
type ExportRows = Record<string, string>[];
// Share a file only within one cancellation lifetime. Independent runs still
// serialize downloads, but must not cancel each other.
const inFlight = new Map<string, Map<AbortSignal | undefined, Promise<ExportRows>>>();

export class LseHttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly code?: string,
  ) {
    super(`LSE HTTP ${status}${code ? ` (${code})` : ""}: ${detail}`);
    this.name = "LseHttpError";
  }
}

export interface LseUsage {
  plan: string;
  weekly: { allowance_bytes: number; used_bytes: number; week: string };
  rows: {
    per_export: number;
    per_day: number;
    used_today: number;
    day: string;
    resets_in_seconds: number;
  };
  withheld: string | null;
}

export function lseCacheKey(kind: string, params: Record<string, string>): string {
  return `lse:v3:${lseCredentialId()}:${kind}:${new URLSearchParams(params)}`;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function readBytes(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  const length = Number(response.headers.get("content-length"));
  if (length > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("LSE export exceeds 16 MiB; choose a shorter range");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("LSE returned an empty response");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new Error("LSE export exceeds 16 MiB; choose a shorter range");
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (
    response.headers.has("content-length") &&
    !response.headers.has("content-encoding") &&
    length !== total
  )
    throw new Error("LSE export was truncated (content length mismatch)");
  return bytes;
}

async function request<T>(
  path: string,
  params: Record<string, string>,
  consume: (response: Response, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const key = getConfig().lseApiKey;
  if (!key) throw new ProviderCredentialError("lse", "missing");
  const signal = withCurrentAbortSignal(AbortSignal.timeout(45_000));
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    await rateLimiter.acquire("lse");
    signal.throwIfAborted();
    const query = new URLSearchParams(params).toString();
    const response = await globalThis.fetch(`${LSE_BASE_URL}${path}${query ? `?${query}` : ""}`, {
      headers: { "x-api-key": key },
      redirect: "error",
      signal,
    });
    if (response.status === 200) return consume(response, signal);
    let body: { code?: string; message?: string; detail?: string; retry_after?: number } = {};
    try {
      body = JSON.parse(new TextDecoder().decode(await readBytes(response, signal)));
    } catch {
      signal.throwIfAborted();
    }
    const error = new LseHttpError(
      response.status,
      body.message ??
        body.detail ??
        (response.status === 202
          ? "LSE export is not ready; no complete CSV received"
          : response.statusText),
      body.code,
    );
    if (response.status === 401) throw new ProviderCredentialError("lse", "stale", 401);
    const retry = response.headers.get("retry-after");
    const seconds = retry !== null ? Number(retry) : body.retry_after;
    const retryMs =
      seconds !== undefined && Number.isFinite(seconds)
        ? seconds * 1000
        : retry
          ? Math.max(0, Date.parse(retry) - Date.now())
          : undefined;
    if (
      response.status === 429 &&
      (body.code === "allowance-exhausted" || body.code === "rows-exhausted")
    ) {
      markExhausted(body.code, seconds);
      throw error;
    }
    if (
      attempt >= 2 ||
      !(response.status === 429 || response.status >= 500) ||
      (retryMs !== undefined && retryMs > MAX_WAIT_MS)
    )
      throw error;
    await delay(
      retryMs !== undefined && Number.isFinite(retryMs)
        ? Math.max(0, retryMs)
        : 1000 * (attempt + 1),
      signal,
    );
  }
}

export async function getLseUsage(): Promise<LseUsage> {
  const key = lseCacheKey("usage", {});
  const blockedUntil = getUsage().blockedUntil;
  const expiredBlock = blockedUntil !== undefined && blockedUntil <= Date.now();
  const cached = expiredBlock ? undefined : cache.get<LseUsage>(key);
  if (cached) return cached;
  const result = await request("/usage", {}, async (response, signal) => {
    const parsed = JSON.parse(
      new TextDecoder().decode(await readBytes(response, signal)),
    ) as LseUsage;
    if (
      typeof parsed.plan !== "string" ||
      !parsed.weekly ||
      !parsed.rows ||
      ![
        parsed.weekly.allowance_bytes,
        parsed.weekly.used_bytes,
        parsed.rows.per_day,
        parsed.rows.used_today,
        parsed.rows.resets_in_seconds,
      ].every(Number.isFinite)
    )
      throw new Error("LSE usage response is invalid");
    // Do not retain the account's key name or unrelated account fields.
    return {
      plan: parsed.plan,
      weekly: parsed.weekly,
      rows: parsed.rows,
      withheld: parsed.withheld,
    };
  });
  syncLseUsage(result.weekly, result.rows);
  cache.set(key, result, 5 * 60_000);
  return result;
}

// RFC 4180 quoting is necessary: the financial-report data cell contains JSON,
// escaped quotes, commas, and occasionally line breaks. Never split by lines.
function parseCsv(csv: string): Record<string, string>[] {
  const records: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const pushCell = () => {
    row.push(cell);
    cell = "";
    closed = false;
  };
  const pushRow = () => {
    pushCell();
    if (row.some((value) => value !== "")) records.push(row);
    row = [];
  };
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += ch;
    } else if (ch === ",") pushCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && csv[i + 1] === "\n") i++;
      pushRow();
    } else if (ch === '"' && cell === "" && !closed) quoted = true;
    else {
      if (closed || ch === '"') throw new Error("LSE CSV contains malformed quoting");
      cell += ch;
    }
  }
  if (quoted) throw new Error("LSE CSV was truncated inside a quoted field");
  if (cell || row.length || closed) pushRow();
  const columns = records
    .shift()
    ?.map((column, i) => (i === 0 ? column.replace(/^\uFEFF/, "") : column));
  if (
    !columns?.length ||
    columns.some((c) => !c || ["__proto__", "constructor", "prototype"].includes(c)) ||
    new Set(columns).size !== columns.length
  )
    throw new Error("LSE CSV has invalid columns");
  return records.map((values) => {
    if (values.length !== columns.length) throw new Error("LSE CSV row has incorrect column count");
    return Object.fromEntries(columns.map((column, i) => [column, values[i]!]));
  });
}

function waitForCaller<T>(task: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return task;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    task.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(signal.reason);
        else resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(signal.aborted ? signal.reason : error);
      },
    );
  });
}

export function lseExport(
  path: string,
  params: Record<string, string>,
): Promise<Record<string, string>[]> {
  const key = lseCacheKey(path, params);
  const callerSignal = currentAbortSignal();
  callerSignal?.throwIfAborted();
  const group = inFlight.get(key) ?? new Map<AbortSignal | undefined, Promise<ExportRows>>();
  const existing = group.get(callerSignal);
  if (existing) return waitForCaller(existing, callerSignal);
  const run = downloadTail
    .catch(() => {})
    .then(async () => {
      callerSignal?.throwIfAborted();
      const usage = (await runWithStaleMetadata(getLseUsage)).value;
      if (usage.withheld) throw new LseHttpError(403, usage.withheld, "key-withheld");
      if (isOverSoftThreshold()) {
        const budget = getUsage();
        throw new LseHttpError(
          429,
          "LSE data allowance unavailable until reset",
          budget.blockReason ?? "allowance-soft-threshold",
        );
      }
      return request(path, params, async (response, signal) => {
        if (!response.headers.get("content-type")?.toLowerCase().includes("text/csv")) {
          await response.body?.cancel();
          throw new Error("LSE did not return a complete CSV export");
        }
        if (params.adjusted === "1" && response.headers.get("x-lse3-adjusted") !== "1") {
          await response.body?.cancel();
          throw new Error("LSE export did not confirm split adjustment");
        }
        const bytes = await readBytes(response, signal);
        recordBytes(bytes.byteLength);
        const checksum = response.headers.get("x-checksum-sha256");
        if (checksum && createHash("sha256").update(bytes).digest("hex") !== checksum.toLowerCase())
          throw new Error("LSE export checksum mismatch");
        const rows = parseCsv(new TextDecoder().decode(bytes));
        // This is the charged input-row count, not the CSV record count.
        // Aggregation and server-side selection can return fewer records.
        const advertisedRows = response.headers.get("x-export-rows");
        if (
          advertisedRows !== null &&
          (!/^\d+$/.test(advertisedRows) || !Number.isSafeInteger(Number(advertisedRows)))
        )
          throw new Error("LSE export charged row count is invalid");
        return rows;
      });
    });
  group.set(callerSignal, run);
  inFlight.set(key, group);
  downloadTail = run;
  void run
    .finally(() => {
      group.delete(callerSignal);
      if (group.size === 0) inFlight.delete(key);
    })
    .catch(() => {});
  return waitForCaller(run, callerSignal);
}
