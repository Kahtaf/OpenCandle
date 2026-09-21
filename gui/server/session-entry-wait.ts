import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { isAnalysisRequest } from "../../src/analysts/orchestrator.js";
import type { WorkflowType } from "../../src/routing/types.js";

export interface WaitForEntryCountOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

export interface WaitForSessionTurnSettlementOptions extends WaitForEntryCountOptions {
  idleGraceMs?: number;
}

export interface SessionRunStatus {
  isStreaming: boolean;
  pendingMessageCount: number;
  /**
   * Monotonic activity signal (e.g. a session-event counter). A single long
   * model generation keeps isStreaming/pendingMessageCount frozen for its
   * whole duration; this token is what distinguishes it from a hung run.
   */
  progressToken?: number;
}

export interface UnresolvedToolCall {
  id: string;
  name: string;
}

export async function waitForEntryCount(
  getCount: () => number,
  previousCount: number,
  options: WaitForEntryCountOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const intervalMs = options.intervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;

  while (getCount() <= previousCount && Date.now() < deadline) {
    await delay(intervalMs);
  }
  if (getCount() <= previousCount) {
    throw new Error("Timed out waiting for a new session entry");
  }
}

export async function waitForNewEntryId(
  getIds: () => string[],
  previousIds: Set<string>,
  options: WaitForEntryCountOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const intervalMs = options.intervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;

  while (!getIds().some((id) => !previousIds.has(id)) && Date.now() < deadline) {
    await delay(intervalMs);
  }
  if (!getIds().some((id) => !previousIds.has(id))) {
    throw new Error("Timed out waiting for a new session entry");
  }
}

// Workflow labels whose dispatch keeps driving further model turns well
// after the first one goes idle: each analyst pass, screener/portfolio/
// compare step, etc. runs its own tool calls and orchestration between
// turns, easily exceeding the default idle grace tuned for an ordinary
// single-turn chat reply. The TUI harness
// (tests/harness/opencandle-runner.ts's settleGraceMsForTurn) already
// widens its own settle grace for exactly these cases; without the same
// grace here, the GUI chat-run endpoint declares a multi-step run
// "complete" after only its first step; see gui-tui parity coverage in
// tests/e2e/gui-browser.test.ts.
const MULTI_STEP_WORKFLOW_SETTLE_GRACE_MS = 30_000;
const MULTI_STEP_WORKFLOWS = new Set<WorkflowType>([
  "options_screener",
  "portfolio_builder",
  "compare_assets",
]);

/**
 * The idle grace `waitForSessionTurnSettlement` should use for the turn a
 * prompt is about to start (or has just started), or `undefined` to keep
 * the caller's own default. `entries` should reflect the session as of
 * right after the prompt was sent, so a workflow-dispatch entry the input
 * handler appended synchronously (comprehensive_analysis is detected from
 * the prompt text itself; the router-dispatched workflows are detected
 * from their `opencandle-workflow` entry) is already visible. `beforeIds`
 * lists the ids of entries that existed before the prompt was sent, so
 * workflow entries left behind by earlier prompts do not widen the grace
 * for this one.
 */
export function settleIdleGraceMsForPrompt(
  prompt: string,
  entries: SessionEntry[],
  beforeIds: ReadonlySet<string>,
): number | undefined {
  if (isAnalysisRequest(prompt).match) return MULTI_STEP_WORKFLOW_SETTLE_GRACE_MS;
  return dispatchesMultiStepWorkflow(entries, beforeIds)
    ? MULTI_STEP_WORKFLOW_SETTLE_GRACE_MS
    : undefined;
}

function dispatchesMultiStepWorkflow(
  entries: SessionEntry[],
  beforeIds: ReadonlySet<string>,
): boolean {
  return entries.some((entry) => {
    if (beforeIds.has(entry.id)) return false;
    if (entry.type !== "custom" || entry.customType !== "opencandle-workflow") return false;
    const data = (entry as { data?: unknown }).data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
    const workflow = (data as Record<string, unknown>).workflow;
    return typeof workflow === "string" && MULTI_STEP_WORKFLOWS.has(workflow as WorkflowType);
  });
}

export async function waitForSessionTurnSettlement(
  getStatus: () => SessionRunStatus,
  options: WaitForSessionTurnSettlementOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 25;
  const idleGraceMs = options.idleGraceMs ?? 250;
  // timeoutMs bounds STALL, not total runtime: a live workflow run (e.g.
  // /analyze) stays active for minutes while its status keeps changing, and
  // capping total runtime failed those runs mid-workflow with
  // "Timed out waiting for the session turn to settle". A hung session stops
  // changing status entirely, which is what the deadline must catch.
  let lastProgressAt = Date.now();
  let lastSignature: string | undefined;
  let idleSince: number | undefined;

  while (true) {
    const status = getStatus();
    const signature = `${status.isStreaming}:${status.pendingMessageCount}:${status.progressToken ?? 0}`;
    if (signature !== lastSignature) {
      lastSignature = signature;
      lastProgressAt = Date.now();
    }
    const active = status.isStreaming || status.pendingMessageCount > 0;

    if (active) {
      idleSince = undefined;
      if (Date.now() - lastProgressAt >= timeoutMs) {
        throw new Error("Timed out waiting for the session turn to settle");
      }
      await delay(intervalMs);
      continue;
    }

    idleSince ??= Date.now();
    if (Date.now() - idleSince >= idleGraceMs) {
      return;
    }

    await delay(intervalMs);
  }
}

export function findUnresolvedToolCalls(entries: SessionEntry[]): UnresolvedToolCall[] {
  const latestAssistantIndex = latestAssistantToolUseIndex(entries);
  if (latestAssistantIndex === -1) return [];

  const assistant = asMessage(entries[latestAssistantIndex]);
  const calls = toolCallsFromContent(assistant?.content);
  if (calls.length === 0) return [];

  const resolved = new Set<string>();
  for (const entry of entries.slice(latestAssistantIndex + 1)) {
    const message = asMessage(entry);
    if (message?.role !== "toolResult") continue;
    const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : "";
    if (toolCallId) resolved.add(toolCallId);
  }

  return calls.filter((call) => !resolved.has(call.id));
}

export async function waitForResolvedToolCalls(
  getEntries: () => SessionEntry[],
  options: WaitForEntryCountOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (findUnresolvedToolCalls(getEntries()).length === 0) return;
    await delay(intervalMs);
  }

  const unresolved = findUnresolvedToolCalls(getEntries());
  if (unresolved.length > 0) {
    throw new Error(
      `Timed out waiting for tool results: ${unresolved.map((call) => call.name).join(", ")}`,
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function latestAssistantToolUseIndex(entries: SessionEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index--) {
    const message = asMessage(entries[index]);
    if (message?.role === "assistant") {
      if (toolCallsFromContent(message.content).length > 0) return index;
      if (message.stopReason === "stop") return -1;
    }
    if (message?.role === "user") return -1;
  }
  return -1;
}

function asMessage(entry: SessionEntry | undefined): Record<string, unknown> | undefined {
  if (entry?.type !== "message") return undefined;
  const message = (entry as { message?: unknown }).message;
  return typeof message === "object" && message !== null && !Array.isArray(message)
    ? (message as Record<string, unknown>)
    : undefined;
}

function toolCallsFromContent(content: unknown): UnresolvedToolCall[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((part): UnresolvedToolCall[] => {
    if (typeof part !== "object" || part === null || Array.isArray(part)) return [];
    const record = part as Record<string, unknown>;
    if (record.type !== "toolCall") return [];
    const id = typeof record.id === "string" ? record.id : "";
    const name = typeof record.name === "string" ? record.name : "tool";
    return id ? [{ id, name }] : [];
  });
}
