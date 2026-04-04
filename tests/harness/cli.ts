/**
 * CLI entry point for the agent test harness.
 *
 * Usage:
 *   npx tsx tests/harness/cli.ts run    --prompt "..." --ipc <dir> [--timeout <ms>]
 *   npx tsx tests/harness/cli.ts wait   --ipc <dir> [--timeout <ms>]
 *   npx tsx tests/harness/cli.ts answer --ipc <dir> --value "..."
 *   npx tsx tests/harness/cli.ts trace  --ipc <dir>
 */
import { SessionManager, SettingsManager } from "@mariozechner/pi-coding-agent";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenCandleSession } from "../../src/index.js";
import { cache } from "../../src/infra/cache.js";
import { IpcChannel } from "./ipc.js";
import { createIpcAskHandler } from "./ipc-ask-handler.js";
import { createTraceCollector } from "./trace-collector.js";

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
    console.error(`Usage: cli.ts <run|wait|answer|trace> [options]`);
    process.exit(1);
}

async function cmdRun() {
  const prompt = args.prompt;
  if (!prompt) {
    console.error("--prompt is required");
    process.exit(1);
  }

  const ipcDir = args.ipc || join(tmpdir(), `oc-harness-${Date.now()}`);
  const timeoutMs = args.timeout ? Number(args.timeout) : 300_000;

  mkdirSync(ipcDir, { recursive: true });
  const ipc = new IpcChannel(ipcDir);
  ipc.writePid();
  ipc.setStatus("running");

  const openCandleHome = mkdtempSync(join(tmpdir(), "oc-harness-home-"));
  process.env.OPENCANDLE_HOME = openCandleHome;

  let collector: ReturnType<typeof createTraceCollector> | null = null;

  try {
    // Deferred collector proxy — the handler captures this ref; the real collector
    // is wired up after createOpenCandleSession returns.
    const collectorProxy = {
      addInteraction: (...a: Parameters<ReturnType<typeof createTraceCollector>["addInteraction"]>) => {
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

    collector = createTraceCollector(session, prompt, {
      jsonlPath: join(ipcDir, "events.jsonl"),
    });

    // Graceful shutdown
    let shutdownRequested = false;
    const onShutdown = () => {
      if (shutdownRequested) return;
      shutdownRequested = true;
      console.error("Shutdown requested, writing partial trace...");
      if (collector) {
        ipc.writeTrace(collector.getTrace());
      }
      session.dispose();
      rmSync(openCandleHome, { recursive: true, force: true });
      process.exit(0);
    };
    process.on("SIGINT", onShutdown);
    process.on("SIGTERM", onShutdown);

    cache.clear();

    await new Promise<void>((resolve) => {
      const unsub = session.subscribe((event) => {
        if (event.type === "agent_end") {
          unsub();
          resolve();
        }
      });
      void session.prompt(prompt);
    });

    ipc.writeTrace(collector.getTrace());
    console.log(`IPC dir: ${ipcDir}`);
    console.log("Session complete. Trace written.");

    collector.dispose();
    session.dispose();
    rmSync(openCandleHome, { recursive: true, force: true });
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ipc.writeError(message);
    console.error("Harness error:", message);
    if (collector) collector.dispose();
    rmSync(openCandleHome, { recursive: true, force: true });
    process.exit(1);
  }
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
