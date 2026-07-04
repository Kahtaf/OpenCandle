/**
 * CLI entry point for the agent test harness.
 *
 * Usage:
 *   npx tsx tests/harness/cli.ts run    --prompt "..." --ipc <dir> [--timeout <ms>]
 *   npx tsx tests/harness/cli.ts send   --prompt "..." --ipc <dir>
 *   npx tsx tests/harness/cli.ts wait   --ipc <dir> [--timeout <ms>]
 *   npx tsx tests/harness/cli.ts answer --ipc <dir> --value "..."
 *   npx tsx tests/harness/cli.ts trace  --ipc <dir>
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentSessionEvent,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { isAnalysisRequest } from "../../src/analysts/orchestrator.js";
import { createOpenCandleSession } from "../../src/index.js";
import { cache } from "../../src/infra/cache.js";
import { IpcChannel } from "./ipc.js";
import { createIpcAskHandler } from "./ipc-ask-handler.js";
import { createTraceCollector } from "./trace-collector.js";
import type { CustomEntryTrace } from "./types.js";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--") && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

const [subcommand] = process.argv.slice(2);
const args = parseArgs(process.argv.slice(3));

switch (subcommand) {
  case "run":
    await cmdRun();
    break;
  case "send":
    cmdSend();
    break;
  case "wait":
    await cmdWait();
    break;
  case "answer":
    cmdAnswer();
    break;
  case "trace":
    cmdTrace();
    break;
  default:
    console.error(`Usage: cli.ts <run|send|wait|answer|trace> [options]`);
    process.exit(1);
}

async function cmdRun() {
  const prompt = args.prompt;
  if (!prompt) {
    console.error("--prompt is required");
    process.exit(1);
  }

  const ipcDir = args.ipc || join(tmpdir(), `oc-harness-${Date.now()}`);
  const isAnalysisPrompt = isAnalysisRequest(prompt).match;
  const timeoutMs = args.timeout ? Number(args.timeout) : isAnalysisPrompt ? 900_000 : 300_000;

  mkdirSync(ipcDir, { recursive: true });
  const ipc = new IpcChannel(ipcDir);
  ipc.writePid();
  ipc.setStatus("running");

  // Respect a caller-provided OPENCANDLE_HOME (for example dogfooding against
  // real local state); otherwise isolate the run in a disposable temp home.
  // Only a temp home we created ourselves is ever deleted.
  const presetHome = process.env.OPENCANDLE_HOME;
  const openCandleHome = presetHome ?? mkdtempSync(join(tmpdir(), "oc-harness-home-"));
  process.env.OPENCANDLE_HOME = openCandleHome;
  const cleanupHome = () => {
    if (!presetHome) rmSync(openCandleHome, { recursive: true, force: true });
  };

  let collector: ReturnType<typeof createTraceCollector> | null = null;

  try {
    // Deferred collector proxy — the handler captures this ref; the real collector
    // is wired up after createOpenCandleSession returns.
    const collectorProxy = {
      addInteraction: (
        ...a: Parameters<ReturnType<typeof createTraceCollector>["addInteraction"]>
      ) => {
        collector?.addInteraction(...a);
      },
    } as ReturnType<typeof createTraceCollector>;

    const askHandler = createIpcAskHandler(ipc, collectorProxy, timeoutMs);

    const { session } = await createOpenCandleSession({
      cwd: process.cwd(),
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory({
        defaultProvider: "google",
        defaultModel: "gemini-2.5-flash",
      }),
      useInlineExtension: true,
      askUserHandler: askHandler,
    });

    const prompts = [prompt];
    let customEntryOffset = 0;
    const customEntries: CustomEntryTrace[] = [];

    collector = createTraceCollector(session, prompt, {
      jsonlPath: join(ipcDir, "events.jsonl"),
      trackPromptIndex: true,
    });

    // Graceful shutdown
    let shutdownRequested = false;
    const onShutdown = () => {
      if (shutdownRequested) return;
      shutdownRequested = true;
      console.error("Shutdown requested, writing partial trace...");
      if (collector) {
        const drained = drainOpenCandleCustomEntries(
          session.sessionManager,
          customEntryOffset,
          prompts.length - 1,
        );
        customEntries.push(...drained.entries);
        ipc.writeTrace({
          ...collector.getTrace(),
          prompts,
          customEntries,
        });
      }
      session.dispose();
      cleanupHome();
      process.exit(0);
    };
    process.on("SIGINT", onShutdown);
    process.on("SIGTERM", onShutdown);

    cache.clear();

    const writeCurrentTrace = (promptIndex: number) => {
      const drained = drainOpenCandleCustomEntries(
        session.sessionManager,
        customEntryOffset,
        promptIndex,
      );
      customEntryOffset = drained.nextEntryOffset;
      customEntries.push(...drained.entries);
      if (!collector) throw new Error("Trace collector was not initialized");
      ipc.writeTrace({
        ...collector.getTrace(),
        prompts,
        customEntries,
      });
    };

    await promptAndWaitForSettle(session, prompt, {
      settleGraceMs: isAnalysisPrompt ? 30_000 : 3_000,
      timeoutMs,
    });
    writeCurrentTrace(0);
    console.log(`IPC dir: ${ipcDir}`);
    console.log("Session complete. Trace written.");

    // Wait a bounded window for follow-up `send` prompts, then exit so
    // scripted runs terminate and self-created temp homes are cleaned up.
    // Each accepted follow-up resets the window. Override with --linger.
    const lingerMs = args.linger ? Number(args.linger) : 120_000;
    let idleSince = Date.now();
    while (!shutdownRequested) {
      const request = ipc.readPromptRequest();
      if (!request) {
        if (Date.now() - idleSince > lingerMs) {
          console.log(`No follow-up prompt within ${lingerMs}ms. Exiting.`);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      const promptIndex = prompts.length;
      prompts.push(request.prompt);
      collector.setPromptIndex(promptIndex);
      const followUpIsAnalysis = isAnalysisRequest(request.prompt).match;
      await promptAndWaitForSettle(session, request.prompt, {
        settleGraceMs: followUpIsAnalysis ? 30_000 : 3_000,
        // Analysis follow-ups need the long window even when the first
        // prompt was a quick one; an explicit --timeout still wins.
        timeoutMs: args.timeout ? timeoutMs : followUpIsAnalysis ? 900_000 : 300_000,
      });
      writeCurrentTrace(promptIndex);
      idleSince = Date.now();
      console.log("Follow-up complete. Trace written.");
    }
    if (!shutdownRequested) {
      collector.dispose();
      session.dispose();
      cleanupHome();
      process.exit(0);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ipc.writeError(message);
    console.error("Harness error:", message);
    if (collector) collector.dispose();
    cleanupHome();
    process.exit(1);
  }
}

function drainOpenCandleCustomEntries(
  sessionManager: {
    getEntries(): Array<Record<string, unknown>>;
  },
  startEntryOffset: number,
  promptIndex: number,
): { entries: CustomEntryTrace[]; nextEntryOffset: number } {
  const allEntries = sessionManager.getEntries();
  const entries = allEntries
    .slice(startEntryOffset)
    .filter(
      (entry) =>
        entry.type === "custom" &&
        typeof entry.customType === "string" &&
        entry.customType.startsWith("opencandle-"),
    )
    .map((entry) => ({
      customType: String(entry.customType),
      data: entry.data,
      timestamp: String(entry.timestamp),
      promptIndex,
    }));
  return { entries, nextEntryOffset: allEntries.length };
}

async function promptAndWaitForSettle(
  session: Awaited<ReturnType<typeof createOpenCandleSession>>["session"],
  prompt: string,
  options: { settleGraceMs: number; timeoutMs: number },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let unsub = () => {};
    const timeoutTimer = setTimeout(() => {
      cleanup();
      reject(new Error(`OpenCandle harness timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      unsub();
    };

    const cancelSettle = () => {
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
    };

    const finishAfterGrace = () => {
      cancelSettle();
      settleTimer = setTimeout(() => {
        cleanup();
        resolve();
      }, options.settleGraceMs);
    };

    unsub = session.subscribe((event: AgentSessionEvent) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        cancelSettle();
      }
      if (event.type === "tool_execution_start") {
        cancelSettle();
      }
      if (event.type === "agent_end") {
        finishAfterGrace();
      }
    });

    void session.prompt(prompt).catch((error: unknown) => {
      cleanup();
      reject(error);
    });
  });
}

async function cmdWait() {
  const ipcDir = args.ipc;
  if (!ipcDir) {
    console.error("--ipc is required");
    process.exit(1);
  }

  const timeoutMs = args.timeout ? Number(args.timeout) : 300_000;
  const start = Date.now();
  const pollInterval = 100;

  while (Date.now() - start < timeoutMs) {
    const status = IpcChannel.readStatus(ipcDir);

    if (status === "waiting") {
      const question = IpcChannel.readQuestion(ipcDir);
      if (question) {
        console.log(JSON.stringify(question));
        process.exit(100);
      }
    }

    if (status === "done") {
      const trace = IpcChannel.readTrace(ipcDir);
      if (trace) {
        const summary = {
          prompt: trace.prompt,
          turns: trace.turns.length,
          toolSequence: trace.toolSequence,
          interactions: trace.interactions.length,
          durationMs: trace.durationMs,
        };
        console.log(JSON.stringify(summary));
      }
      process.exit(0);
    }

    if (status === "error") {
      const { readFileSync, existsSync } = await import("node:fs");
      const errorPath = join(ipcDir, "error.txt");
      const msg = existsSync(errorPath) ? readFileSync(errorPath, "utf-8") : "Unknown error";
      console.error(msg);
      process.exit(1);
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  console.error("Timeout waiting for harness");
  process.exit(2);
}

function cmdSend() {
  const ipcDir = args.ipc;
  const prompt = args.prompt;
  if (!ipcDir || !prompt) {
    console.error("--ipc and --prompt are required");
    process.exit(1);
  }
  const status = IpcChannel.readStatus(ipcDir);
  if (status !== "done" && status !== "waiting") {
    console.error(`Cannot send follow-up while harness status is ${status ?? "missing"}`);
    process.exit(1);
  }
  if (!IpcChannel.isRunAlive(ipcDir)) {
    console.error(
      "Cannot send follow-up: the harness run process is no longer alive (it may have exited after its linger window).",
    );
    process.exit(1);
  }
  IpcChannel.writePromptRequest(ipcDir, prompt);
}

function cmdAnswer() {
  const ipcDir = args.ipc;
  const value = args.value;
  if (!ipcDir || value === undefined) {
    console.error("--ipc and --value are required");
    process.exit(1);
  }

  IpcChannel.writeAnswer(ipcDir, value);
}

function cmdTrace() {
  const ipcDir = args.ipc;
  if (!ipcDir) {
    console.error("--ipc is required");
    process.exit(1);
  }

  const trace = IpcChannel.readTrace(ipcDir);
  if (!trace) {
    console.error("No trace found");
    process.exit(1);
  }

  console.log(JSON.stringify(trace, null, 2));
}
