import { type ChildProcess, spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";

/**
 * Launches the unmodified GUI server child process for the journey:
 *   node --import tsx tests/support/gui-journey/gui-server-bootstrap.ts
 *
 * The child is detached into its own process group so the whole group can be
 * terminated on every success and failure path.
 */

export interface GuiServerProcess {
  child: ChildProcess;
  baseUrl: string;
  readLog(): string;
  stop(): Promise<void>;
}

export interface StartGuiServerOptions {
  cwd: string;
  bootstrapPath: string;
  port: number;
  env: NodeJS.ProcessEnv;
}

export async function allocatePort(): Promise<number> {
  const server = createNetServer();
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("Failed to allocate a local port"));
      });
    });
  });
}

export async function startGuiServer(options: StartGuiServerOptions): Promise<GuiServerProcess> {
  const child = spawn(process.execPath, ["--import", "tsx", options.bootstrapPath], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let log = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${options.port}`;
  const result: GuiServerProcess = {
    child,
    baseUrl,
    readLog: () => log,
    stop: () => stopProcessGroup(child),
  };
  try {
    await waitForHealth(`${baseUrl}/health`, () => result.readLog(), child);
  } catch (error) {
    await stopProcessGroup(child);
    throw error;
  }
  return result;
}

interface ChildStartupFailure {
  detail: string;
}

const LOG_TAIL_LIMIT = 4_000;

/** Bounds startup error output so a runaway child log cannot flood the caller. */
function boundedLogTail(log: string, limit = LOG_TAIL_LIMIT): string {
  return log.length > limit ? log.slice(-limit) : log;
}

export async function waitForHealth(
  url: string,
  log: () => string,
  child?: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError = "";
  let failure: ChildStartupFailure | null = null;

  const fail = (detail: string) => {
    failure ??= { detail };
  };
  const onError = (error: Error) => {
    fail(`process error: ${error.message}`);
  };
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    if (code !== null) fail(`exit code ${code}`);
    else if (signal !== null) fail(`signal ${signal}`);
    else fail("process exited");
  };
  child?.on("error", onError);
  child?.on("exit", onExit);
  // A child can exit before the listeners above attach; capture that here.
  if (child && child.exitCode !== null) onExit(child.exitCode, child.signalCode);
  else if (child && child.signalCode !== null) onExit(null, child.signalCode);

  try {
    while (Date.now() < deadline) {
      if (failure) throw startupFailure(failure, log());
      try {
        const response = await fetch(url);
        if (response.ok) return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (failure) throw startupFailure(failure, log());
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`GUI server did not become healthy: ${lastError}\n${boundedLogTail(log())}`);
  } finally {
    child?.off("error", onError);
    child?.off("exit", onExit);
  }
}

function startupFailure(failure: ChildStartupFailure, log: string): Error {
  return new Error(
    `GUI server exited before becoming healthy (${failure.detail})\n${boundedLogTail(log)}`,
  );
}

export async function stopProcessGroup(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    // Negative pid targets the detached child's whole process group.
    process.kill(-pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
