const SUPPORTED_NODE_RANGE = "22.22.2+ or 24.x-26.x";

function isSupportedNodeVersion(version: string): boolean {
  const [majorRaw, minorRaw, patchRaw] = version.split(".");
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  const patch = Number(patchRaw);

  if (major === 22) return minor > 22 || (minor === 22 && patch >= 2);
  return major >= 24 && major < 27;
}

export function getUnsupportedNodeVersionMessage(
  version: string = process.versions.node,
): string | null {
  if (isSupportedNodeVersion(version)) return null;

  return `OpenCandle supports Node ${SUPPORTED_NODE_RANGE}. Current Node is ${version}. Use Node ${SUPPORTED_NODE_RANGE}; the repo default is Node 22.22.0 via \`nvm use\`. After switching Node versions, reinstall dependencies under the active Node with \`npm install\` or rebuild native modules with \`npm rebuild better-sqlite3\`.`;
}

export function assertSupportedNodeVersion(version?: string): void {
  const message = getUnsupportedNodeVersionMessage(version);
  if (message) throw new Error(message);
}
