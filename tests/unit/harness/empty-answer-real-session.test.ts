import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { runOpenCandleSession } from "../../harness/opencandle-runner.js";
import { installDeterministicFetchGuard } from "../../helpers/deterministic-fetch-guard.js";
import {
  type ModelScript,
  startDeterministicModelServer,
} from "../../helpers/deterministic-model-server.js";

async function runSession(script: ModelScript, settleGraceMs = 20, timeoutMs = 20_000) {
  const home = mkdtempSync(join(tmpdir(), "oc-empty-answer-"));
  vi.stubEnv("OPENCANDLE_HOME", home);
  const server = await startDeterministicModelServer((request) => {
    const messages = JSON.stringify(request.messages);
    if (messages.includes("routing agent"))
      return {
        kind: "text",
        text: JSON.stringify({
          routeKind: "agent_task",
          entities: { symbols: [] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          tool_bundles: ["clarification"],
          diagnostics: [],
          reasoning: "General educational question.",
        }),
      };
    if (messages.includes("Write a 4-8 word title"))
      return { kind: "text", text: "Investment uncertainty" };
    return script(request);
  });
  const guard = installDeterministicFetchGuard([{ prefix: server.baseUrl, passthrough: true }]);

  try {
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
    });
    runtime.registerProvider("empty-proof", {
      api: "openai-completions",
      baseUrl: server.baseUrl,
      apiKey: "test-only",
      models: [
        {
          id: "test-model",
          name: "Local transport",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 8192,
          maxTokens: 1024,
        },
      ],
    });
    await runtime.refresh({ allowNetwork: false });
    const manager = SessionManager.inMemory();
    const result = await runOpenCandleSession({
      prompt: "Explain investment uncertainty.",
      cwd: process.cwd(),
      openCandleHome: home,
      modelRuntime: runtime,
      sessionManager: manager,
      defaultProvider: "empty-proof",
      defaultModel: "test-model",
      settleGraceMs,
      timeoutMs,
    });
    expect(guard.unrecognizedUrls).toEqual([]);
    return { ...result, entries: manager.getEntries(), requests: server.requests };
  } finally {
    guard.restore();
    await server.stop();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
}

const clarification = {
  kind: "tool_call" as const,
  id: "ask-1",
  name: "ask_user",
  arguments: { question: "Would you like an example?", question_type: "confirm" },
};

describe("real session terminal completion contract", () => {
  it("waits through Pi retry backoff after a canceled clarification without replaying tools", {
    timeout: 20_000,
  }, async () => {
    let calls = 0;
    const result = await runSession(() => {
      calls += 1;
      if (calls === 1) return clarification;
      if (calls === 2 || calls === 3) return { kind: "error", message: "503 upstream unavailable" };
      return {
        kind: "text",
        text: "You cancelled the example. Investment outcomes are uncertain and losses are possible.",
      };
    }, 3_000);
    expect(result.agentTrace.finalText).toContain("losses are possible");
    expect(calls).toBe(4);
    expect(result.agentTrace.retryEvents).toEqual([
      { type: "auto_retry_start", attempt: 1, delayMs: 2000, errorCategory: "provider_error" },
      { type: "auto_retry_start", attempt: 2, delayMs: 4000, errorCategory: "provider_error" },
      { type: "auto_retry_end", attempt: 2, success: true },
    ]);
    expect(result.agentTrace.toolSequence).toEqual(["ask_user"]);
    expect(result.agentTrace.terminalOutcome).toMatchObject({
      stopReason: "stop",
      errorPresent: false,
      textEmpty: false,
    });
  });
  it("rejects successful-but-empty output even when a disclaimer entry exists", async () => {
    await expect(runSession(() => ({ kind: "text", text: "" }))).rejects.toThrow("empty_answer");
  });

  it("rejects a terminal provider error and persists only safe metadata", async () => {
    let failure: unknown;
    try {
      await runSession(() => ({ kind: "error", message: "401 invalid api key SECRET_TEST_VALUE" }));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain("authentication");
    expect(message).not.toContain("SECRET_TEST_VALUE");
    const path = message.split("Diagnostic: ")[1];
    const diagnostic = readFileSync(path, "utf8");
    expect(diagnostic).not.toContain("SECRET_TEST_VALUE");
    expect(JSON.parse(diagnostic)).toMatchObject({
      reason: "authentication",
      terminalOutcome: { errorPresent: true, textEmpty: true, errorCategory: "authentication" },
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("fails the harness deadline during retry backoff instead of treating it as completion", async () => {
    await expect(
      runSession(() => ({ kind: "error", message: "503 upstream unavailable" }), 20, 150),
    ).rejects.toThrow("timeout");
  });
});
