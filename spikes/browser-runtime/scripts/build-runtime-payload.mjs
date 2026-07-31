import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const spikeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputFile = resolve(spikeRoot, "src/generated/runtime-bundle.mjs");
const forbidden = ["better-sqlite3", "node:child_process", "twitter-cli", "rdt-cli"];

const result = await build({
  entryPoints: [resolve(spikeRoot, "runtime/server.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  write: false,
  metafile: true,
  sourcemap: false,
  legalComments: "none",
});

const output = result.outputFiles[0]?.text;
if (!output) throw new Error("esbuild did not produce the runtime payload");

const auditText = `${output}\n${JSON.stringify(result.metafile)}`.toLowerCase();
const found = forbidden.filter((token) => auditText.includes(token));
if (found.length > 0) {
  throw new Error(`Forbidden runtime dependencies found: ${found.join(", ")}`);
}

await mkdir(dirname(outputFile), { recursive: true });
await writeFile(outputFile, output, "utf8");

const bytes = Buffer.byteLength(output);
process.stdout.write(`Built ${outputFile} (${bytes} bytes)\n`);
