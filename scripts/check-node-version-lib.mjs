import { spawn } from "node:child_process";

const supportedNodeRange = "22.22.2+ or 24.x-26.x";

export function isSupportedNodeVersion(version) {
  const [majorRaw, minorRaw, patchRaw] = version.split(".");
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  const patch = Number(patchRaw);

  if (major === 22) return minor > 22 || (minor === 22 && patch >= 2);
  return major >= 24 && major < 27;
}

export function getUnsupportedNodeVersionMessage(version = process.versions.node) {
  if (isSupportedNodeVersion(version)) return null;

  return (
    `OpenCandle supports Node ${supportedNodeRange}. Current Node is ${version}.\n` +
    "Use a supported Node version; the repo default is Node 22.22.0 via `nvm use`.\n" +
    "After switching Node versions, reinstall dependencies under the active Node with `npm install` or rebuild native modules with `npm rebuild better-sqlite3`."
  );
}

export function getNativeDependencyErrorMessage(
  error,
  dependencyName,
  nodeVersion = process.versions.node,
) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    !message.includes("NODE_MODULE_VERSION") &&
    !message.includes("was compiled against a different Node.js version")
  ) {
    return null;
  }

  return (
    `${dependencyName} native binding was built for a different Node ABI than the active Node ${nodeVersion}.\n` +
    `Run \`npm rebuild ${dependencyName}\` or reinstall dependencies under the active Node with \`npm install\`.`
  );
}

export async function rebuildNativeDependency(dependencyName) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

  await new Promise((resolve, reject) => {
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
}) {
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
