const SUPPORTED_NODE_MAJOR = 22;

export function getUnsupportedNodeVersionMessage(version: string = process.versions.node): string | null {
  const major = Number(version.split(".")[0]);
  if (major === SUPPORTED_NODE_MAJOR) return null;

  return `OpenCandle requires Node ${SUPPORTED_NODE_MAJOR}.x. Current Node is ${version}. Run \`nvm use\` from the repo root, then reinstall dependencies with \`npm install\`.`;
}

export function assertSupportedNodeVersion(version?: string): void {
  const message = getUnsupportedNodeVersionMessage(version);
  if (message) throw new Error(message);
}

assertSupportedNodeVersion();
