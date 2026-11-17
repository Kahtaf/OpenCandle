import { once } from "node:events";
import { createServer } from "node:http";
import { type AssistantMessage, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  type AgentSessionEvent,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenCandleSession } from "../../../src/pi/session.js";

type Part =
  | { text: string; thought?: boolean }
  | { functionCall: { name: string; args: Record<string, string> } };
const tool: Part[] = [
  {
    functionCall: {
      name: "ask_user",
      args: { question: "Would you like an example?", question_type: "confirm" },
    },
  },
];
const answer: Part[] = [{ text: "Investments can lose value." }];

async function runLocalSession(
  parts: Part[][],
  options: { enabled?: boolean; abort?: "backoff" | "active"; summary?: boolean } = {},
) {
  const requests: Record<string, unknown>[] = [];
  const events: AgentSessionEvent[] = [];
  let cancelActiveRequest: (() => Promise<void>) | undefined;
  let activeRequestCancelled = false;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    const ancillary = body.includes("routing agent") || body.includes("Write a 4-8 word title");
    const responseParts = body.includes("routing agent")
      ? [
          {
            text: JSON.stringify({
              routeKind: "agent_task",
              entities: { symbols: [] },
              slots: {},
              preference_updates: [],
              missing_required: [],
              tool_bundles: ["clarification"],
              diagnostics: [],
              reasoning: "Educational question.",
            }),
          },
        ]
      : ancillary
        ? [{ text: "Investment uncertainty" }]
        : parts[Math.min(requests.length, parts.length - 1)];
    if (!ancillary) requests.push(request);
    if (!ancillary && options.abort === "active" && requests.length === 2) {
      res.once("close", () => {
        activeRequestCancelled = true;
      });
      void cancelActiveRequest?.();
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: responseParts }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: responseParts.length, totalTokenCount: 12 + responseParts.length } })}\n\n`,
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local server did not bind");
  const baseUrl = `http://127.0.0.1:${address.port}/v1beta`;
  const fetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(baseUrl)) throw new Error("Nonlocal fetch blocked by regression test");
    return fetch(input, init);
  });
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
  });
  runtime.registerProvider("google", {
    api: "google-generative-ai",
    baseUrl,
    apiKey: "synthetic-local-only",
    models: [
      {
        id: "gemini-2.5-flash",
        name: "Local Gemini SSE",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 1024,
      },
    ],
  });
  await runtime.refresh({ allowNetwork: false });
  const manager = SessionManager.inMemory();
  const askUser = vi.fn(async () => ({ answer: "yes", cancelled: false }));
  const created = await createOpenCandleSession({
    modelRuntime: runtime,
    sessionManager: manager,
    settingsManager: SettingsManager.inMemory({
      defaultProvider: "google",
      defaultModel: "gemini-2.5-flash",
      retry: {
        enabled: options.enabled ?? true,
        maxRetries: 2,
        baseDelayMs: options.abort ? 200 : 1,
        maxAgentDelayMs: 200,
      },
      compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 128 },
    }),
    askUserHandler: askUser,
    useInlineExtension: !options.summary,
  });
  try {
    cancelActiveRequest = () => created.session.abort();
    created.session.subscribe((event) => {
      events.push(structuredClone(event));
      if (options.abort === "backoff" && event.type === "auto_retry_start")
        setTimeout(() => void created.session.abort(), 10);
    });
    await created.session.prompt("Explain investment uncertainty.");
    await created.waitForSettled();
    expect(created.session.isIdle).toBe(true);
    if (options.abort === "backoff") await new Promise((resolve) => setTimeout(resolve, 250));
    if (options.abort === "active") {
      await vi.waitFor(() => expect(activeRequestCancelled).toBe(true));
    }
    let summaryAuthCalls: number | undefined;
    let summaryRequests: number | undefined;
    if (options.summary) {
      await created.session.prompt("Explain another uncertainty.");
      await created.waitForSettled();
      const getAuth = vi.spyOn(runtime, "getAuth");
      const before = requests.length;
      const summary = await created.session.compact();
      summaryRequests = requests.length - before;
      expect(summary.summary).toContain("Investments can lose value.");
      summaryAuthCalls = getAuth.mock.calls.length;
    }
    const entries = manager.getEntries();
    const messages = entries.flatMap((entry) => (entry.type === "message" ? [entry.message] : []));
    const assistants = messages.filter(
      (message): message is AssistantMessage => message.role === "assistant",
    );
    return {
      requests,
      events,
      entries,
      messages,
      assistants,
      projected: manager.buildSessionContext().messages,
      toolExecutions: askUser.mock.calls.length,
      summaryAuthCalls,
      summaryRequests,
      title: created.session.sessionName,
      activeRequestCancelled,
    };
  } finally {
    created.session.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OpenCandle local Gemini SSE completion", () => {
  it("preserves SDK summary auth ownership", async () => {
    const proof = await runLocalSession([answer], { summary: true });
    expect(proof.summaryRequests).toBeGreaterThan(0);
    expect(proof.summaryAuthCalls).toBe(proof.summaryRequests);
  });

  it("recovers after a completed tool without replay and retains the failed attempt", async () => {
    const proof = await runLocalSession([tool, [], answer]);
    expect(proof.requests).toHaveLength(3);
    expect(proof.toolExecutions).toBe(1);
    expect(proof.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(JSON.stringify(proof.requests[2])).toContain("functionResponse");
    expect(JSON.stringify(proof.requests[2])).toContain("yes");
    expect(proof.assistants.map((message) => message.stopReason)).toEqual([
      "toolUse",
      "error",
      "stop",
    ]);
    expect(proof.assistants[1].rawStopReason).toBe("STOP");
    expect(proof.assistants[1].diagnostics).toContainEqual(
      expect.objectContaining({ details: { originalStopReason: "stop" } }),
    );
    expect(
      proof.projected.filter(
        (message) => message.role === "assistant" && message.stopReason === "error",
      ),
    ).toHaveLength(0);
    expect(proof.projected.filter((message) => message.role === "toolResult")).toHaveLength(1);
    expect(proof.events.filter((event) => event.type === "auto_retry_start")).toHaveLength(1);
    expect(proof.events).toContainEqual(
      expect.objectContaining({ type: "auto_retry_end", success: true }),
    );
    expect(proof.assistants.at(-1)?.content).toContainEqual(
      expect.objectContaining({ type: "text", text: "Investments can lose value." }),
    );
  });

  it("exhausts exactly Pi's configured retry bound with explicit failure", async () => {
    const proof = await runLocalSession([[]]);
    expect(proof.requests).toHaveLength(3);
    expect(proof.assistants).toHaveLength(3);
    expect(
      proof.assistants.every(
        (message) => message.stopReason === "error" && message.rawStopReason === "STOP",
      ),
    ).toBe(true);
    expect(proof.assistants.at(-1)?.errorMessage).toBeTruthy();
    expect(proof.events.filter((event) => event.type === "auto_retry_start")).toHaveLength(2);
    expect(proof.events).toContainEqual(
      expect.objectContaining({ type: "auto_retry_end", success: false }),
    );
  });

  it("fails explicitly when retries are disabled", async () => {
    const proof = await runLocalSession([[]], { enabled: false });
    expect(proof.requests).toHaveLength(1);
    expect(proof.assistants.at(-1)?.stopReason).toBe("error");
    expect(proof.events.some((event) => event.type === "auto_retry_start")).toBe(false);
  });

  it("cancels Pi backoff without another request", async () => {
    const proof = await runLocalSession([[], answer], { abort: "backoff" });
    expect(proof.requests).toHaveLength(1);
    expect(proof.events.filter((event) => event.type === "auto_retry_start")).toHaveLength(1);
    expect(proof.events).toContainEqual(
      expect.objectContaining({ type: "auto_retry_end", success: false }),
    );
  });

  it("cancels an active recovery request without another attempt", async () => {
    const proof = await runLocalSession([[], answer], { abort: "active" });
    expect(proof.requests).toHaveLength(2);
    expect(proof.activeRequestCancelled).toBe(true);
    expect(proof.assistants.at(-1)?.stopReason).toBe("aborted");
    expect(proof.events.filter((event) => event.type === "auto_retry_start")).toHaveLength(1);
  });

  it("leaves a nonempty normal STOP alone", async () => {
    const proof = await runLocalSession([answer]);
    expect(proof.requests).toHaveLength(1);
    expect(proof.title).toBe("Investment uncertainty");
    expect(proof.assistants.at(-1)?.stopReason).toBe("stop");
    expect(proof.events.some((event) => event.type === "auto_retry_start")).toBe(false);
  });
});
