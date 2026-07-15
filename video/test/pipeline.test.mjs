import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {dirname, resolve} from "node:path";
import {validatePipeline} from "../scripts/pipeline-validation.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const pipeline = JSON.parse(
  readFileSync(resolve(projectRoot, "pipeline/launch-pipeline.json"), "utf8"),
);

test("the OpenCandle launch pipeline is complete and renderable", () => {
  const result = validatePipeline(pipeline, {projectRoot});
  assert.deepEqual(result.errors, []);
  assert.equal(result.totalFrames, 2010);
  assert.equal(result.beats, 6);
  assert.equal(pipeline.audio.durationFrames, 1989);
});

test("the full launch uses the signed-off focused GUI and TUI renders", () => {
  assert.equal(
    pipeline.assets.gui.source,
    "public/approved/gui.mp4",
  );
  assert.equal(pipeline.assets.gui.durationFrames, 690);
  assert.equal(
    pipeline.assets.tui.source,
    "public/approved/tui.mp4",
  );
  assert.equal(
    pipeline.assets.dualGui.source,
    "public/approved/gui-final.png",
  );
  assert.equal(
    pipeline.assets.dualTui.source,
    "public/approved/tui-final.png",
  );

  const browserWorkflowBeat = pipeline.beats.find(
    (beat) => beat.id === "browser-question-and-trace",
  );
  assert.equal(browserWorkflowBeat.playbackRate, 1);
  assert.equal(browserWorkflowBeat.duration, pipeline.assets.gui.durationFrames);
});

test("each beat has exactly one narrative job", () => {
  const broken = structuredClone(pipeline);
  broken.beats[1].narrativeRole = "";

  const result = validatePipeline(broken, {projectRoot});
  assert.match(result.errors.join("\n"), /narrativeRole/);
});

test("visual coverage cannot contain gaps", () => {
  const broken = structuredClone(pipeline);
  broken.beats[2].from = broken.beats[1].from + broken.beats[1].duration + 1;

  const result = validatePipeline(broken, {projectRoot});
  assert.match(result.errors.join("\n"), /gap/);
});

test("on-screen copy stays intentionally sparse", () => {
  const broken = structuredClone(pipeline);
  broken.beats[4].onScreenText = "This is a long marketing sentence that nobody will read in a launch video";

  const result = validatePipeline(broken, {projectRoot});
  assert.match(result.errors.join("\n"), /onScreenText/);
});

test("audio duration must be a positive integer", () => {
  for (const durationFrames of [0, -1]) {
    const broken = structuredClone(pipeline);
    broken.audio.durationFrames = durationFrames;

    const result = validatePipeline(broken, {projectRoot});
    assert.match(result.errors.join("\n"), /audio\.durationFrames/);
  }
});

test("the browser is the primary flow and the CLI is the continuation surface", () => {
  const browserIndex = pipeline.beats.findIndex((beat) => beat.surface === "gui");
  const architectureIndex = pipeline.beats.findIndex((beat) => beat.surface === "architecture");
  const terminalIndex = pipeline.beats.findIndex((beat) => beat.surface === "tui");
  assert.ok(browserIndex >= 0);
  assert.ok(browserIndex < architectureIndex);
  assert.ok(architectureIndex > 0);
  assert.ok(terminalIndex > architectureIndex);
});
