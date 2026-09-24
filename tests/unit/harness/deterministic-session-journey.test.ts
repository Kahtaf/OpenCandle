import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { resetConfigCache } from "../../../src/config.js";
import { listApiKeyProviders } from "../../../src/onboarding/providers.js";
import quoteFixture from "../../fixtures/yahoo/AAPL-journey-quote.json";
import { runOpenCandleSession } from "../../harness/opencandle-runner.js";
import { installDeterministicFetchGuard } from "../../helpers/deterministic-fetch-guard.js";
import {
  type ModelChatRequest,
  type ModelScriptedReply,
  startDeterministicModelServer,
} from "../../helpers/deterministic-model-server.js";

/**
 * Deterministic end-to-end journey through the real agent/TUI session stack.
 *
 * This suite drives `runOpenCandleSession` -> `createOpenCandleSession` with a
 * real Pi `ModelRuntime` and a persisted `SessionManager`. Model responses are
 * FIXTURE-SYNTHESIZED at the HTTP transport boundary by a local fixture server,
 * and the only outbound data call (the Yahoo quote) is served from a checked-in
 * fixture. The scripted model text is a transport-level fixture: it proves the
 * orchestration, real tool execution, session-event, and persistence wiring,
 * not model intelligence. No OpenCandle session, coordinator, provider, or
 * `wrapProvider` internals are mocked; everything that tries to leave the
 * process is either served locally or rejected by the fetch guard.
 *
 * Isolation: the model runtime uses an in-memory credential store and no
 * `models.json`, the Pi agent directory and session store live under a temp
 * root, and every data-provider API key declared by the provider registry is
 * blanked for the duration of each case.
 */

const PROVIDER_ID = "oc-journey";
const MODEL_ID = "oc-journey-model";
const TEST_MODEL_KEY = "test-journey-key";
const QUOTE_PRICE = 189.42;
const QUOTE_AS_OF_ISO = "2026-07-15T20:00:00.000Z";
const USER_PROMPT = "What is AAPL trading at?";

/**
 * Data-provider API keys that a developer `.env` may carry, read from the
 * provider registry rather than a hand-maintained list. The journey must stay
 * hermetic, so blank each one: an empty value stops `loadEnv()` from
 * re-populating it and makes every data provider fall back to the local
 * fixture or fail honestly.
 */
function isolateDataProviderKeys(): () => void {
  const saved = new Map<string, string | undefined>();
  for (const provider of listApiKeyProviders()) {
    saved.set(provider.envVar, process.env[provider.envVar]);
    process.env[provider.envVar] = "";
  }
  resetConfigCache();
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    resetConfigCache();
  };
}

const ROUTER_RESPONSE = {
  routeKind: "agent_task",
  workflow: "general_finance_qa",
  entities: { symbols: ["AAPL"] },
  slots: {},
  preference_updates: [],
  missing_required: [],
  tool_bundles: ["core_market"],
  diagnostics: [],
  reasoning: "Simple quote request routed straight to the main agent.",
};

interface Harness {
  sessionDir: string;
  openCandleHome: string;
  agentDir: string;
  cleanup(): void;
}

const activeFetchGuards: Array<{ restore(): void }> = [];
const activeModelServers: Array<{ stop(): Promise<void> }> = [];

function createHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "oc-deterministic-journey-"));
  return {
    sessionDir: join(root, "sessions"),
    openCandleHome: join(root, "home"),
    agentDir: join(root, "pi-agent"),
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * Point Pi's agent directory at the temp harness root so the session never
 * reads the developer's ambient `~/.pi/agent` auth, models, settings, or
 * extensions. `PI_CODING_AGENT_DIR` is Pi's documented override.
 */
function isolatePiAgentDir(agentDir: string): () => void {
  const key = "PI_CODING_AGENT_DIR";
  const saved = process.env[key];
  process.env[key] = agentDir;
  return () => {
    if (saved === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved;
    }
  };
}

async function createJourneyModelRuntime(baseUrl: string): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({
    // In-memory credentials + no models.json: the runtime never reads ambient
    // user Pi auth or provider catalog files.
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
  });
  runtime.registerProvider(PROVIDER_ID, {
    api: "openai-completions",
    baseUrl,
    apiKey: TEST_MODEL_KEY,
    models: [
      {
        id: MODEL_ID,
        name: "OpenCandle Journey Test Model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 1024,
      },
    ],
  });
  await runtime.refresh({ allowNetwork: false });
  return runtime;
}

function replyForJourney(request: ModelChatRequest): ModelScriptedReply {
  const serialized = JSON.stringify(request.messages);
  if (serialized.includes("routing agent")) {
    return { kind: "text", text: JSON.stringify(ROUTER_RESPONSE) };
  }
  if (serialized.includes("Write a 4-8 word title")) {
    return { kind: "text", text: "AAPL quote check" };
  }
  if (request.messages.some((message) => message.role === "tool")) {
    return {
      kind: "text",
      text: `AAPL is trading at $${QUOTE_PRICE.toFixed(2)} as of ${QUOTE_AS_OF_ISO}.`,
    };
  }
  return {
    kind: "tool_call",
    id: "call-journey-quote",
    name: "get_stock_quote",
    arguments: { symbol: "AAPL" },
  };
}

function persistedMessageRoles(entries: readonly unknown[]): string[] {
  return entries
    .filter(
      (entry): entry is { type: "message"; message: { role?: unknown } } =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as { type?: unknown }).type === "message",
    )
    .map((entry) => String(entry.message.role));
}

function persistedEntryJson(entries: readonly unknown[]): string {
  return JSON.stringify(entries);
}

describe("deterministic fixture-scripted agent/session journey", () => {
  afterEach(async () => {
    for (const guard of activeFetchGuards.splice(0)) guard.restore();
    for (const server of activeModelServers.splice(0)) await server.stop();
  });

  it("runs a fixture-scripted quote journey, persists it, and reopens the transcript", {
    timeout: 30_000,
  }, async () => {
    const harness = createHarness();
    const restoreProviderKeys = isolateDataProviderKeys();
    const restoreAgentDir = isolatePiAgentDir(harness.agentDir);
    const modelServer = await startDeterministicModelServer(replyForJourney);
    activeModelServers.push(modelServer);
    const guard = installDeterministicFetchGuard([
      { prefix: modelServer.baseUrl, passthrough: true },
      { prefix: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL", json: quoteFixture },
      // Best-effort extended-hours enrichment probes this host; deny it
      // without network so the journey stays offline and deterministic.
      { prefix: "https://finance.yahoo.com/", status: 404 },
      { prefix: "https://query1.finance.yahoo.com/", status: 404 },
      { prefix: "https://query2.finance.yahoo.com/", status: 404 },
    ]);
    activeFetchGuards.push(guard);

    try {
      const modelRuntime = await createJourneyModelRuntime(modelServer.baseUrl);
      const sessionManager = SessionManager.create(process.cwd(), harness.sessionDir);

      const result = await runOpenCandleSession({
        prompt: USER_PROMPT,
        cwd: process.cwd(),
        openCandleHome: harness.openCandleHome,
        modelRuntime,
        sessionManager,
        defaultProvider: PROVIDER_ID,
        defaultModel: MODEL_ID,
        settleGraceMs: 1000,
        timeoutMs: 30_000,
      });

      // 1. Real tool execution: the fixture-scripted assistant asked for a
      // quote and the provider fixture actually flowed through the real tool.
      expect(result.agentTrace.toolSequence).toEqual(["get_stock_quote"]);
      const toolCall = result.agentTrace.turns[0]?.toolCalls[0];
      expect(toolCall?.name).toBe("get_stock_quote");
      expect(toolCall?.args).toEqual({ symbol: "AAPL" });
      expect(toolCall?.isError).toBe(false);
      const toolResult = toolCall?.result as {
        content: Array<{ type: string; text: string }>;
        details: { price: number; asOf: string };
      };
      expect(toolResult.details.price).toBe(QUOTE_PRICE);
      expect(toolResult.details.asOf).toBe(QUOTE_AS_OF_ISO);
      expect(toolResult.content[0]?.text).toContain(`$${QUOTE_PRICE.toFixed(2)}`);

      // 2. The final assistant turn cites the fixture value and as-of date.
      expect(result.agentTrace.finalText).toContain(`$${QUOTE_PRICE.toFixed(2)}`);
      expect(result.agentTrace.finalText).toContain("2026-07-15");

      // 3. The router classified the turn as a direct agent task.
      const routerEntry = result.agentTrace.customEntries?.find(
        (entry) => entry.customType === "opencandle-router",
      );
      const routerOutput = (
        routerEntry?.data as { output?: { routeKind?: string; workflow?: string } } | undefined
      )?.output;
      expect(routerOutput?.routeKind).toBe("agent_task");
      expect(routerOutput?.workflow).toBe("general_finance_qa");

      // 4. The semantically required model requests happened, judged by
      // content rather than position: the router ran, the main agent had
      // tools available, and the real quote result was transported back into
      // a model request as a tool message.
      expect(
        modelServer.requests.some((request) =>
          JSON.stringify(request.messages).includes("routing agent"),
        ),
      ).toBe(true);
      expect(
        modelServer.requests.some(
          (request) => (request.tools?.length ?? 0) > 0 && request.messages.at(-1)?.role === "user",
        ),
      ).toBe(true);
      expect(
        modelServer.requests.some((request) =>
          request.messages.some(
            (message) =>
              message.role === "tool" &&
              JSON.stringify(message).includes(`$${QUOTE_PRICE.toFixed(2)}`),
          ),
        ),
      ).toBe(true);

      // 5. Exactly one user turn, persisted and readable after reopening. The
      // tool evidence and the final answer both reach the transcript, and the
      // test provider key never does.
      const sessionFile = sessionManager.getSessionFile();
      expect(sessionFile).toBeDefined();
      const reopened = SessionManager.open(sessionFile as string);
      const entries = reopened.getEntries();
      expect(persistedMessageRoles(entries).filter((role) => role === "user")).toHaveLength(1);
      const transcript = persistedEntryJson(entries);
      const finalText = result.agentTrace.finalText;
      expect(transcript).toContain("get_stock_quote");
      expect(transcript).toContain(finalText);
      expect(transcript).toContain(`$${QUOTE_PRICE.toFixed(2)}`);
      expect(transcript).not.toContain(TEST_MODEL_KEY);

      // 6. No unrecognized external traffic escaped the process, and the only
      // deliberately denied calls were the best-effort Yahoo enrichment hosts.
      expect(guard.unrecognizedUrls).toEqual([]);
      expect(
        guard.deniedUrls.every(
          (url) =>
            url.startsWith("https://finance.yahoo.com/") ||
            url.startsWith("https://query1.finance.yahoo.com/") ||
            url.startsWith("https://query2.finance.yahoo.com/"),
        ),
      ).toBe(true);
    } finally {
      restoreAgentDir();
      restoreProviderKeys();
      harness.cleanup();
    }
  });

  it("reports an honest unavailable quote when every provider fails", {
    timeout: 30_000,
  }, async () => {
    const harness = createHarness();
    const restoreProviderKeys = isolateDataProviderKeys();
    const restoreAgentDir = isolatePiAgentDir(harness.agentDir);
    const modelServer = await startDeterministicModelServer((request) => {
      const serialized = JSON.stringify(request.messages);
      if (serialized.includes("routing agent")) {
        return { kind: "text", text: JSON.stringify(ROUTER_RESPONSE) };
      }
      if (serialized.includes("Write a 4-8 word title")) {
        return { kind: "text", text: "AAPL quote unavailable" };
      }
      if (request.messages.some((message) => message.role === "tool")) {
        return {
          kind: "text",
          text: "I could not retrieve a live AAPL quote because the quote provider is unavailable. No price can be confirmed.",
        };
      }
      return {
        kind: "tool_call",
        id: "call-journey-unavailable",
        name: "get_stock_quote",
        arguments: { symbol: "AAPL" },
      };
    });
    activeModelServers.push(modelServer);
    const guard = installDeterministicFetchGuard([
      { prefix: modelServer.baseUrl, passthrough: true },
      {
        prefix: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
        json: {
          chart: { result: null, error: { code: "Not Found", description: "No data found" } },
        },
      },
      { prefix: "https://finance.yahoo.com/", status: 404 },
      { prefix: "https://query1.finance.yahoo.com/", status: 404 },
      { prefix: "https://query2.finance.yahoo.com/", status: 404 },
    ]);
    activeFetchGuards.push(guard);

    try {
      const modelRuntime = await createJourneyModelRuntime(modelServer.baseUrl);
      const sessionManager = SessionManager.create(process.cwd(), harness.sessionDir);

      const result = await runOpenCandleSession({
        prompt: USER_PROMPT,
        cwd: process.cwd(),
        openCandleHome: harness.openCandleHome,
        modelRuntime,
        sessionManager,
        defaultProvider: PROVIDER_ID,
        defaultModel: MODEL_ID,
        settleGraceMs: 1000,
        timeoutMs: 30_000,
      });

      expect(result.agentTrace.toolSequence).toEqual(["get_stock_quote"]);
      const unavailableResult = result.agentTrace.turns[0]?.toolCalls[0]?.result as
        | { content?: Array<{ text?: string }> }
        | undefined;
      const toolText = unavailableResult?.content?.[0]?.text ?? "";
      expect(toolText.toLowerCase()).toContain("unavailable");

      // Honest failure: no invented price, no dollar figure.
      expect(result.agentTrace.finalText.toLowerCase()).toContain("unavailable");
      expect(result.agentTrace.finalText).not.toMatch(/\$\s?\d/);
      expect(result.agentTrace.finalText).not.toContain(String(QUOTE_PRICE));

      expect(guard.unrecognizedUrls).toEqual([]);
    } finally {
      restoreAgentDir();
      restoreProviderKeys();
      harness.cleanup();
    }
  });
});
