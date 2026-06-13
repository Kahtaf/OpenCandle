/**
 * Dogfood wrapper: same as tests/harness/cli.ts `run`, but uses the REAL
 * ~/.opencandle home (seeded market state) instead of a temp dir, and does
 * NOT delete the home dir on exit. Use tests/harness/cli.ts for
 * wait/answer/trace (they only touch the ipc dir).
 *
 * Usage: npx tsx dogfood-output/cli-real-home.ts run --prompt "..." --ipc <dir> [--timeout <ms>]
 */
import { SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createOpenCandleSession } from "../src/index.js";
import { cache } from "../src/infra/cache.js";
import { IpcChannel } from "../tests/harness/ipc.js";
import { createIpcAskHandler } from "../tests/harness/ipc-ask-handler.js";
import { createTraceCollector } from "../tests/harness/trace-collector.js";
import type { CustomEntryTrace } from "../tests/harness/types.js";

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

if (subcommand !== "run") {
  console.error("Only `run` is supported; use tests/harness/cli.ts for wait/answer/trace");
  process.exit(1);
}

const prompt = args.prompt;
if (!prompt) {
  console.error("--prompt is required");
  process.exit(1);
}

const ipcDir = args.ipc;
if (!ipcDir) {
  console.error("--ipc is required");
  process.exit(1);
}
const timeoutMs = args.timeout ? Number(args.timeout) : 300_000;

mkdirSync(ipcDir, { recursive: true });
const ipc = new IpcChannel(ipcDir);
ipc.writePid();
ipc.setStatus("running");

// Point at the REAL seeded home. Never delete it.
process.env.OPENCANDLE_HOME = join(homedir(), ".opencandle");

let collector: ReturnType<typeof createTraceCollector> | null = null;

try {
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

  let shutdownRequested = false;
  const onShutdown = () => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    console.error("Shutdown requested, writing partial trace...");
    if (collector) {
      ipc.writeTrace({
        ...collector.getTrace(),
        customEntries: drainOpenCandleCustomEntries(session.sessionManager),
      });
    }
    session.dispose();
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

  ipc.writeTrace({
    ...collector.getTrace(),
    customEntries: drainOpenCandleCustomEntries(session.sessionManager),
  });
  console.log(`IPC dir: ${ipcDir}`);
  console.log("Session complete. Trace written.");

  collector.dispose();
  session.dispose();
  process.exit(0);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  ipc.writeError(message);
  console.error("Harness error:", message);
  if (collector) collector.dispose();
  process.exit(1);
}

function drainOpenCandleCustomEntries(
  sessionManager: { getEntries(): Array<Record<string, unknown>> },
): CustomEntryTrace[] {
  return sessionManager
    .getEntries()
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
    }));
}
