import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const motion = JSON.parse(
  readFileSync(resolve(here, "../motion/tui-interaction.json"), "utf8"),
);

test("TUI camera zooms during typing and tool activity", () => {
  assert.ok(Math.max(...motion.camera.zoom) >= 1.22);
  assert.ok(motion.camera.frames.includes(motion.events.typingStart));
  assert.ok(motion.camera.frames.includes(motion.events.toolsStart));
});

test("TUI camera arrays stay aligned", () => {
  assert.equal(motion.camera.frames.length, motion.camera.zoom.length);
  assert.equal(motion.camera.frames.length, motion.camera.x.length);
  assert.equal(motion.camera.frames.length, motion.camera.y.length);
});

test("TUI displays the selected model", () => {
  assert.equal(motion.modelLabel, "gpt-6");
});
