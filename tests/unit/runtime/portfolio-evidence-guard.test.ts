import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PortfolioSlots, SlotResolution } from "../../../src/routing/types.js";
import type { EvidenceRecord } from "../../../src/runtime/evidence.js";
import type {
  PromptOutputValidation,
  PromptValidationContext,
  WorkflowDefinition,
} from "../../../src/runtime/prompt-step.js";
import { SessionCoordinator } from "../../../src/runtime/session-coordinator.js";
import { buildPortfolioWorkflowDefinition } from "../../../src/workflows/portfolio-builder.js";

type Handler = (event: never) => void;

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `peg-e${idCounter}`;
}

function userTextEntry(text: string): SessionEntry {
  return {
    type: "message",
    id: nextId(),
    parentId: null,
    timestamp: new Date().toISOString(),
    message: { role: "user", content: [{ type: "text", text }], timestamp: Date.now() },
  } as SessionEntry;
}

function assistantTextEntry(text: string): SessionEntry {
  return {
    type: "message",
    id: nextId(),
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

function makeResolution(overrides: Partial<PortfolioSlots> = {}): SlotResolution<PortfolioSlots> {
  const resolved: PortfolioSlots = {
    budget: 10_000,
    riskProfile: "balanced",
    timeHorizon: "1y_plus",
    assetScope: "diversified_etf_building_blocks",
    positionCount: 6,
    maxSinglePositionPct: 20,
    ...overrides,
  };
  return {
    resolved,
    sources: {
      budget: "user",
      riskProfile: "default",
      timeHorizon: "default",
      assetScope: "default",
      positionCount: "default",
      maxSinglePositionPct: "default",
    },
    defaultsUsed: [
      "riskProfile",
      "timeHorizon",
      "assetScope",
      "positionCount",
      "maxSinglePositionPct",
    ],
    missingRequired: [],
  };
}

interface ToolScript {
  tool: string;
  /** Undefined models an unavailable result (`details: null`). */
  details?: unknown;
  isError?: boolean;
}

interface TurnScript {
  tools?: ToolScript[];
  text: string;
}

const VALID_TABLE = `| Symbol | Allocation % | Dollar Amount | Current Price | Estimated Shares | Role | Analyst Rationale |
| --- | --- | --- | --- | --- | --- | --- |
| VOO | 18% | $1,800.00 | $474.96 | 3 | Core US Equity | Core growth. |
| VXUS | 18% | $1,800.00 | $60.50 | 29 | International Equity | Global diversification. |
| BND | 18% | $1,800.00 | $72.33 | 24 | Core US Fixed Income | Stability. |
| SHY | 16% | $1,600.00 | $80.20 | 19 | Short-Duration Stability | Capital preservation. |
| TIP | 15% | $1,500.00 | $108.68 | 13 | Inflation Protection | Inflation hedge. |
| BNDX | 15% | $1,500.00 | $46.50 | 32 | International Fixed Income | Global bonds. |`;

/** Stage markers taken from the live portfolio workflow prompts. */
function stageOf(prompt: string): "fetch" | "risk" | "synthesize" | "fetch_repair" | "risk_repair" {
  if (prompt.includes("Build a draft portfolio")) return "fetch";
  if (prompt.includes("Now review the risk and diversification")) return "risk";
  if (prompt.includes("Present the final portfolio draft")) return "synthesize";
  if (prompt.includes("usable market price evidence")) return "fetch_repair";
  if (prompt.includes("usable risk or correlation evidence")) return "risk_repair";
  throw new Error(`unrecognized portfolio prompt: ${prompt.slice(0, 80)}`);
}

function startHarness(respond: (prompt: string) => TurnScript) {
  vi.useFakeTimers();
  const coord = new SessionCoordinator();
  const entries: SessionEntry[] = [];
  const handlers = new Map<string, Handler[]>();
  const emit = (name: string, event: unknown) => {
    for (const handler of handlers.get(name) ?? []) handler(event as never);
  };
  const sentPrompts: string[] = [];
  let toolSeq = 0;

  const pi = {
    on: vi.fn((name: string, handler: Handler) => {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    }),
    sendUserMessage: vi.fn((prompt: string) => {
      sentPrompts.push(prompt);
      entries.push(userTextEntry(prompt));
      const script = respond(prompt);
      setTimeout(() => {
        for (const call of script.tools ?? []) {
          toolSeq += 1;
          const id = `tc-${toolSeq}`;
          emit("tool_execution_start", { toolCallId: id, toolName: call.tool, args: {} });
          emit("tool_execution_end", {
            toolCallId: id,
            toolName: call.tool,
            result: {
              content: [{ type: "text", text: `${call.tool} result` }],
              details: call.details === undefined ? null : call.details,
            },
            isError: call.isError === true,
          });
        }
        emit("message_update", {
          assistantMessageEvent: { type: "text_delta", delta: script.text },
        });
        entries.push(assistantTextEntry(script.text));
      }, 10);
    }),
    appendEntry: vi.fn(),
  };

  const ctx = {
    isIdle: () => true,
    hasPendingMessages: () => false,
    ui: { notify: vi.fn() },
    sessionManager: { getEntries: () => entries, getBranch: () => entries },
  };

  coord.executeWorkflow(
    pi as never,
    buildPortfolioWorkflowDefinition(makeResolution()),
    ctx as never,
  );

  return {
    coord,
    pi,
    sentPrompts,
    advance: async (ms = 4000) => {
      await vi.advanceTimersByTimeAsync(ms);
    },
  };
}

function promptsMatching(prompts: string[], marker: string): string[] {
  return prompts.filter((prompt) => prompt.includes(marker));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("portfolio workflow absent-evidence guard", () => {
  it("fails closed when a plausible draft was produced with zero tool evidence", async () => {
    const harness = startHarness(() => ({
      text: "| VOO | 18% | $474.96 |\n| VXUS | 18% | $60.50 |\nCorrelations are low and volatility is moderate.",
    }));

    await harness.advance();
    await harness.coord.waitForActiveWorkflow();

    const run = harness.coord.getRunner().getActiveRun();
    expect(run?.status).toBe("failed");
    expect(run?.steps.find((step) => step.stepType === "fetch_candidates")?.status).toBe("failed");
    expect(promptsMatching(harness.sentPrompts, "Present the final portfolio draft")).toHaveLength(
      0,
    );
    expect(promptsMatching(harness.sentPrompts, "usable market price evidence")).toHaveLength(1);
    expect(harness.pi.appendEntry).toHaveBeenCalledWith("opencandle-workflow-event", {
      eventType: "output_validation_failed",
      stepType: "fetch_candidates",
      errors: [expect.stringMatching(/no usable market price evidence/i)],
    });
    expect(harness.pi.appendEntry).toHaveBeenCalledWith("opencandle-workflow-complete", {
      workflow: "portfolio_builder",
      status: "failed",
    });
    expect(harness.pi.appendEntry).not.toHaveBeenCalledWith(
      "opencandle-workflow-complete",
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("permits progress once completed quote and risk evidence was captured", async () => {
    const harness = startHarness((prompt) => {
      switch (stageOf(prompt)) {
        case "fetch":
          return {
            tools: [{ tool: "get_stock_quote", details: { symbol: "VOO", price: 474.96 } }],
            text: "Candidates: VOO, VXUS, BND, SHY, TIP, BNDX with quoted prices.",
          };
        case "risk":
          return {
            tools: [
              { tool: "analyze_risk", details: { symbol: "VOO", annualizedVolatility: 0.16 } },
            ],
            text: "Risk reviewed from returned metrics.",
          };
        default:
          return { text: VALID_TABLE };
      }
    });

    await harness.advance();
    await harness.coord.waitForActiveWorkflow();

    const run = harness.coord.getRunner().getActiveRun();
    expect(run?.status).toBe("completed");
    expect(run?.steps.map((step) => step.status)).toEqual(["completed", "completed", "completed"]);
    expect(promptsMatching(harness.sentPrompts, "usable market price evidence")).toHaveLength(0);
    expect(harness.pi.appendEntry).toHaveBeenCalledWith("opencandle-workflow-complete", {
      workflow: "portfolio_builder",
      status: "completed",
    });
  });

  it("does not accept an error-only attempt as market evidence", async () => {
    const harness = startHarness(() => ({
      tools: [{ tool: "get_stock_quote", isError: true }],
      text: "| VOO | 18% | $474.96 |",
    }));

    await harness.advance();
    await harness.coord.waitForActiveWorkflow();

    const run = harness.coord.getRunner().getActiveRun();
    expect(run?.status).toBe("failed");
    expect(promptsMatching(harness.sentPrompts, "usable market price evidence")).toHaveLength(1);
  });

  it("collects evidence during the single repair attempt and then advances", async () => {
    const harness = startHarness((prompt) => {
      const stage = stageOf(prompt);
      if (stage === "fetch") {
        return { text: "| VOO | 18% | $474.96 | (no tool call)" };
      }
      if (stage === "fetch_repair") {
        return {
          tools: [{ tool: "get_stock_quote", details: { symbol: "VOO", price: 474.96 } }],
          text: "Quoted candidates with real prices.",
        };
      }
      if (stage === "risk") {
        return {
          tools: [{ tool: "analyze_correlation", details: { matrix: { VOO: { VXUS: 0.4 } } } }],
          text: "Correlation reviewed.",
        };
      }
      return { text: VALID_TABLE };
    });

    await harness.advance();
    await harness.coord.waitForActiveWorkflow();

    const run = harness.coord.getRunner().getActiveRun();
    expect(run?.status).toBe("completed");
    expect(promptsMatching(harness.sentPrompts, "usable market price evidence")).toHaveLength(1);
    expect(
      promptsMatching(harness.sentPrompts, "Now review the risk and diversification"),
    ).toHaveLength(1);
  });

  it("fails closed when fetch succeeds but risk evidence never arrives", async () => {
    const harness = startHarness((prompt) => {
      switch (stageOf(prompt)) {
        case "fetch":
          return {
            tools: [{ tool: "get_stock_quote", details: { symbol: "VOO", price: 474.96 } }],
            text: "Quoted candidates with real prices.",
          };
        case "risk":
          // Fabricated risk prose with zero risk/correlation tool evidence.
          return { text: "Volatility is moderate and average correlation is 0.35." };
        case "risk_repair":
          return { text: "Still moderate; average correlation 0.35." };
        default:
          return { text: VALID_TABLE };
      }
    });

    await harness.advance();
    await harness.coord.waitForActiveWorkflow();

    const run = harness.coord.getRunner().getActiveRun();
    expect(run?.status).toBe("failed");
    expect(run?.steps.find((step) => step.stepType === "risk_review")?.status).toBe("failed");
    expect(
      promptsMatching(harness.sentPrompts, "usable risk or correlation evidence"),
    ).toHaveLength(1);
    expect(promptsMatching(harness.sentPrompts, "Present the final portfolio draft")).toHaveLength(
      0,
    );
    expect(harness.pi.appendEntry).toHaveBeenCalledWith("opencandle-workflow-complete", {
      workflow: "portfolio_builder",
      status: "failed",
    });
  });

  it("preserves initial-attempt evidence across a repair when only session entries are available", async () => {
    const harness = startSessionEntryHarness();

    await harness.advance();
    await harness.coord.waitForActiveWorkflow();

    const run = harness.coord.getRunner().getActiveRun();
    expect(run?.status).toBe("completed");
    expect(harness.sentPrompts).toEqual([
      "probe initial prompt",
      "fetch the missing tool result again",
    ]);
    const output = run?.stepOutputs.get(0);
    // Replacement raw text comes from the repair attempt only.
    expect(output?.rawText).toBe("repair response text");
    // The initial attempt's tool evidence survives the repair.
    expect(output?.evidence.map(toolNameOf)).toEqual(
      expect.arrayContaining(["get_stock_quote", "get_stock_history"]),
    );
  });
});

function toolNameOf(record: EvidenceRecord): string | undefined {
  const value = isObject(record.value) ? record.value : undefined;
  return typeof value?.tool === "string" ? value.tool : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validator that requires evidence from two distinct tools, so it only passes
 * when the initial attempt's evidence and the repair's evidence are both kept.
 */
function twoToolEvidenceValidator(): PromptOutputValidation {
  return {
    validate(_rawText: string, context?: PromptValidationContext): string[] {
      const tools = new Set((context?.currentEvidence ?? []).map(toolNameOf));
      return tools.has("get_stock_quote") && tools.has("get_stock_history")
        ? []
        : ["required tool evidence is incomplete"];
    },
    repairPrompt(): string {
      return "fetch the missing tool result again";
    },
  };
}

function assistantToolCallEntry(toolCallId: string, toolName: string): SessionEntry {
  return {
    type: "message",
    id: nextId(),
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id: toolCallId, name: toolName, arguments: {} }],
      stopReason: "toolUse",
      timestamp: Date.now(),
    },
  } as SessionEntry;
}

function toolResultEntry(toolCallId: string, toolName: string): SessionEntry {
  return {
    type: "message",
    id: nextId(),
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: "toolResult",
      toolCallId,
      toolName,
      details: { symbol: "VOO", price: 474.96 },
      content: [{ type: "text", text: `${toolName} result` }],
      isError: false,
      timestamp: Date.now(),
    },
  } as SessionEntry;
}

/**
 * Drives a one-step workflow whose pi emits no tool_execution events, forcing
 * the coordinator's session-entry evidence fallback across a repair.
 */
function startSessionEntryHarness() {
  vi.useFakeTimers();
  const coord = new SessionCoordinator();
  const entries: SessionEntry[] = [];
  const sentPrompts: string[] = [];
  let callSeq = 0;

  const definition: WorkflowDefinition = {
    workflowType: "evidence_merge_probe",
    steps: [
      {
        stepType: "probe",
        description: "probe",
        prompt: "probe initial prompt",
        skippable: false,
        requiredInputs: [],
        expectedOutputs: [],
        outputValidation: twoToolEvidenceValidator(),
      },
    ],
  };

  const pi = {
    // No `on` handler: no tool_execution events, so capture falls back to
    // session entries for every attempt.
    sendUserMessage: vi.fn((prompt: string) => {
      sentPrompts.push(prompt);
      entries.push(userTextEntry(prompt));
      const isRepair = prompt !== "probe initial prompt";
      setTimeout(() => {
        callSeq += 1;
        const toolCallId = `call-${callSeq}`;
        const toolName = isRepair ? "get_stock_history" : "get_stock_quote";
        entries.push(assistantToolCallEntry(toolCallId, toolName));
        entries.push(toolResultEntry(toolCallId, toolName));
        entries.push(
          assistantTextEntry(isRepair ? "repair response text" : "initial response text"),
        );
      }, 10);
    }),
    appendEntry: vi.fn(),
  };

  const ctx = {
    isIdle: () => true,
    hasPendingMessages: () => false,
    ui: { notify: vi.fn() },
    sessionManager: { getEntries: () => entries, getBranch: () => entries },
  };

  coord.executeWorkflow(pi as never, definition, ctx as never);

  return {
    coord,
    sentPrompts,
    advance: async (ms = 2000) => {
      await vi.advanceTimersByTimeAsync(ms);
    },
  };
}
