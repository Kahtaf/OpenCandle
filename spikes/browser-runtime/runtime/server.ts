import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getModel, registerBuiltInApiProviders } from "@earendil-works/pi-ai/compat";
import { searchPredictionMarkets } from "../../../src/providers/polymarket.js";
import { route } from "../../../src/routing/router.js";
import { createPiAiRouterClient } from "../../../src/routing/router-llm-client.js";
import {
  createBridgeDocument,
  createBridgePolicy,
  parseProbeRequest,
  parseTrustedHostOrigin,
  serializeProbeError,
} from "./request-contract.js";

const RUNTIME_VERSION = "browser-runtime-spike-v1";
const MAX_BODY_BYTES = 8_192;
const MAX_EVIDENCE = 5;
const CAPABILITIES = ["health", "polymarket", "router", "diagnostic-synthesis"] as const;
const MODEL_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.OPENAI_API_KEY,
  process.env.ANTHROPIC_API_KEY,
];
const trustedHostOrigin = parseTrustedHostOrigin(process.env.OPENCANDLE_SPIKE_HOST_ORIGIN);

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
  response.end(createBridgeDocument(trustedHostOrigin, nonce));
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

  registerBuiltInApiProviders();
  const model = getModel(request.provider, request.modelId);
  const client = createPiAiRouterClient(model);
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
      `Evidence: ${JSON.stringify(evidence)}`,
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
  sendJson(response, 404, { error: "Not found" });
});

const port = Number.parseInt(process.env.PORT ?? "4174", 10);
server.listen(Number.isFinite(port) ? port : 4174, "0.0.0.0");
