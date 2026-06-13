import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { buildRouterPrompt } from "../../../src/routing/router-prompt.js";
import type { RouterLlmClient } from "../../../src/routing/router-types.js";
import { SessionCoordinator } from "../../../src/runtime/session-coordinator.js";

type ReadonlySessionManager = ExtensionContext["sessionManager"];

/**
 * Task 7.2: Verify that when `buildRouterContextBase` pulls priorTurns from a
 * session manager with real prior history, the resulting `RouterInputContext`
 * (when fed into `buildRouterPrompt`) produces a prompt that contains the
 * prior user turn in the "Prior conversation turns" section.
 *
 * Per the task brief: testing `buildPriorTurns` + `buildRouterPrompt` in
 * isolation is the sanctioned approach; wiring the full extension harness is
 * not required.
 */

function fakeSessionManager(entries: SessionEntry[]): ReadonlySessionManager {
  return {
    getBranch: () => entries,
    getCwd: () => "/tmp",
    getSessionDir: () => "/tmp",
    getSessionId: () => "test-session",
    getSessionFile: () => undefined,
    getLeafId: () => entries[entries.length - 1]?.id ?? null,
    getLeafEntry: () => entries[entries.length - 1],
    getEntry: (id: string) => entries.find((e) => e.id === id),
    getLabel: () => undefined,
    getHeader: () => null,
    getEntries: () => entries,
    getTree: () => [],
    getSessionName: () => undefined,
  } as unknown as ReadonlySessionManager;
}

let seq = 0;
function id(): string {
  seq += 1;
  return `x${seq}`;
}

function userMsg(text: string): SessionEntry {
  return {
    type: "message",
    id: id(),
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    },
  } as SessionEntry;
}

function assistantMsg(text: string): SessionEntry {
  return {
    type: "message",
    id: id(),
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      api: "anthropic",
      provider: "anthropic",
      model: "claude-test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    },
  } as SessionEntry;
}

describe("opencandle-extension router prompt assembly (task 7.2)", () => {
  it("includes prior-turn text from a populated session branch in the rendered router prompt", () => {
    const mgr = fakeSessionManager([
      userMsg("tell me about NVDA"),
      assistantMsg(
        "NVDA is a leading GPU maker. Recent quarter was strong on data-center revenue.",
      ),
    ]);

    const coord = new SessionCoordinator();
    const { profileSnapshot, recentWorkflowRuns, priorTurns } = coord.buildRouterContextBase(mgr);

    // Sanity: the helper pulled both turns.
    expect(priorTurns).toHaveLength(2);
    expect(priorTurns[0]).toEqual({ role: "user", text: "tell me about NVDA" });

    const prompt = buildRouterPrompt({
      text: "what about at $500?",
      priorTurns,
      profileSnapshot,
      recentWorkflowRuns,
    });

    // The rendered prompt MUST contain the NVDA prior user turn in the
    // "Prior conversation turns" section — this is what the downstream router
    // LLM would actually see.
    expect(prompt).toContain("Prior conversation turns");
    expect(prompt).toContain("tell me about NVDA");
    // And the assistant reply text should also be rendered.
    expect(prompt).toContain("NVDA is a leading GPU maker");
    // The current turn must appear after the priorTurns block.
    expect(prompt.indexOf("tell me about NVDA")).toBeLessThan(
      prompt.indexOf("what about at $500?"),
    );
  });

  it("produces an empty priorTurns block when the session branch is empty", () => {
    const mgr = fakeSessionManager([]);
    const coord = new SessionCoordinator();
    const { profileSnapshot, recentWorkflowRuns, priorTurns } = coord.buildRouterContextBase(mgr);
    expect(priorTurns).toEqual([]);

    const prompt = buildRouterPrompt({
      text: "analyze AAPL",
      priorTurns,
      profileSnapshot,
      recentWorkflowRuns,
    });
    expect(prompt).toContain("Prior conversation turns (most recent last):\n(none)");
  });

  it("exercises a stub RouterLlmClient end-to-end against the assembled prompt", async () => {
    // This asserts the RouterLlmClient shape stays compatible with the
    // prompt produced above — a lightweight regression guard for task 7.2's
    // "stub client captures the prompt" wording.
    const mgr = fakeSessionManager([userMsg("tell me about NVDA")]);
    const coord = new SessionCoordinator();
    const base = coord.buildRouterContextBase(mgr);

    let capturedPrompt = "";
    const client: RouterLlmClient = {
      async complete(prompt) {
        capturedPrompt = prompt;
        return JSON.stringify({
          route: "fallback",
          entities: { symbols: ["NVDA"] },
          slots: {},
          preference_updates: [],
          missing_required: [],
          reasoning: "test",
        });
      },
    };

    const prompt = buildRouterPrompt({
      text: "what about at $500?",
      ...base,
    });
    const result = await client.complete(prompt);
    expect(capturedPrompt).toContain("tell me about NVDA");
    expect(JSON.parse(result).entities.symbols).toEqual(["NVDA"]);
  });
});
