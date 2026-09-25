import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { resetConfigCache } from "../../../src/config.js";
import { listApiKeyProviders } from "../../../src/onboarding/providers.js";
import { runOpenCandleSession } from "../../harness/opencandle-runner.js";
import { installDeterministicFetchGuard } from "../../helpers/deterministic-fetch-guard.js";
import {
  type ModelChatRequest,
  startDeterministicModelServer,
} from "../../helpers/deterministic-model-server.js";

/**
 * Real Pi/session proof for the portfolio-builder evidence guard.
 *
 * This suite drives the production `runOpenCandleSession` stack (real Pi
 * AgentSession, real router model request, real workflow dispatch, real
 * registered tools) with a transport-level scripted model. It exists to pin the
 * exact failure mode behind the `portfolio-builder-conservative` release case:
 * a scripted model that answers the `fetch_candidates` step with a complete
 * no-tool portfolio draft instead of calling a pricing tool.
 *
 * It asserts the runtime contract we depend on (guard runs, one repair attempt,
 * failed terminal status) and records the observed outcome (the fabricated
 * draft is what the trace preserves). The contrast case proves the same stack
 * captures real tool calls when the model asks for a registered tool whose
 * provider response is served from a checked-in fixture.
 */

const PROVIDER_ID = "oc-portfolio-real";
const MODEL_ID = "oc-portfolio-real-model";
const TEST_MODEL_KEY = "test-portfolio-key";
const USER_PROMPT = "Build me a portfolio with $50k";

const ROUTER_RESPONSE = {
  routeKind: "workflow_dispatch",
  workflow: "portfolio_builder",
  entities: { symbols: [], budget: 50_000 },
  slots: {},
  preference_updates: [],
  missing_required: [],
  tool_bundles: ["core_market"],
  diagnostics: [],
  reasoning: "Budget supplied; dispatch the portfolio builder.",
};

const FETCH_DRAFT_MARKER = "ORCHESTRATED_NO_TOOL_DRAFT";
const REPAIR_DRAFT_MARKER = "ORCHESTRATED_NO_TOOL_REPAIR_DRAFT";

const NO_TOOL_DRAFT = `Assumptions: $50,000 budget, balanced profile, 1y+ horizon.
Bottom line: a diversified six-fund portfolio.
${FETCH_DRAFT_MARKER}
| Symbol | Allocation % |
| VOO | 20% |
| VXUS | 15% |
| BND | 20% |
| SHY | 15% |
| TIP | 15% |
| BNDX | 15% |
Why this fits the horizon: growth and stability are balanced.`;

const NO_TOOL_REPAIR_DRAFT = `${REPAIR_DRAFT_MARKER}
Bottom line: the same portfolio without a fresh quote.
| Symbol | Allocation % |
| VOO | 20% |
| VXUS | 15% |
| BND | 20% |
| SHY | 15% |
| TIP | 15% |
| BNDX | 15%`;

interface Harness {
  sessionDir: string;
  openCandleHome: string;
  agentDir: string;
  cleanup(): void;
}

const activeFetchGuards: Array<{ restore(): void }> = [];
const activeModelServers: Array<{ stop(): Promise<void> }> = [];

function createHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "oc-portfolio-real-"));
  return {
    sessionDir: join(root, "sessions"),
    openCandleHome: join(root, "home"),
    agentDir: join(root, "pi-agent"),
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function isolateDataProviderKeys(): () => void {
  const saved = new Map<string, string | undefined>();
  for (const provider of listApiKeyProviders()) {
    saved.set(provider.envVar, process.env[provider.envVar]);
    process.env[provider.envVar] = "";
  }
  resetConfigCache();
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetConfigCache();
  };
}

function isolatePiAgentDir(agentDir: string): () => void {
  const key = "PI_CODING_AGENT_DIR";
  const saved = process.env[key];
  process.env[key] = agentDir;
  return () => {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  };
}

async function createModelRuntime(baseUrl: string): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({
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
        name: "OpenCandle Portfolio Real-Session Model",
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

function buildHistoryFixture(symbol: string, days = 60): unknown {
  const timestamp: number[] = [];
  const open: number[] = [];
  const high: number[] = [];
  const low: number[] = [];
  const close: number[] = [];
  const volume: number[] = [];
  const start = Date.UTC(2026, 5, 1) / 1000;
  for (let i = 0; i < days; i += 1) {
    const price = 180 + Math.sin(i / 4) * 4 + i * 0.1;
    timestamp.push(start + i * 86_400);
    open.push(price - 0.5);
    high.push(price + 1);
    low.push(price - 1);
    close.push(price);
    volume.push(1_000_000 + i);
  }
  return {
    chart: {
      result: [
        {
          meta: {
            symbol,
            regularMarketPrice: close[close.length - 1],
            chartPreviousClose: close[close.length - 2],
            regularMarketTime: timestamp[timestamp.length - 1],
            currency: "USD",
          },
          timestamp,
          indicators: { quote: [{ open, high, low, close, volume }] },
        },
      ],
      error: null,
    },
  };
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .join("");
}

function lastUserText(request: ModelChatRequest): string {
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index];
    if (message?.role === "user") return textOf(message.content);
  }
  return "";
}

function isRouterRequest(request: ModelChatRequest): boolean {
  return JSON.stringify(request.messages).includes("routing agent");
}

function isTitleRequest(request: ModelChatRequest): boolean {
  return JSON.stringify(request.messages).includes("Write a 4-8 word title");
}

interface WorkflowEntrySummary {
  customTypes: string[];
  workflow: string | undefined;
  completeStatus: string | undefined;
  validationFailedSteps: string[];
}

function summarizeWorkflow(
  entries: Array<{ customType: string; data: unknown }>,
): WorkflowEntrySummary {
  const customTypes = entries.map((entry) => entry.customType);
  const workflowEntry = entries.find((entry) => entry.customType === "opencandle-workflow");
  const completeEntry = [...entries]
    .reverse()
    .find((entry) => entry.customType === "opencandle-workflow-complete");
  const validationFailedSteps = entries
    .filter((entry) => entry.customType === "opencandle-workflow-event")
    .map((entry) => entry.data as { eventType?: string; stepType?: string })
    .filter((data) => data.eventType === "output_validation_failed")
    .map((data) => String(data.stepType));
  return {
    customTypes,
    workflow: (workflowEntry?.data as { workflow?: string } | undefined)?.workflow,
    completeStatus: (completeEntry?.data as { status?: string } | undefined)?.status,
    validationFailedSteps,
  };
}

interface VisibleFailureMessage {
  customType: string;
  text: string;
  display: boolean;
  details: unknown;
}

/**
 * Read the user-visible terminal failure notice from the persisted session
 * transcript. `pi.sendMessage` persists a `custom_message` entry (distinct from
 * the `custom` entries the harness trace already drains).
 */
function visibleValidationFailureMessages(entries: readonly unknown[]): VisibleFailureMessage[] {
  return entries
    .filter(
      (
        entry,
      ): entry is {
        type: string;
        customType: string;
        content: unknown;
        display: boolean;
        details?: unknown;
      } => {
        if (typeof entry !== "object" || entry === null) return false;
        const record = entry as { type?: unknown; customType?: unknown };
        return (
          record.type === "custom_message" && record.customType === "Workflow validation failed"
        );
      },
    )
    .map((entry) => ({
      customType: entry.customType,
      text: textOf(entry.content),
      display: entry.display === true,
      details: entry.details,
    }));
}

describe("portfolio builder real-session evidence guard", () => {
  afterEach(async () => {
    for (const guard of activeFetchGuards.splice(0)) guard.restore();
    for (const server of activeModelServers.splice(0)) await server.stop();
  });

  it("fails closed but preserves the fabricated no-tool draft when the model never calls a tool", {
    timeout: 90_000,
  }, async () => {
    const harness = createHarness();
    const restoreProviderKeys = isolateDataProviderKeys();
    const restoreAgentDir = isolatePiAgentDir(harness.agentDir);
    const modelServer = await startDeterministicModelServer((request) => {
      if (isRouterRequest(request)) {
        return { kind: "text", text: JSON.stringify(ROUTER_RESPONSE) };
      }
      if (isTitleRequest(request)) {
        return { kind: "text", text: "Portfolio build" };
      }
      const userText = lastUserText(request);
      if (userText.includes("usable market price evidence")) {
        return { kind: "text", text: NO_TOOL_REPAIR_DRAFT };
      }
      if (userText.includes("Identify candidate holdings")) {
        return { kind: "text", text: NO_TOOL_DRAFT };
      }
      return { kind: "text", text: "unexpected scripted request" };
    });
    activeModelServers.push(modelServer);
    const guard = installDeterministicFetchGuard([
      { prefix: modelServer.baseUrl, passthrough: true },
      {
        prefix: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
        json: buildHistoryFixture("AAPL"),
      },
      { prefix: "https://query1.finance.yahoo.com/", status: 404 },
      { prefix: "https://query2.finance.yahoo.com/", status: 404 },
      { prefix: "https://finance.yahoo.com/", status: 404 },
    ]);
    activeFetchGuards.push(guard);

    try {
      const modelRuntime = await createModelRuntime(modelServer.baseUrl);
      const sessionManager = SessionManager.create(process.cwd(), harness.sessionDir);

      const result = await runOpenCandleSession({
        prompt: USER_PROMPT,
        cwd: process.cwd(),
        openCandleHome: harness.openCandleHome,
        modelRuntime,
        sessionManager,
        defaultProvider: PROVIDER_ID,
        defaultModel: MODEL_ID,
        timeoutMs: 60_000,
      });

      const entries = (result.agentTrace.customEntries ?? []).map((entry) => ({
        customType: entry.customType,
        data: entry.data,
      }));
      const workflow = summarizeWorkflow(entries);

      // 1. The router dispatched the real portfolio workflow.
      expect(workflow.workflow).toBe("portfolio_builder");

      // 2. The evidence guard ran on the fetch step and failed after exactly
      // one repair attempt. The coordinator records one failure per attempt:
      // the initial attempt and the repair attempt, both for fetch_candidates.
      expect(workflow.validationFailedSteps).toEqual(["fetch_candidates", "fetch_candidates"]);
      const repairRequests = modelServer.requests.filter((request) =>
        lastUserText(request).includes("usable market price evidence"),
      );
      expect(repairRequests).toHaveLength(1);

      // 3. The run reached a terminal failed status (it never synthesized).
      expect(workflow.completeStatus).toBe("failed");
      expect(
        modelServer.requests.some((request) =>
          lastUserText(request).includes("Present the final portfolio draft"),
        ),
      ).toBe(false);

      // 4. No tool ever executed, and the trace preserves the fabricated
      // no-tool draft as the final answer. This is the release symptom: the
      // evidence guard fails the workflow internally, but the trace/eval sees a
      // plausible portfolio plus an empty tool sequence.
      expect(result.agentTrace.toolSequence).toEqual([]);
      expect(result.agentTrace.finalText).toContain(REPAIR_DRAFT_MARKER);
      expect(result.evalTrace.toolCalls).toEqual([]);
      expect(result.evalTrace.classification.workflow).toBe("portfolio_builder");

      // 5. A deterministic, user-visible terminal notice is persisted so the
      // fabricated draft is not presented as a validated answer. It carries the
      // workflow identity in details and no raw validation/provider errors.
      const visibleFailures = visibleValidationFailureMessages(sessionManager.getEntries());
      expect(visibleFailures).toHaveLength(1);
      expect(visibleFailures[0]?.display).toBe(true);
      expect(visibleFailures[0]?.text).toMatch(/failed validation/i);
      expect(visibleFailures[0]?.text).toMatch(/unverified|do not rely/i);
      const failureDetails = visibleFailures[0]?.details as
        | { workflow?: string; reason?: string }
        | undefined;
      expect(failureDetails?.workflow).toBe("portfolio_builder");
      expect(failureDetails?.reason).toBe("output_validation_failed");
      expect(visibleFailures[0]?.text).not.toMatch(/output_validation_failed|workflow_output/i);
      // No unbacked rollback/write promise, and no implication that market
      // data was fetched when the failure is missing evidence.
      expect(visibleFailures[0]?.text).not.toMatch(/no changes were saved/i);
      expect(visibleFailures[0]?.text).not.toMatch(/\bfetched\b/i);

      expect(guard.unrecognizedUrls).toEqual([]);
    } finally {
      restoreAgentDir();
      restoreProviderKeys();
      harness.cleanup();
    }
  });

  it("captures real tool calls and completes when the model asks for registered tools", {
    timeout: 90_000,
  }, async () => {
    const harness = createHarness();
    const restoreProviderKeys = isolateDataProviderKeys();
    const restoreAgentDir = isolatePiAgentDir(harness.agentDir);
    const modelServer = await startDeterministicModelServer((request) => {
      if (isRouterRequest(request)) {
        return { kind: "text", text: JSON.stringify(ROUTER_RESPONSE) };
      }
      if (isTitleRequest(request)) {
        return { kind: "text", text: "Portfolio build" };
      }
      const userText = lastUserText(request);
      const lastRole = request.messages.at(-1)?.role;
      if (userText.includes("Present the final portfolio draft")) {
        return {
          kind: "text",
          text: `Assumptions: $50,000 budget, defaults for scope and horizon.
| Symbol | Allocation % |
| VOO | 20% |
| VXUS | 15% |
| BND | 20% |
| SHY | 15% |
| TIP | 15% |
| BNDX | 15%`,
        };
      }
      if (userText.includes("Now review the risk and diversification")) {
        return lastRole === "tool"
          ? { kind: "text", text: "Risk reviewed from the returned metrics." }
          : {
              kind: "tool_call",
              id: "call-portfolio-risk",
              name: "analyze_risk",
              arguments: { symbol: "AAPL" },
            };
      }
      if (userText.includes("Identify candidate holdings")) {
        return lastRole === "tool"
          ? { kind: "text", text: "AAPL is the candidate, quoted from the fixture." }
          : {
              kind: "tool_call",
              id: "call-portfolio-quote",
              name: "get_stock_quote",
              arguments: { symbol: "AAPL" },
            };
      }
      return { kind: "text", text: "unexpected scripted request" };
    });
    activeModelServers.push(modelServer);
    const guard = installDeterministicFetchGuard([
      { prefix: modelServer.baseUrl, passthrough: true },
      {
        prefix: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
        json: buildHistoryFixture("AAPL"),
      },
      { prefix: "https://query1.finance.yahoo.com/", status: 404 },
      { prefix: "https://query2.finance.yahoo.com/", status: 404 },
      { prefix: "https://finance.yahoo.com/", status: 404 },
    ]);
    activeFetchGuards.push(guard);

    try {
      const modelRuntime = await createModelRuntime(modelServer.baseUrl);
      const sessionManager = SessionManager.create(process.cwd(), harness.sessionDir);

      const result = await runOpenCandleSession({
        prompt: USER_PROMPT,
        cwd: process.cwd(),
        openCandleHome: harness.openCandleHome,
        modelRuntime,
        sessionManager,
        defaultProvider: PROVIDER_ID,
        defaultModel: MODEL_ID,
        timeoutMs: 60_000,
      });

      const entries = (result.agentTrace.customEntries ?? []).map((entry) => ({
        customType: entry.customType,
        data: entry.data,
      }));
      const workflow = summarizeWorkflow(entries);

      // The same real stack captures the tool calls and completes the run when
      // the model actually asks for the registered tools.
      expect(result.agentTrace.toolSequence).toEqual(["get_stock_quote", "analyze_risk"]);
      expect(workflow.validationFailedSteps).toEqual([]);
      expect(workflow.completeStatus).toBe("completed");
      // A healthy run emits no terminal validation-failure notice.
      expect(visibleValidationFailureMessages(sessionManager.getEntries())).toEqual([]);
      expect(
        modelServer.requests.some((request) =>
          lastUserText(request).includes("Present the final portfolio draft"),
        ),
      ).toBe(true);
      expect(guard.unrecognizedUrls).toEqual([]);
    } finally {
      restoreAgentDir();
      restoreProviderKeys();
      harness.cleanup();
    }
  });
});
