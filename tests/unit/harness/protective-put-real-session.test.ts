import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createOpenCandleSessionCore } from "../../../src/pi/session-core.js";
import { drainOpenCandleCustomEntries } from "../../harness/opencandle-runner.js";
import { assertSessionCompleted } from "../../harness/session-completion.js";
import { createTraceCollector } from "../../harness/trace-collector.js";
import { installDeterministicFetchGuard } from "../../helpers/deterministic-fetch-guard.js";
import { startDeterministicModelServer } from "../../helpers/deterministic-model-server.js";
import { createTestModelRuntime } from "../../helpers/pi-model-runtime.js";

const CORRECTED = `Standard-contract illustration: assuming 100 shares per put contract; verify the actual multiplier before trading.
Owned position: 375 shares.
| Put contracts | Covered shares | Uncovered shares | Excess shares |
| --- | --- | --- | --- |
| 3 puts | 300 shares | 75 shares | 0 shares |
| 4 puts | 400 shares | 0 shares | 25 shares |
The uncovered shares remain exposed. Rounding up adds surplus put exposure.
Premium percentage unavailable: quotes were unavailable. Verify executable prices with a broker. Premium can be lost; protection begins at the strike for covered shares.`;

describe("real protective-put workflow validation", () => {
  it.each([true, false])(
    "handles one financial repair, with recovery=%s and no repeated acquisition",
    {
      timeout: 20_000,
    },
    async (repairSucceeds) => {
      const home = mkdtempSync(join(tmpdir(), "oc-put-repair-"));
      vi.stubEnv("OPENCANDLE_HOME", home);
      let repairCalls = 0;
      let fetchSteps = 0;
      const failed = readFileSync(
        "tests/fixtures/workflows/protective-put-missing-coverage.txt",
        "utf8",
      );
      const server = await startDeterministicModelServer((request) => {
        const lastUser = [...request.messages].reverse().find((message) => message.role === "user");
        const text =
          typeof lastUser?.content === "string"
            ? lastUser.content
            : JSON.stringify(lastUser?.content);
        if (text.includes("failed position-sizing or premium arithmetic validation")) {
          repairCalls += 1;
          return { kind: "text", text: repairSucceeds ? CORRECTED : failed };
        }
        if (text.includes("Now rank and present")) return { kind: "text", text: failed };
        fetchSteps += 1;
        return {
          kind: "text",
          text: "Option chain unavailable; do not invent prices or executable premiums.",
        };
      });
      const guard = installDeterministicFetchGuard([{ prefix: server.baseUrl, passthrough: true }]);
      let created: Awaited<ReturnType<typeof createOpenCandleSessionCore>> | undefined;
      try {
        const { modelRuntime } = await createTestModelRuntime();
        modelRuntime.registerProvider("put-proof", {
          api: "openai-completions",
          baseUrl: server.baseUrl,
          apiKey: "test-only",
          models: [
            {
              id: "local",
              name: "Local put workflow",
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
            defaultProvider: "put-proof",
            defaultModel: "local",
          }),
          askUserHandler: async () => ({ answer: null, cancelled: true }),
          titleCompletion: async () => "Protective put sizing",
          routerLlmClient: {
            complete: async () =>
              JSON.stringify({
                routeKind: "workflow_dispatch",
                workflow: "options_screener",
                entities: {
                  symbols: ["MSFT"],
                  optionStrategy: "protective_put",
                  shareQuantity: 375,
                  direction: "bearish",
                  dteTarget: "25_to_45_days",
                },
                slots: {},
                preference_updates: [],
                missing_required: [],
                tool_bundles: ["core_market", "options"],
                diagnostics: [],
                reasoning: "Hedge an owned stock position.",
              }),
          },
        });
        const collector = createTraceCollector(created.session, "protective-put proof");
        await created.session.prompt(
          "I own 375 shares of MSFT and want to understand protective puts.",
        );
        await created.waitForSettled();
        const entries = manager.getEntries().filter((entry) => entry.type === "custom");
        expect(fetchSteps).toBe(1);
        expect(repairCalls).toBe(1);
        expect(
          entries.filter(
            (entry) =>
              entry.customType === "opencandle-workflow-event" &&
              (entry.data as { eventType?: string }).eventType === "output_validation_failed",
          ),
        ).toHaveLength(repairSucceeds ? 1 : 2);
        expect(
          entries.findLast((entry) => entry.customType === "opencandle-workflow-complete")?.data,
        ).toMatchObject({ status: repairSucceeds ? "completed" : "failed" });
        const trace = {
          ...collector.getTrace(),
          customEntries: drainOpenCandleCustomEntries(manager),
        };
        collector.dispose();
        if (repairSucceeds) expect(() => assertSessionCompleted(trace)).not.toThrow();
        else expect(() => assertSessionCompleted(trace)).toThrow("workflow_failed");
        expect(guard.unrecognizedUrls).toEqual([]);
      } finally {
        created?.session.dispose();
        guard.restore();
        await server.stop();
        vi.unstubAllEnvs();
        rmSync(home, { recursive: true, force: true });
      }
    },
  );
});
