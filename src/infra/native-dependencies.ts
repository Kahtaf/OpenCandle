export function getNativeDependencyErrorMessage(error: unknown, dependencyName: string): string | null {
  const message = error instanceof Error ? error.message : String(error);
  if (
    !message.includes("NODE_MODULE_VERSION") &&
    !message.includes("was compiled against a different Node.js version")
  ) {
    return null;
  }

  return `${dependencyName} native binding was built for a different Node ABI than the active Node ${process.versions.node}. ` +
    `Run \`npm rebuild ${dependencyName}\` or reinstall dependencies under the active Node with \`npm install\`.`;
}
