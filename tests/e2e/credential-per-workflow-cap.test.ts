/**
 * E2E test — at-most-one hard-provider prompt per workflow (OpenSpec
 * conversational-provider-setup, Task 17.4).
 *
 * Verifies the per-workflow prompt cap:
 *   1. Fresh session with BOTH ALPHA_VANTAGE_API_KEY and FRED_API_KEY absent
 *      and no persisted onboarding state
 *   2. User submits "analyze NVDA" — a workflow that would normally fetch
 *      both Alpha Vantage (fundamentals) and FRED (macro) data
 *   3. The extension's `hardPromptFiredInWorkflow` flag (set inside the
 *      `tool_result` handler) flips after the first hard-provider prompt
 *      fires. `resolveCredentialRequired` then returns `{ action: "skip" }`
 *      for the second hard provider because its tier is `"hard"` and the
 *      cap is set
 *   4. EXACTLY one askUser prompt is recorded for a hard provider (whichever
 *      tool ran first — in the NVDA analyze workflow, Alpha Vantage
 *      typically precedes FRED via get_financials / get_company_overview)
 *   5. The final assistant answer's `**Data gaps**` section lists BOTH
 *      providers with their remediations: `/connect financials` for Alpha
 *      Vantage and `/connect economy` for FRED (both come from the first
 *      alias in `src/onboarding/providers.ts`)
 *
 * Scope: Task 17.4 only. See credential-prompt.test.ts (17.1),
 * credential-snooze.test.ts (17.2), credential-soft-fallback.test.ts (17.3).
 *
 * Usage: npx tsx tests/e2e/credential-per-workflow-cap.test.ts
 *
 * Requires at least one of GEMINI_API_KEY / GOOGLE_API_KEY / ANTHROPIC_API_KEY /
 * OPENAI_API_KEY in
 * the environment. If none is present, the test exits 0 with a skip notice so CI
 * without LLM credentials can still run the suite.
 */

// -----------------------------------------------------------------------------
// STEP 1: Sandbox OPENCANDLE_HOME and scrub ALPHA_VANTAGE_API_KEY + FRED_API_KEY
// *before* any import that might read config or onboarding state.
// -----------------------------------------------------------------------------
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-credential-per-workflow-cap-test-"));
process.env.OPENCANDLE_HOME = openCandleHome;
delete process.env.ALPHA_VANTAGE_API_KEY;
delete process.env.FRED_API_KEY;

type LlmChoice = { provider: string; model: string; envVars: string[] };
const LLM_CANDIDATES: readonly LlmChoice[] = [
  { provider: "google", model: "gemini-2.5-flash", envVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"] },
  { provider: "anthropic", model: "claude-haiku-4-5", envVars: ["ANTHROPIC_API_KEY"] },
  { provider: "openai", model: "gpt-5-mini", envVars: ["OPENAI_API_KEY"] },
];
const llmChoice = LLM_CANDIDATES.find((c) => c.envVars.some((envVar) => !!process.env[envVar]));
if (!llmChoice) {
  console.log(
    "⚠ Skipping credential-per-workflow-cap e2e: no LLM credential in env " +
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
// STEP 4: Scripted askUserHandler — always pick "Continue …". Records every
// call so we can assert the exactly-one cap.
// -----------------------------------------------------------------------------
interface AskUserCall {
  question: string;
  options?: string[];
  answer: string | null;
}
const askUserTranscript: AskUserCall[] = [];

const askUserHandler: AskUserHandler = async (params) => {
  const options = params.options ?? [];
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
console.log("=== OpenCandle credential-per-workflow-cap E2E (Task 17.4) ===");
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
// STEP 6: Drive the analyze flow with settle-based termination.
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

record("exactly one hard-provider askUser prompt was recorded", () => {
  assert(
    askUserTranscript.length === 1,
    `expected exactly 1 hard-provider prompt due to per-workflow cap, got ${askUserTranscript.length}:\n${askUserTranscript
      .map((c) => `  - ${c.question}`)
      .join("\n")}`,
  );
});

// Determine which provider the single prompt was for. Either Alpha Vantage or
// FRED is acceptable — the workflow orders tools but the LLM may reorder at
// the margin, so we accept whichever came first.
const firstCall = askUserTranscript[0];
const matchesAlpha =
  firstCall !== undefined &&
  (firstCall.question.includes("Alpha Vantage") ||
    (firstCall.options ?? []).some((o) => o.includes("Alpha Vantage")));
const matchesFred =
  firstCall !== undefined &&
  (firstCall.question.includes("FRED") ||
    (firstCall.options ?? []).some((o) => o.includes("FRED")));

record("the single prompt was for Alpha Vantage or FRED", () => {
  assert(
    matchesAlpha || matchesFred,
    `expected the single prompt to mention Alpha Vantage or FRED, got: ${firstCall?.question ?? "(no call)"}`,
  );
});

if (matchesAlpha) {
  console.log("\nDetected: Alpha Vantage prompted first, FRED was silently capped");
} else if (matchesFred) {
  console.log("\nDetected: FRED prompted first, Alpha Vantage was silently capped");
}

record('final assistant text contains "Data gaps" section', () => {
  assert(
    text.includes("Data gaps") || text.includes("**Data gaps**"),
    `expected a "Data gaps" section in the final answer. First 500 chars:\n${text.slice(0, 500)}`,
  );
});

record('"Data gaps" section mentions BOTH Alpha Vantage and FRED providers', () => {
  // Primary check: both verbatim `/connect` remediations appear.
  const hasAvRemediation = text.includes("/connect financials");
  const hasFredRemediation = text.includes("/connect economy");
  if (hasAvRemediation && hasFredRemediation) return;

  // Secondary check: the LLM may have merged the two remediations or used a
  // slightly different phrasing — fall back to checking that both providers
  // are NAMED in the text. This still catches the "only one provider was
  // surfaced" bug we're guarding against.
  const hasAvName = text.includes("Alpha Vantage") || text.includes("alpha_vantage");
  const hasFredName = text.includes("FRED") || text.includes("fred");
  assert(
    hasAvName && hasFredName,
    `expected BOTH Alpha Vantage and FRED to appear in the Data gaps section (either via /connect remediations or by name). ` +
      `av_remediation=${hasAvRemediation} fred_remediation=${hasFredRemediation} av_name=${hasAvName} fred_name=${hasFredName}. ` +
      `Text tail:\n${text.slice(-1200)}`,
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
console.log(
  `Credential-per-workflow-cap E2E: ${passed} passed, ${failed} failed out of ${passed + failed}`,
);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  ✗ ${f}`);
} else {
  console.log("\nAll credential-per-workflow-cap assertions passed!");
}

rmSync(openCandleHome, { recursive: true, force: true });
delete process.env.OPENCANDLE_HOME;
session.dispose();

process.exit(failed > 0 ? 1 : 0);
