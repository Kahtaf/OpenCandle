import {
  isModelRelayProvider,
  MODEL_RELAY_HEADERS,
  MODEL_RELAY_PATH,
  MODEL_RELAY_PROVIDER_IDS,
  type ModelRelayProvider,
  PROVIDER_RELAY_CONTRACT_VERSION,
  PROVIDER_RELAY_HEALTH_PATH,
  PROVIDER_RELAY_PATH,
  PROVIDER_RELAY_RUNTIME_TOKEN_PATH,
} from "../../../src/runtime/provider-relay-contract.js";

const CONTRACT_VERSION = PROVIDER_RELAY_CONTRACT_VERSION;
const DEFAULT_MAX_REQUEST_BYTES = 256 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MODEL_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_MAX_MODEL_REQUEST_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_MODEL_RESPONSE_BYTES = 32 * 1024 * 1024;
const CLIENT_ID_PATTERN = /^[a-f0-9]{32}$/;
const WEB_CONTAINER_ORIGIN_PATTERN =
  /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local-corp\.webcontainer-api\.io$/;
const STACKBLITZ_WEBCONTAINER_ORIGIN = "https://stackblitz.com";
const DEFAULT_RUNTIME_TOKEN_TTL_MS = 60 * 60_000;
const MIN_RUNTIME_TOKEN_SECRET_LENGTH = 32;
const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"] as const;

type RelayProvider =
  | "brave"
  | "ddg"
  | "exa"
  | "fear_greed"
  | "finnhub"
  | "fred"
  | "lse"
  | "tradingview"
  | "yahoo";
type RelayMethod = "GET" | "POST";

interface RelayRequestEnvelope {
  version: typeof CONTRACT_VERSION;
  provider: RelayProvider;
  url: string;
  method: RelayMethod;
  headers?: Record<string, string>;
  upstreamCookie?: string;
  bodyBase64?: string;
}

export type ProviderRelayEnv = Pick<Env, "PROVIDER_RELAY_RATE_LIMITER"> & {
  RELAY_RUNTIME_TOKEN_SECRET: string;
};

interface ProviderRelayOptions {
  fetchImpl?: (request: Request) => Promise<Response>;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  maxModelRequestBytes?: number;
  maxModelResponseBytes?: number;
  timeoutMs?: number;
  modelTimeoutMs?: number;
  allowedOrigins?: readonly string[];
  now?: () => number;
  runtimeTokenTtlMs?: number;
}

const DEFAULT_ALLOWED_ORIGINS = ["https://web.opencandle.app"] as const;

interface ProviderPolicy {
  readonly methods: readonly RelayMethod[];
  readonly allowedHeaders: ReadonlySet<string>;
  matches(url: URL, method: RelayMethod): boolean;
}

interface ModelProviderPolicy {
  readonly methods: readonly RelayMethod[];
  matches(url: URL, method: RelayMethod): boolean;
  allowsHeader(name: string): boolean;
  hasCredential(headers: Headers): boolean;
}

const COMMON_GET_HEADERS = new Set(["accept", "user-agent"]);
const JSON_POST_HEADERS = new Set(["accept", "content-type", "user-agent"]);
const FORM_POST_HEADERS = new Set([...COMMON_GET_HEADERS, "content-type"]);

const PROVIDER_POLICIES: Readonly<Record<RelayProvider, ProviderPolicy>> = {
  brave: policy(
    ["GET"],
    new Set([...COMMON_GET_HEADERS, "x-subscription-token"]),
    (url) =>
      exact(url, "api.search.brave.com", "/res/v1/web/search") ||
      exact(url, "api.search.brave.com", "/res/v1/news/search"),
  ),
  ddg: policy(
    ["GET", "POST"],
    FORM_POST_HEADERS,
    (url, method) =>
      (method === "GET" &&
        ((url.hostname === "duckduckgo.com" &&
          (url.pathname === "/" || url.pathname === "/news.js")) ||
          (url.hostname === "links.duckduckgo.com" && url.pathname === "/d.js"))) ||
      (method === "POST" &&
        ((url.hostname === "html.duckduckgo.com" && url.pathname === "/html/") ||
          (url.hostname === "lite.duckduckgo.com" && url.pathname === "/lite/"))),
  ),
  exa: policy(
    ["POST"],
    new Set([...JSON_POST_HEADERS, "x-api-key"]),
    (url) => exact(url, "api.exa.ai", "/search") || exact(url, "mcp.exa.ai", "/mcp"),
  ),
  fear_greed: policy(["GET"], COMMON_GET_HEADERS, (url) =>
    exact(url, "api.alternative.me", "/fng/"),
  ),
  finnhub: policy(
    ["GET"],
    COMMON_GET_HEADERS,
    (url) =>
      exact(url, "finnhub.io", "/api/v1/company-news") ||
      exact(url, "finnhub.io", "/api/v1/quote"),
  ),
  fred: policy(["GET"], COMMON_GET_HEADERS, (url) =>
    pathMatches(url, "api.stlouisfed.org", /^\/fred\/series(?:\/observations)?$/),
  ),
  lse: policy(
    ["GET"],
    new Set([...COMMON_GET_HEADERS, "x-api-key"]),
    (url) =>
      exact(url, "api.londonstrategicedge.com", "/vault/candles") ||
      exact(url, "api.londonstrategicedge.com", "/vault/ref/financial_reports"),
  ),
  tradingview: policy(
    ["POST"],
    new Set([...JSON_POST_HEADERS, "origin", "referer"]),
    (url) =>
      pathMatches(url, "scanner.tradingview.com", /^\/(?:america|global)\/scan2$/),
  ),
  yahoo: policy(
    ["GET"],
    COMMON_GET_HEADERS,
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

const MODEL_PROVIDER_POLICIES: Readonly<Record<ModelRelayProvider, ModelProviderPolicy>> = {
  openai: modelPolicy(
    (url, method) =>
      exactMethod(url, method, "api.openai.com", "/v1/models", "GET") ||
      exactMethod(url, method, "api.openai.com", "/v1/responses", "POST") ||
      exactMethod(url, method, "api.openai.com", "/v1/chat/completions", "POST"),
    new Set([
      "accept",
      "authorization",
      "content-type",
      "openai-organization",
      "openai-project",
      "user-agent",
      "x-client-request-id",
    ]),
    ["x-stainless-"],
    (headers) => /^Bearer\s+\S+$/i.test(headers.get("authorization") ?? ""),
  ),
  anthropic: modelPolicy(
    (url, method) =>
      exactMethod(url, method, "api.anthropic.com", "/v1/models", "GET") ||
      exactMethod(url, method, "api.anthropic.com", "/v1/messages", "POST") ||
      exactMethod(url, method, "api.anthropic.com", "/v1/messages/count_tokens", "POST"),
    new Set([
      "accept",
      "anthropic-beta",
      "anthropic-dangerous-direct-browser-access",
      "anthropic-version",
      "authorization",
      "content-type",
      "user-agent",
      "x-api-key",
      "x-app",
      "x-session-affinity",
    ]),
    ["x-stainless-"],
    (headers) =>
      Boolean(headers.get("x-api-key")) || /^Bearer\s+\S+$/i.test(headers.get("authorization") ?? ""),
  ),
  google: modelPolicy(
    (url, method) => {
      if (exactMethod(url, method, "generativelanguage.googleapis.com", "/v1beta/models", "GET")) {
        return true;
      }
      return (
        method === "POST" &&
        pathMatches(
          url,
          "generativelanguage.googleapis.com",
          /^\/v1beta\/models\/[A-Za-z0-9._-]+:(?:streamGenerateContent|generateContent|countTokens)$/,
        )
      );
    },
    new Set(["accept", "content-type", "user-agent", "x-goog-api-client", "x-goog-api-key"]),
    [],
    (headers) => Boolean(headers.get("x-goog-api-key")),
  ),
};

export const RELAY_POLICY_MANIFEST = Object.freeze({
  version: CONTRACT_VERSION,
  providers: Object.freeze(
    [...Object.keys(PROVIDER_POLICIES), ...MODEL_RELAY_PROVIDER_IDS].sort(),
  ),
});

export function createProviderRelay(options: ProviderRelayOptions = {}) {
  const fetchImpl = options.fetchImpl ?? ((request: Request) => fetch(request));
  const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const maxModelRequestBytes =
    options.maxModelRequestBytes ?? DEFAULT_MAX_MODEL_REQUEST_BYTES;
  const maxModelResponseBytes =
    options.maxModelResponseBytes ?? DEFAULT_MAX_MODEL_RESPONSE_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const modelTimeoutMs = options.modelTimeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;
  const allowedOrigins = new Set(options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS);
  const now = options.now ?? Date.now;
  const runtimeTokenTtlMs = options.runtimeTokenTtlMs ?? DEFAULT_RUNTIME_TOKEN_TTL_MS;

  return {
    async fetch(request: Request, env: ProviderRelayEnv): Promise<Response> {
      const requestUrl = new URL(request.url);
      const requestOrigin = request.headers.get("origin");
      const clientId = request.headers.get(MODEL_RELAY_HEADERS.client) ?? "";
      const trustedTopLevelOrigin = requestOrigin !== null && allowedOrigins.has(requestOrigin);
      const runtimeAuthorized = CLIENT_ID_PATTERN.test(clientId)
        ? await verifyRuntimeToken(
            request.headers.get(MODEL_RELAY_HEADERS.runtimeToken) ?? "",
            clientId,
            env.RELAY_RUNTIME_TOKEN_SECRET,
            now(),
          )
        : false;
      // The relay is intentionally public infrastructure. Origin filtering is
      // a CORS/drive-by-browser guard, not authentication: non-browser callers
      // can omit or spoof Origin and remain bounded by the exact provider
      // allowlist, body/time limits, and server-observed network rate limit.
      const corsOrigin = requestOrigin
        ? trustedTopLevelOrigin
          ? requestOrigin
          : runtimeAuthorized || (request.method === "OPTIONS" && isCorsCandidateOrigin(requestOrigin))
            ? "*"
            : null
        : null;
      const respondJson = (status: number, body: unknown) =>
        jsonResponse(status, body, corsOrigin);
      const respondError = (status: number, error: string) =>
        errorResponse(status, error, corsOrigin);
      if (requestUrl.pathname === PROVIDER_RELAY_RUNTIME_TOKEN_PATH) {
        if (request.method === "OPTIONS") return corsPreflight(corsOrigin);
        if (request.method !== "POST") return respondError(405, "method_not_allowed");
        if (requestOrigin && !trustedTopLevelOrigin && !runtimeAuthorized) {
          return respondError(403, "origin_not_allowed");
        }
        if (!CLIENT_ID_PATTERN.test(clientId)) return respondError(400, "invalid_client");
        const rateLimitError = await applyRateLimit(request, env, respondError);
        if (rateLimitError) return rateLimitError;
        const authorization = await issueRuntimeToken(
          clientId,
          env.RELAY_RUNTIME_TOKEN_SECRET,
          now(),
          runtimeTokenTtlMs,
        );
        if (!authorization) return respondError(503, "runtime_token_unavailable");
        return respondJson(200, {
          version: CONTRACT_VERSION,
          token: authorization.token,
          expiresAt: authorization.expiresAt,
        });
      }
      if (requestUrl.pathname === PROVIDER_RELAY_HEALTH_PATH) {
        if (request.method === "OPTIONS") return corsPreflight(corsOrigin);
        if (request.method !== "GET") return respondError(405, "method_not_allowed");
        if (requestOrigin && !trustedTopLevelOrigin && !runtimeAuthorized) {
          return respondError(403, "origin_not_allowed");
        }
        return respondJson(200, RELAY_POLICY_MANIFEST);
      }
      const isProviderFetch = requestUrl.pathname === PROVIDER_RELAY_PATH;
      const isModelFetch = requestUrl.pathname === MODEL_RELAY_PATH;
      if (!isProviderFetch && !isModelFetch) {
        return respondError(404, "not_found");
      }
      if (request.method === "OPTIONS") return corsPreflight(corsOrigin);
      if (requestOrigin && !trustedTopLevelOrigin && !runtimeAuthorized) {
        return respondError(403, "origin_not_allowed");
      }
      if (request.method !== "POST") return respondError(405, "method_not_allowed");

      if (!CLIENT_ID_PATTERN.test(clientId)) return respondError(400, "invalid_client");
      const rateLimitError = await applyRateLimit(request, env, respondError);
      if (rateLimitError) return rateLimitError;

      if (isModelFetch) {
        return relayModelRequest({
          request,
          fetchImpl,
          timeoutMs: modelTimeoutMs,
          maxRequestBytes: maxModelRequestBytes,
          maxResponseBytes: maxModelResponseBytes,
          corsOrigin,
          respondError,
        });
      }

      let envelope: RelayRequestEnvelope;
      try {
        const bytes = await readBounded(request.body, maxRequestBytes);
        envelope = parseEnvelope(new TextDecoder().decode(bytes));
      } catch (error) {
        return respondError(
          error instanceof RequestTooLargeError ? 413 : 400,
          error instanceof RequestTooLargeError ? "request_too_large" : "invalid_request",
        );
      }

      let validated: ReturnType<typeof validateProviderRequest>;
      try {
        validated = validateProviderRequest(envelope);
      } catch {
        return respondError(400, "invalid_request");
      }
      if (!validated) return respondError(403, "provider_request_not_allowed");

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
          return respondError(502, "upstream_redirect_rejected");
        }
        if (!upstream.ok) {
          await upstream.body?.cancel();
          return respondJson(200, {
            version: CONTRACT_VERSION,
            status: upstream.status,
            statusText: "",
            headers: responseHeaders(upstream.headers),
            ...upstreamCookieResponse(envelope.provider, upstream.headers),
            bodyBase64: "",
          });
        }
        const body = await readBounded(upstream.body, maxResponseBytes);
        return respondJson(200, {
          version: CONTRACT_VERSION,
          status: upstream.status,
          statusText: upstream.statusText,
          headers: responseHeaders(upstream.headers),
          ...upstreamCookieResponse(envelope.provider, upstream.headers),
          bodyBase64: encodeBase64(body),
        });
      } catch (error) {
        if (error instanceof RequestTooLargeError) {
          return respondError(502, "upstream_response_too_large");
        }
        if (controller.signal.aborted) return respondError(504, "upstream_timeout");
        return respondError(502, "upstream_unavailable");
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

async function relayModelRequest(options: {
  request: Request;
  fetchImpl: (request: Request) => Promise<Response>;
  timeoutMs: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
  corsOrigin: string | null;
  respondError: (status: number, error: string) => Response;
}): Promise<Response> {
  const provider = options.request.headers.get(MODEL_RELAY_HEADERS.provider);
  const method = options.request.headers.get(MODEL_RELAY_HEADERS.upstreamMethod);
  const target = options.request.headers.get(MODEL_RELAY_HEADERS.upstreamUrl);
  if (!isModelRelayProvider(provider) || (method !== "GET" && method !== "POST") || !target) {
    return options.respondError(400, "invalid_request");
  }

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return options.respondError(400, "invalid_request");
  }
  if (!isSafeHttpsUrl(url) || hasCredentialQuery(url)) {
    return options.respondError(403, "provider_request_not_allowed");
  }
  const policy = MODEL_PROVIDER_POLICIES[provider];
  if (!policy.methods.includes(method) || !policy.matches(url, method)) {
    return options.respondError(403, "provider_request_not_allowed");
  }

  const upstreamHeaders = new Headers();
  for (const [name, value] of options.request.headers) {
    const normalized = name.toLowerCase();
    if (!policy.allowsHeader(normalized)) continue;
    if (value.length > 8_192 || /[\r\n]/.test(value)) {
      return options.respondError(400, "invalid_request");
    }
    upstreamHeaders.set(normalized, value);
  }
  if (!policy.hasCredential(upstreamHeaders)) {
    return options.respondError(400, "missing_model_credential");
  }
  let body: Uint8Array | undefined;
  if (options.request.body) {
    try {
      const requestBody = await readBounded(options.request.body, options.maxRequestBytes);
      if (method === "GET" && requestBody.byteLength > 0) {
        return options.respondError(400, "invalid_request");
      }
      if (method === "POST" && requestBody.byteLength > 0) body = requestBody;
    } catch (error) {
      return options.respondError(
        error instanceof RequestTooLargeError ? 413 : 400,
        error instanceof RequestTooLargeError ? "request_too_large" : "invalid_request",
      );
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  options.request.signal.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const init: RequestInit & { duplex?: "half" } = {
      method,
      headers: upstreamHeaders,
      ...(method === "POST" && body
        ? { body, duplex: "half" as const }
        : {}),
      redirect: "manual",
      signal: controller.signal,
    };
    const upstream = await options.fetchImpl(new Request(url, init));
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel();
      return options.respondError(502, "upstream_redirect_rejected");
    }
    if (!upstream.ok) {
      await upstream.body?.cancel();
      const headers = modelResponseHeaders(upstream.headers, options.corsOrigin);
      headers.set("content-type", "application/json; charset=utf-8");
      return new Response(JSON.stringify({ error: "model_provider_request_failed" }), {
        status: upstream.status,
        headers,
      });
    }
    clearTimeout(timeout);
    return new Response(
      guardedModelStream(
        upstream.body,
        options.maxResponseBytes,
        options.timeoutMs,
        controller,
      ),
      {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: modelResponseHeaders(upstream.headers, options.corsOrigin),
      },
    );
  } catch {
    if (controller.signal.aborted) return options.respondError(504, "upstream_timeout");
    return options.respondError(502, "upstream_unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

function guardedModelStream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  timeoutMs: number,
  upstreamController: AbortController,
): ReadableStream<Uint8Array> | null {
  if (!stream) return null;
  const reader = stream.getReader();
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let output: ReadableStreamDefaultController<Uint8Array> | undefined;
  let closed = false;
  const clearDeadline = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const fail = (error: Error) => {
    if (closed) return;
    closed = true;
    clearDeadline();
    upstreamController.abort(error);
    void reader.cancel(error);
    output?.error(error);
  };
  const resetDeadline = () => {
    clearDeadline();
    timer = setTimeout(() => fail(new Error("upstream_timeout")), timeoutMs);
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      output = controller;
      resetDeadline();
    },
    async pull(controller) {
      if (closed) return;
      try {
        const { done, value } = await reader.read();
        if (closed) return;
        if (done) {
          closed = true;
          clearDeadline();
          controller.close();
          return;
        }
        total += value.byteLength;
        if (total > maxBytes) {
          fail(new RequestTooLargeError());
          return;
        }
        controller.enqueue(value);
        resetDeadline();
      } catch (error) {
        fail(error instanceof Error ? error : new Error("upstream_unavailable"));
      }
    },
    async cancel(reason) {
      if (closed) return;
      closed = true;
      clearDeadline();
      upstreamController.abort(reason);
      await reader.cancel(reason);
    },
  });
}

async function pseudonymousRateLimitKey(connectingIp: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(connectingIp));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function applyRateLimit(
  request: Request,
  env: ProviderRelayEnv,
  respondError: (status: number, error: string) => Response,
): Promise<Response | undefined> {
  const connectingIp = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  if (!/^[0-9a-f:.]{2,64}$/i.test(connectingIp)) {
    return respondError(503, "relay_rate_limit_identity_unavailable");
  }
  if (!env.PROVIDER_RELAY_RATE_LIMITER) {
    return respondError(503, "relay_rate_limiter_unavailable");
  }
  const rate = await env.PROVIDER_RELAY_RATE_LIMITER.limit({
    key: await pseudonymousRateLimitKey(connectingIp),
  });
  return rate.success ? undefined : respondError(429, "relay_rate_limited");
}

function isCorsCandidateOrigin(origin: string): boolean {
  if (origin === "null") return true;
  if (origin === STACKBLITZ_WEBCONTAINER_ORIGIN || WEB_CONTAINER_ORIGIN_PATTERN.test(origin)) {
    return true;
  }
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "https:" ||
      (parsed.protocol === "http:" &&
        LOOPBACK_HOSTNAMES.includes(
          parsed.hostname as (typeof LOOPBACK_HOSTNAMES)[number],
        ))
    );
  } catch {
    return false;
  }
}

async function issueRuntimeToken(
  clientId: string,
  secret: string,
  nowMs: number,
  ttlMs: number,
): Promise<{ token: string; expiresAt: number } | undefined> {
  if (!isRuntimeTokenSecret(secret) || !Number.isFinite(ttlMs) || ttlMs <= 0) return undefined;
  const expiresAt = Math.floor(nowMs + ttlMs);
  const payload = encodeBase64Url(
    new TextEncoder().encode(
      JSON.stringify({ v: CONTRACT_VERSION, cid: clientId, exp: expiresAt }),
    ),
  );
  const key = await importRuntimeTokenKey(secret);
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
  );
  return { token: `${payload}.${encodeBase64Url(signature)}`, expiresAt };
}

async function verifyRuntimeToken(
  token: string,
  clientId: string,
  secret: string,
  nowMs: number,
): Promise<boolean> {
  if (!isRuntimeTokenSecret(secret) || token.length > 2_048) return false;
  const [payload, encodedSignature, extra] = token.split(".");
  if (!payload || !encodedSignature || extra !== undefined) return false;
  let signature: Uint8Array;
  let claims: unknown;
  try {
    signature = decodeBase64Url(encodedSignature);
    claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as unknown;
  } catch {
    return false;
  }
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) return false;
  const value = claims as Record<string, unknown>;
  if (
    value.v !== CONTRACT_VERSION ||
    value.cid !== clientId ||
    typeof value.exp !== "number" ||
    !Number.isSafeInteger(value.exp) ||
    value.exp <= nowMs
  ) {
    return false;
  }
  const key = await importRuntimeTokenKey(secret);
  return crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    new TextEncoder().encode(payload),
  );
}

function isRuntimeTokenSecret(secret: string): boolean {
  return typeof secret === "string" && secret.length >= MIN_RUNTIME_TOKEN_SECRET_LENGTH;
}

function importRuntimeTokenKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function encodeBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("invalid base64url");
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  return decodeBase64(`${value.replaceAll("-", "+").replaceAll("_", "/")}${padding}`);
}

function policy(
  methods: readonly RelayMethod[],
  allowedHeaders: ReadonlySet<string>,
  matches: (url: URL, method: RelayMethod) => boolean,
): ProviderPolicy {
  return { methods, allowedHeaders, matches };
}

function modelPolicy(
  matches: (url: URL, method: RelayMethod) => boolean,
  allowedHeaders: ReadonlySet<string>,
  allowedPrefixes: readonly string[],
  hasCredential: (headers: Headers) => boolean,
): ModelProviderPolicy {
  return {
    methods: ["GET", "POST"],
    matches,
    allowsHeader: (name) =>
      allowedHeaders.has(name) || allowedPrefixes.some((prefix) => name.startsWith(prefix)),
    hasCredential,
  };
}

function exactMethod(
  url: URL,
  method: RelayMethod,
  hostname: string,
  pathname: string,
  expectedMethod: RelayMethod,
): boolean {
  return method === expectedMethod && exact(url, hostname, pathname);
}

function isSafeHttpsUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    (url.port === "" || url.port === "443") &&
    url.username === "" &&
    url.password === "" &&
    url.hash === ""
  );
}

function hasCredentialQuery(url: URL): boolean {
  return [...url.searchParams.keys()].some((name) =>
    /^(?:api[_-]?key|access[_-]?token|authorization|key)$/i.test(name),
  );
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
    (record.upstreamCookie !== undefined && typeof record.upstreamCookie !== "string") ||
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
  if (!provider.methods.includes(envelope.method) || !provider.matches(url, envelope.method)) {
    return null;
  }

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
    if (
      normalized === "content-type" &&
      envelope.provider === "ddg" &&
      value.toLowerCase() !== "application/x-www-form-urlencoded"
    ) {
      return null;
    }
    headers.set(normalized, value);
  }
  if (envelope.upstreamCookie !== undefined) {
    if (envelope.provider !== "yahoo" || !isSafeCookie(envelope.upstreamCookie)) return null;
    headers.set("cookie", envelope.upstreamCookie);
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
  const allowed = ["content-type", "retry-after", "x-data-bytes"];
  return Object.fromEntries(
    allowed.flatMap((name) => {
      const value = headers.get(name);
      return value === null ? [] : [[name, value]];
    }),
  );
}

function modelResponseHeaders(headers: Headers, origin: string | null): Headers {
  const response = new Headers(corsHeaders(origin));
  response.delete("content-type");
  for (const name of [
    "content-type",
    "retry-after",
    "request-id",
    "x-request-id",
    "openai-processing-ms",
    "openai-version",
  ]) {
    const value = headers.get(name);
    if (value !== null) response.set(name, value);
  }
  return response;
}

function upstreamCookieResponse(
  provider: RelayProvider,
  headers: Headers,
): { upstreamSetCookie?: string } {
  if (provider !== "yahoo") return {};
  const value = headers.get("set-cookie");
  return value && isSafeCookie(value) ? { upstreamSetCookie: value } : {};
}

function isSafeCookie(value: string): boolean {
  return value.length > 0 && value.length <= 8_192 && !/[\r\n]/.test(value);
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

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": [
      "Accept",
      "Anthropic-Beta",
      "Anthropic-Dangerous-Direct-Browser-Access",
      "Anthropic-Version",
      "Authorization",
      "Content-Type",
      "X-Api-Key",
      "X-Goog-Api-Client",
      "X-Goog-Api-Key",
      "X-OpenCandle-Client",
      "X-OpenCandle-Provider",
      "X-OpenCandle-Runtime-Token",
      "X-OpenCandle-Upstream-Method",
      "X-OpenCandle-Upstream-URL",
    ].join(", "),
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  };
}

function corsPreflight(origin: string | null): Response {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function jsonResponse(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

function errorResponse(status: number, error: string, origin: string | null): Response {
  return jsonResponse(status, { error }, origin);
}

class RequestTooLargeError extends Error {}
