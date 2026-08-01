import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { auditRuntimeComposition } from "./runtime-composition.mjs";

const hostedRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputFile = resolve(hostedRoot, "public/runtime/runtime-bundle.mjs");

const result = await build({
  entryPoints: [resolve(hostedRoot, "runtime/server.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  write: false,
  metafile: true,
  sourcemap: false,
  legalComments: "none",
  minify: true,
  plugins: [
    {
      name: "hosted-pi-child-process-boundary",
      setup(build) {
        build.onResolve({ filter: /^sql\.js$/ }, () => ({
          path: resolve(hostedRoot, "runtime/sqljs-webcontainer.ts"),
        }));
        build.onResolve({ filter: /^@earendil-works\/pi-ai$/ }, () => ({
          path: resolve(hostedRoot, "runtime/pi-ai-browser.ts"),
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

const output = result.outputFiles[0]?.text;
if (!output) throw new Error("esbuild did not produce the runtime payload");

const audit = auditRuntimeComposition({
  output,
  metafile: result.metafile,
  sensitiveValues: [
    process.env.OPENAI_API_KEY,
    process.env.GEMINI_API_KEY,
    process.env.ANTHROPIC_API_KEY,
  ],
  maxBytes: 4_000_000,
});

await mkdir(dirname(outputFile), { recursive: true });
await writeFile(outputFile, output, "utf8");
await copyFile(
  resolve(hostedRoot, "../../node_modules/sql.js/dist/sql-wasm.js"),
  resolve(hostedRoot, "public/runtime/sql-wasm.cjs"),
);
await copyFile(
  resolve(hostedRoot, "../../node_modules/sql.js/dist/sql-wasm.wasm"),
  resolve(hostedRoot, "public/runtime/sql-wasm.wasm"),
);

process.stdout.write(`Built ${outputFile} (${audit.bytes} bytes)\n`);
