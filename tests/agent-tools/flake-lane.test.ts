import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatFlakeSummary, parseFlakeLaneArgs, runFlakeLane } from "../../scripts/flake-lane.mjs";

// User contract: the advisory flake lane repeats one gate-policy step N times,
// sequentially and without retry, and reports an honest pass count plus the
// first failure's log. A lane that retried, stopped early, or hid failures
// would let a flake keep forcing reruns on unrelated PRs (#209).

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "flake-lane-test-"));
  tempRoots.push(root);
  return root;
}

const policy = {
  core: ["test"],
  full: ["test", "test:gui:hosted"],
  release: ["test", "test:gui:hosted"],
};

// Stub step: prints which run it is and where its TMPDIR points, records every
// invocation, then passes or fails according to the mode.
const STUB = `
const { appendFileSync } = require("node:fs");
const [mode, ledger] = process.argv.slice(1);
const run = Number(process.env.OPENCANDLE_FLAKE_RUN);
appendFileSync(ledger, JSON.stringify({ run, tmp: process.env.TMPDIR }) + "\\n");
console.log("stub run " + run + " mode " + mode);
const fail = mode === "fail" || (mode === "alternate" && run % 2 === 0);
if (fail) { console.error("stub failure on run " + run); process.exit(3); }
`;

function stubInvoke(mode: string, ledger: string) {
  return () => ({ command: process.execPath, args: ["-e", STUB, mode, ledger] });
}

function readLedger(ledger: string) {
  return readFileSync(ledger, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { run: number; tmp: string });
}

async function lane(mode: string, runs: number) {
  const root = tempRoot();
  const ledger = join(root, "ledger.jsonl");
  const result = await runFlakeLane({
    suite: "test:gui:hosted",
    runs,
    policy,
    outRoot: join(root, "out"),
    invoke: stubInvoke(mode, ledger),
    log: () => {},
    echo: false,
  });
  return { result, ledger, root };
}

describe("parseFlakeLaneArgs", () => {
  it("parses the suite, run count, and pass-through step arguments", () => {
    expect(
      parseFlakeLaneArgs(["--suite", "test", "--runs", "3", "--", "--sequence.shuffle"]),
    ).toEqual({ suite: "test", runs: 3, args: ["--sequence.shuffle"] });
  });

  it("rejects a missing suite or an unbounded run count", () => {
    expect(() => parseFlakeLaneArgs(["--runs", "3"])).toThrow(/--suite/);
    expect(() => parseFlakeLaneArgs(["--suite", "test", "--runs", "0"])).toThrow(/--runs/);
    expect(() => parseFlakeLaneArgs(["--suite", "test", "--runs", "abc"])).toThrow(/--runs/);
    expect(() => parseFlakeLaneArgs(["--suite", "test", "--runs", "101"])).toThrow(/--runs/);
  });
});

describe("runFlakeLane", () => {
  it("only repeats steps that the gate policy already owns", async () => {
    await expect(
      runFlakeLane({
        suite: "lint",
        runs: 1,
        policy,
        invoke: stubInvoke("pass", "x"),
        log: () => {},
      }),
    ).rejects.toThrow(/gate policy/);
  });

  it("reports N/N passes and writes no failure log when every run passes", async () => {
    const { result, ledger } = await lane("pass", 3);

    expect(result.passes).toBe(3);
    expect(result.failures).toBe(0);
    expect(result.results.map((run) => run.status)).toEqual([0, 0, 0]);
    expect(readLedger(ledger).map((entry) => entry.run)).toEqual([1, 2, 3]);
    expect(existsSync(join(result.reportDir, "first-failure.log"))).toBe(false);
    const summary = JSON.parse(readFileSync(join(result.reportDir, "summary.json"), "utf8"));
    expect(summary).toMatchObject({ suite: "test:gui:hosted", runs: 3, passes: 3, failures: 0 });
  });

  it("reports N/N failures for an always-failing step without retrying or stopping early", async () => {
    const { result, ledger } = await lane("fail", 4);

    expect(result.passes).toBe(0);
    expect(result.failures).toBe(4);
    expect(result.results.map((run) => run.status)).toEqual([3, 3, 3, 3]);
    // Exactly one invocation per run: no retry-until-green.
    expect(readLedger(ledger).map((entry) => entry.run)).toEqual([1, 2, 3, 4]);
    const firstFailure = readFileSync(join(result.reportDir, "first-failure.log"), "utf8");
    expect(firstFailure).toContain("stub failure on run 1");
    expect(firstFailure).not.toContain("run 2");
  });

  it("detects an intermittent step over repeated runs and keeps the first failure's log", async () => {
    const { result } = await lane("alternate", 10);

    expect(result.passes).toBe(5);
    expect(result.failures).toBe(5);
    expect(result.results.filter((run) => run.status !== 0).map((run) => run.run)).toEqual([
      2, 4, 6, 8, 10,
    ]);
    const firstFailure = readFileSync(join(result.reportDir, "first-failure.log"), "utf8");
    expect(firstFailure).toContain("stub failure on run 2");
    const summary = JSON.parse(readFileSync(join(result.reportDir, "summary.json"), "utf8"));
    expect(summary.firstFailedRun).toBe(2);
  });

  it("gives every run its own TMPDIR so repeated runs cannot share state", async () => {
    const { ledger } = await lane("pass", 3);

    const tmps = readLedger(ledger).map((entry) => entry.tmp);
    expect(new Set(tmps).size).toBe(3);
    for (const tmp of tmps) expect(tmp).toContain("opencandle-flake-");
  });
});

describe("formatFlakeSummary", () => {
  it("renders the per-suite pass count for the step summary", async () => {
    const { result } = await lane("alternate", 4);
    const markdown = formatFlakeSummary(result);
    expect(markdown).toContain("test:gui:hosted");
    expect(markdown).toContain("2/4 passed");
    expect(markdown).toContain("first failure: run 2");
  });
});
