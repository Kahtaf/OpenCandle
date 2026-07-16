import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {validatePipeline} from "./pipeline-validation.mjs";

const projectRoot = process.cwd();
const manifestPath = resolve(projectRoot, "pipeline/launch-pipeline.json");
const pipeline = JSON.parse(readFileSync(manifestPath, "utf8"));
const result = validatePipeline(pipeline, {
  projectRoot,
  requireStaged: process.argv.includes("--require-staged"),
});

if (result.errors.length > 0) {
  console.error(result.errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Pipeline valid: ${result.beats} beats, ${result.totalFrames} frames.`);
