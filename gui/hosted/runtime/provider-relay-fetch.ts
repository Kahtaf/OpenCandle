import {
  isModelRelayProvider,
  MODEL_RELAY_HEADERS,
  MODEL_RELAY_PATH,
  type ModelRelayProvider,
  modelRelayProviderForUrl,
  PROVIDER_RELAY_CONTRACT_VERSION,
  PROVIDER_RELAY_HEALTH_PATH,
} from "../../../src/runtime/provider-relay-contract.js";

const RELAY_CONTRACT_VERSION = PROVIDER_RELAY_CONTRACT_VERSION;
const MAX_RELAY_ENVELOPE_BYTES = 6 * 1024 * 1024;
const DEFAULT_RELAY_HEALTH_TIMEOUT_MS = 5_000;
const DEFAULT_RELAY_MANIFEST_MAX_AGE_MS = 60_000;
const ABORTED = Symbol("aborted");

type RelayProvider =
  | ModelRelayProvider
  | "brave"
  | "exa"
  | "fear_greed"
  | "finnhub"
  | "fred"
  | "lse"
  | "sec_edgar"
  | "tradingview"
  | "yahoo";

interface HostedProviderFetchOptions {
  relayUrl: string;
  clientId: string;
  fetchImpl?: typeof globalThis.fetch;
}

interface RelayResponseEnvelope {
  version: number;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  upstreamSetCookie?: string;
  bodyBase64: string;
}

export interface HostedRelayManifest {
  version: 1;
  providers: string[];
}

export function createHostedRelayManifestLoader(options: {
  relayUrl: string;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxAgeMs?: number;
  now?: () => number;
}): () => Promise<HostedRelayManifest | undefined> {
  let cached: HostedRelayManifest | undefined;
  let cachedAt = 0;
  let inFlight: Promise<HostedRelayManifest | undefined> | undefined;
  return async () => {
    const now = options.now ?? Date.now;
    const maxAgeMs = options.maxAgeMs ?? DEFAULT_RELAY_MANIFEST_MAX_AGE_MS;
    if (cached && now() - cachedAt <= maxAgeMs) return cached;
    inFlight ??= fetchHostedRelayManifest(options)
      .then((manifest) => {
        cached = manifest;
        cachedAt = now();
        return manifest;
      })
      .catch(() => {
        cached = undefined;
        cachedAt = 0;
        return undefined;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
}

export async function fetchHostedRelayManifest(options: {
  relayUrl: string;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
}): Promise<HostedRelayManifest> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const healthUrl = new URL(options.relayUrl);
  healthUrl.pathname = PROVIDER_RELAY_HEALTH_PATH;
  healthUrl.search = "";
  healthUrl.hash = "";
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_RELAY_HEALTH_TIMEOUT_MS,
  );
  let serialized: string;
  try {
    const response = await fetchImpl(healthUrl.toString(), {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Hosted provider relay health check failed");
    serialized = await readBoundedText(response, 32_768, controller.signal);
    if (controller.signal.aborted) {
      throw new Error("Hosted provider relay health check timed out");
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Hosted provider relay health check timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Hosted provider relay returned an invalid manifest");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Hosted provider relay returned an invalid manifest");
  }
  const value = parsed as Record<string, unknown>;
  if (
    value.version !== RELAY_CONTRACT_VERSION ||
    !Array.isArray(value.providers) ||
    !value.providers.every(
      (provider) => typeof provider === "string" && /^[a-z0-9_]{1,64}$/.test(provider),
    )
  ) {
    throw new Error("Hosted provider relay manifest is incompatible");
  }
  return {
    version: RELAY_CONTRACT_VERSION,
    providers: [...new Set(value.providers)].sort(),
  };
}

export function createHostedProviderFetch(options: HostedProviderFetchOptions): typeof fetch {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const target = requestUrl(input);
    const provider = relayProviderForUrl(target);
    if (!provider) return fetchImpl(input, init);
    if (!options.relayUrl) throw new Error("Hosted provider relay is unavailable");

    if (isModelRelayProvider(provider)) {
      const request = new Request(input, init);
      const relayEndpoint = new URL(options.relayUrl);
      relayEndpoint.pathname = MODEL_RELAY_PATH;
      relayEndpoint.search = "";
      relayEndpoint.hash = "";
      const headers = new Headers(request.headers);
      headers.set(MODEL_RELAY_HEADERS.client, options.clientId);
      headers.set(MODEL_RELAY_HEADERS.provider, provider);
      headers.set(MODEL_RELAY_HEADERS.upstreamMethod, request.method);
      headers.set(MODEL_RELAY_HEADERS.upstreamUrl, request.url);
      const body = request.body ? await request.arrayBuffer() : undefined;
      return fetchImpl(relayEndpoint, {
        method: "POST",
        headers,
        ...(body?.byteLength ? { body } : {}),
        signal: request.signal,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      });
    }

    const upstreamCookie = readHeader(init?.headers, "cookie") ??
      (input instanceof Request ? input.headers.get("cookie") : null);
    const request = new Request(input, init);
    const body = request.body ? new Uint8Array(await request.arrayBuffer()) : undefined;
    const envelope = {
      version: RELAY_CONTRACT_VERSION,
      provider,
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(
        [...request.headers.entries()]
          .filter(([name]) => name.toLowerCase() !== "cookie")
          .map(([name, value]) => [name.toLowerCase(), value]),
      ),
      ...(upstreamCookie ? { upstreamCookie } : {}),
      ...(body?.byteLength ? { bodyBase64: encodeBase64(body) } : {}),
    };

    const relayResponse = await fetchImpl(options.relayUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencandle-client": options.clientId,
      },
      body: JSON.stringify(envelope),
      signal: request.signal,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });

    const serialized = await readBoundedText(relayResponse, MAX_RELAY_ENVELOPE_BYTES);
    if (!relayResponse.ok) {
      throw new Error(`Hosted provider relay failed: ${relayErrorCode(serialized)}`);
    }
    const response = parseRelayResponse(serialized);
    const bytes = decodeBase64(response.bodyBase64);
    const headers = new Headers(response.headers);
    if (response.upstreamSetCookie) {
      headers.set("x-opencandle-upstream-set-cookie", response.upstreamSetCookie);
    }
    return new Response(bytes.byteLength === 0 ? null : bytes, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

export function relayProviderForUrl(url: URL): RelayProvider | undefined {
  const modelProvider = modelRelayProviderForUrl(url);
  if (modelProvider) return modelProvider;
  switch (url.hostname) {
    case "api.search.brave.com":
      return "brave";
    case "api.exa.ai":
    case "mcp.exa.ai":
      return "exa";
    case "api.alternative.me":
      return "fear_greed";
    case "finnhub.io":
      return "finnhub";
    case "api.stlouisfed.org":
      return "fred";
    case "api.londonstrategicedge.com":
      return "lse";
    case "efts.sec.gov":
    case "www.sec.gov":
    case "data.sec.gov":
      return "sec_edgar";
    case "scanner.tradingview.com":
      return "tradingview";
    case "fc.yahoo.com":
    case "query1.finance.yahoo.com":
    case "query2.finance.yahoo.com":
      return "yahoo";
    default:
      return undefined;
  }
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    await response.body?.cancel();
    throw new Error("Hosted provider relay response is too large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let removeAbortListener = () => {};
  const aborted = signal
    ? new Promise<symbol>((resolve) => {
        const onAbort = () => {
          void reader.cancel();
          resolve(ABORTED);
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () => signal.removeEventListener("abort", onAbort);
      })
    : undefined;
  try {
    while (true) {
      const next = aborted
        ? await Promise.race([reader.read(), aborted])
        : await reader.read();
      if (next === ABORTED || signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      const { done, value } = next;
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("Hosted provider relay response is too large");
      }
      chunks.push(value);
    }
  } finally {
    removeAbortListener();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseRelayResponse(serialized: string): RelayResponseEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Hosted provider relay returned invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Hosted provider relay returned an invalid envelope");
  }
  const value = parsed as Record<string, unknown>;
  if (
    value.version !== RELAY_CONTRACT_VERSION ||
    typeof value.status !== "number" ||
    value.status < 100 ||
    value.status > 599 ||
    typeof value.statusText !== "string" ||
    !isStringRecord(value.headers) ||
    (value.upstreamSetCookie !== undefined &&
      (typeof value.upstreamSetCookie !== "string" ||
        value.upstreamSetCookie.length === 0 ||
        value.upstreamSetCookie.length > 8_192 ||
        /[\r\n]/.test(value.upstreamSetCookie))) ||
    typeof value.bodyBase64 !== "string"
  ) {
    throw new Error("Hosted provider relay returned an invalid envelope");
  }
  return value as unknown as RelayResponseEnvelope;
}

function readHeader(headers: HeadersInit | undefined, wantedName: string): string | null {
  if (!headers) return null;
  const normalized = wantedName.toLowerCase();
  if (headers instanceof Headers) return headers.get(normalized);
  if (Array.isArray(headers)) {
    return headers.find(([name]) => name.toLowerCase() === normalized)?.[1] ?? null;
  }
  const match = Object.entries(headers).find(([name]) => name.toLowerCase() === normalized);
  return match?.[1] == null ? null : String(match[1]);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((item) => typeof item === "string")
  );
}

function relayErrorCode(serialized: string): string {
  try {
    const parsed = JSON.parse(serialized) as { error?: unknown };
    if (typeof parsed.error === "string" && /^[a-z0-9_]{1,80}$/.test(parsed.error)) {
      return parsed.error;
    }
  } catch {
    // Return a generic code without reflecting the relay body.
  }
  return "relay_unavailable";
}

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}
