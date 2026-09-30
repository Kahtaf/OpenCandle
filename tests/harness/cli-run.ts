/**
 * `cli.ts run` implementation, separated from the argv/process shell so the
 * settle behavior can be exercised in-process against a scripted model.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { isAnalysisRequest } from "../../src/analysts/orchestrator.js";
import { createOpenCandleSession } from "../../src/index.js";
import { cache } from "../../src/infra/cache.js";
import { IpcChannel } from "./ipc.js";
import { createIpcAskHandler } from "./ipc-ask-handler.js";
import { drainOpenCandleCustomEntries } from "./opencandle-runner.js";
import { promptAndWaitForCompletion, type SettleOutcome } from "./session-settle.js";
import { createTraceCollector } from "./trace-collector.js";
import type { CustomEntryTrace } from "./types.js";

export interface HarnessRunOptions {
  prompt: string;
  ipcDir?: string;
  /** Overall bound for one prompt, including every workflow step. */
  timeoutMs?: number;
  /** Quiet window required after the completion signal before settling. */
  settleMs?: number;
  /** Follow-up window after completion; each accepted `send` resets it. */
  lingerMs?: number;
  cwd?: string;
  modelRuntime?: ModelRuntime;
  defaultProvider?: string;
  defaultModel?: string;
  /** Install SIGINT/SIGTERM handlers that write a partial trace and exit. */
  installSignalHandlers?: boolean;
}

export interface HarnessRunResult {
  exitCode: number;
  ipcDir: string;
}

/** Default quiet window once the workflow and session signal completion. */
export const DEFAULT_SETTLE_MS = 2_000;
/** Exit code for a run that hit its timeout before the prompt completed. */
export const INCOMPLETE_EXIT_CODE = 3;

export async function runHarnessCli(options: HarnessRunOptions): Promise<HarnessRunResult> {
  const { prompt } = options;
  const ipcDir = options.ipcDir || join(tmpdir(), `oc-harness-${Date.now()}`);
  const isAnalysisPrompt = isAnalysisRequest(prompt).match;
  const timeoutMs = options.timeoutMs ?? (isAnalysisPrompt ? 900_000 : 300_000);

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
    if (!presetHome) {
      rmSync(openCandleHome, { recursive: true, force: true });
      delete process.env.OPENCANDLE_HOME;
    }
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

    const created = await createOpenCandleSession({
      cwd: options.cwd ?? process.cwd(),
      modelRuntime: options.modelRuntime,
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory({
        defaultProvider: options.defaultProvider ?? "google",
        defaultModel: options.defaultModel ?? "gemini-2.5-flash",
      }),
      useInlineExtension: true,
      askUserHandler: askHandler,
    });
    const { session } = created;
    const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;

    const prompts = [prompt];
    let customEntryOffset = 0;
    const customEntries: CustomEntryTrace[] = [];

    collector = createTraceCollector(session, prompt, {
      jsonlPath: join(ipcDir, "events.jsonl"),
      trackPromptIndex: true,
    });

    // Graceful shutdown
    let shutdownRequested = false;
    if (options.installSignalHandlers) {
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
    }

    cache.clear();

    const currentTrace = (promptIndex: number) => {
      const drained = drainOpenCandleCustomEntries(
        session.sessionManager,
        customEntryOffset,
        promptIndex,
      );
      customEntryOffset = drained.nextEntryOffset;
      customEntries.push(...drained.entries);
      if (!collector) throw new Error("Trace collector was not initialized");
      return { ...collector.getTrace(), prompts, customEntries };
    };
    const writeCurrentTrace = (promptIndex: number) => ipc.writeTrace(currentTrace(promptIndex));

    const finishIncomplete = (
      promptIndex: number,
      outcome: Extract<SettleOutcome, { status: "incomplete" }>,
    ): HarnessRunResult => {
      const { status: _status, ...details } = outcome;
      ipc.writeIncomplete(details, currentTrace(promptIndex));
      console.error(
        outcome.reason === "workflow_running"
          ? `Timed out after ${outcome.timeoutMs}ms while workflow ${outcome.workflow} was still running. Partial trace written.`
          : `Timed out after ${outcome.timeoutMs}ms while the session was still busy. Partial trace written.`,
      );
      collector?.dispose();
      session.dispose();
      cleanupHome();
      return { exitCode: INCOMPLETE_EXIT_CODE, ipcDir };
    };

    const first = await promptAndWaitForCompletion(created, prompt, {
      timeoutMs,
      resolveSettleMs: () => settleMs,
    });
    if (first.status === "incomplete") return finishIncomplete(0, first);
    writeCurrentTrace(0);
    console.log(`IPC dir: ${ipcDir}`);
    console.log("Session complete. Trace written.");

    // Wait a bounded window for follow-up `send` prompts, then exit so
    // scripted runs terminate and self-created temp homes are cleaned up.
    // Each accepted follow-up resets the window. Override with --linger.
    const lingerMs = options.lingerMs ?? 120_000;
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
      const followUp = await promptAndWaitForCompletion(created, request.prompt, {
        // Analysis follow-ups need the long window even when the first
        // prompt was a quick one; an explicit --timeout still wins.
        timeoutMs:
          options.timeoutMs !== undefined ? timeoutMs : followUpIsAnalysis ? 900_000 : 300_000,
        resolveSettleMs: () => settleMs,
      });
      if (followUp.status === "incomplete") return finishIncomplete(promptIndex, followUp);
      writeCurrentTrace(promptIndex);
      idleSince = Date.now();
      console.log("Follow-up complete. Trace written.");
    }
    collector.dispose();
    session.dispose();
    cleanupHome();
    return { exitCode: 0, ipcDir };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ipc.writeError(message);
    console.error("Harness error:", message);
    if (collector) collector.dispose();
    cleanupHome();
    return { exitCode: 1, ipcDir };
  }
}
