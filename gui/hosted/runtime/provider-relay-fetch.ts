import {
  isModelRelayProvider,
  MODEL_RELAY_HEADERS,
  MODEL_RELAY_PATH,
  type ModelRelayProvider,
  modelRelayProviderForUrl,
  PROVIDER_RELAY_CONTRACT_VERSION,
  PROVIDER_RELAY_HEALTH_PATH,
  PROVIDER_RELAY_RUNTIME_TOKEN_PATH,
} from "../../../src/runtime/provider-relay-contract.js";

const RELAY_CONTRACT_VERSION = PROVIDER_RELAY_CONTRACT_VERSION;
const MAX_RELAY_ENVELOPE_BYTES = 6 * 1024 * 1024;
const DEFAULT_RELAY_HEALTH_TIMEOUT_MS = 5_000;
const DEFAULT_RUNTIME_AUTHORIZATION_TIMEOUT_MS = 30_000;
const DEFAULT_RELAY_MANIFEST_MAX_AGE_MS = 60_000;
const DEFAULT_RUNTIME_TOKEN_REFRESH_WINDOW_MS = 5 * 60_000;
const ABORTED = Symbol("aborted");

type RelayProvider =
  | ModelRelayProvider
  | "brave"
  | "ddg"
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
  loadRelayManifest?: () => Promise<HostedRelayManifest | undefined>;
  getRuntimeToken?: () => Promise<string>;
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

interface HostedRuntimeAuthorization {
  token: string;
  expiresAt: number;
}

export async function fetchHostedRuntimeAuthorization(options: {
  relayUrl: string;
  clientId: string;
  currentToken?: string;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
}): Promise<HostedRuntimeAuthorization> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const tokenUrl = relayEndpoint(options.relayUrl, PROVIDER_RELAY_RUNTIME_TOKEN_PATH);
  const headers = new Headers({ [MODEL_RELAY_HEADERS.client]: options.clientId });
  if (options.currentToken) {
    headers.set(MODEL_RELAY_HEADERS.runtimeToken, options.currentToken);
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_RUNTIME_AUTHORIZATION_TIMEOUT_MS,
  );
  let serialized: string;
  try {
    const response = await fetchImpl(tokenUrl, {
      method: "POST",
      headers,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    serialized = await readBoundedText(response, 4_096, controller.signal);
    if (!response.ok) {
      throw new Error(
        `Hosted provider relay authorization failed (${response.status}: ${semanticRelayError(serialized)})`,
      );
    }
    if (controller.signal.aborted) {
      throw new Error("Hosted provider relay authorization timed out");
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Hosted provider relay authorization timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Hosted provider relay returned invalid authorization");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Hosted provider relay returned invalid authorization");
  }
  const value = parsed as Record<string, unknown>;
  if (
    value.version !== RELAY_CONTRACT_VERSION ||
    typeof value.token !== "string" ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value.token) ||
    value.token.length > 2_048 ||
    typeof value.expiresAt !== "number" ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt <= 0
  ) {
    throw new Error("Hosted provider relay returned invalid authorization");
  }
  return { token: value.token, expiresAt: value.expiresAt };
}

function semanticRelayError(serialized: string): string {
  try {
    const value = JSON.parse(serialized) as unknown;
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as Record<string, unknown>).error === "string" &&
      /^[a-z0-9_]{1,80}$/u.test((value as Record<string, string>).error)
    ) {
      return (value as Record<string, string>).error;
    }
  } catch {
    // Fall through to the generic bounded reason.
  }
  return "authorization_rejected";
}

export function createHostedRuntimeTokenManager(options: {
  relayUrl: string;
  clientId: string;
  initialToken?: string;
  expiresAt?: number;
  fetchImpl?: typeof globalThis.fetch;
  now?: () => number;
  refreshWindowMs?: number;
}): () => Promise<string> {
  let authorization: HostedRuntimeAuthorization | undefined = options.initialToken && options.expiresAt
    ? { token: options.initialToken, expiresAt: options.expiresAt }
    : undefined;
  let inFlight: Promise<HostedRuntimeAuthorization> | undefined;
  return async () => {
    const now = options.now ?? Date.now;
    const refreshWindowMs = options.refreshWindowMs ?? DEFAULT_RUNTIME_TOKEN_REFRESH_WINDOW_MS;
    if (authorization && authorization.expiresAt - now() > refreshWindowMs) {
      return authorization.token;
    }
    inFlight ??= fetchHostedRuntimeAuthorization({
      relayUrl: options.relayUrl,
      clientId: options.clientId,
      ...(authorization ? { currentToken: authorization.token } : {}),
      fetchImpl: options.fetchImpl,
    })
      .finally(() => {
        inFlight = undefined;
      });
    authorization = await inFlight;
    return authorization.token;
  };
}

export function createHostedRelayManifestLoader(options: {
  relayUrl: string;
  clientId?: string;
  getRuntimeToken?: () => Promise<string>;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxAgeMs?: number;
  now?: () => number;
  onError?: (error: Error) => void;
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
      .catch((error) => {
        cached = undefined;
        cachedAt = 0;
        options.onError?.(
          error instanceof Error ? error : new Error("Hosted provider relay negotiation failed"),
        );
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
  clientId?: string;
  getRuntimeToken?: () => Promise<string>;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
}): Promise<HostedRelayManifest> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const healthUrl = relayEndpoint(options.relayUrl, PROVIDER_RELAY_HEALTH_PATH);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_RELAY_HEALTH_TIMEOUT_MS,
  );
  let serialized: string;
  try {
    const headers = new Headers();
    if (options.clientId) headers.set(MODEL_RELAY_HEADERS.client, options.clientId);
    const runtimeToken = await options.getRuntimeToken?.();
    if (runtimeToken) headers.set(MODEL_RELAY_HEADERS.runtimeToken, runtimeToken);
    const response = await fetchImpl(healthUrl.toString(), {
      method: "GET",
      headers,
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
      const manifest = await options.loadRelayManifest?.();
      if (!manifest?.providers.includes(provider)) {
        const label = provider === "openai" ? "OpenAI" : provider === "google" ? "Google" : "Anthropic";
        throw new Error(`${label} model relay is unavailable or incompatible`);
      }
      const request = new Request(input, init);
      const relayEndpoint = new URL(options.relayUrl);
      relayEndpoint.pathname = MODEL_RELAY_PATH;
      relayEndpoint.search = "";
      relayEndpoint.hash = "";
      const headers = new Headers(request.headers);
      headers.set(MODEL_RELAY_HEADERS.client, options.clientId);
      const runtimeToken = await options.getRuntimeToken?.();
      if (runtimeToken) headers.set(MODEL_RELAY_HEADERS.runtimeToken, runtimeToken);
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

    const relayHeaders = new Headers({
      "content-type": "application/json",
      [MODEL_RELAY_HEADERS.client]: options.clientId,
    });
    const runtimeToken = await options.getRuntimeToken?.();
    if (runtimeToken) relayHeaders.set(MODEL_RELAY_HEADERS.runtimeToken, runtimeToken);
    const relayResponse = await fetchImpl(options.relayUrl, {
      method: "POST",
      headers: relayHeaders,
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
    case "duckduckgo.com":
    case "links.duckduckgo.com":
    case "html.duckduckgo.com":
    case "lite.duckduckgo.com":
      return "ddg";
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

function relayEndpoint(relayUrl: string, pathname: string): URL {
  const endpoint = new URL(relayUrl);
  endpoint.pathname = pathname;
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
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
