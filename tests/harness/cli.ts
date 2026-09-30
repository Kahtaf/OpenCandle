/**
 * CLI entry point for the agent test harness.
 *
 * Usage:
 *   npx tsx tests/harness/cli.ts run    --prompt "..." --ipc <dir> [--timeout <ms>] [--settle-ms <ms>] [--linger <ms>]
 *   npx tsx tests/harness/cli.ts send   --prompt "..." --ipc <dir>
 *   npx tsx tests/harness/cli.ts wait   --ipc <dir> [--timeout <ms>]
 *   npx tsx tests/harness/cli.ts answer --ipc <dir> --value "..."
 *   npx tsx tests/harness/cli.ts trace  --ipc <dir>
 */

import { join } from "node:path";
import { INCOMPLETE_EXIT_CODE, runHarnessCli } from "./cli-run.js";
import { IpcChannel } from "./ipc.js";

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
  const { exitCode } = await runHarnessCli({
    prompt,
    ipcDir: args.ipc,
    timeoutMs: args.timeout ? Number(args.timeout) : undefined,
    settleMs: args["settle-ms"] ? Number(args["settle-ms"]) : undefined,
    lingerMs: args.linger ? Number(args.linger) : undefined,
    installSignalHandlers: true,
  });
  process.exit(exitCode);
}

async function cmdWait() {
  const ipcDir = args.ipc;
  if (!ipcDir) {
    console.error("--ipc is required");
    process.exit(1);
  }

  // Default to the longest `run` bound so `wait` never gives up on a run that
  // is still legitimately inside its own timeout.
  const timeoutMs = args.timeout ? Number(args.timeout) : 900_000;
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

    if (status === "incomplete") {
      const incomplete = IpcChannel.readIncomplete(ipcDir);
      const trace = IpcChannel.readTrace(ipcDir);
      console.log(
        JSON.stringify({
          status: "incomplete",
          ...incomplete,
          turns: trace?.turns.length ?? 0,
          toolSequence: trace?.toolSequence ?? [],
        }),
      );
      process.exit(INCOMPLETE_EXIT_CODE);
    }

    if (status === "running" && !IpcChannel.isRunAlive(ipcDir)) {
      console.error("Harness run process exited without completing (status still running).");
      process.exit(1);
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

  console.error(
    `Timeout waiting for harness after ${timeoutMs}ms (run status: ${IpcChannel.readStatus(ipcDir) ?? "missing"}).`,
  );
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
