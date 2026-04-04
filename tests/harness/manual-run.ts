/**
 * Manual test runner — uses askUserHandler injection with file-based IPC.
 * Writes questions to ipc/question.json, polls for ipc/answer.json.
 * An external agent reads questions, writes answers, and drives the session.
 */
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import { SessionManager, SettingsManager } from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenCandleSession } from "../../src/index.js";
import { cache } from "../../src/infra/cache.js";
import { classifyIntent } from "../../src/routing/classify-intent.js";
import type { AskUserHandler } from "../../src/types/index.js";

const ipcDir = process.argv[2] || join(tmpdir(), "oc-ipc-" + Date.now());
const prompt = process.argv[3] || "Help me build a diversified stock portfolio for long-term growth";

// Optional: pre-scripted answers as JSON array in argv[4]
const scriptedAnswers: string[] = process.argv[4] ? JSON.parse(process.argv[4]) as string[] : [];
let scriptedIndex = 0;

mkdirSync(ipcDir, { recursive: true });
console.log(`IPC dir: ${ipcDir}`);
console.log(`Prompt: ${prompt}`);
if (scriptedAnswers.length > 0) {
  console.log(`Scripted answers: ${scriptedAnswers.length}`);
}

function setStatus(status: string) {
  writeFileSync(join(ipcDir, "status"), status, "utf-8");
}

const askUserTranscript: Array<{ question: string; answer: string | null }> = [];

const askUserHandler: AskUserHandler = async (params) => {
  // If scripted answers are available, consume the next one
  if (scriptedIndex < scriptedAnswers.length) {
    const answer = scriptedAnswers[scriptedIndex++];
    askUserTranscript.push({ question: params.question, answer });
    return { answer, cancelled: false };
  }

  // Fall back to IPC-based polling
  writeFileSync(join(ipcDir, "question.json"), JSON.stringify(params, null, 2), "utf-8");
  setStatus("waiting");

  const answerPath = join(ipcDir, "answer.json");
  const start = Date.now();
  const timeout = 5 * 60 * 1000; // 5 min

  while (!existsSync(answerPath)) {
    if (Date.now() - start > timeout) {
      setStatus("running");
      askUserTranscript.push({ question: params.question, answer: null });
      return { answer: null, cancelled: true };
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  const raw = readFileSync(answerPath, "utf-8");
  const { value } = JSON.parse(raw) as { value: string };

  rmSync(answerPath, { force: true });
  rmSync(join(ipcDir, "question.json"), { force: true });
  setStatus("running");

  askUserTranscript.push({ question: params.question, answer: value });
  return { answer: value, cancelled: false };
};

const openCandleHome = mkdtempSync(join(tmpdir(), "oc-manual-test-"));
process.env.OPENCANDLE_HOME = openCandleHome;

const { session } = await createOpenCandleSession({
  cwd: process.cwd(),
  sessionManager: SessionManager.inMemory(),
  settingsManager: SettingsManager.inMemory({
    defaultProvider: "google",
    defaultModel: "gemini-2.5-flash",
  }),
  useInlineExtension: true,
  askUserHandler,
});

cache.clear();
setStatus("running");

let text = "";
const toolCalls: Array<{ name: string; args: unknown; result?: unknown }> = [];
const pendingTools = new Map<string, { name: string; args: unknown }>();

// For multi-turn workflows (e.g., comprehensive analysis with debate),
// the extension sends follow-up user messages after each LLM turn settles.
// Each follow-up triggers a new agent turn ending with agent_end.
// We wait for sustained quiet (no new turns) before finalizing the trace.
// The grace period must be long enough for the workflow runner to poll
// settlement (~100ms), send the next prompt, and for the LLM to start.
const SETTLE_GRACE_MS = 30_000;

await new Promise<void>((resolve) => {
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let agentEndCount = 0;

  const cancelSettle = () => {
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
  };

  const finish = () => {
    cancelSettle();
    unsub();
    resolve();
  };

  const resetSettleTimer = () => {
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
      agentEndCount++;
      // Wait for possible follow-up messages from the workflow runner
      resetSettleTimer();
    }
  });
  void session.prompt(prompt);
});

// Write final trace
const classification = classifyIntent(prompt);
const trace = { prompt, classification, toolCalls, askUserTranscript, text };
writeFileSync(join(ipcDir, "trace.json"), JSON.stringify(trace, null, 2), "utf-8");
setStatus("done");
console.log("Session complete. Trace written.");

rmSync(openCandleHome, { recursive: true, force: true });
session.dispose();
process.exit(0);
