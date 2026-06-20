/**
 * E2E test — soft-tier fallback behavior (OpenSpec conversational-provider-setup, Task 17.3).
 *
 * Verifies that soft-tier providers (Brave, Exa) silently fall back to the
 * keyless alternative without EVER prompting the user, and that the final
 * assistant answer surfaces a `**Data gaps**` section mentioning the
 * soft-degraded provider with a `/connect search` remediation.
 *
 * Flow:
 *   1. Fresh session with no BRAVE_API_KEY and no EXA_API_KEY
 *   2. User asks a question that triggers the `search_web` tool
 *   3. The `buildSoftDegradedPrefix` helper in src/tools/sentiment/web-search.ts
 *      attaches a `[OPENCANDLE_SOFT_DEGRADED ...]` tag to the tool result
 *   4. The extension's `tool_result` hook records the degradation into the
 *      per-turn accumulator WITHOUT pausing the workflow and WITHOUT calling
 *      promptUser — soft tier never prompts
 *   5. The LLM emits a `**Data gaps**` section that includes a remediation
 *      citing `/connect search` verbatim (or at least names one of the
 *      fallback providers)
 *
 * Scope: Task 17.3 only. See credential-prompt.test.ts (17.1) and
 * credential-snooze.test.ts (17.2).
 *
 * Usage: npx tsx tests/e2e/credential-soft-fallback.test.ts
 *
 * Requires at least one of GEMINI_API_KEY / GOOGLE_API_KEY / ANTHROPIC_API_KEY /
 * OPENAI_API_KEY in
 * the environment. If none is present, the test exits 0 with a skip notice so CI
 * without LLM credentials can still run the suite.
 */

// -----------------------------------------------------------------------------
// STEP 1: Sandbox OPENCANDLE_HOME and scrub BRAVE_API_KEY + EXA_API_KEY *before*
// any import that might read config or onboarding state.
// -----------------------------------------------------------------------------
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-credential-soft-fallback-test-"));
process.env.OPENCANDLE_HOME = openCandleHome;
delete process.env.BRAVE_API_KEY;
delete process.env.EXA_API_KEY;

type LlmChoice = { provider: string; model: string; envVars: string[] };
const LLM_CANDIDATES: readonly LlmChoice[] = [
  { provider: "google", model: "gemini-2.5-flash", envVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"] },
  { provider: "anthropic", model: "claude-haiku-4-5", envVars: ["ANTHROPIC_API_KEY"] },
  { provider: "openai", model: "gpt-5-mini", envVars: ["OPENAI_API_KEY"] },
];
const llmChoice = LLM_CANDIDATES.find((c) => c.envVars.some((envVar) => !!process.env[envVar]));
if (!llmChoice) {
  console.log(
    "⚠ Skipping credential-soft-fallback e2e: no LLM credential in env " +
      `(need one of ${LLM_CANDIDATES.flatMap((c) => c.envVars).join(", ")})`,
  );
  rmSync(openCandleHome, { recursive: true, force: true });
  delete process.env.OPENCANDLE_HOME;
  process.exit(0);
}

// -----------------------------------------------------------------------------
// STEP 2: Dynamic imports — env sandboxing above must be fully applied first.
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
// STEP 4: Scripted askUserHandler — MUST NOT be invoked in this test. If it is,
// the soft-tier policy is broken (soft tier never prompts). We record the call
// so the assertion can print the offending question text.
// -----------------------------------------------------------------------------
interface AskUserCall {
  question: string;
  options?: string[];
  answer: string | null;
}
const askUserTranscript: AskUserCall[] = [];

const askUserHandler: AskUserHandler = async (params) => {
  const options = params.options ?? [];
  // If anything calls us, pick the Continue option to avoid a deadlock; the
  // test will still fail because askUserTranscript will be non-empty.
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
console.log("=== OpenCandle credential-soft-fallback E2E (Task 17.3) ===");
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
// STEP 6: Drive a web-search prompt with settle-based termination.
//
// The phrasing is chosen to match the `search_web` tool's description —
// "Search the web for financial news, earnings context, company events,
// regulatory developments, or general information" — without overlapping with
// the dedicated sentiment/quote/fundamentals tools. If the model mis-routes
// to a different tool the test will assert-fail in step 9.
// -----------------------------------------------------------------------------
const SETTLE_GRACE_MS = 30_000;
const HARD_TIMEOUT_MS = 8 * 60 * 1000;

let text = "";
const toolCalls: Array<{ name: string; args: unknown; result?: unknown }> = [];
const pendingTools = new Map<string, { name: string; args: unknown }>();

const WEB_SEARCH_PROMPT = "search the web for recent news about Tesla";

console.log(`\nDriving prompt: "${WEB_SEARCH_PROMPT}"`);
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
  void session.prompt(WEB_SEARCH_PROMPT);
});

// -----------------------------------------------------------------------------
// STEP 7: Assertions.
// -----------------------------------------------------------------------------
console.log(
  `\nCaptured ${text.length} chars of assistant text across ${toolCalls.length} tool calls`,
);
console.log(`askUserHandler was called ${askUserTranscript.length} time(s) (should be 0)`);
for (const [i, call] of askUserTranscript.entries()) {
  console.log(
    `  [${i}] Q: ${call.question.slice(0, 120)}${call.question.length > 120 ? "..." : ""}`,
  );
  console.log(`       A: ${call.answer ?? "(cancelled)"}`);
}

record("soft tier never prompted the user", () => {
  assert(
    askUserTranscript.length === 0,
    `expected zero askUser calls for soft-tier providers (Brave/Exa), got ${askUserTranscript.length}:\n${askUserTranscript
      .map((c) => `  - ${c.question}`)
      .join("\n")}`,
  );
});

record("model called the search_web tool at least once", () => {
  const webSearchCalls = toolCalls.filter((c) => c.name === "search_web");
  assert(
    webSearchCalls.length >= 1,
    `expected at least one "search_web" tool call; the test prompt "${WEB_SEARCH_PROMPT}" should have triggered it. Observed tools: ${toolCalls
      .map((c) => c.name)
      .join(", ")}`,
  );
});

record('final assistant text contains "Data gaps" section', () => {
  assert(
    text.includes("Data gaps") || text.includes("**Data gaps**"),
    `expected a "Data gaps" section in the final answer. First 500 chars:\n${text.slice(0, 500)}`,
  );
});

record(
  '"Data gaps" section mentions a soft-degraded provider or "/connect search" remediation',
  () => {
    const mentionsRemediation = text.includes("/connect search");
    const mentionsProvider =
      text.includes("Brave") ||
      text.includes("brave") ||
      text.includes("Exa") ||
      text.includes("exa") ||
      text.includes("DuckDuckGo") ||
      text.includes("duckduckgo") ||
      text.includes("ddg");
    assert(
      mentionsRemediation || mentionsProvider,
      `expected "/connect search" remediation OR a mention of Brave/Exa/DuckDuckGo in the final answer. Text tail:\n${text.slice(-800)}`,
    );
  },
);

record("no raw [OPENCANDLE_SOFT_DEGRADED tag leaked to the user", () => {
  assert(
    !text.includes("[OPENCANDLE_SOFT_DEGRADED"),
    "raw soft-degraded tag leaked into the final assistant text — the LLM should translate it into a Data gaps bullet, not echo the tag",
  );
});

// -----------------------------------------------------------------------------
// STEP 8: Summary + cleanup + exit.
// -----------------------------------------------------------------------------
console.log(`\n${"=".repeat(50)}`);
console.log(
  `Credential-soft-fallback E2E: ${passed} passed, ${failed} failed out of ${passed + failed}`,
);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  ✗ ${f}`);
} else {
  console.log("\nAll credential-soft-fallback assertions passed!");
}

rmSync(openCandleHome, { recursive: true, force: true });
delete process.env.OPENCANDLE_HOME;
session.dispose();

process.exit(failed > 0 ? 1 : 0);
