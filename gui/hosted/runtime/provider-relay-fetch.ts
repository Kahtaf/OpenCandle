const RELAY_CONTRACT_VERSION = 1;
const MAX_RELAY_ENVELOPE_BYTES = 6 * 1024 * 1024;
const DEFAULT_RELAY_HEALTH_TIMEOUT_MS = 5_000;
const ABORTED = Symbol("aborted");

type RelayProvider =
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
  bodyBase64: string;
}

export interface HostedRelayManifest {
  version: 1;
  providers: string[];
}

export async function fetchHostedRelayManifest(options: {
  relayUrl: string;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
}): Promise<HostedRelayManifest> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const healthUrl = new URL(options.relayUrl);
  healthUrl.pathname = "/v1/health";
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

    const request = new Request(input, init);
    const body = request.body ? new Uint8Array(await request.arrayBuffer()) : undefined;
    const envelope = {
      version: RELAY_CONTRACT_VERSION,
      provider,
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(
        [...request.headers.entries()].map(([name, value]) => [name.toLowerCase(), value]),
      ),
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
    return new Response(bytes.byteLength === 0 ? null : bytes, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

export function relayProviderForUrl(url: URL): RelayProvider | undefined {
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
    typeof value.bodyBase64 !== "string"
  ) {
    throw new Error("Hosted provider relay returned an invalid envelope");
  }
  return value as unknown as RelayResponseEnvelope;
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
