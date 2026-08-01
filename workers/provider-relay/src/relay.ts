const CONTRACT_VERSION = 1 as const;
const DEFAULT_MAX_REQUEST_BYTES = 256 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const CLIENT_ID_PATTERN = /^[a-f0-9]{32}$/;

type RelayProvider =
  | "brave"
  | "exa"
  | "fear_greed"
  | "fred"
  | "tradingview"
  | "yahoo";

type RelayMethod = "GET" | "POST";

interface RelayRequestEnvelope {
  version: typeof CONTRACT_VERSION;
  provider: RelayProvider;
  url: string;
  method: RelayMethod;
  headers?: Record<string, string>;
  bodyBase64?: string;
}

export type ProviderRelayEnv = Pick<Env, "PROVIDER_RELAY_RATE_LIMITER">;

interface ProviderRelayOptions {
  fetchImpl?: (request: Request) => Promise<Response>;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  timeoutMs?: number;
}

interface ProviderPolicy {
  readonly methods: readonly RelayMethod[];
  readonly allowedHeaders: ReadonlySet<string>;
  matches(url: URL): boolean;
}

const COMMON_GET_HEADERS = new Set(["accept", "user-agent"]);
const JSON_POST_HEADERS = new Set(["accept", "content-type", "user-agent"]);

const PROVIDER_POLICIES: Readonly<Record<RelayProvider, ProviderPolicy>> = {
  brave: policy(
    ["GET"],
    new Set([...COMMON_GET_HEADERS, "x-subscription-token"]),
    (url) =>
      exact(url, "api.search.brave.com", "/res/v1/web/search") ||
      exact(url, "api.search.brave.com", "/res/v1/news/search"),
  ),
  exa: policy(
    ["POST"],
    new Set([...JSON_POST_HEADERS, "authorization"]),
    (url) => exact(url, "api.exa.ai", "/search") || exact(url, "mcp.exa.ai", "/mcp"),
  ),
  fear_greed: policy(["GET"], COMMON_GET_HEADERS, (url) =>
    exact(url, "api.alternative.me", "/fng/"),
  ),
  fred: policy(["GET"], COMMON_GET_HEADERS, (url) =>
    pathMatches(url, "api.stlouisfed.org", /^\/fred\/series(?:\/observations)?$/),
  ),
  tradingview: policy(
    ["POST"],
    new Set([...JSON_POST_HEADERS, "origin", "referer"]),
    (url) =>
      pathMatches(url, "scanner.tradingview.com", /^\/(?:america|global)\/scan2$/),
  ),
  yahoo: policy(
    ["GET"],
    new Set([...COMMON_GET_HEADERS, "cookie"]),
    (url) => {
      if (exact(url, "fc.yahoo.com", "/t")) return true;
      if (exact(url, "query2.finance.yahoo.com", "/v1/test/getcrumb")) return true;
      if (exact(url, "query2.finance.yahoo.com", "/v7/finance/quote")) return true;
      if (
        pathMatches(
          url,
          "query2.finance.yahoo.com",
          /^\/ws\/fundamentals-timeseries\/v1\/finance\/timeseries\/[^/]+$/,
        )
      ) {
        return true;
      }
      return (
        pathMatches(url, "query1.finance.yahoo.com", /^\/v1\/finance\/search$/) ||
        pathMatches(url, "query1.finance.yahoo.com", /^\/v7\/finance\/options\/[^/]+$/) ||
        pathMatches(url, "query1.finance.yahoo.com", /^\/v8\/finance\/chart\/[^/]+$/) ||
        pathMatches(url, "query1.finance.yahoo.com", /^\/v10\/finance\/quoteSummary\/[^/]+$/)
      );
    },
  ),
};

export const RELAY_POLICY_MANIFEST = Object.freeze({
  version: CONTRACT_VERSION,
  providers: Object.freeze(Object.keys(PROVIDER_POLICIES).sort()),
});

export function createProviderRelay(options: ProviderRelayOptions = {}) {
  const fetchImpl = options.fetchImpl ?? ((request: Request) => fetch(request));
  const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async fetch(request: Request, env: ProviderRelayEnv): Promise<Response> {
      const requestUrl = new URL(request.url);
      if (request.method === "OPTIONS") return corsPreflight();
      if (requestUrl.pathname === "/v1/health") {
        if (request.method !== "GET") return errorResponse(405, "method_not_allowed");
        return jsonResponse(200, RELAY_POLICY_MANIFEST);
      }
      if (requestUrl.pathname !== "/v1/provider-fetch") {
        return errorResponse(404, "not_found");
      }
      if (request.method !== "POST") return errorResponse(405, "method_not_allowed");

      const clientId = request.headers.get("x-opencandle-client") ?? "";
      if (!CLIENT_ID_PATTERN.test(clientId)) return errorResponse(400, "invalid_client");
      const connectingIp = request.headers.get("cf-connecting-ip")?.trim() ?? "";
      if (!/^[0-9a-f:.]{2,64}$/i.test(connectingIp)) {
        return errorResponse(503, "relay_rate_limit_identity_unavailable");
      }
      if (!env.PROVIDER_RELAY_RATE_LIMITER) {
        return errorResponse(503, "relay_rate_limiter_unavailable");
      }
      const rate = await env.PROVIDER_RELAY_RATE_LIMITER.limit({
        key: await pseudonymousRateLimitKey(connectingIp),
      });
      if (!rate.success) return errorResponse(429, "relay_rate_limited");

      let envelope: RelayRequestEnvelope;
      try {
        const bytes = await readBounded(request.body, maxRequestBytes);
        envelope = parseEnvelope(new TextDecoder().decode(bytes));
      } catch (error) {
        return errorResponse(
          error instanceof RequestTooLargeError ? 413 : 400,
          error instanceof RequestTooLargeError ? "request_too_large" : "invalid_request",
        );
      }

      const validated = validateProviderRequest(envelope);
      if (!validated) return errorResponse(403, "provider_request_not_allowed");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      request.signal.addEventListener("abort", () => controller.abort(), { once: true });
      try {
        const upstream = await fetchImpl(
          new Request(validated.url, {
            method: validated.method,
            headers: validated.headers,
            body: validated.body,
            redirect: "manual",
            signal: controller.signal,
          }),
        );
        if (upstream.status >= 300 && upstream.status < 400) {
          await upstream.body?.cancel();
          return errorResponse(502, "upstream_redirect_rejected");
        }
        if (!upstream.ok) {
          await upstream.body?.cancel();
          return jsonResponse(200, {
            version: CONTRACT_VERSION,
            status: upstream.status,
            statusText: "",
            headers: responseHeaders(upstream.headers),
            bodyBase64: "",
          });
        }
        const body = await readBounded(upstream.body, maxResponseBytes);
        return jsonResponse(200, {
          version: CONTRACT_VERSION,
          status: upstream.status,
          statusText: upstream.statusText,
          headers: responseHeaders(upstream.headers),
          bodyBase64: encodeBase64(body),
        });
      } catch (error) {
        if (error instanceof RequestTooLargeError) {
          return errorResponse(502, "upstream_response_too_large");
        }
        if (controller.signal.aborted) return errorResponse(504, "upstream_timeout");
        return errorResponse(502, "upstream_unavailable");
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

async function pseudonymousRateLimitKey(connectingIp: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(connectingIp));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function policy(
  methods: readonly RelayMethod[],
  allowedHeaders: ReadonlySet<string>,
  matches: (url: URL) => boolean,
): ProviderPolicy {
  return { methods, allowedHeaders, matches };
}

function exact(url: URL, hostname: string, pathname: string): boolean {
  return url.hostname === hostname && url.pathname === pathname;
}

function pathMatches(url: URL, hostname: string, pathname: RegExp): boolean {
  return url.hostname === hostname && pathname.test(url.pathname);
}

function parseEnvelope(raw: string): RelayRequestEnvelope {
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
  const record = value as Record<string, unknown>;
  if (
    record.version !== CONTRACT_VERSION ||
    typeof record.provider !== "string" ||
    !(record.provider in PROVIDER_POLICIES) ||
    typeof record.url !== "string" ||
    (record.method !== "GET" && record.method !== "POST") ||
    (record.bodyBase64 !== undefined && typeof record.bodyBase64 !== "string") ||
    !isStringRecord(record.headers)
  ) {
    throw new Error("invalid");
  }
  return record as unknown as RelayRequestEnvelope;
}

function isStringRecord(value: unknown): value is Record<string, string> | undefined {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === "string");
}

function validateProviderRequest(envelope: RelayRequestEnvelope): {
  url: URL;
  method: RelayMethod;
  headers: Headers;
  body?: Uint8Array;
} | null {
  let url: URL;
  try {
    url = new URL(envelope.url);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    (url.port !== "" && url.port !== "443") ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    return null;
  }

  const provider = PROVIDER_POLICIES[envelope.provider];
  if (!provider.methods.includes(envelope.method) || !provider.matches(url)) return null;

  const headers = new Headers();
  for (const [name, value] of Object.entries(envelope.headers ?? {})) {
    const normalized = name.toLowerCase();
    if (!provider.allowedHeaders.has(normalized) || value.length > 8_192) return null;
    if (
      normalized === "origin" &&
      envelope.provider === "tradingview" &&
      value !== "https://www.tradingview.com"
    ) {
      return null;
    }
    if (
      normalized === "referer" &&
      envelope.provider === "tradingview" &&
      value !== "https://www.tradingview.com/"
    ) {
      return null;
    }
    headers.set(normalized, value);
  }

  if (envelope.method === "GET" && envelope.bodyBase64 !== undefined) return null;
  let body: Uint8Array | undefined;
  if (envelope.bodyBase64 !== undefined) {
    try {
      body = decodeBase64(envelope.bodyBase64);
    } catch {
      return null;
    }
  }
  return { url, method: envelope.method, headers, ...(body && { body }) };
}

async function readBounded(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RequestTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function responseHeaders(headers: Headers): Record<string, string> {
  const allowed = ["content-type", "retry-after", "set-cookie", "x-data-bytes"];
  return Object.fromEntries(
    allowed.flatMap((name) => {
      const value = headers.get(name);
      return value === null ? [] : [[name, value]];
    }),
  );
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-OpenCandle-Client",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  };
}

function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders() });
}

function errorResponse(status: number, error: string): Response {
  return jsonResponse(status, { error });
}

class RequestTooLargeError extends Error {}
