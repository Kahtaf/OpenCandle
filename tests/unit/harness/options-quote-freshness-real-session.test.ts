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
import { OPTION_QUOTE_NOTICE_TYPE } from "../../../src/runtime/quote-notice.js";
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

const AFTER_HOURS_NOTICE =
  "Options market is after hours. Option prices shown are from the last regular session and are not executable now.";

interface Scenario {
  name: string;
  route: "workflow" | "agent_task";
  fixture: unknown;
  expectedNotice?: string;
}

const scenarios: Scenario[] = [
  {
    name: "options_screener workflow on an after-hours chain",
    route: "workflow",
    fixture: afterHoursFixture,
    expectedNotice: AFTER_HOURS_NOTICE,
  },
  { name: "options_screener workflow on a live chain", route: "workflow", fixture: regularFixture },
  {
    name: "single-turn agent task on an after-hours chain",
    route: "agent_task",
    fixture: afterHoursFixture,
    expectedNotice: AFTER_HOURS_NOTICE,
  },
  { name: "single-turn agent task on a live chain", route: "agent_task", fixture: regularFixture },
];

describe("real session non-live option quote notice", () => {
  it.each(scenarios)(
    "$name: deterministic notice, no model repair",
    { timeout: 20_000 },
    async (scenario) => {
      const home = mkdtempSync(join(tmpdir(), "oc-quote-gate-"));
      vi.stubEnv("OPENCANDLE_HOME", home);
      cache.clear();
      clearCrumbCache();
      rateLimiter.configure("yahoo", 5, 5);
      let chainCalls = 0;
      const server = await startDeterministicModelServer((request) => {
        const last = request.messages.at(-1);
        if (last?.role === "tool") return { kind: "text", text: UNDISCLOSED };
        // Rank from the chain already fetched: a second fetch would be a cache
        // read whose session is rechecked against the wall clock.
        if (JSON.stringify(last?.content).includes("Now rank and present")) {
          return { kind: "text", text: UNDISCLOSED };
        }
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
              JSON.stringify(
                scenario.route === "workflow"
                  ? {
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
                    }
                  : {
                      routeKind: "agent_task",
                      entities: { symbols: ["AAPL"] },
                      slots: {},
                      preference_updates: [],
                      missing_required: [],
                      tool_bundles: ["core_market", "options"],
                      diagnostics: [],
                      reasoning: "Quote an option.",
                    },
              ),
          },
        });
        await created.session.prompt("Find me a bullish AAPL call about a month out.");
        await created.waitForSettled();
        const all = manager.getEntries();
        const validationEvents = all.filter(
          (entry) =>
            entry.type === "custom" &&
            entry.customType === "opencandle-workflow-event" &&
            (entry.data as { eventType?: string }).eventType === "output_validation_failed",
        );
        const notices = all.filter(
          (entry) =>
            entry.type === "custom_message" && entry.customType === OPTION_QUOTE_NOTICE_TYPE,
        );
        expect(chainCalls).toBe(1);
        // No model repair is ever requested for quote freshness.
        expect(validationEvents).toEqual([]);
        if (scenario.expectedNotice) {
          expect(notices).toHaveLength(1);
          const notice = notices[0] as { content: unknown; display: boolean };
          expect(JSON.stringify(notice.content)).toContain(scenario.expectedNotice);
          expect(notice.display).toBe(true);
          // The notice follows the final answer.
          const lastAssistant = all.findLastIndex(
            (entry) => entry.type === "message" && entry.message.role === "assistant",
          );
          expect(all.indexOf(notices[0])).toBeGreaterThan(lastAssistant);
        } else {
          expect(notices).toEqual([]);
        }
        if (scenario.route === "workflow") {
          expect(
            all.findLast(
              (entry) =>
                entry.type === "custom" && entry.customType === "opencandle-workflow-complete",
            ),
          ).toMatchObject({ data: { status: "completed" } });
        }
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
