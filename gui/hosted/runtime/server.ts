import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createInterface } from "node:readline";
import { searchPredictionMarkets } from "../../../src/providers/polymarket.js";
import { resolveHostedBrowserCapabilityReport } from "../../../src/onboarding/providers.js";
import { validateCredential } from "../../../src/onboarding/validation.js";
import { validateModelKey } from "../../../src/onboarding/validate-model-key.js";
import { route } from "../../../src/routing/router.js";
import {
  renderUntrustedText,
  untrustedContentHeader,
} from "../../../src/tools/sentiment/untrusted-text.js";
import { runBrowserPiSession } from "./browser-pi-session.js";
import { createBrowserModelRuntime } from "./browser-model-runtime.js";
import { createPiAiRouterClient } from "../../../src/routing/router-llm-client.js";
import { BrowserHostedGuiRuntime } from "./browser-hosted-gui-runtime.js";
import {
  buildHostedMarketIndicesSnapshot,
  buildHostedMarketQuoteSnapshot,
  buildHostedUnavailableMarketQuoteSnapshot,
  getHostedInstrumentHistorySnapshot,
  getHostedInstrumentOverviewSnapshot,
  getHostedInstrumentQuoteSnapshot,
  searchHostedInstrumentCandidates,
} from "./hosted-market-data-api.js";
import {
  createHostedRelayManifestLoader,
  createHostedProviderFetch,
} from "./provider-relay-fetch.js";
import {
  type GuiRequest,
  parseGuiRequest,
  parseProbeRequest,
  parseSessionRequest,
  parseTrustedHostOrigin,
  serializeProbeError,
} from "./request-contract.js";
import { MODEL_ENVIRONMENT } from "./request-contract.js";
import {
  isFirstClassModelProvider,
  type FirstClassModelProviderId,
} from "../../../src/pi/model-provider-metadata.js";
import {
  isAuthorizedPrivateRuntimeRequest,
  PRIVATE_RUNTIME_TOKEN_HEADER,
} from "./runtime-request-auth.js";

const RUNTIME_VERSION = "opencandle-hosted-web-v1";
// Four 5 MiB image attachments expand to roughly 27 MiB as base64 JSON. Keep
// one bounded request limit for both HTTP fallback and native stdio transport.
const MAX_BODY_BYTES = 32 * 1_024 * 1_024;
const MAX_EVIDENCE = 5;
const CAPABILITIES = [
  "health",
  "polymarket",
  "router",
  "diagnostic-synthesis",
  "pi-agent-session",
] as const;
const PROCESS_FRAME_PREFIX = "@@OPENCANDLE@@";
const MODEL_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.OPENAI_API_KEY,
  process.env.ANTHROPIC_API_KEY,
];
const trustedHostOrigin = parseTrustedHostOrigin(process.env.OPENCANDLE_SPIKE_HOST_ORIGIN);
const providerRelayUrl = process.env.OPENCANDLE_PROVIDER_RELAY_URL?.trim() ?? "";
const providerRelayClientId = process.env.OPENCANDLE_PROVIDER_RELAY_CLIENT_ID?.trim() ?? "";
if (providerRelayUrl && !/^[a-f0-9]{32}$/.test(providerRelayClientId)) {
  throw new Error("OPENCANDLE_PROVIDER_RELAY_CLIENT_ID is invalid");
}
const nativeFetch = globalThis.fetch.bind(globalThis);
const loadHostedRelayManifest = providerRelayUrl
  ? createHostedRelayManifestLoader({ relayUrl: providerRelayUrl, fetchImpl: nativeFetch })
  : async () => undefined;
const initialHostedRelayManifestPromise = loadHostedRelayManifest();
const runtimeEpoch = process.env.OPENCANDLE_RUNTIME_EPOCH;
if (!runtimeEpoch || !/^[a-f0-9]{32}$/.test(runtimeEpoch)) {
  throw new Error("OPENCANDLE_RUNTIME_EPOCH is invalid");
}
const hostedGuiRuntimePromise = initialHostedRelayManifestPromise.then((relayManifest) => {
  globalThis.fetch = createHostedProviderFetch({
    relayUrl: providerRelayUrl,
    clientId: providerRelayClientId,
    fetchImpl: nativeFetch,
  });
  const selectedProvider = isFirstClassModelProvider(process.env.OPENCANDLE_MODEL_PROVIDER)
    ? process.env.OPENCANDLE_MODEL_PROVIDER
    : undefined;
  const selectedModel = process.env.OPENCANDLE_MODEL_ID?.trim() || undefined;
  const modelCredentials = Object.fromEntries(
    (Object.keys(MODEL_ENVIRONMENT) as FirstClassModelProviderId[]).flatMap((providerId) => {
      const key = process.env[MODEL_ENVIRONMENT[providerId].envVar]?.trim();
      return key ? [[providerId, key]] : [];
    }),
  );
  return BrowserHostedGuiRuntime.create({
    cwd: process.cwd(),
    sessionDir: `${process.cwd()}/sessions`,
    stateFile: `${process.cwd()}/state/current.sqlite3`,
    currentSessionId: process.env.OPENCANDLE_CURRENT_SESSION_ID,
    modelProvider: selectedProvider,
    modelId: selectedModel,
    modelCredentials,
    relayProviders: relayManifest?.providers ?? [],
  });
});

function isolationHeaders(contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": trustedHostOrigin,
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "cross-origin",
    Vary: "Origin",
  };
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, isolationHeaders("application/json; charset=utf-8"));
  response.end(JSON.stringify(body));
}

function writeSse(response: ServerResponse, event: unknown): void {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

async function runProbe(body: unknown): Promise<unknown> {
  const request = parseProbeRequest(body, process.env);
  const quotes = await searchPredictionMarkets(request.question, MAX_EVIDENCE);
  const evidence = quotes.slice(0, MAX_EVIDENCE).map((quote) => ({
    title: quote.title.slice(0, 240),
    outcome: quote.outcome.slice(0, 120),
    probability: quote.probability,
    sourceUrl: quote.url.slice(0, 2_000),
    provider: quote.source,
  }));

  if (!request.runModel) {
    return { evidence, evidenceCount: evidence.length };
  }

  const modelKey =
    request.provider === "google"
      ? process.env.GEMINI_API_KEY
      : request.provider === "openai"
        ? process.env.OPENAI_API_KEY
        : process.env.ANTHROPIC_API_KEY;
  if (!modelKey) throw new Error("Model probe requires a configured model key");
  const modelRuntime = await createBrowserModelRuntime({ [request.provider]: modelKey });
  const model = modelRuntime.getModel(request.provider, request.modelId);
  if (!model) throw new Error("Unsupported provider or model");
  const client = createPiAiRouterClient(model, modelRuntime.completeSimple.bind(modelRuntime));
  const routeResult = await route(
    {
      text: request.question,
      priorTurns: [],
      profileSnapshot: {},
      recentWorkflowRuns: [],
    },
    client,
  );
  const synthesis = await client.complete(
    [
      "BROWSER RUNTIME FEASIBILITY SPIKE ONLY.",
      "Summarize the bounded prediction-market evidence in at most 120 words.",
      "Do not present this as a production OpenCandle answer.",
      `Question: ${request.question}`,
      untrustedContentHeader("Polymarket diagnostic evidence"),
      `Evidence: ${JSON.stringify(
        evidence.map((item) => ({
          ...item,
          title: renderUntrustedText(item.title, 240),
          outcome: renderUntrustedText(item.outcome, 120),
        })),
      )}`,
    ].join("\n"),
  );

  return {
    evidence,
    evidenceCount: evidence.length,
    route: routeResult,
    diagnosticSynthesis: synthesis.slice(0, 2_000),
    diagnosticLabel: "Spike-only diagnostic synthesis",
  };
}

async function runGuiRequest(request: GuiRequest): Promise<unknown> {
  const runtime = await hostedGuiRuntimePromise;
  switch (request.action) {
    case "bootstrap": {
      await refreshHostedRelayProviders(runtime);
      return runtime.bootstrap();
    }
    case "configure_model":
      runtime.configureModel(request.provider, request.modelId, request.apiKey);
      return runtime.bootstrap();
    case "validate_provider_key":
      return validateCredential(request.providerId, request.apiKey);
    case "validate_model_key":
      return validateModelKey(request.provider, request.apiKey);
    case "new_session":
      return runtime.newSession();
    case "load_session":
      return runtime.loadSession(request.sessionId);
    case "rename_session":
      return runtime.renameSession(request.sessionId, request.name);
    case "delete_session":
      return runtime.deleteSession(request.sessionId);
    case "ask_user.answer":
      return runtime.answerAskUser(request.sessionId, request.id, request.answer);
    case "ask_user.cancel":
      return runtime.cancelAskUser(request.sessionId, request.id);
    case "chat_run":
      await refreshHostedRelayProviders(runtime);
      return runtime.chatRun(
        request.sessionId,
        request,
        request.actionId,
      );
    case "tool_invoke":
      return runtime.invokeTool(
        request.sessionId,
        request.actionId,
        request.toolName,
        request.args,
      );
    case "market_state":
      return runtime.marketState();
    case "diagnostics":
      return buildHostedDiagnostics();
    case "market_quotes":
      return (await hasRelayProvider("yahoo"))
        ? buildHostedMarketQuoteSnapshot(runtime.marketState())
        : buildHostedUnavailableMarketQuoteSnapshot(
            runtime.marketState(),
            "Audited provider relay is unavailable",
          );
    case "market_indices":
      return (await hasRelayProvider("yahoo"))
        ? buildHostedMarketIndicesSnapshot()
        : { generatedAt: new Date().toISOString(), indices: [] };
    case "instrument_history":
      await requireRelayProvider("yahoo", "Instrument history");
      return getHostedInstrumentHistorySnapshot(request.symbol, request.range);
    case "instrument_search":
      await requireRelayProvider("yahoo", "Instrument search");
      return searchHostedInstrumentCandidates(request.query);
    case "instrument_quote":
      await requireRelayProvider("yahoo", "Instrument quotes");
      return getHostedInstrumentQuoteSnapshot(request.symbol);
    case "instrument_endpoint":
      await requireRelayProvider("yahoo", "Instrument details");
      if (request.endpoint !== "overview") {
        throw new Error(`Unsupported hosted instrument endpoint: ${request.endpoint}`);
      }
      return getHostedInstrumentOverviewSnapshot(request.symbol);
  }
}

async function refreshHostedRelayProviders(runtime: BrowserHostedGuiRuntime): Promise<void> {
  const manifest = await loadHostedRelayManifest();
  if (manifest) runtime.configureRelayProviders(manifest.providers);
}

async function hasRelayProvider(provider: string): Promise<boolean> {
  const manifest = await loadHostedRelayManifest();
  if (manifest) (await hostedGuiRuntimePromise).configureRelayProviders(manifest.providers);
  return manifest?.providers.includes(provider) === true;
}

async function requireRelayProvider(provider: string, capability: string): Promise<void> {
  if (await hasRelayProvider(provider)) return;
  throw new Error(
    `${capability} requires the audited provider relay, which is unavailable or incompatible.`,
  );
}

async function buildHostedDiagnostics(): Promise<Record<string, unknown>> {
  const relayManifest = await loadHostedRelayManifest();
  if (relayManifest) (await hostedGuiRuntimePromise).configureRelayProviders(relayManifest.providers);
  const providers = resolveHostedBrowserCapabilityReport(relayManifest?.providers);
  const relayReady = Boolean(relayManifest);
  return {
    runtime: "hosted-web",
    nodeVersion: process.version,
    status: relayReady ? "ready" : "degraded",
    summary: relayReady
      ? "The browser runtime and audited provider relay are ready. Native-only capabilities remain disabled."
      : "The browser runtime is ready. Relayed and native-only capabilities are disabled.",
    capabilities: CAPABILITIES,
    sections: [
      {
        id: "hosted-runtime",
        label: "Hosted runtime",
        status: "ready",
        checks: [
          {
            id: "browser-node",
            label: "Browser-hosted Node and Pi",
            status: "pass",
            detail: process.version,
          },
          {
            id: "background",
            label: "Background execution after closing the app",
            status: "skip",
            detail: "Unavailable in hosted mode. Use the local GUI or TUI for an always-running process.",
          },
          {
            id: "provider-relay",
            label: "Audited provider relay",
            status: relayReady ? "pass" : "skip",
            detail: relayReady
              ? `Policy v${relayManifest?.version}; ${relayManifest?.providers.length ?? 0} allowed providers.`
              : "Unavailable or incompatible. Relayed tools fail closed.",
          },
        ],
      },
      {
        id: "hosted-providers",
        label: "Browser provider paths",
        status: "degraded",
        checks: [
          ...providers.direct.map((provider) => ({
            id: `provider-${provider.id}`,
            label: provider.displayName,
            status: "pass",
            detail: provider.browserTransport.reason,
          })),
          ...providers.relayed.map((provider) => ({
            id: `provider-${provider.id}`,
            label: provider.displayName,
            status: "pass",
            detail: "Available through the audited OpenCandle provider relay.",
          })),
          ...providers.unavailable.map((provider) => ({
            id: `provider-${provider.id}`,
            label: provider.displayName,
            status: "skip",
            detail: `${provider.browserTransport.reason} Use the local GUI or TUI when needed.`,
          })),
        ],
      },
    ],
  };
}

const server = createServer(async (request, response) => {
  const requestOrigin = request.headers.origin;
  const requestRuntimeToken = request.headers[PRIVATE_RUNTIME_TOKEN_HEADER];
  if (request.method === "OPTIONS") {
    if (requestOrigin !== trustedHostOrigin) {
      sendJson(response, 403, { error: "Request is not authorized" });
      return;
    }
    response.writeHead(204, {
      ...isolationHeaders("text/plain; charset=utf-8"),
      "Access-Control-Allow-Headers": `Content-Type, ${PRIVATE_RUNTIME_TOKEN_HEADER}`,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Max-Age": "600",
    });
    response.end();
    return;
  }
  if (
    !isAuthorizedPrivateRuntimeRequest(
      {
        ...(requestOrigin !== undefined ? { origin: requestOrigin } : {}),
        ...(typeof requestRuntimeToken === "string"
          ? { runtimeToken: requestRuntimeToken }
          : {}),
      },
      { trustedOrigin: trustedHostOrigin, runtimeToken: runtimeEpoch },
    )
  ) {
    sendJson(response, 403, { error: "Request is not authorized" });
    return;
  }
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, {
      runtimeVersion: RUNTIME_VERSION,
      nodeVersion: process.version,
      modelKeyConfigured: MODEL_KEYS.some((value) => Boolean(value?.trim())),
      capabilities: CAPABILITIES,
    });
    return;
  }
  if (request.method === "POST" && request.url === "/probe") {
    try {
      sendJson(response, 200, await runProbe(await readJsonBody(request)));
    } catch (error) {
      sendJson(response, 400, serializeProbeError(error, MODEL_KEYS));
    }
    return;
  }
  if (request.method === "POST" && request.url === "/session") {
    try {
      const parsed = parseSessionRequest(await readJsonBody(request), process.env);
      const apiKey = process.env[MODEL_ENVIRONMENT[parsed.provider].envVar];
      if (!apiKey) throw new Error("Pi session requires a configured model key");
      sendJson(
        response,
        200,
        await runBrowserPiSession(parsed.question, parsed.provider, parsed.modelId, apiKey),
      );
    } catch (error) {
      sendJson(response, 400, serializeProbeError(error, MODEL_KEYS));
    }
    return;
  }
  if (request.method === "POST" && request.url === "/gui") {
    try {
      sendJson(
        response,
        200,
        await runGuiRequest(parseGuiRequest(await readJsonBody(request))),
      );
    } catch (error) {
      sendJson(response, 400, serializeProbeError(error, MODEL_KEYS));
    }
    return;
  }
  if (request.method === "POST" && request.url === "/gui-stream") {
    const controller = new AbortController();
    request.on("aborted", () => controller.abort());
    response.on("close", () => {
      if (!response.writableEnded) controller.abort();
    });
    try {
      const parsed = parseGuiRequest(await readJsonBody(request));
      if (parsed.action !== "chat_run") throw new Error("Only chat runs may be streamed");
      response.writeHead(200, {
        ...isolationHeaders("text/event-stream; charset=utf-8"),
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
      });
      const runtime = await hostedGuiRuntimePromise;
      await runtime.chatRun(
        parsed.sessionId,
        parsed,
        parsed.actionId,
        (event) => writeSse(response, event),
        controller.signal,
      );
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 400, serializeProbeError(error, MODEL_KEYS));
        return;
      }
    } finally {
      if (!response.writableEnded) response.end();
    }
    return;
  }
  sendJson(response, 404, { error: "Not found" });
});

const port = Number.parseInt(process.env.PORT ?? "4174", 10);
if (process.env.OPENCANDLE_RUNTIME_TRANSPORT === "stdio") {
  startStdioTransport();
} else {
  server.listen(Number.isFinite(port) ? port : 4174, "0.0.0.0");
}

function writeProcessFrame(frame: unknown): void {
  process.stdout.write(`${PROCESS_FRAME_PREFIX}${JSON.stringify(frame)}\n`);
}

function startStdioTransport(): void {
  const activeStreams = new Map<string, AbortController>();
  process.stdin.setRawMode?.(true);
  const input = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  input.on("line", (line) => {
    if (Buffer.byteLength(line) > MAX_BODY_BYTES) {
      const requestId = line.match(/"requestId"\s*:\s*"([a-f0-9]{32})"/)?.[1];
      if (requestId) {
        writeProcessFrame({
          type: "response",
          runtimeEpoch,
          requestId,
          ok: false,
          error: "Request frame is too large",
        });
      }
      return;
    }
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const requestId = typeof message.requestId === "string" ? message.requestId : "";
    if (message.type === "cancel" && requestId) {
      activeStreams.get(requestId)?.abort();
      activeStreams.delete(requestId);
      return;
    }
    if (
      message.type !== "request" ||
      message.runtimeEpoch !== runtimeEpoch ||
      !/^[a-f0-9]{32}$/.test(requestId)
    ) return;
    void runStdioRequest(
      requestId,
      String(message.operation ?? ""),
      message.payload,
      activeStreams,
    );
  });
  writeProcessFrame({ type: "ready", runtimeEpoch });
  void hostedGuiRuntimePromise.catch((error) => {
      writeProcessFrame({
        type: "fatal",
        runtimeEpoch,
        error: serializeProbeError(error, MODEL_KEYS).error,
      });
      process.exitCode = 1;
      input.close();
    });
}

async function runStdioRequest(
  requestId: string,
  operation: string,
  payload: unknown,
  activeStreams: Map<string, AbortController>,
): Promise<void> {
  try {
    if (operation === "health") {
      writeProcessFrame({
        type: "response",
        runtimeEpoch,
        requestId,
        ok: true,
        result: {
          runtimeVersion: RUNTIME_VERSION,
          nodeVersion: process.version,
          modelKeyConfigured: MODEL_KEYS.some((value) => Boolean(value?.trim())),
          capabilities: CAPABILITIES,
        },
      });
      return;
    }
    if (operation === "probe") {
      writeProcessFrame({
        type: "response",
        runtimeEpoch,
        requestId,
        ok: true,
        result: await runProbe(payload),
      });
      return;
    }
    if (operation === "session") {
      const parsed = parseSessionRequest(payload, process.env);
      const apiKey = process.env[MODEL_ENVIRONMENT[parsed.provider].envVar];
      if (!apiKey) throw new Error("Pi session requires a configured model key");
      writeProcessFrame({
        type: "response",
        runtimeEpoch,
        requestId,
        ok: true,
        result: await runBrowserPiSession(parsed.question, parsed.provider, parsed.modelId, apiKey),
      });
      return;
    }
    if (operation === "gui") {
      writeProcessFrame({
        type: "response",
        runtimeEpoch,
        requestId,
        ok: true,
        result: await runGuiRequest(parseGuiRequest(payload)),
      });
      return;
    }
    if (operation === "gui-stream") {
      const parsed = parseGuiRequest(payload);
      if (parsed.action !== "chat_run") throw new Error("Only chat runs may be streamed");
      const controller = new AbortController();
      activeStreams.set(requestId, controller);
      const runtime = await hostedGuiRuntimePromise;
      await runtime.chatRun(
        parsed.sessionId,
        parsed,
        parsed.actionId,
        (event) => writeProcessFrame({
          type: "stream-event",
          runtimeEpoch,
          requestId,
          event,
        }),
        controller.signal,
      );
      activeStreams.delete(requestId);
      writeProcessFrame({ type: "stream-end", runtimeEpoch, requestId, ok: true });
      return;
    }
    throw new Error("Unsupported hosted runtime operation");
  } catch (error) {
    activeStreams.delete(requestId);
    writeProcessFrame({
      type: operation === "gui-stream" ? "stream-end" : "response",
      runtimeEpoch,
      requestId,
      ok: false,
      error: serializeProbeError(error, MODEL_KEYS).error,
    });
  }
}
