import {mkdirSync, readFileSync} from "node:fs";
import {resolve} from "node:path";
import {spawnSync} from "node:child_process";

const projectRoot = process.cwd();
const pipeline = JSON.parse(
  readFileSync(resolve(projectRoot, "pipeline/launch-pipeline.json"), "utf8"),
);
const args = new Set(process.argv.slice(2));

const run = (command, commandArgs) => {
  const result = spawnSync(command, commandArgs, {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

if (args.has("--regenerate-voice")) {
  run(process.execPath, ["scripts/generate-voiceover.mjs"]);
  run(process.execPath, ["scripts/transcribe-voiceover.mjs"]);
}

run(process.execPath, ["--test", "test/pipeline.test.mjs"]);
run(process.execPath, ["scripts/validate-pipeline.mjs", "--require-staged"]);
run("npx", ["eslint", "src"]);
run("npx", ["tsc", "--noEmit"]);

mkdirSync(resolve(projectRoot, "stills/pipeline"), {recursive: true});
for (const beat of pipeline.beats) {
  run("npx", [
    "remotion",
    "still",
    pipeline.compositionId,
    `stills/pipeline/${beat.id}.png`,
    `--frame=${beat.qaFrame}`,
  ]);
}

if (!args.has("--stills-only")) {
  run("npx", [
    "remotion",
    "render",
    pipeline.compositionId,
    "out/opencandle-release-pipeline.mp4",
    "--codec=h264",
    "--crf=18",
    "--audio-codec=aac",
  ]);
  run(process.execPath, ["scripts/build-review-page.mjs"]);
}
