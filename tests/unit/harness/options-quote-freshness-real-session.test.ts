import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import { createOpenCandleSessionCore } from "../../../src/pi/session-core.js";
import { getOpenCandleToolDefinitions } from "../../../src/pi/tool-adapter.js";
import { clearCrumbCache } from "../../../src/providers/yahoo-finance.js";
import afterHoursFixture from "../../fixtures/yahoo/options-AAPL-after-hours.json";
import regularFixture from "../../fixtures/yahoo/options-AAPL-regular.json";
import { installDeterministicFetchGuard } from "../../helpers/deterministic-fetch-guard.js";
import { startDeterministicModelServer } from "../../helpers/deterministic-model-server.js";
import { yahooOptionsFetch } from "../../helpers/option-chain-results.js";
import { createTestModelRuntime } from "../../helpers/pi-model-runtime.js";

const UNDISCLOSED = `| Strike | Expiry | Premium | Delta |
| --- | --- | --- | --- |
| $210 | 2026-06-19 | $4.80 | 0.42 |
Bottom line: buy the $210 call for a $480 premium per contract. Max loss = premium. Verify with your broker before trading.`;

const DISCLOSED = `| Strike | Expiry | Last-session premium | Delta |
| --- | --- | --- | --- |
| $210 | 2026-06-19 | $4.80 | 0.42 |
These are last-session quotes and are not executable now; recheck bid/ask after regular options trading opens.
Bottom line: the $210 call ranks first. Max loss = premium.`;

interface Scenario {
  name: string;
  fixture: unknown;
  repairReply?: string;
  /** First-step text after the chain fetch; defaults to a figure-free status line. */
  fetchReply?: string;
  expectedRepairs: number;
  expectedValidationFailures: number;
  expectedStatus: "completed" | "failed";
}

const scenarios: Scenario[] = [
  {
    name: "stale chain, repair discloses",
    fixture: afterHoursFixture,
    repairReply: DISCLOSED,
    expectedRepairs: 1,
    expectedValidationFailures: 1,
    expectedStatus: "completed",
  },
  {
    name: "stale chain, repair still undisclosed",
    fixture: afterHoursFixture,
    repairReply: UNDISCLOSED,
    expectedRepairs: 1,
    expectedValidationFailures: 2,
    expectedStatus: "failed",
  },
  {
    name: "live regular-session chain",
    fixture: regularFixture,
    fetchReply: UNDISCLOSED,
    expectedRepairs: 0,
    expectedValidationFailures: 0,
    expectedStatus: "completed",
  },
  {
    name: "stale chain, first-step table undisclosed",
    fixture: afterHoursFixture,
    fetchReply: UNDISCLOSED,
    repairReply: DISCLOSED,
    expectedRepairs: 2,
    expectedValidationFailures: 2,
    expectedStatus: "completed",
  },
];

describe("real options_screener quote-freshness gate", () => {
  it.each(scenarios)(
    "$name: at most one repair per step and no repeated chain fetch",
    { timeout: 20_000 },
    async (scenario) => {
      const home = mkdtempSync(join(tmpdir(), "oc-quote-gate-"));
      vi.stubEnv("OPENCANDLE_HOME", home);
      cache.clear();
      clearCrumbCache();
      rateLimiter.configure("yahoo", 5, 5);
      let repairCalls = 0;
      let chainCalls = 0;
      const server = await startDeterministicModelServer((request) => {
        const last = request.messages.at(-1);
        if (last?.role === "tool") {
          return { kind: "text", text: scenario.fetchReply ?? "Fetched the option chain." };
        }
        const lastUser = [...request.messages].reverse().find((message) => message.role === "user");
        const text =
          typeof lastUser?.content === "string"
            ? lastUser.content
            : JSON.stringify(lastUser?.content);
        if (text.includes("failed quote-freshness validation")) {
          repairCalls += 1;
          return { kind: "text", text: scenario.repairReply ?? UNDISCLOSED };
        }
        if (text.includes("Now rank and present")) return { kind: "text", text: UNDISCLOSED };
        chainCalls += 1;
        return {
          kind: "tool_call",
          id: `chain-${chainCalls}`,
          name: "get_option_chain",
          arguments: { symbol: "AAPL" },
        };
      });
      const guard = installDeterministicFetchGuard([{ prefix: server.baseUrl, passthrough: true }]);
      const guardedFetch = globalThis.fetch;
      globalThis.fetch = yahooOptionsFetch(scenario.fixture, guardedFetch);
      let created: Awaited<ReturnType<typeof createOpenCandleSessionCore>> | undefined;
      try {
        const { modelRuntime } = await createTestModelRuntime();
        modelRuntime.registerProvider("quote-gate", {
          api: "openai-completions",
          baseUrl: server.baseUrl,
          apiKey: "test-only",
          models: [
            {
              id: "local",
              name: "Local quote gate",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 16384,
              maxTokens: 2048,
            },
          ],
        });
        await modelRuntime.refresh({ allowNetwork: false });
        const manager = SessionManager.inMemory();
        created = await createOpenCandleSessionCore({
          cwd: process.cwd(),
          agentDir: join(home, "agent"),
          modelRuntime,
          sessionManager: manager,
          settingsManager: SettingsManager.inMemory({
            defaultProvider: "quote-gate",
            defaultModel: "local",
          }),
          askUserHandler: async () => ({ answer: null, cancelled: true }),
          toolDefinitions: getOpenCandleToolDefinitions(),
          titleCompletion: async () => "Call screen",
          routerLlmClient: {
            complete: async () =>
              JSON.stringify({
                routeKind: "workflow_dispatch",
                workflow: "options_screener",
                entities: {
                  symbols: ["AAPL"],
                  direction: "bullish",
                  dteTarget: "25_to_45_days",
                },
                slots: {},
                preference_updates: [],
                missing_required: [],
                tool_bundles: ["core_market", "options"],
                diagnostics: [],
                reasoning: "Screen calls.",
              }),
          },
        });
        await created.session.prompt("Find me a bullish AAPL call about a month out.");
        await created.waitForSettled();
        const entries = manager.getEntries().filter((entry) => entry.type === "custom");
        const validationEvents = entries.filter(
          (entry) =>
            entry.customType === "opencandle-workflow-event" &&
            (entry.data as { eventType?: string }).eventType === "output_validation_failed",
        );
        expect(chainCalls).toBe(1);
        expect(repairCalls).toBe(scenario.expectedRepairs);
        expect(validationEvents).toHaveLength(scenario.expectedValidationFailures);
        if (scenario.expectedRepairs > 0) {
          expect(JSON.stringify(validationEvents[0].data)).toContain("last_session_quotes");
        }
        expect(
          entries.findLast((entry) => entry.customType === "opencandle-workflow-complete")?.data,
        ).toMatchObject({ status: scenario.expectedStatus });
        expect(guard.unrecognizedUrls).toEqual([]);
      } finally {
        created?.session.dispose();
        globalThis.fetch = guardedFetch;
        guard.restore();
        await server.stop();
        vi.unstubAllEnvs();
        cache.clear();
        clearCrumbCache();
        rmSync(home, { recursive: true, force: true });
      }
    },
  );
});
