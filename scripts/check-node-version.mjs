const currentNodeVersion = process.versions.node;
const supportedNodeRange = "20.19+, 22.12+, or 24.x-26.x";

function isSupportedNodeVersion(version) {
  const [majorRaw, minorRaw] = version.split(".");
  const major = Number(majorRaw);
  const minor = Number(minorRaw);

  if (major === 20) return minor >= 19;
  if (major === 22) return minor >= 12;
  return major >= 24 && major < 27;
}

if (!isSupportedNodeVersion(currentNodeVersion)) {
  console.error(
    `OpenCandle supports Node ${supportedNodeRange}. Current Node is ${currentNodeVersion}.\n` +
      "Use a supported Node version; the repo default is Node 22.22.0 via `nvm use`.\n" +
      "After switching Node versions, reinstall dependencies under the active Node with `npm install` or rebuild native modules with `npm rebuild better-sqlite3`.",
  );
  process.exit(1);
}

function getNativeDependencyErrorMessage(error, dependencyName) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    !message.includes("NODE_MODULE_VERSION") &&
    !message.includes("was compiled against a different Node.js version")
  ) {
    return null;
  }

  return `${dependencyName} native binding was built for a different Node ABI than the active Node ${process.versions.node}.\n` +
    `Run \`npm rebuild ${dependencyName}\` or reinstall dependencies under the active Node with \`npm install\`.`;
}

try {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(":memory:");
  db.close();
} catch (error) {
  const message = getNativeDependencyErrorMessage(error, "better-sqlite3");
  if (message) {
    console.error(message);
    process.exit(1);
  }
  throw error;
}
