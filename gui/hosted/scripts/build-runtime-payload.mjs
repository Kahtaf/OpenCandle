import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { auditRuntimeComposition } from "./runtime-composition.mjs";

const hostedRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(hostedRoot, "public/runtime");

const result = await build({
  entryPoints: [resolve(hostedRoot, "runtime/server.ts")],
  bundle: true,
  format: "esm",
  splitting: true,
  platform: "node",
  target: "node22",
  outdir: outputDirectory,
  entryNames: "runtime-bundle",
  chunkNames: "runtime-[name]-[hash]",
  outExtension: { ".js": ".mjs" },
  write: false,
  metafile: true,
  sourcemap: false,
  legalComments: "none",
  minify: true,
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  plugins: [
    {
      name: "hosted-pi-child-process-boundary",
      setup(build) {
        build.onResolve({ filter: /^(?:node:)?child_process$/ }, () => ({
          path: resolve(hostedRoot, "runtime/node-child-process-browser.ts"),
        }));
        build.onResolve({ filter: /^sql\.js$/ }, () => ({
          path: resolve(hostedRoot, "runtime/sqljs-webcontainer.ts"),
        }));
        build.onResolve({ filter: /^@earendil-works\/pi-ai$/ }, () => ({
          path: resolve(hostedRoot, "runtime/pi-ai-browser.ts"),
        }));
        build.onResolve({ filter: /^@earendil-works\/pi-ai\/providers\/all$/ }, () => ({
          path: resolve(hostedRoot, "runtime/pi-provider-catalog-browser.ts"),
        }));
        build.onResolve({ filter: /(?:^|\/)child-process\.js$/ }, (args) => {
          if (!args.resolveDir.includes("@earendil-works/pi-coding-agent")) return;
          return {
            path: resolve(hostedRoot, "runtime/pi-child-process-browser.ts"),
          };
        });
        build.onResolve({ filter: /(?:^|\/)open-url\.js$/ }, (args) => {
          if (!args.resolveDir.includes("/src/onboarding")) return;
          return {
            path: resolve(hostedRoot, "runtime/open-url-browser.ts"),
          };
        });
      },
    },
  ],
  alias: {
    undici: resolve(hostedRoot, "runtime/undici-browser.ts"),
    "safe-buffer": resolve(hostedRoot, "runtime/safer-buffer-browser.ts"),
    "safer-buffer": resolve(hostedRoot, "runtime/safer-buffer-browser.ts"),
    "@earendil-works/pi-coding-agent": resolve(
      hostedRoot,
      "runtime/pi-coding-agent-browser.ts",
    ),
    "@earendil-works/pi-ai/compat": resolve(
      hostedRoot,
      "runtime/pi-ai-compat-browser.ts",
    ),
  },
});

const outputs = result.outputFiles.filter((file) => file.path.endsWith(".mjs"));
const entry = outputs.find((file) => file.path.endsWith("/runtime-bundle.mjs"));
if (!entry) throw new Error("esbuild did not produce the runtime entry payload");
const output = outputs.map((file) => file.text).join("\n");

const audit = auditRuntimeComposition({
  output,
  metafile: result.metafile,
  sensitiveValues: [
    process.env.OPENAI_API_KEY,
    process.env.GEMINI_API_KEY,
    process.env.ANTHROPIC_API_KEY,
  ],
  // Canonical Pi AgentSession includes compaction, command dispatch, model
  // switching, and retry lifecycle code that the former hosted shim omitted.
  maxBytes: 10_000_000,
});

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
for (const file of outputs) {
  await writeFile(resolve(outputDirectory, file.path.split("/").at(-1)), file.text, "utf8");
}
const runtimeFiles = outputs.map((file) => file.path.split("/").at(-1)).sort();
await writeFile(
  resolve(outputDirectory, "runtime-files.json"),
  JSON.stringify({ version: 1, entry: "runtime-bundle.mjs", files: runtimeFiles }),
  "utf8",
);
await copyFile(
  resolve(hostedRoot, "../../node_modules/sql.js/dist/sql-wasm.js"),
  resolve(outputDirectory, "sql-wasm.cjs"),
);
await copyFile(
  resolve(hostedRoot, "../../node_modules/sql.js/dist/sql-wasm.wasm"),
  resolve(outputDirectory, "sql-wasm.wasm"),
);

process.stdout.write(
  `Built ${runtimeFiles.length} runtime modules (${audit.bytes} bytes total; ${Buffer.byteLength(entry.text)} byte entry)\n`,
);
