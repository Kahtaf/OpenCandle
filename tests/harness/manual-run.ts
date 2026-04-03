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
import type { AskUserHandler } from "../../src/types/index.js";

const ipcDir = process.argv[2] || join(tmpdir(), "oc-ipc-" + Date.now());
const prompt = process.argv[3] || "Help me build a diversified stock portfolio for long-term growth";

mkdirSync(ipcDir, { recursive: true });
console.log(`IPC dir: ${ipcDir}`);
console.log(`Prompt: ${prompt}`);

function setStatus(status: string) {
  writeFileSync(join(ipcDir, "status"), status, "utf-8");
}

const askUserHandler: AskUserHandler = async (params) => {
  // Write question
  writeFileSync(join(ipcDir, "question.json"), JSON.stringify(params, null, 2), "utf-8");
  setStatus("waiting");

  // Poll for answer
  const answerPath = join(ipcDir, "answer.json");
  const start = Date.now();
  const timeout = 5 * 60 * 1000; // 5 min

  while (!existsSync(answerPath)) {
    if (Date.now() - start > timeout) {
      setStatus("running");
      return { answer: null, cancelled: true };
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  const raw = readFileSync(answerPath, "utf-8");
  const { value } = JSON.parse(raw) as { value: string };

  // Clean up for next round
  rmSync(answerPath, { force: true });
  rmSync(join(ipcDir, "question.json"), { force: true });
  setStatus("running");

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
const toolCalls: string[] = [];
const toolResults: Record<string, string>[] = [];

await new Promise<void>((resolve) => {
  const unsub = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      text += event.assistantMessageEvent.delta;
    }
    if (event.type === "tool_execution_start") {
      toolCalls.push(event.toolName);
    }
    if (event.type === "agent_end") {
      unsub();
      resolve();
    }
  });
  void session.prompt(prompt);
});

// Write final trace
const trace = { prompt, toolCalls, text };
writeFileSync(join(ipcDir, "trace.json"), JSON.stringify(trace, null, 2), "utf-8");
setStatus("done");
console.log("Session complete. Trace written.");

rmSync(openCandleHome, { recursive: true, force: true });
session.dispose();
process.exit(0);
