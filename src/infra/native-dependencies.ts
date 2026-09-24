import { existsSync } from "node:fs";
import { win32 } from "node:path";

export function getNativeDependencyErrorMessage(
  error: unknown,
  dependencyName: string,
): string | null {
  const message = error instanceof Error ? error.message : String(error);
  if (
    !message.includes("NODE_MODULE_VERSION") &&
    !message.includes("was compiled against a different Node.js version")
  ) {
    return null;
  }

  return (
    `${dependencyName} native binding was built for a different Node ABI than the active Node ${process.versions.node}. ` +
    `Run \`npm rebuild ${dependencyName}\` or reinstall dependencies under the active Node with \`npm install\`.`
  );
}

/**
 * Resolve how to invoke npm without a shell. POSIX uses the real `npm`
 * executable. Windows cannot spawn the `npm.cmd` shim under `shell: false`
 * (Node's .cmd/.bat hardening), so run npm's JavaScript entrypoint through
 * `process.execPath`. `npm_execpath` is preferred when present; the standard
 * Node install layout is the standalone fallback for runtimes that do not
 * inherit it (for example a globally installed OpenCandle CLI).
 */
function resolveNpmRunner(): { command: string; args: string[] } {
  if (process.platform !== "win32") {
    return { command: "npm", args: [] };
  }

  const candidates: string[] = [];
  if (process.env.npm_execpath) {
    candidates.push(process.env.npm_execpath);
  }
  candidates.push(
    win32.join(win32.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  );

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { command: process.execPath, args: [candidate] };
    }
  }

  throw new Error(
    `Cannot locate the npm JavaScript entrypoint on Windows; refusing to run the npm.cmd shim without a shell. Tried:\n- ${candidates.join("\n- ")}`,
  );
}

export async function rebuildNativeDependency(dependencyName: string): Promise<void> {
  const npm = resolveNpmRunner();
  const { spawn } = await import("node:child_process");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(npm.command, [...npm.args, "rebuild", dependencyName], {
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`npm rebuild ${dependencyName} failed with exit code ${code}.`));
    });
  });
}

export async function ensureNativeDependency({
  dependencyName,
  load,
  rebuild = rebuildNativeDependency,
  log = console.error,
}: {
  dependencyName: string;
  load: () => Promise<void>;
  rebuild?: (dependencyName: string) => Promise<void>;
  log?: (message: string) => void;
}): Promise<void> {
  try {
    await load();
    return;
  } catch (error) {
    const message = getNativeDependencyErrorMessage(error, dependencyName);
    if (!message) throw error;

    log(`${message}\nAttempting \`npm rebuild ${dependencyName}\` before continuing...`);
  }

  await rebuild(dependencyName);

  try {
    await load();
  } catch (error) {
    const message = getNativeDependencyErrorMessage(error, dependencyName);
    if (!message) throw error;

    throw new Error(
      `${message}\nAutomatic rebuild did not repair the native binding. Run \`npm install\` under Node ${process.versions.node} and retry.`,
    );
  }
}

export async function ensureOpenCandleNativeDependencies(): Promise<void> {
  await ensureNativeDependency({
    dependencyName: "better-sqlite3",
    async load() {
      const { default: Database } = await import("better-sqlite3");
      const db = new Database(":memory:");
      db.close();
    },
  });
}
