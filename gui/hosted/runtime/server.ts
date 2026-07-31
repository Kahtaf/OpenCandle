import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { searchPredictionMarkets } from "../../../src/providers/polymarket.js";
import { getHostedBrowserCapabilityReport } from "../../../src/onboarding/providers.js";
import { route } from "../../../src/routing/router.js";
import {
  renderUntrustedText,
  untrustedContentHeader,
} from "../../../src/tools/sentiment/untrusted-text.js";
import { runBrowserPiSession } from "./browser-pi-session.js";
import { createBrowserPiRouterClient } from "./browser-pi-router-client.js";
import { BrowserHostedGuiRuntime } from "./browser-hosted-gui-runtime.js";
import {
  createBridgeDocument,
  createBridgePolicy,
  type GuiRequest,
  parseGuiRequest,
  parseProbeRequest,
  parseSessionRequest,
  parseTrustedHostOrigin,
  serializeProbeError,
} from "./request-contract.js";

const RUNTIME_VERSION = "opencandle-hosted-web-v1";
const MAX_BODY_BYTES = 8_192;
const MAX_EVIDENCE = 5;
const CAPABILITIES = [
  "health",
  "polymarket",
  "router",
  "diagnostic-synthesis",
  "pi-agent-session",
] as const;
const MODEL_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.OPENAI_API_KEY,
  process.env.ANTHROPIC_API_KEY,
];
const trustedHostOrigin = parseTrustedHostOrigin(process.env.OPENCANDLE_SPIKE_HOST_ORIGIN);
const runtimeEpoch = process.env.OPENCANDLE_RUNTIME_EPOCH;
if (!runtimeEpoch || !/^[a-f0-9]{32}$/.test(runtimeEpoch)) {
  throw new Error("OPENCANDLE_RUNTIME_EPOCH is invalid");
}
const hostedGuiRuntimePromise = BrowserHostedGuiRuntime.create({
  cwd: process.cwd(),
  sessionDir: `${process.cwd()}/sessions`,
  stateFile: `${process.cwd()}/state/current.sqlite3`,
  currentSessionId: process.env.OPENCANDLE_CURRENT_SESSION_ID,
  modelId: "gpt-4.1-mini",
  apiKey: process.env.OPENAI_API_KEY,
});

function isolationHeaders(contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, isolationHeaders("application/json; charset=utf-8"));
  response.end(JSON.stringify(body));
}

function sendBridge(response: ServerResponse): void {
  const nonce = randomBytes(18).toString("base64url");
  response.writeHead(200, {
    ...isolationHeaders("text/html; charset=utf-8"),
    "Cache-Control": "no-store",
    "Content-Security-Policy": createBridgePolicy(trustedHostOrigin, nonce),
  });
  response.end(createBridgeDocument(trustedHostOrigin, nonce, runtimeEpoch));
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
  const client = createBrowserPiRouterClient(request.provider, request.modelId, modelKey);
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
    case "bootstrap":
      return runtime.bootstrap();
    case "configure_model":
      runtime.configureModel(request.modelId, request.apiKey);
      return runtime.bootstrap();
    case "new_session":
      return runtime.newSession();
    case "load_session":
      return runtime.loadSession(request.sessionId);
    case "rename_session":
      return runtime.renameSession(request.sessionId, request.name);
    case "delete_session":
      return runtime.deleteSession(request.sessionId);
    case "chat_run":
      return runtime.chatRun(
        request.sessionId,
        request.prompt,
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
    case "market_indices":
    case "instrument_history":
    case "instrument_search":
    case "instrument_quote":
    case "instrument_endpoint":
      throw new Error(
        "Live quotes and instrument lookup do not have a proven direct-browser provider yet. Use the local GUI or TUI for this capability.",
      );
  }
}

function buildHostedDiagnostics(): Record<string, unknown> {
  const providers = getHostedBrowserCapabilityReport();
  return {
    runtime: "hosted-web",
    nodeVersion: process.version,
    status: "degraded",
    summary: "The browser runtime is ready. Capabilities without a proven direct path are disabled.",
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
  if (request.method === "GET" && request.url === "/bridge") {
    sendBridge(response);
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
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("Pi session requires a configured model key");
      sendJson(
        response,
        200,
        await runBrowserPiSession(parsed.question, parsed.modelId, apiKey),
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
        parsed.prompt,
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
server.listen(Number.isFinite(port) ? port : 4174, "0.0.0.0");
