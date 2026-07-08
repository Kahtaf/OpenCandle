/**
 * E2E test — credential-prompt snooze lifecycle (OpenSpec conversational-provider-setup, Task 17.2).
 *
 * Verifies the end-to-end snooze flow:
 *   1. Fresh session with no ALPHA_VANTAGE_API_KEY and no persisted onboarding state
 *   2. User submits "analyze NVDA" and picks the "Snooze 7 days" option
 *   3. Onboarding state on disk shows alpha_vantage with status "snoozed" and a
 *      `snoozeUntil` roughly 7 days in the future
 *   4. A SECOND "analyze NVDA" in the SAME session does NOT re-prompt for
 *      Alpha Vantage (same-session dedup via `sessionPromptedSet` in the
 *      extension closure)
 *   5. After fast-forwarding `snoozeUntil` to the past and creating a FRESH
 *      session, "analyze NVDA" DOES re-prompt
 *   6. The fresh-session final assistant text contains a `**Data gaps**`
 *      section citing `run /connect financials` verbatim
 *
 * Scope: Task 17.2 only. See credential-prompt.test.ts for Task 17.1.
 *
 * Usage: npx tsx tests/e2e/credential-snooze.test.ts
 *
 * Requires at least one of GEMINI_API_KEY / GOOGLE_API_KEY / ANTHROPIC_API_KEY /
 * OPENAI_API_KEY in
 * the environment. If none is present, the test exits 0 with a skip notice so CI
 * without LLM credentials can still run the suite.
 */

// -----------------------------------------------------------------------------
// STEP 1: Sandbox OPENCANDLE_HOME and scrub ALPHA_VANTAGE_API_KEY *before* any
// import that might read config or onboarding state.
// -----------------------------------------------------------------------------
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-credential-snooze-test-"));
process.env.OPENCANDLE_HOME = openCandleHome;
delete process.env.ALPHA_VANTAGE_API_KEY;

type LlmChoice = { provider: string; model: string; envVars: string[] };
const LLM_CANDIDATES: readonly LlmChoice[] = [
  { provider: "google", model: "gemini-2.5-flash", envVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"] },
  { provider: "anthropic", model: "claude-haiku-4-5", envVars: ["ANTHROPIC_API_KEY"] },
  { provider: "openai", model: "gpt-5-mini", envVars: ["OPENAI_API_KEY"] },
];
const llmChoice = LLM_CANDIDATES.find((c) => c.envVars.some((envVar) => !!process.env[envVar]));
if (!llmChoice) {
  console.log(
    "⚠ Skipping credential-snooze e2e: no LLM credential in env " +
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
type AgentSession = import("@earendil-works/pi-coding-agent").AgentSession;
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

interface AskUserCall {
  question: string;
  options?: string[];
  answer: string | null;
}

// -----------------------------------------------------------------------------
// STEP 4: Driver that wraps a single `analyze NVDA` turn with settle-based
// termination (mirrors credential-prompt.test.ts).
// -----------------------------------------------------------------------------
const SETTLE_GRACE_MS = 30_000;
const HARD_TIMEOUT_MS = 8 * 60 * 1000;

interface TurnCapture {
  text: string;
  toolCalls: Array<{ name: string; args: unknown; result?: unknown }>;
}

async function driveAnalyzeNvda(session: AgentSession): Promise<TurnCapture> {
  const capture: TurnCapture = { text: "", toolCalls: [] };
  const pendingTools = new Map<string, { name: string; args: unknown }>();

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
        capture.text += event.assistantMessageEvent.delta;
        cancelSettle();
      }
      if (event.type === "tool_execution_start") {
        pendingTools.set(event.toolCallId, { name: event.toolName, args: event.args });
        cancelSettle();
      }
      if (event.type === "tool_execution_end") {
        const pending = pendingTools.get(event.toolCallId);
        if (pending) {
          capture.toolCalls.push({ name: pending.name, args: pending.args, result: event.result });
          pendingTools.delete(event.toolCallId);
        }
      }
      if (event.type === "agent_end") {
        resetSettleTimer();
      }
    });
    void session.prompt("analyze NVDA");
  });

  return capture;
}

// -----------------------------------------------------------------------------
// STEP 5: Session A — scripted handler picks "Snooze …" on Alpha Vantage.
// -----------------------------------------------------------------------------
console.log("=== OpenCandle credential-snooze E2E (Task 17.2) ===");
console.log(`LLM: ${llmChoice.provider}/${llmChoice.model}`);
console.log(`OPENCANDLE_HOME (sandbox): ${openCandleHome}`);

const askUserTranscriptA: AskUserCall[] = [];
const askUserHandlerA: AskUserHandler = async (params) => {
  const options = params.options ?? [];
  // Pick "Snooze …" when offered; fall back so the test never deadlocks if the
  // first prompt is not the AV credential prompt.
  const snoozeOption =
    options.find((o) => o.startsWith("Snooze")) ??
    options.find((o) => o.startsWith("Continue")) ??
    options[0] ??
    null;
  askUserTranscriptA.push({
    question: params.question,
    options: params.options,
    answer: snoozeOption,
  });
  return { answer: snoozeOption, cancelled: snoozeOption === null };
};

const { session: sessionA } = await createOpenCandleSession({
  cwd: process.cwd(),
  sessionManager: SessionManager.inMemory(),
  settingsManager: SettingsManager.inMemory({
    defaultProvider: llmChoice.provider,
    defaultModel: llmChoice.model,
  }),
  useInlineExtension: true,
  askUserHandler: askUserHandlerA,
});

cache.clear();

console.log('\nSession A — first prompt: "analyze NVDA" (expect Snooze choice)');
console.log("(this will hit the live LLM; expect 1–3 minutes)\n");
const captureA1 = await driveAnalyzeNvda(sessionA);

console.log(
  `\nCaptured ${captureA1.text.length} chars of assistant text across ${captureA1.toolCalls.length} tool calls`,
);
console.log(`askUserHandler was called ${askUserTranscriptA.length} time(s) in turn A1`);
for (const [i, call] of askUserTranscriptA.entries()) {
  console.log(
    `  [${i}] Q: ${call.question.slice(0, 120)}${call.question.length > 120 ? "..." : ""}`,
  );
  console.log(`       A: ${call.answer ?? "(cancelled)"}`);
}

record("session A: at least one Alpha Vantage prompt fired", () => {
  const match = askUserTranscriptA.find(
    (c) =>
      c.question.includes("Alpha Vantage") ||
      (c.options ?? []).some((o) => o.includes("Alpha Vantage")),
  );
  assert(
    match !== undefined,
    `expected a prompt mentioning "Alpha Vantage" in session A, got:\n${askUserTranscriptA
      .map((c) => `  - ${c.question}`)
      .join("\n")}`,
  );
});

record("session A: scripted answer was the Snooze option", () => {
  const snoozedCall = askUserTranscriptA.find((c) => c.answer?.startsWith("Snooze"));
  assert(
    snoozedCall !== undefined,
    `expected a "Snooze …" answer to be recorded, got:\n${askUserTranscriptA
      .map((c) => `  - ${c.answer ?? "(null)"}`)
      .join("\n")}`,
  );
});

// -----------------------------------------------------------------------------
// STEP 6: Assert the onboarding.json state file shows alpha_vantage snoozed
// with a snoozeUntil ~7 days out.
// -----------------------------------------------------------------------------
const onboardingPath = join(openCandleHome, "onboarding.json");
record("session A: onboarding.json records alpha_vantage status=snoozed", () => {
  const raw = readFileSync(onboardingPath, "utf-8");
  const parsed = JSON.parse(raw) as {
    providers?: {
      alpha_vantage?: { status?: string; snoozeUntil?: string };
    };
  };
  const entry = parsed.providers?.alpha_vantage;
  assert(
    entry !== undefined,
    `expected providers.alpha_vantage entry in ${onboardingPath}, got:\n${raw}`,
  );
  assert(
    entry?.status === "snoozed",
    `expected alpha_vantage.status === "snoozed", got: ${entry?.status}`,
  );
  assert(
    typeof entry?.snoozeUntil === "string",
    `expected alpha_vantage.snoozeUntil to be a string, got: ${String(entry?.snoozeUntil)}`,
  );
  const snoozeUntil = entry.snoozeUntil;
  const snoozeUntilMs = Date.parse(snoozeUntil);
  assert(
    !Number.isNaN(snoozeUntilMs),
    `expected snoozeUntil to parse as a date, got: ${snoozeUntil}`,
  );
  const nowMs = Date.now();
  const sixDaysMs = 6 * 24 * 3600 * 1000;
  const eightDaysMs = 8 * 24 * 3600 * 1000;
  assert(
    snoozeUntilMs >= nowMs + sixDaysMs && snoozeUntilMs <= nowMs + eightDaysMs,
    `expected snoozeUntil to be ~7 days in the future, got ${snoozeUntil} (delta=${
      (snoozeUntilMs - nowMs) / (24 * 3600 * 1000)
    } days)`,
  );
});

// -----------------------------------------------------------------------------
// STEP 7: Same session, second "analyze NVDA" — must NOT re-prompt for AV.
// -----------------------------------------------------------------------------
const preA2Count = askUserTranscriptA.length;
console.log('\nSession A — second prompt: "analyze NVDA" (expect NO new AV prompt)\n');
const captureA2 = await driveAnalyzeNvda(sessionA);

const newCallsA2 = askUserTranscriptA.slice(preA2Count);
console.log(
  `\nCaptured ${captureA2.text.length} chars of assistant text across ${captureA2.toolCalls.length} tool calls`,
);
console.log(`askUserHandler saw ${newCallsA2.length} NEW call(s) in turn A2`);
for (const [i, call] of newCallsA2.entries()) {
  console.log(
    `  [${i}] Q: ${call.question.slice(0, 120)}${call.question.length > 120 ? "..." : ""}`,
  );
  console.log(`       A: ${call.answer ?? "(cancelled)"}`);
}

record("session A: second analyze did NOT re-prompt for Alpha Vantage (session dedup)", () => {
  const reprompt = newCallsA2.find(
    (c) =>
      c.question.includes("Alpha Vantage") ||
      (c.options ?? []).some((o) => o.includes("Alpha Vantage")),
  );
  assert(
    reprompt === undefined,
    `expected NO new Alpha Vantage prompt in session A turn 2, got:\n${newCallsA2
      .map((c) => `  - ${c.question}`)
      .join("\n")}`,
  );
});

// -----------------------------------------------------------------------------
// STEP 8: Dispose session A, fast-forward snoozeUntil into the past, create a
// fresh session B that should re-prompt.
// -----------------------------------------------------------------------------
sessionA.dispose();

{
  const raw = readFileSync(onboardingPath, "utf-8");
  const parsed = JSON.parse(raw) as {
    providers: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
  };
  const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  parsed.providers.alpha_vantage = {
    ...parsed.providers.alpha_vantage,
    snoozeUntil: past,
  };
  writeFileSync(onboardingPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
  console.log(`\nFast-forwarded alpha_vantage.snoozeUntil to ${past}`);
}

cache.clear();

const askUserTranscriptB: AskUserCall[] = [];
const askUserHandlerB: AskUserHandler = async (params) => {
  const options = params.options ?? [];
  // Fresh session: now pick "Continue …" so we verify the prompt came back and
  // exercise the gap-note rendering path.
  const continueOption =
    options.find((o) => o.startsWith("Continue")) ?? options[1] ?? options[0] ?? null;
  askUserTranscriptB.push({
    question: params.question,
    options: params.options,
    answer: continueOption,
  });
  return { answer: continueOption, cancelled: continueOption === null };
};

const { session: sessionB } = await createOpenCandleSession({
  cwd: process.cwd(),
  sessionManager: SessionManager.inMemory(),
  settingsManager: SettingsManager.inMemory({
    defaultProvider: llmChoice.provider,
    defaultModel: llmChoice.model,
  }),
  useInlineExtension: true,
  askUserHandler: askUserHandlerB,
});

console.log('\nSession B (fresh) — prompt: "analyze NVDA" (expect AV prompt to return)\n');
const captureB = await driveAnalyzeNvda(sessionB);

console.log(
  `\nCaptured ${captureB.text.length} chars of assistant text across ${captureB.toolCalls.length} tool calls`,
);
console.log(`askUserHandler was called ${askUserTranscriptB.length} time(s) in session B`);
for (const [i, call] of askUserTranscriptB.entries()) {
  console.log(
    `  [${i}] Q: ${call.question.slice(0, 120)}${call.question.length > 120 ? "..." : ""}`,
  );
  console.log(`       A: ${call.answer ?? "(cancelled)"}`);
}

record("session B: Alpha Vantage prompt re-fired after snooze expiry", () => {
  const match = askUserTranscriptB.find(
    (c) =>
      c.question.includes("Alpha Vantage") ||
      (c.options ?? []).some((o) => o.includes("Alpha Vantage")),
  );
  assert(
    match !== undefined,
    `expected a fresh Alpha Vantage prompt in session B after fast-forwarding snoozeUntil, got:\n${askUserTranscriptB
      .map((c) => `  - ${c.question}`)
      .join("\n")}`,
  );
});

record('session B: final assistant text contains "Data gaps" section', () => {
  assert(
    captureB.text.includes("Data gaps") || captureB.text.includes("**Data gaps**"),
    `expected a "Data gaps" section in the final answer. First 500 chars:\n${captureB.text.slice(0, 500)}`,
  );
});

record('session B: "Data gaps" section cites "/connect financials" remediation', () => {
  assert(
    captureB.text.includes("/connect financials"),
    `expected the verbatim "/connect financials" remediation in the final answer. Text tail:\n${captureB.text.slice(-800)}`,
  );
});

// -----------------------------------------------------------------------------
// STEP 9: Summary + cleanup + exit.
// -----------------------------------------------------------------------------
console.log(`\n${"=".repeat(50)}`);
console.log(`Credential-snooze E2E: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  ✗ ${f}`);
} else {
  console.log("\nAll credential-snooze assertions passed!");
}

rmSync(openCandleHome, { recursive: true, force: true });
delete process.env.OPENCANDLE_HOME;
sessionB.dispose();

process.exit(failed > 0 ? 1 : 0);
