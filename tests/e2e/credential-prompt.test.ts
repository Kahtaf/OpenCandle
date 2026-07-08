/**
 * E2E test — credential-prompt interception (OpenSpec conversational-provider-setup, Task 17.1).
 *
 * Verifies the end-to-end flow:
 *   1. Fresh session with no ALPHA_VANTAGE_API_KEY and no persisted onboarding state
 *   2. User submits "analyze NVDA"
 *   3. The OpenCandle `tool_result` extension hook intercepts a credential-required
 *      tag for alpha_vantage and pauses the workflow via `promptUser`
 *   4. Our scripted askUserHandler picks the "Continue with …" option
 *   5. The workflow resumes and the final assistant text contains a `**Data gaps**`
 *      section citing `run /connect financials` verbatim
 *   6. None of the tool calls surface a raw `[OPENCANDLE_CREDENTIAL_REQUIRED` tag
 *      back to the user
 *
 * Scope: Task 17.1 only. Snooze, soft-fallback, and per-workflow-cap coverage
 * (Tasks 17.2–17.4) live in follow-up tests.
 *
 * Usage: npx tsx tests/e2e/credential-prompt.test.ts
 *
 * Requires at least one of GEMINI_API_KEY / GOOGLE_API_KEY / ANTHROPIC_API_KEY /
 * OPENAI_API_KEY in
 * the environment. If none is present, the test exits 0 with a skip notice so CI
 * without LLM credentials can still run the suite.
 */

// -----------------------------------------------------------------------------
// STEP 1: Sandbox OPENCANDLE_HOME and scrub ALPHA_VANTAGE_API_KEY *before* any
// import that might read config or onboarding state. Static ESM imports below
// read `process.env` lazily (inside `getConfig` / `loadOnboardingState`), so
// setting these values before the session is constructed is sufficient — but
// we do it at the top of the file to be defensive against future eager reads.
// -----------------------------------------------------------------------------
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-credential-prompt-test-"));
process.env.OPENCANDLE_HOME = openCandleHome;
// Ensure Alpha Vantage credential is absent: the flow only prompts when the
// provider is unconfigured.
delete process.env.ALPHA_VANTAGE_API_KEY;

// Pick an LLM provider/model based on available credentials. Matches the
// defaults used by tests/e2e/cli.test.ts and tests/harness/cli.ts.
type LlmChoice = { provider: string; model: string; envVars: string[] };
const LLM_CANDIDATES: readonly LlmChoice[] = [
  { provider: "google", model: "gemini-2.5-flash", envVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"] },
  { provider: "anthropic", model: "claude-haiku-4-5", envVars: ["ANTHROPIC_API_KEY"] },
  { provider: "openai", model: "gpt-5-mini", envVars: ["OPENAI_API_KEY"] },
];
const llmChoice = LLM_CANDIDATES.find((c) => c.envVars.some((envVar) => !!process.env[envVar]));
if (!llmChoice) {
  console.log(
    "⚠ Skipping credential-prompt e2e: no LLM credential in env " +
      `(need one of ${LLM_CANDIDATES.flatMap((c) => c.envVars).join(", ")})`,
  );
  rmSync(openCandleHome, { recursive: true, force: true });
  delete process.env.OPENCANDLE_HOME;
  process.exit(0);
}

// -----------------------------------------------------------------------------
// STEP 2: Imports. Dynamic await-import to ensure env sandboxing above is
// fully applied before anything inside `src/` reads it.
// -----------------------------------------------------------------------------
const [{ SessionManager, SettingsManager }, { createOpenCandleSession }, { cache }] =
  await Promise.all([
    import("@earendil-works/pi-coding-agent"),
    import("../../src/index.js"),
    import("../../src/infra/cache.js"),
  ]);
type AgentSessionEvent = import("@earendil-works/pi-coding-agent").AgentSessionEvent;
type AskUserHandler = import("../../src/types/index.js").AskUserHandler;

// -----------------------------------------------------------------------------
// STEP 3: Test helpers
// -----------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function record(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ ${name}: ${message}`);
    failures.push(`${name}: ${message}`);
    failed++;
  }
}

// -----------------------------------------------------------------------------
// STEP 4: Scripted askUserHandler — the test's decision oracle.
//
// The extension's `tool_result` hook calls `promptUser` with a "select"-type
// question whose `options` array includes a `Continue with …` / `Continue without …`
// choice. We record every call and always return the continue-without option,
// satisfying Task 17.1 step (d).
// -----------------------------------------------------------------------------
interface AskUserCall {
  question: string;
  options?: string[];
  answer: string | null;
}
const askUserTranscript: AskUserCall[] = [];

const askUserHandler: AskUserHandler = async (params) => {
  const options = params.options ?? [];
  // Prefer the "Continue with" / "Continue without" option; fall back to the
  // second option (continue slot) or the first if only one option exists.
  const continueOption =
    options.find((o) => o.startsWith("Continue")) ?? options[1] ?? options[0] ?? null;
  askUserTranscript.push({
    question: params.question,
    options: params.options,
    answer: continueOption,
  });
  return { answer: continueOption, cancelled: continueOption === null };
};

// -----------------------------------------------------------------------------
// STEP 5: Create the session.
// -----------------------------------------------------------------------------
console.log("=== OpenCandle credential-prompt E2E (Task 17.1) ===");
console.log(`LLM: ${llmChoice.provider}/${llmChoice.model}`);
console.log(`OPENCANDLE_HOME (sandbox): ${openCandleHome}`);

const { session } = await createOpenCandleSession({
  cwd: process.cwd(),
  sessionManager: SessionManager.inMemory(),
  settingsManager: SettingsManager.inMemory({
    defaultProvider: llmChoice.provider,
    defaultModel: llmChoice.model,
  }),
  useInlineExtension: true,
  askUserHandler,
});

cache.clear();

// -----------------------------------------------------------------------------
// STEP 6: Drive the analyze flow and accumulate output with a settle-based
// termination strategy (mirrors tests/harness/cli.ts).
//
// "analyze NVDA" is a multi-turn workflow: the orchestrator queues several
// follow-up messages after the initial prompt, so we can't just listen for a
// single `agent_end`. Instead, we reset a 30s settle timer after each
// agent_end event, and treat the run as "done" once 30s pass with no new
// activity (text delta, tool start, or agent end). A hard cap of 8 min
// prevents hangs if the model gets stuck.
// -----------------------------------------------------------------------------
const SETTLE_GRACE_MS = 30_000;
const HARD_TIMEOUT_MS = 8 * 60 * 1000;

let text = "";
const toolCalls: Array<{ name: string; args: unknown; result?: unknown }> = [];
const pendingTools = new Map<string, { name: string; args: unknown }>();

console.log('\nDriving prompt: "analyze NVDA"');
console.log("(this will hit the live LLM; expect 1–3 minutes)\n");

await new Promise<void>((resolve, reject) => {
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  const hardTimer = setTimeout(() => {
    cleanup();
    reject(new Error(`hard timeout after ${HARD_TIMEOUT_MS}ms`));
  }, HARD_TIMEOUT_MS);

  const cancelSettle = (): void => {
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
  };

  const cleanup = (): void => {
    cancelSettle();
    clearTimeout(hardTimer);
    unsub();
  };

  const finish = (): void => {
    cleanup();
    resolve();
  };

  const resetSettleTimer = (): void => {
    cancelSettle();
    settleTimer = setTimeout(finish, SETTLE_GRACE_MS);
  };

  const unsub = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      text += event.assistantMessageEvent.delta;
      cancelSettle();
    }
    if (event.type === "tool_execution_start") {
      pendingTools.set(event.toolCallId, { name: event.toolName, args: event.args });
      cancelSettle();
    }
    if (event.type === "tool_execution_end") {
      const pending = pendingTools.get(event.toolCallId);
      if (pending) {
        toolCalls.push({ name: pending.name, args: pending.args, result: event.result });
        pendingTools.delete(event.toolCallId);
      }
    }
    if (event.type === "agent_end") {
      resetSettleTimer();
    }
  });
  void session.prompt("analyze NVDA");
});

// -----------------------------------------------------------------------------
// STEP 7: Assertions.
// -----------------------------------------------------------------------------
console.log(
  `\nCaptured ${text.length} chars of assistant text across ${toolCalls.length} tool calls`,
);
console.log(`askUserHandler was called ${askUserTranscript.length} time(s)`);
for (const [i, call] of askUserTranscript.entries()) {
  console.log(
    `  [${i}] Q: ${call.question.slice(0, 120)}${call.question.length > 120 ? "..." : ""}`,
  );
  console.log(`       A: ${call.answer ?? "(cancelled)"}`);
}

record("askUserHandler was called at least once", () => {
  assert(
    askUserTranscript.length >= 1,
    `expected at least one credential prompt, got ${askUserTranscript.length}`,
  );
});

record("one prompt references Alpha Vantage", () => {
  const match = askUserTranscript.find(
    (c) =>
      c.question.includes("Alpha Vantage") ||
      (c.options ?? []).some((o) => o.includes("Alpha Vantage")),
  );
  assert(
    match !== undefined,
    `expected a prompt mentioning "Alpha Vantage", got:\n${askUserTranscript
      .map((c) => `  - ${c.question}`)
      .join("\n")}`,
  );
});

record("scripted answer picked the Continue option", () => {
  const alphaCall = askUserTranscript.find(
    (c) =>
      c.question.includes("Alpha Vantage") ||
      (c.options ?? []).some((o) => o.includes("Alpha Vantage")),
  );
  assert(alphaCall !== undefined, "no Alpha Vantage prompt was recorded");
  assert(
    alphaCall?.answer?.startsWith("Continue"),
    `expected a "Continue …" answer, got: ${alphaCall?.answer ?? "(null)"}`,
  );
});

record('final assistant text contains "Data gaps" section', () => {
  assert(
    text.includes("Data gaps") || text.includes("**Data gaps**"),
    `expected a "Data gaps" section in the final answer. First 500 chars:\n${text.slice(0, 500)}`,
  );
});

record('"Data gaps" section cites "/connect financials" remediation', () => {
  assert(
    text.includes("/connect financials"),
    `expected the verbatim "/connect financials" remediation in the final answer. Text tail:\n${text.slice(-800)}`,
  );
});

record("no raw [OPENCANDLE_CREDENTIAL_REQUIRED tag leaked to the user", () => {
  assert(
    !text.includes("[OPENCANDLE_CREDENTIAL_REQUIRED"),
    "raw credential-required tag leaked into the final assistant text — the extension hook failed to intercept it",
  );
});

// -----------------------------------------------------------------------------
// STEP 8: Summary + cleanup + exit.
// -----------------------------------------------------------------------------
console.log(`\n${"=".repeat(50)}`);
console.log(`Credential-prompt E2E: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  ✗ ${f}`);
} else {
  console.log("\nAll credential-prompt assertions passed!");
}

rmSync(openCandleHome, { recursive: true, force: true });
delete process.env.OPENCANDLE_HOME;
session.dispose();

process.exit(failed > 0 ? 1 : 0);
