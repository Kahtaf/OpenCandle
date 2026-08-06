import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const template = await readFile(join(root, "public", "sw.js"), "utf8");
const assetFiles = (await walk(dist)).map((path) => ({
  path,
  publicPath: `/${relative(dist, path).replaceAll("\\", "/")}`,
}));
const shellFiles = assetFiles
  .filter(
    ({ publicPath: path }) =>
      !path.endsWith("/sw.js") && !path.startsWith("/runtime/") && path !== "/_headers",
  )
  .sort((left, right) => left.publicPath.localeCompare(right.publicPath));
const assets = shellFiles
  .map(({ publicPath }) => publicPath)
  .sort();
if (!assets.includes("/index.html")) throw new Error("Hosted build is missing index.html");
const fingerprintInput = await Promise.all(
  shellFiles.map(async ({ path, publicPath }) => [
    publicPath,
    createHash("sha256").update(await readFile(path)).digest("hex"),
  ]),
);
const fingerprint = createHash("sha256")
  .update(JSON.stringify(fingerprintInput))
  .digest("hex")
  .slice(0, 16);
const output = template
  .replaceAll("__OPENCANDLE_CACHE_NAME__", `opencandle-hosted-shell-${fingerprint}`)
  .replace("__OPENCANDLE_PRECACHE__", JSON.stringify(assets, null, 2));
await writeFile(join(dist, "sw.js"), output);

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}
