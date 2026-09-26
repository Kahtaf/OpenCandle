import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findEnvKeys, getProviders } from "@earendil-works/pi-ai/compat";
import { PROVIDERS } from "../../../src/onboarding/providers.js";

/**
 * Every environment variable that could hand the isolated GUI server a
 * credential, blanked so the lane always starts from a genuinely cold home.
 *
 * The list is derived, never typed out: a hand-written list silently stops
 * covering the run the day a contributor puts a provider key in their `.env`,
 * because Pi's model registry accepts every provider it knows. Pi's
 * `findEnvKeys` reports only variables that are already set, so probe it with a
 * recording proxy that answers every lookup; keyed data providers come from
 * OpenCandle's own provider registry for the same reason.
 */
export function blankedCredentialEnv(): Record<string, string> {
  const names = new Set<string>();
  const probe = new Proxy({} as Record<string, string>, {
    get: (_target, property) => {
      if (typeof property !== "string") return undefined;
      names.add(property);
      return "probe";
    },
  });
  for (const provider of getProviders()) findEnvKeys(provider, probe);
  for (const descriptor of PROVIDERS) {
    if (descriptor.kind === "api-key") names.add(descriptor.envVar);
  }
  return Object.fromEntries([...names].map((name) => [name, ""]));
}

/**
 * Child environment for the isolated GUI server. Every home-derived state
 * location is pointed into the throwaway home, including the ones a developer
 * shell may set explicitly: Pi resolves its agent dir (auth.json, models.json,
 * settings) from PI_CODING_AGENT_DIR before HOME, and its session dir from
 * PI_CODING_AGENT_SESSION_DIR, so inheriting either would read real host
 * state. USERPROFILE is Node's home on Windows. Explicit `overrides` still win.
 */
export function isolatedGuiServerEnv(options: {
  homeDir: string;
  port: number;
  overrides?: Record<string, string>;
  parentEnv?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  const home = join(options.homeDir, "home");
  return {
    ...(options.parentEnv ?? process.env),
    HOME: home,
    USERPROFILE: home,
    OPENCANDLE_HOME: join(options.homeDir, "opencandle"),
    PI_CODING_AGENT_DIR: join(home, ".pi", "agent"),
    PI_CODING_AGENT_SESSION_DIR: "",
    OPENCANDLE_GUI_HOST: "127.0.0.1",
    OPENCANDLE_GUI_PORT: String(options.port),
    ...blankedCredentialEnv(),
    ...options.overrides,
  };
}

export interface IsolatedGuiServer {
  baseUrl: string;
  port: number;
  homeDir: string;
  child: ChildProcessWithoutNullStreams;
  log(): string;
  /** Kills the server process group, waits for exit, and removes the temp home. */
  stop(): Promise<void>;
}

export interface StartIsolatedGuiServerOptions {
  cwd: string;
  /** Override the temporary home so a test can assert it was removed. */
  homeDir?: string;
  /** Override the OS-allocated port, e.g. to pin a port that is already taken. */
  port?: number;
  /** How long `/health` may stay unhealthy before failing and cleaning up. */
  healthTimeoutMs?: number;
  /** Extra environment merged after the isolation baseline. */
  env?: Record<string, string>;
  /** Observes the child as soon as it is spawned so a test can capture its pid. */
  onSpawn?: (child: ChildProcessWithoutNullStreams, homeDir: string) => void;
}

/**
 * Start the real local GUI server against a throwaway HOME/OPENCANDLE_HOME on
 * an OS-allocated port, with every model and provider credential blanked.
 *
 * The server runs directly under `node --import tsx` rather than through
 * `npm run gui`: npm and the tsx bin are wrapper processes, and killing the
 * wrapper does not reliably stop the server it spawned. `detached` puts the
 * server in its own process group so teardown can signal the whole tree.
 *
 * On any startup failure the child group is killed and the temporary home is
 * removed before the original error is rethrown. `stop()` does the same after
 * the suite and throws if the child will not die or the home is not removed.
 */
export async function startIsolatedGuiServer(
  options: StartIsolatedGuiServerOptions,
): Promise<IsolatedGuiServer> {
  const entry = join(options.cwd, "gui", "server", "server.ts");
  const webDist = join(options.cwd, "gui", "web", "dist", "index.html");
  if (!existsSync(webDist)) {
    throw new Error(
      `GUI web assets are missing at ${webDist}; run \`npm run gui:web:build\` before this suite.`,
    );
  }

  const homeDir = options.homeDir ?? mkdtempSync(join(tmpdir(), "opencandle-gui-integration-"));
  const port = options.port ?? (await allocatePort());
  const baseUrl = `http://127.0.0.1:${port}`;
  const healthTimeoutMs = options.healthTimeoutMs ?? 45_000;
  let log = "";
  let spawnError: Error | undefined;

  const child = spawn(process.execPath, ["--import", "tsx", entry], {
    cwd: options.cwd,
    env: isolatedGuiServerEnv({ homeDir, port, overrides: options.env }),
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  child.stdout.on("data", (chunk) => {
    log += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    log += chunk.toString();
  });
  child.on("error", (error) => {
    spawnError = error;
  });
  options.onSpawn?.(child, homeDir);

  try {
    await waitForHealth(`${baseUrl}/health`, () => log, {
      timeoutMs: healthTimeoutMs,
      spawnError: () => spawnError,
    });
  } catch (error) {
    try {
      await teardown(child, homeDir);
    } catch (teardownError) {
      throw new AggregateError(
        [error, teardownError],
        "GUI server failed to start and its cleanup also failed",
      );
    }
    throw error;
  }

  let stopped = false;
  return {
    baseUrl,
    port,
    homeDir,
    child,
    log: () => log,
    async stop() {
      if (stopped) return;
      stopped = true;
      await teardown(child, homeDir);
    },
  };
}

/** Kill the whole server process group, wait for exit, then remove its home. */
async function teardown(child: ChildProcessWithoutNullStreams, homeDir: string): Promise<void> {
  const exited = await terminate(child);
  if (!exited) {
    throw new Error(`Isolated GUI server child ${child.pid ?? "?"} did not exit after SIGKILL`);
  }
  rmSync(homeDir, { recursive: true, force: true });
  if (existsSync(homeDir)) {
    throw new Error(`Isolated GUI temporary home was not removed: ${homeDir}`);
  }
}

/**
 * SIGTERM the process group, wait, then SIGKILL and wait again. Returns true
 * only once the direct child AND every remaining member of its process group
 * are gone. A child that never spawned (no pid) needs no signalling.
 */
async function terminate(child: ChildProcessWithoutNullStreams): Promise<boolean> {
  if (!child.pid) return true;
  signalProcessGroup(child, "SIGTERM");
  await waitForExit(child, 5_000);
  if (!(await waitForProcessGroupExit(child.pid, 2_000))) {
    signalProcessGroup(child, "SIGKILL");
    await waitForProcessGroupExit(child.pid, 5_000);
  }
  return !isProcessGroupAlive(child.pid);
}

/** Resolves true once no process in the detached group remains alive. */
export async function waitForProcessGroupExit(pid: number, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessGroupAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isProcessGroupAlive(pid);
}

function signalProcessGroup(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    if (signal === "SIGKILL") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill(signal);
    }
    return;
  }
  try {
    // Negative pid signals the detached process group led by the server.
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process is already gone.
    }
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** True while any process in the detached server group is still alive. */
export function isProcessGroupAlive(pid: number): boolean {
  if (process.platform === "win32") return isProcessAlive(pid);
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function allocatePort(): Promise<number> {
  const server = createNetServer();
  return new Promise((resolve, reject) => {
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

export async function waitForHealth(
  url: string,
  log: () => string,
  options: { timeoutMs?: number; spawnError?: () => Error | undefined } = {},
): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 45_000);
  let lastError = "";
  while (Date.now() < deadline) {
    const spawnFailure = options.spawnError?.();
    if (spawnFailure) throw spawnFailure;
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`GUI server did not become healthy: ${lastError}\n${log()}`);
}

/** Resolves true once the child exits, false if the timeout elapses first. */
export function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs = 5_000,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let timer: NodeJS.Timeout;
    const onExit = () => {
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve(true);
    };
    timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

/**
 * Child environment for the GUI release-gate smoke (`npm run gui`): the
 * isolated GUI baseline over `smokeHome`, plus the model-key probe stub URL.
 */
export function releaseSmokeServerEnv(options: {
  smokeHome: string;
  port: number;
  probeBaseUrl: string;
  parentEnv?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  return isolatedGuiServerEnv({
    homeDir: options.smokeHome,
    port: options.port,
    parentEnv: options.parentEnv,
    overrides: { OPENCANDLE_MODEL_KEY_PROBE_BASE_URL: options.probeBaseUrl },
  });
}
