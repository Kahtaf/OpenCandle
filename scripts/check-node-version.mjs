const supportedNodeMajor = 22;
const currentNodeVersion = process.versions.node;
const currentNodeMajor = Number(currentNodeVersion.split(".")[0]);

if (currentNodeMajor !== supportedNodeMajor) {
  console.error(
    `OpenCandle requires Node ${supportedNodeMajor}.x. Current Node is ${currentNodeVersion}.\n` +
      "Run `nvm use` from the repo root, then reinstall dependencies with `npm install`.",
  );
  process.exit(1);
}
