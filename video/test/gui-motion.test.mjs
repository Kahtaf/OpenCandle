import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const motion = JSON.parse(
  readFileSync(resolve(here, "../motion/gui-interaction.json"), "utf8"),
);
const guiSource = readFileSync(
  resolve(here, "../src/surfaces/GuiSurface.tsx"),
  "utf8",
);

test("GUI interaction follows the actual application flow", () => {
  const e = motion.events;
  assert.ok(e.composerClick < e.typingStart);
  assert.ok(e.typingEnd < e.sendClick);
  assert.ok(e.sendClick < e.messageIn);
  assert.ok(e.messageIn < e.researchReady);
  assert.ok(e.researchReady < e.researchClick);
  assert.ok(e.researchClick < e.drawerOpenEnd);
  assert.ok(e.drawerOpenEnd < e.chartHoverStart);
});

test("cursor travel happens in short bursts instead of slow drifts", () => {
  for (const move of motion.cursorMoves) {
    assert.ok(move.to - move.from <= 14, `${move.id} is slower than 14 frames`);
    assert.ok(move.to > move.from, `${move.id} must have a positive duration`);
  }
});

test("the desktop research drawer matches the app's quick slide-in", () => {
  const openFrames = motion.events.drawerOpenEnd - motion.events.researchClick;
  assert.ok(openFrames >= 6 && openFrames <= 12);
});

test("the standalone interaction has enough hold time to inspect the chart", () => {
  assert.ok(motion.durationFrames - motion.events.chartHoverEnd >= 45);
});

test("camera pushes in decisively around GUI work areas", () => {
  assert.ok(Math.max(...motion.camera.zoom) >= 1.22);
  assert.equal(motion.camera.frames.length, motion.camera.zoom.length);
  assert.equal(motion.camera.frames.length, motion.camera.x.length);
  assert.equal(motion.camera.frames.length, motion.camera.y.length);
});

test("GUI displays the selected model", () => {
  assert.equal(motion.modelLabel, "gpt-6");
});

test("the focused GUI clip is slowed by fifty percent", () => {
  assert.equal(motion.timeScale, 1.5);
  assert.ok(motion.durationFrames >= 450);
  assert.equal(motion.events.chartHoverStart, 279);
});

test("the chart camera holds steady while the price chart is inspected", () => {
  const {chartHoverStart, chartCameraHoldEnd} = motion.events;
  const zooms = motion.camera.frames
    .map((frame, index) => ({frame, zoom: motion.camera.zoom[index]}))
    .filter(({frame}) => frame >= chartHoverStart && frame <= chartCameraHoldEnd)
    .map(({zoom}) => zoom);

  assert.ok(zooms.length >= 3);
  assert.equal(new Set(zooms).size, 1);
});

test("chart endpoint labels are stable HTML instead of SVG text", () => {
  assert.match(guiSource, /data-chart-axis-label="latest"/);
  assert.doesNotMatch(guiSource, /<text[^>]*>Latest<\/text>/);
});

test("research drawer scroll follows chart inspection", () => {
  const e = motion.events;
  assert.ok(e.chartCameraHoldEnd < e.researchScrollStart);
  assert.ok(e.researchScrollStart < e.researchScrollEnd);
  assert.ok(e.researchScrollEnd < e.researchScrollHoldEnd);
  assert.ok(motion.researchScroll.offsetEnd >= 400);
});

test("scroll interaction has mouse movement and a tighter camera", () => {
  const scrollMoves = motion.cursorMoves.filter(({id}) => id.includes("scroll"));
  assert.ok(scrollMoves.length >= 2);
  const scrollZooms = motion.camera.frames
    .map((frame, index) => ({frame, zoom: motion.camera.zoom[index]}))
    .filter(({frame}) => frame >= motion.events.researchScrollStart && frame <= motion.events.researchScrollHoldEnd)
    .map(({zoom}) => zoom);
  assert.ok(Math.max(...scrollZooms) >= 1.28);
});

test("scrolled research content includes technical and options visuals", () => {
  assert.match(guiSource, /data-research-card="rsi"/);
  assert.match(guiSource, /data-research-card="options-interest"/);
  assert.doesNotMatch(guiSource, /data-research-scroll-thumb/);
});

test("research drawer uses the same tool sequence and source treatment as the app", () => {
  for (const label of [
    "Stock quote",
    "Company overview",
    "Technical indicators",
    "Web search",
    "Options chain",
  ]) {
    assert.match(guiSource, new RegExp(label));
  }
  assert.match(guiSource, /humilitas\.org/);
  assert.match(guiSource, /bitrss\.com/);
  assert.match(guiSource, /1618arts\.com/);
  assert.match(guiSource, /\+6 sources/);
});

test("technical renderer mirrors the app's price, RSI, and MACD panes", () => {
  for (const label of ["Close", "SMA(20)", "SMA(50)", "Bollinger", "RSI(14)", "MACD", "Signal", "Histogram"]) {
    assert.match(guiSource, new RegExp(label.replace(/[()]/g, "\\$&")));
  }
  assert.match(guiSource, /data-research-chart="price"/);
  assert.match(guiSource, /data-research-chart="rsi"/);
  assert.match(guiSource, /data-research-chart="macd"/);
  assert.match(guiSource, /Recorded values · illustrative chart/);
});

test("options renderer mirrors the app's stack bar, money tiles, and contract lists", () => {
  for (const label of ["Calls 115.9K", "Puts 81.0K", "Put/Call ratio", "AVG IV", "CALL CONTRACTS", "PUT CONTRACTS", "TOTAL VOLUME", "OTM CALLS", "OTM PUTS"]) {
    assert.match(guiSource, new RegExp(label.replace("/", "\\/")));
  }
  assert.match(guiSource, /data-options-stack-bar/);
  assert.match(guiSource, /Expiration Jul 17/);
  assert.doesNotMatch(guiSource, /Expiration Jul 16/);
});

test("frozen research values are identified as a recorded demo", () => {
  assert.match(guiSource, /Recorded demo/);
  assert.match(guiSource, /Recorded 2026-07-04 · 06:31 ET/);
});

test("recorded browser evidence does not present missing values or unsupported conclusions", () => {
  assert.match(guiSource, /\["AVG VOLUME", "Unavailable"\]/);
  assert.match(guiSource, /Price sits below SMA\(20\) and SMA\(50\)/);
  assert.match(guiSource, /verify portfolio concentration before sizing/);
  assert.doesNotMatch(guiSource, /Adds diversification beyond AAPL and TSLA/);
  assert.doesNotMatch(guiSource, /Valuation favors a gradual entry/);
});

test("the replica removes invented research cards that do not exist in the app", () => {
  assert.doesNotMatch(guiSource, /Normalized trend/);
  assert.doesNotMatch(guiSource, /Normalized by moneyness/);
  assert.doesNotMatch(guiSource, /Business snapshot/);
  assert.doesNotMatch(guiSource, /Options open interest/);
  assert.doesNotMatch(guiSource, /title="Correlation"/);
});

test("research stays working until the drawer scroll is complete", () => {
  const e = motion.events;
  assert.ok(e.researchScrollHoldEnd <= e.researchComplete);
  assert.ok(e.researchComplete < e.finalTypingStart);
  assert.ok(e.finalTypingStart < e.finalTypingEnd);
  assert.ok(e.finalTypingEnd < motion.durationFrames);
});

test("the UI exposes loading and typed-result states", () => {
  assert.match(guiSource, /data-research-status="working"/);
  assert.match(guiSource, /data-final-answer/);
  assert.match(guiSource, /Working…/);
});
