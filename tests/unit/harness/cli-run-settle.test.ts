import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { resetConfigCache } from "../../../src/config.js";
import { listApiKeyProviders } from "../../../src/onboarding/providers.js";
import { runHarnessCli } from "../../harness/cli-run.js";
import { IpcChannel } from "../../harness/ipc.js";
import { installDeterministicFetchGuard } from "../../helpers/deterministic-fetch-guard.js";
import {
  type ModelChatRequest,
  type ModelScriptedReply,
  startDeterministicModelServer,
} from "../../helpers/deterministic-model-server.js";

/**
 * `cli.ts run` must settle on workflow completion, not on a fixed grace after
 * the first `agent_end`. A scripted multi-step portfolio workflow whose final
 * synthesis step is slow to produce its first token is the exact shape that
 * made the CLI return after `risk_review` (issue #238).
 */

const PROVIDER_ID = "oc-cli-settle";
const MODEL_ID = "oc-cli-settle-model";
const SYNTHESIS_MARKER = "CLI_SETTLE_FINAL_SYNTHESIS";

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

const SYNTHESIS_TEXT = `Assumptions: $50,000 budget, defaults for scope and horizon.
${SYNTHESIS_MARKER}
| Symbol | Allocation % |
| VOO | 20% |
| VXUS | 15% |
| BND | 20% |
| SHY | 15% |
| TIP | 15% |
| BNDX | 15% |`;

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

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

function buildHistoryFixture(symbol: string, days = 60): unknown {
  const timestamp: number[] = [];
  const close: number[] = [];
  const start = Date.UTC(2026, 5, 1) / 1000;
  for (let i = 0; i < days; i += 1) {
    timestamp.push(start + i * 86_400);
    close.push(180 + Math.sin(i / 4) * 4 + i * 0.1);
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
          indicators: {
            quote: [
              {
                open: close.map((price) => price - 0.5),
                high: close.map((price) => price + 1),
                low: close.map((price) => price - 1),
                close,
                volume: close.map((_, i) => 1_000_000 + i),
              },
            ],
          },
        },
      ],
      error: null,
    },
  };
}

/** Isolate data-provider keys, the Pi agent dir, and network for one run. */
async function setUpScriptedPortfolio(synthesis: () => Promise<ModelScriptedReply>) {
  const root = mkdtempSync(join(tmpdir(), "oc-cli-settle-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));

  const savedKeys = new Map<string, string | undefined>();
  for (const provider of listApiKeyProviders()) {
    savedKeys.set(provider.envVar, process.env[provider.envVar]);
    process.env[provider.envVar] = "";
  }
  resetConfigCache();
  const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, "pi-agent");
  cleanups.push(() => {
    for (const [key, value] of savedKeys) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetConfigCache();
    if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
  });

  const modelServer = await startDeterministicModelServer((request) => {
    const serialized = JSON.stringify(request.messages);
    if (serialized.includes("routing agent")) {
      return { kind: "text", text: JSON.stringify(ROUTER_RESPONSE) };
    }
    if (serialized.includes("Write a 4-8 word title")) {
      return { kind: "text", text: "Portfolio build" };
    }
    const userText = lastUserText(request);
    const lastRole = request.messages.at(-1)?.role;
    if (userText.includes("Present the final portfolio draft")) return synthesis();
    if (userText.includes("Now review the risk and diversification")) {
      return lastRole === "tool"
        ? { kind: "text", text: "Risk reviewed from the returned metrics." }
        : {
            kind: "tool_call",
            id: "call-risk",
            name: "analyze_risk",
            arguments: { symbol: "AAPL" },
          };
    }
    if (userText.includes("Identify candidate holdings")) {
      return lastRole === "tool"
        ? { kind: "text", text: "AAPL is the candidate, quoted from the fixture." }
        : {
            kind: "tool_call",
            id: "call-quote",
            name: "get_stock_quote",
            arguments: { symbol: "AAPL" },
          };
    }
    return { kind: "text", text: "unexpected scripted request" };
  });
  cleanups.push(() => modelServer.stop());

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
  cleanups.push(() => guard.restore());

  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
  });
  modelRuntime.registerProvider(PROVIDER_ID, {
    api: "openai-completions",
    baseUrl: modelServer.baseUrl,
    apiKey: "test-cli-settle-key",
    models: [
      {
        id: MODEL_ID,
        name: "OpenCandle CLI Settle Model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 1024,
      },
    ],
  });
  await modelRuntime.refresh({ allowNetwork: false });

  return { root, modelServer, guard, modelRuntime };
}

function customTypes(ipcDir: string): Array<{ customType: string; data: unknown }> {
  return (IpcChannel.readTrace(ipcDir)?.customEntries ?? []).map(({ customType, data }) => ({
    customType,
    data,
  }));
}

describe("cli.ts run settles on workflow completion", () => {
  it("returns only after the final synthesis step of a multi-step workflow", {
    timeout: 90_000,
  }, async () => {
    // The synthesis step's first token arrives well after the prior step's
    // agent_end, longer than the old fixed 3s settle grace.
    const { root, modelServer, guard, modelRuntime } = await setUpScriptedPortfolio(async () => {
      await new Promise((resolve) => setTimeout(resolve, 4_500));
      return { kind: "text", text: SYNTHESIS_TEXT };
    });
    const ipcDir = join(root, "ipc");

    const result = await runHarnessCli({
      prompt: "Build me a portfolio with $50k",
      ipcDir,
      timeoutMs: 60_000,
      settleMs: 200,
      lingerMs: 0,
      modelRuntime,
      defaultProvider: PROVIDER_ID,
      defaultModel: MODEL_ID,
    });

    expect(result.exitCode).toBe(0);
    expect(IpcChannel.readStatus(ipcDir)).toBe("done");
    const trace = IpcChannel.readTrace(ipcDir);
    expect(trace?.toolSequence).toEqual(["get_stock_quote", "analyze_risk"]);
    expect(trace?.finalText).toContain(SYNTHESIS_MARKER);
    expect(customTypes(ipcDir)).toContainEqual({
      customType: "opencandle-workflow-complete",
      data: expect.objectContaining({ workflow: "portfolio_builder", status: "completed" }),
    });
    expect(existsSync(join(ipcDir, "incomplete.json"))).toBe(false);
    expect(
      modelServer.requests.some((request) =>
        lastUserText(request).includes("Present the final portfolio draft"),
      ),
    ).toBe(true);
    expect(guard.unrecognizedUrls).toEqual([]);
  });

  it("reports a distinct incomplete status and non-zero exit when the timeout hits mid-workflow", {
    timeout: 90_000,
  }, async () => {
    let releaseSynthesis = () => {};
    const synthesisHeld = new Promise<void>((resolve) => {
      releaseSynthesis = resolve;
    });
    cleanups.push(() => releaseSynthesis());
    const { root, modelRuntime } = await setUpScriptedPortfolio(async () => {
      await synthesisHeld;
      return { kind: "text", text: SYNTHESIS_TEXT };
    });
    const ipcDir = join(root, "ipc");

    const result = await runHarnessCli({
      prompt: "Build me a portfolio with $50k",
      ipcDir,
      timeoutMs: 8_000,
      settleMs: 200,
      lingerMs: 0,
      modelRuntime,
      defaultProvider: PROVIDER_ID,
      defaultModel: MODEL_ID,
    });

    expect(result.exitCode).toBe(3);
    expect(IpcChannel.readStatus(ipcDir)).toBe("incomplete");
    const incomplete = JSON.parse(readFileSync(join(ipcDir, "incomplete.json"), "utf-8")) as {
      reason: string;
      workflow?: string;
      timeoutMs: number;
    };
    expect(incomplete).toEqual({
      reason: "workflow_running",
      workflow: "portfolio_builder",
      timeoutMs: 8_000,
    });
    // The partial trace is still written for diagnosis, and it never carries
    // the final synthesis or a completed workflow marker.
    const trace = IpcChannel.readTrace(ipcDir);
    expect(trace?.toolSequence).toEqual(["get_stock_quote", "analyze_risk"]);
    expect(trace?.finalText ?? "").not.toContain(SYNTHESIS_MARKER);
    expect(customTypes(ipcDir).map((entry) => entry.customType)).not.toContain(
      "opencandle-workflow-complete",
    );

    // `cli.ts wait` surfaces the same incomplete status with its own exit code,
    // distinct from done (0), error (1), and its own wait timeout (2).
    const waited = spawnSync(
      process.execPath,
      ["--import", "tsx", "tests/harness/cli.ts", "wait", "--ipc", ipcDir, "--timeout", "5000"],
      { cwd: process.cwd(), encoding: "utf-8" },
    );
    expect(waited.status).toBe(3);
    expect(JSON.parse(waited.stdout.trim())).toMatchObject({
      status: "incomplete",
      reason: "workflow_running",
      workflow: "portfolio_builder",
      timeoutMs: 8_000,
      toolSequence: ["get_stock_quote", "analyze_risk"],
    });
  });
});
