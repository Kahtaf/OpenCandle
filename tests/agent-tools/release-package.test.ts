import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const smokeScript = resolve(repoRoot, "scripts/packed-install-smoke.mjs");
const releasePackageScript = resolve(repoRoot, "scripts/release-package.mjs");

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function runCli(script: string, args: string[]) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function loadSmokeHelpers() {
  return (await import(pathToFileURL(smokeScript).href)) as {
    parseSmokeArgs: (args: string[]) => { tarball?: string; sha256?: string };
    assertUsableTarball: (path: string) => { isFile: () => boolean };
    sha256File: (path: string) => string;
    assertPackedManifestMatchesRoot: (
      expected: { name: string; version: string; exports?: Record<string, unknown> },
      actual: { name: string; version: string; exports?: Record<string, unknown> },
    ) => void;
    packFilenameFromJson: (output: string) => string;
  };
}

async function loadReleaseHelpers() {
  return (await import(pathToFileURL(releasePackageScript).href)) as {
    parseReleasePackageArgs: (args: string[]) => {
      command: string;
      out?: string;
      dir?: string;
    };
    buildPackageProof: (input: Record<string, unknown>) => Record<string, unknown>;
    evaluatePackageProof: (input: {
      proof: unknown;
      manifest: { name: string; version: string };
      headCommit: string;
      tarballSha256?: string;
      tarballStat?: { isFile: () => boolean; isSymbolicLink: () => boolean };
    }) => { ok: boolean; errors: string[] };
    resolveOutDir: (root: string, out: string) => string;
    assertCleanWorkingTree: (root: string) => void;
    assertHeadUnchanged: (root: string, expectedCommit: string) => void;
    resetGeneratedOutputDir: (dir: string) => void;
    commitPackageProof: (input: {
      dir: string;
      tarballName: string;
      proof: Record<string, unknown>;
    }) => Record<string, unknown>;
    runVerify: (input: { root: string; dir: string }) => Record<string, unknown>;
  };
}

describe("packed install smoke arguments", () => {
  it("defaults to the original pack-and-install mode with no arguments", async () => {
    const { parseSmokeArgs } = await loadSmokeHelpers();

    expect(parseSmokeArgs([])).toEqual({});
  });

  it("parses an explicit tarball and expected sha256", async () => {
    const { parseSmokeArgs } = await loadSmokeHelpers();
    const digest = "a".repeat(64);

    expect(parseSmokeArgs(["--tarball", "./out/pkg.tgz", "--sha256", digest])).toEqual({
      tarball: resolve(repoRoot, "out/pkg.tgz"),
      sha256: digest,
    });
  });

  it("rejects unknown arguments", async () => {
    const { parseSmokeArgs } = await loadSmokeHelpers();

    expect(() => parseSmokeArgs(["--bogus"])).toThrow(/unknown argument/i);
  });

  it("rejects a missing option value", async () => {
    const { parseSmokeArgs } = await loadSmokeHelpers();

    expect(() => parseSmokeArgs(["--tarball"])).toThrow(/requires a value/i);
  });

  it("rejects a non-64-hex sha256", async () => {
    const { parseSmokeArgs } = await loadSmokeHelpers();

    expect(() => parseSmokeArgs(["--tarball", "pkg.tgz", "--sha256", "abc123"])).toThrow(
      /64-character hex/i,
    );
  });

  it("requires the tarball and sha256 options together", async () => {
    const { parseSmokeArgs } = await loadSmokeHelpers();

    expect(() => parseSmokeArgs(["--tarball", "pkg.tgz"])).toThrow(/together/i);
  });

  it("exits nonzero for unknown CLI arguments", () => {
    const result = runCli(smokeScript, ["--bogus"]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/unknown argument/i);
  });
});

describe("packed install smoke tarball validation", () => {
  it("rejects a missing tarball", async () => {
    const { assertUsableTarball } = await loadSmokeHelpers();
    const missing = join(makeTempRoot("opencandle-smoke-"), "missing.tgz");

    expect(() => assertUsableTarball(missing)).toThrow(/not found/i);
  });

  it("refuses a symlinked tarball", async () => {
    const { assertUsableTarball } = await loadSmokeHelpers();
    const root = makeTempRoot("opencandle-smoke-");
    const real = join(root, "real.tgz");
    const link = join(root, "link.tgz");
    writeFileSync(real, "not a tarball");
    symlinkSync(real, link);

    expect(() => assertUsableTarball(link)).toThrow(/symlink/i);
  });

  it("refuses a non-.tgz file", async () => {
    const { assertUsableTarball } = await loadSmokeHelpers();
    const root = makeTempRoot("opencandle-smoke-");
    const file = join(root, "package.tar.gz");
    writeFileSync(file, "not a tarball");

    expect(() => assertUsableTarball(file)).toThrow(/\.tgz/i);
  });

  it("refuses a corrupt tarball before building or packing", () => {
    const root = makeTempRoot("opencandle-smoke-");
    const tarball = join(root, "corrupt.tgz");
    writeFileSync(tarball, "definitely not a real npm tarball");

    const result = runCli(smokeScript, ["--tarball", tarball, "--sha256", "0".repeat(64)]);

    expect(result.status).not.toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toMatch(/sha256 mismatch/i);
    // Explicit tarball mode must never build, prepare, or repack.
    expect(output).not.toMatch(/npm run prepare/);
    expect(output).not.toMatch(/npm pack/);
  });

  it("hashes the tarball contents", async () => {
    const { sha256File } = await loadSmokeHelpers();
    const root = makeTempRoot("opencandle-smoke-");
    const file = join(root, "pkg.tgz");
    writeFileSync(file, "hello");

    expect(sha256File(file)).toBe(sha256("hello"));
  });
});

describe("packed manifest comparison", () => {
  it("accepts a tarball whose name, version, and exports match the root manifest", async () => {
    const { assertPackedManifestMatchesRoot } = await loadSmokeHelpers();
    const manifest = {
      name: "opencandle",
      version: "1.2.3",
      exports: { ".": { import: "./dist/index.js" } },
    };

    expect(() =>
      assertPackedManifestMatchesRoot(manifest, structuredClone(manifest)),
    ).not.toThrow();
  });

  it("rejects a version mismatch", async () => {
    const { assertPackedManifestMatchesRoot } = await loadSmokeHelpers();

    expect(() =>
      assertPackedManifestMatchesRoot(
        { name: "opencandle", version: "1.2.3", exports: {} },
        { name: "opencandle", version: "1.2.4", exports: {} },
      ),
    ).toThrow(/version/i);
  });

  it("rejects an exports mismatch", async () => {
    const { assertPackedManifestMatchesRoot } = await loadSmokeHelpers();

    expect(() =>
      assertPackedManifestMatchesRoot(
        { name: "opencandle", version: "1.2.3", exports: { ".": {} } },
        { name: "opencandle", version: "1.2.3", exports: { ".": {}, "./extra": {} } },
      ),
    ).toThrow(/exports/i);
  });
});

describe("npm pack JSON filename validation", () => {
  it("accepts exactly one bare .tgz entry", async () => {
    const { packFilenameFromJson } = await loadSmokeHelpers();

    expect(packFilenameFromJson('[{"filename":"opencandle-0.15.0.tgz"}]')).toBe(
      "opencandle-0.15.0.tgz",
    );
  });

  it("rejects more than one package entry", async () => {
    const { packFilenameFromJson } = await loadSmokeHelpers();

    expect(() => packFilenameFromJson('[{"filename":"a.tgz"},{"filename":"b.tgz"}]')).toThrow(
      /exactly one/i,
    );
  });

  it("rejects a non-.tgz filename", async () => {
    const { packFilenameFromJson } = await loadSmokeHelpers();

    expect(() => packFilenameFromJson('[{"filename":"package.tar.gz"}]')).toThrow(/\.tgz/i);
  });

  it("rejects a filename containing path components", async () => {
    const { packFilenameFromJson } = await loadSmokeHelpers();

    expect(() => packFilenameFromJson('[{"filename":"../evil.tgz"}]')).toThrow(/unsafe/i);
    expect(() => packFilenameFromJson('[{"filename":"/tmp/evil.tgz"}]')).toThrow(/unsafe/i);
  });

  it("rejects malformed JSON", async () => {
    const { packFilenameFromJson } = await loadSmokeHelpers();

    expect(() => packFilenameFromJson("npm notice\nnot json")).toThrow(/parse/i);
  });
});

describe("release package proof helpers", () => {
  it("parses prepare and verify invocations", async () => {
    const { parseReleasePackageArgs } = await loadReleaseHelpers();

    expect(parseReleasePackageArgs(["prepare", "--out", "validation-output/release"])).toEqual({
      command: "prepare",
      out: "validation-output/release",
    });
    expect(parseReleasePackageArgs(["verify", "--dir", "/tmp/proof"])).toEqual({
      command: "verify",
      dir: "/tmp/proof",
    });
  });

  it("rejects unknown release-package arguments", async () => {
    const { parseReleasePackageArgs } = await loadReleaseHelpers();

    expect(() => parseReleasePackageArgs(["prepare", "--bogus"])).toThrow(/unknown argument/i);
    expect(() => parseReleasePackageArgs(["nope"])).toThrow(/unknown command/i);
  });

  it("builds an exact schema-version-1 proof object", async () => {
    const { buildPackageProof } = await loadReleaseHelpers();

    const proof = buildPackageProof({
      manifest: { name: "opencandle", version: "0.15.0" },
      candidateCommit: "c".repeat(40),
      tarball: "opencandle-0.15.0.tgz",
      sha256: "d".repeat(64),
      testedAt: "2026-01-01T00:00:00.000Z",
      nodeVersion: "22.0.0",
      platform: "linux",
      smokePassed: true,
    });

    expect(proof).toEqual({
      schemaVersion: 1,
      candidateCommit: "c".repeat(40),
      packageName: "opencandle",
      packageVersion: "0.15.0",
      tarball: "opencandle-0.15.0.tgz",
      sha256: "d".repeat(64),
      testedAt: "2026-01-01T00:00:00.000Z",
      node: "22.0.0",
      platform: "linux",
      smokePassed: true,
    });
  });

  function validInput() {
    const proof = {
      schemaVersion: 1,
      candidateCommit: "c".repeat(40),
      packageName: "opencandle",
      packageVersion: "0.15.0",
      tarball: "opencandle-0.15.0.tgz",
      sha256: "d".repeat(64),
      testedAt: "2026-01-01T00:00:00.000Z",
      node: "22.0.0",
      platform: "linux",
      smokePassed: true,
    };
    return {
      proof,
      manifest: { name: "opencandle", version: "0.15.0" },
      headCommit: "c".repeat(40),
      tarballSha256: "d".repeat(64),
      tarballStat: { isFile: () => true, isSymbolicLink: () => false },
    };
  }

  it("accepts a matching proof", async () => {
    const { evaluatePackageProof } = await loadReleaseHelpers();

    expect(evaluatePackageProof(validInput())).toEqual({ ok: true, errors: [] });
  });

  it("rejects a missing proof", async () => {
    const { evaluatePackageProof } = await loadReleaseHelpers();
    const input = validInput();

    const result = evaluatePackageProof({ ...input, proof: undefined });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/missing/i);
  });

  it("rejects an unsupported schema version", async () => {
    const { evaluatePackageProof } = await loadReleaseHelpers();
    const input = validInput();

    const result = evaluatePackageProof({
      ...input,
      proof: { ...input.proof, schemaVersion: 2 },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/schemaVersion/i);
  });

  it("rejects a stale candidate commit", async () => {
    const { evaluatePackageProof } = await loadReleaseHelpers();
    const input = validInput();

    const result = evaluatePackageProof({
      ...input,
      proof: { ...input.proof, candidateCommit: "e".repeat(40) },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/candidateCommit/i);
  });

  it("rejects a manifest version mismatch", async () => {
    const { evaluatePackageProof } = await loadReleaseHelpers();
    const input = validInput();

    const result = evaluatePackageProof({
      ...input,
      proof: { ...input.proof, packageVersion: "9.9.9" },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/packageVersion/i);
  });

  it("rejects a proof that never passed the smoke", async () => {
    const { evaluatePackageProof } = await loadReleaseHelpers();
    const input = validInput();

    const result = evaluatePackageProof({
      ...input,
      proof: { ...input.proof, smokePassed: false },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/smokePassed/i);
  });

  it("rejects a missing tarball", async () => {
    const { evaluatePackageProof } = await loadReleaseHelpers();
    const input = validInput();

    const result = evaluatePackageProof({
      ...input,
      tarballStat: undefined,
      tarballSha256: undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/tarball missing/i);
  });

  it("rejects a symlinked tarball", async () => {
    const { evaluatePackageProof } = await loadReleaseHelpers();
    const input = validInput();

    const result = evaluatePackageProof({
      ...input,
      tarballStat: { isFile: () => true, isSymbolicLink: () => true },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/symlink/i);
  });

  it("rejects changed tarball content", async () => {
    const { evaluatePackageProof } = await loadReleaseHelpers();
    const input = validInput();

    const result = evaluatePackageProof({ ...input, tarballSha256: "f".repeat(64) });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/content changed/i);
  });

  it("rejects a non-.tgz tarball name", async () => {
    const { evaluatePackageProof } = await loadReleaseHelpers();
    const input = validInput();

    const result = evaluatePackageProof({
      ...input,
      proof: { ...input.proof, tarball: "package.tar.gz" },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/tarball must be a \.tgz/i);
  });

  it("rejects malformed testedAt, node, and platform fields", async () => {
    const { evaluatePackageProof } = await loadReleaseHelpers();
    const input = validInput();

    const badDate = evaluatePackageProof({
      ...input,
      proof: { ...input.proof, testedAt: "not-a-date" },
    });
    expect(badDate.ok).toBe(false);
    expect(badDate.errors.join(" ")).toMatch(/testedAt/i);

    const badNode = evaluatePackageProof({
      ...input,
      proof: { ...input.proof, node: "garbage" },
    });
    expect(badNode.ok).toBe(false);
    expect(badNode.errors.join(" ")).toMatch(/node/i);

    const badPlatform = evaluatePackageProof({
      ...input,
      proof: { ...input.proof, platform: "" },
    });
    expect(badPlatform.ok).toBe(false);
    expect(badPlatform.errors.join(" ")).toMatch(/platform/i);
  });

  it("restricts proof output to the gitignored validation-output tree", async () => {
    const { resolveOutDir } = await loadReleaseHelpers();

    expect(resolveOutDir("/repo", "validation-output/release")).toBe(
      resolve("/repo/validation-output/release"),
    );
    expect(() => resolveOutDir("/repo", "/tmp/elsewhere")).toThrow(/validation-output/i);
    expect(() => resolveOutDir("/repo", "docs/proof")).toThrow(/validation-output/i);
    expect(() => resolveOutDir("/repo", "validation-output")).toThrow(/validation-output/i);
  });

  it("rejects a symlinked output ancestor that escapes validation-output", async () => {
    const { resolveOutDir } = await loadReleaseHelpers();
    const root = makeTempRoot("opencandle-out-");
    mkdirSync(join(root, "validation-output"));
    const outside = makeTempRoot("opencandle-outside-");
    symlinkSync(outside, join(root, "validation-output", "alias"));

    expect(() => resolveOutDir(root, "validation-output/alias/release")).toThrow(/symlink/i);
  });

  it("rejects a symlinked validation-output base", async () => {
    const { resolveOutDir } = await loadReleaseHelpers();
    const root = makeTempRoot("opencandle-out-");
    const outside = makeTempRoot("opencandle-outside-");
    symlinkSync(outside, join(root, "validation-output"));

    expect(() => resolveOutDir(root, "validation-output/release")).toThrow(/symlink/i);
  });
});

describe("release package output reset guard", () => {
  it("creates a missing output directory", async () => {
    const { resetGeneratedOutputDir } = await loadReleaseHelpers();
    const root = makeTempRoot("opencandle-reset-");
    const dir = join(root, "release");

    resetGeneratedOutputDir(dir);

    expect(existsSync(dir)).toBe(true);
  });

  it("clears a prior recognized generated tree", async () => {
    const { resetGeneratedOutputDir } = await loadReleaseHelpers();
    const root = makeTempRoot("opencandle-reset-");
    const dir = join(root, "release");
    mkdirSync(dir);
    writeFileSync(join(dir, "opencandle-0.15.0.tgz"), "tarball");
    writeFileSync(join(dir, "package-proof.json"), "{}");

    resetGeneratedOutputDir(dir);

    expect(existsSync(join(dir, "opencandle-0.15.0.tgz"))).toBe(false);
    expect(existsSync(join(dir, "package-proof.json"))).toBe(false);
  });

  it("refuses to delete unrelated content and leaves it in place", async () => {
    const { resetGeneratedOutputDir } = await loadReleaseHelpers();
    const root = makeTempRoot("opencandle-reset-");
    const dir = join(root, "release");
    mkdirSync(dir);
    const notes = join(dir, "notes.txt");
    writeFileSync(notes, "do not delete");

    expect(() => resetGeneratedOutputDir(dir)).toThrow(/unrecognized content/i);
    expect(readFileSync(notes, "utf8")).toBe("do not delete");
  });

  it("refuses a symlinked entry in the output directory", async () => {
    const { resetGeneratedOutputDir } = await loadReleaseHelpers();
    const root = makeTempRoot("opencandle-reset-");
    const dir = join(root, "release");
    mkdirSync(dir);
    const outside = join(root, "outside.tgz");
    writeFileSync(outside, "outside");
    symlinkSync(outside, join(dir, "opencandle-0.15.0.tgz"));

    expect(() => resetGeneratedOutputDir(dir)).toThrow(/regular generated file/i);
    expect(existsSync(outside)).toBe(true);
  });
});

describe("release package proof commit guard", () => {
  const proof = { schemaVersion: 1, smokePassed: true };

  it("writes the proof when the tree is exactly tarball plus proof", async () => {
    const { commitPackageProof } = await loadReleaseHelpers();
    const root = makeTempRoot("opencandle-commit-");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "opencandle-0.15.0.tgz"), "tarball");

    commitPackageProof({ dir: root, tarballName: "opencandle-0.15.0.tgz", proof });

    expect(JSON.parse(readFileSync(join(root, "package-proof.json"), "utf8"))).toEqual(proof);
  });

  it("removes the proof and fails when the tree has unexpected content", async () => {
    const { commitPackageProof } = await loadReleaseHelpers();
    const root = makeTempRoot("opencandle-commit-");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "opencandle-0.15.0.tgz"), "tarball");
    writeFileSync(join(root, "not-generated.txt"), "unexpected");

    expect(() =>
      commitPackageProof({ dir: root, tarballName: "opencandle-0.15.0.tgz", proof }),
    ).toThrow(/Unexpected proof tree/i);
    expect(existsSync(join(root, "package-proof.json"))).toBe(false);
  });
});

describe("release package clean-tree guard", () => {
  it("accepts a clean checkout and rejects a dirty one", async () => {
    const { assertCleanWorkingTree } = await loadReleaseHelpers();
    const root = makeTempRoot("opencandle-clean-");
    const init = spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" });
    expect(init.status, init.stderr).toBe(0);
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: root });
    writeFileSync(join(root, "tracked.txt"), "tracked\n");
    spawnSync("git", ["add", "tracked.txt"], { cwd: root });
    const commit = spawnSync("git", ["commit", "-qm", "init"], { cwd: root, encoding: "utf8" });
    expect(commit.status, commit.stderr).toBe(0);

    expect(() => assertCleanWorkingTree(root)).not.toThrow();

    writeFileSync(join(root, "untracked.txt"), "untracked\n");
    expect(() => assertCleanWorkingTree(root)).toThrow(/not clean/i);
  });
});

function makeCleanGitRepo(name: string, version: string): { root: string; head: string } {
  const root = makeTempRoot("opencandle-git-");
  const git = (args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  const init = git(["init", "-q"]);
  if (init.status !== 0) throw new Error(init.stderr);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name, version }, null, 2)}\n`);
  git(["add", "package.json"]);
  const commit = git(["commit", "-qm", "init"]);
  if (commit.status !== 0) throw new Error(commit.stderr);
  return { root, head: git(["rev-parse", "HEAD"]).stdout.trim() };
}

function writeProofFixture(
  dir: string,
  head: string,
  manifest: { name: string; version: string },
): { tarball: string; proofPath: string; proof: Record<string, unknown> } {
  mkdirSync(dir, { recursive: true });
  const tarballName = `${manifest.name}-${manifest.version}.tgz`;
  const tarball = join(dir, tarballName);
  writeFileSync(tarball, "fake tarball bytes");
  const proof = {
    schemaVersion: 1,
    candidateCommit: head,
    packageName: manifest.name,
    packageVersion: manifest.version,
    tarball: tarballName,
    sha256: sha256("fake tarball bytes"),
    testedAt: new Date().toISOString(),
    node: process.versions.node,
    platform: process.platform,
    smokePassed: true,
  };
  const proofPath = join(dir, "package-proof.json");
  writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
  return { tarball, proofPath, proof };
}

describe("release package verify", () => {
  it("verifies a well-formed proof against a clean repo, manifest, HEAD, and hash", async () => {
    const { runVerify } = await loadReleaseHelpers();
    const repo = makeCleanGitRepo("opencandle", "0.15.0");
    const dir = join(makeTempRoot("opencandle-proof-"), "release");
    writeProofFixture(dir, repo.head, { name: "opencandle", version: "0.15.0" });

    const proof = runVerify({ root: repo.root, dir });

    expect(proof.packageName).toBe("opencandle");
    expect(proof.packageVersion).toBe("0.15.0");
  });

  it("requires a clean working tree", async () => {
    const { runVerify } = await loadReleaseHelpers();
    const repo = makeCleanGitRepo("opencandle", "0.15.0");
    const dir = join(makeTempRoot("opencandle-proof-"), "release");
    writeProofFixture(dir, repo.head, { name: "opencandle", version: "0.15.0" });
    writeFileSync(join(repo.root, "edited-source.ts"), "dirty\n");

    expect(() => runVerify({ root: repo.root, dir })).toThrow(/not clean/i);
  });

  it("detects changed tarball content", async () => {
    const { runVerify } = await loadReleaseHelpers();
    const repo = makeCleanGitRepo("opencandle", "0.15.0");
    const dir = join(makeTempRoot("opencandle-proof-"), "release");
    const { tarball } = writeProofFixture(dir, repo.head, {
      name: "opencandle",
      version: "0.15.0",
    });
    writeFileSync(tarball, "tampered bytes");

    expect(() => runVerify({ root: repo.root, dir })).toThrow(/content changed/i);
  });

  it("detects a stale candidate commit", async () => {
    const { runVerify } = await loadReleaseHelpers();
    const repo = makeCleanGitRepo("opencandle", "0.15.0");
    const dir = join(makeTempRoot("opencandle-proof-"), "release");
    const { proofPath } = writeProofFixture(dir, repo.head, {
      name: "opencandle",
      version: "0.15.0",
    });
    const proof = JSON.parse(readFileSync(proofPath, "utf8")) as Record<string, unknown>;
    proof.candidateCommit = "0".repeat(40);
    writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);

    expect(() => runVerify({ root: repo.root, dir })).toThrow(/candidateCommit/i);
  });

  it("detects a missing tarball", async () => {
    const { runVerify } = await loadReleaseHelpers();
    const repo = makeCleanGitRepo("opencandle", "0.15.0");
    const dir = join(makeTempRoot("opencandle-proof-"), "release");
    const { tarball } = writeProofFixture(dir, repo.head, {
      name: "opencandle",
      version: "0.15.0",
    });
    rmSync(tarball);

    expect(() => runVerify({ root: repo.root, dir })).toThrow(/tarball missing/i);
  });

  it("rejects malformed proof metadata", async () => {
    const { runVerify } = await loadReleaseHelpers();
    const repo = makeCleanGitRepo("opencandle", "0.15.0");
    const dir = join(makeTempRoot("opencandle-proof-"), "release");
    const { proofPath } = writeProofFixture(dir, repo.head, {
      name: "opencandle",
      version: "0.15.0",
    });
    const proof = JSON.parse(readFileSync(proofPath, "utf8")) as Record<string, unknown>;
    proof.testedAt = "yesterday";
    writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);

    expect(() => runVerify({ root: repo.root, dir })).toThrow(/testedAt/i);
  });
});

describe("release package HEAD guard", () => {
  it("rejects a HEAD that moved since the snapshot", async () => {
    const { assertHeadUnchanged } = await loadReleaseHelpers();
    const repo = makeCleanGitRepo("opencandle", "0.15.0");
    const move = spawnSync("git", ["commit", "--allow-empty", "-qm", "move"], {
      cwd: repo.root,
      encoding: "utf8",
    });
    expect(move.status, move.stderr).toBe(0);

    expect(() => assertHeadUnchanged(repo.root, repo.head)).toThrow(/HEAD changed/i);
  });

  it("accepts an unchanged HEAD", async () => {
    const { assertHeadUnchanged } = await loadReleaseHelpers();
    const repo = makeCleanGitRepo("opencandle", "0.15.0");

    expect(() => assertHeadUnchanged(repo.root, repo.head)).not.toThrow();
  });
});

describe("release package prepare ordering", () => {
  it("snapshots candidate HEAD before the build and rechecks HEAD and tree before the proof", () => {
    const source = readFileSync(releasePackageScript, "utf8");

    const snapshot = source.indexOf("const candidateCommit = readGitHead(root)");
    const build = source.indexOf('run(npmCommand, ["run", "prepare"]');
    const smoke = source.indexOf("smokeScriptPath,");
    const headCheck = source.indexOf("assertHeadUnchanged(root, candidateCommit)");
    const commit = source.indexOf("commitPackageProof({ dir: outDir");

    expect(snapshot).toBeGreaterThan(-1);
    expect(snapshot).toBeLessThan(build);
    expect(build).toBeLessThan(smoke);
    expect(headCheck).toBeGreaterThan(-1);
    expect(headCheck).toBeLessThan(commit);
  });
});

describe("release package verify CLI", () => {
  it("exits nonzero for unknown CLI arguments", () => {
    const result = runCli(releasePackageScript, ["--bogus"]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/unknown/i);
  });

  it("does not fetch or publish during verify", () => {
    const source = readFileSync(releasePackageScript, "utf8");

    // Verify is a local, read-only proof check: no lifecycle or registry verbs.
    expect(source).not.toMatch(/npm publish/);
    expect(source).not.toMatch(/git push/);
    expect(source).not.toMatch(/git tag/);
    // The proof script packs exactly once with lifecycle scripts disabled
    // (prepare is run explicitly) and never touches the registry or git refs.
    expect(source).toMatch(/"pack", "--ignore-scripts", "--json"/);
    expect(source).toMatch(/"--pack-destination"/);
  });
});

// Keep a lightweight filesystem smoke on the smoke script's error path: a
// valid hash for a corrupt tarball must fail at install without the script
// touching the build. This is a real process run, not a mocked spawn.
describe("packed install smoke explicit mode guardrails", () => {
  it("never prepares or packs when a tarball is supplied", () => {
    const root = makeTempRoot("opencandle-smoke-");
    const tarball = join(root, "corrupt.tgz");
    writeFileSync(tarball, "definitely not a tarball");
    const digest = sha256("definitely not a tarball");

    const result = runCli(smokeScript, ["--tarball", tarball, "--sha256", digest]);

    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).not.toBe(0);
    expect(output).not.toMatch(/npm run prepare/);
    expect(output).not.toMatch(/npm pack/);
    expect(existsSync(tarball)).toBe(true);
    expect(lstatSync(tarball).isFile()).toBe(true);
  });
});
