import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { BrowserHostedGuiRuntime } from "../../gui/hosted/runtime/browser-hosted-gui-runtime.js";
import { runOpenCandleSession } from "./opencandle-runner.js";

/**
 * Live cross-surface proof: export canonical hosted JSONL, open it with Pi's
 * native reader, and continue it through the same harness used for the TUI.
 */
async function main() {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is required for the hosted-to-TUI continuation proof");
  }
  const root = mkdtempSync(join(tmpdir(), "oc-hosted-tui-"));
  try {
    const runtime = await BrowserHostedGuiRuntime.create({
      cwd: root,
      sessionDir: join(root, "hosted"),
      stateFile: join(root, "state", "current.sqlite3"),
    });
    const bootstrap = await runtime.bootstrap();
    const checkpoint = bootstrap.checkpoint.sessions.find(
      (item) => item.sessionId === bootstrap.sessionId,
    );
    if (!checkpoint) throw new Error("Hosted runtime did not produce a canonical checkpoint");
    const sessionPath = join(root, checkpoint.filename);
    writeFileSync(sessionPath, checkpoint.content);
    runtime.dispose();

    const sessionManager = SessionManager.open(sessionPath, root, root);
    const entriesBefore = sessionManager.getEntries().length;
    const result = await runOpenCandleSession({
      prompt: "In one short sentence, confirm this imported OpenCandle session can continue.",
      cwd: root,
      openCandleHome: join(root, "home"),
      sessionManager,
      defaultProvider: "openai",
      defaultModel: "gpt-4.1-mini",
      settleGraceMs: 200,
      timeoutMs: 180_000,
    });
    const entriesAfter = sessionManager.getEntries().length;
    const proof = {
      sessionIdPreserved: sessionManager.getSessionId() === bootstrap.sessionId,
      entriesBefore,
      entriesAfter,
      answerPresent: Boolean(result.agentTrace.finalText.trim()),
    };
    if (!proof.sessionIdPreserved || entriesAfter <= entriesBefore || !proof.answerPresent) {
      throw new Error("The TUI harness did not continue the imported hosted session");
    }
    process.stdout.write(`${JSON.stringify(proof)}\n`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

await main();
