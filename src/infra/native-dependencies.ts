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

export async function rebuildNativeDependency(dependencyName: string): Promise<void> {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const { spawn } = await import("node:child_process");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(npmCommand, ["rebuild", dependencyName], {
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
