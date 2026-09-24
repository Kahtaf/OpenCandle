#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { assertUsableTarball, packFilenameFromJson, sha256File } from "./packed-install-smoke.mjs";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const smokeScriptPath = join(defaultRoot, "scripts", "packed-install-smoke.mjs");
const proofFilename = "package-proof.json";
const generatedTarballPattern = /\.tgz$/i;
const generatedTempProofPattern = /^\.package-proof\.json\..+\.tmp$/;

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? defaultRoot,
    env: options.env ?? process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function capture(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? defaultRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: "pipe",
    shell: false,
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result.stdout;
}

export function parseReleasePackageArgs(args) {
  const command = args[0];
  if (command !== "prepare" && command !== "verify") {
    throw new Error(`unknown command: ${command ?? "(none)"}`);
  }

  const options = { command };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg !== "--out" && arg !== "--dir") {
      throw new Error(`unknown argument: ${arg}`);
    }
    if (!value || value.startsWith("--")) {
      throw new Error(`${arg} requires a value`);
    }
    if (arg === "--out") {
      if (command !== "prepare") throw new Error("--out is only valid for prepare");
      options.out = value;
    } else {
      if (command !== "verify") throw new Error("--dir is only valid for verify");
      options.dir = value;
    }
    index += 1;
  }

  if (command === "prepare" && !options.out) {
    options.out = "validation-output/release";
  }
  if (command === "verify" && !options.dir) {
    throw new Error("verify requires --dir <path>");
  }
  return options;
}

export function buildPackageProof({
  manifest,
  candidateCommit,
  tarball,
  sha256,
  testedAt = new Date().toISOString(),
  nodeVersion = process.versions.node,
  platform = process.platform,
  smokePassed,
}) {
  return {
    schemaVersion: 1,
    candidateCommit,
    packageName: manifest.name,
    packageVersion: manifest.version,
    tarball,
    sha256,
    testedAt,
    node: nodeVersion,
    platform,
    smokePassed,
  };
}

/**
 * Pure proof check. The CLI gathers the real filesystem, manifest, and HEAD
 * values and feeds them here so every rejection path is unit-testable without
 * touching the network or the registry.
 */
export function evaluatePackageProof({ proof, manifest, headCommit, tarballSha256, tarballStat }) {
  if (!proof || typeof proof !== "object") {
    return { ok: false, errors: ["package-proof.json is missing or unreadable"] };
  }

  const errors = [];
  if (proof.schemaVersion !== 1) {
    errors.push(`unsupported schemaVersion: ${String(proof.schemaVersion)}`);
  }
  if (proof.candidateCommit !== headCommit) {
    errors.push(
      `candidateCommit ${String(proof.candidateCommit)} does not match HEAD ${headCommit}`,
    );
  }
  if (proof.packageName !== manifest.name) {
    errors.push(
      `packageName ${String(proof.packageName)} does not match manifest ${manifest.name}`,
    );
  }
  if (proof.packageVersion !== manifest.version) {
    errors.push(
      `packageVersion ${String(proof.packageVersion)} does not match manifest ${manifest.version}`,
    );
  }
  const proofSha = typeof proof.sha256 === "string" ? proof.sha256 : "";
  if (!/^[0-9a-f]{64}$/.test(proofSha)) {
    errors.push("sha256 must be a 64-character hex digest");
  }
  if (proof.smokePassed !== true) {
    errors.push("smokePassed must be true");
  }
  if (typeof proof.tarball !== "string" || !generatedTarballPattern.test(proof.tarball)) {
    errors.push("tarball must be a .tgz filename");
  }
  if (typeof proof.testedAt !== "string" || Number.isNaN(Date.parse(proof.testedAt))) {
    errors.push("testedAt must be a parseable timestamp");
  }
  if (typeof proof.node !== "string" || !/^\d+\.\d+\.\d+/.test(proof.node)) {
    errors.push("node must be a semantic version");
  }
  if (typeof proof.platform !== "string" || proof.platform.length === 0) {
    errors.push("platform must be a non-empty string");
  }
  if (!tarballStat) {
    errors.push("tarball missing");
  } else if (tarballStat.isSymbolicLink()) {
    errors.push("tarball is a symlink");
  } else if (!tarballStat.isFile()) {
    errors.push("tarball is not a regular file");
  } else if (tarballSha256 !== proofSha) {
    errors.push(`tarball content changed: expected ${proofSha}, received ${String(tarballSha256)}`);
  }

  return { ok: errors.length === 0, errors };
}

export function readGitHead(root = defaultRoot) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error("cannot read git HEAD outside a git checkout");
  }
  return result.stdout.trim();
}

export function assertCleanWorkingTree(root = defaultRoot) {
  const result = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error("cannot read git status outside a git checkout");
  }
  const status = result.stdout.trim();
  if (status) {
    throw new Error(`working tree is not clean:\n${status}`);
  }
}

/**
 * The proof is only meaningful if the commit it names is still the commit the
 * artifact was built from. A concurrent commit between the build and the proof
 * write would silently attest a mismatched tarball.
 */
export function assertHeadUnchanged(root, expectedCommit) {
  const current = readGitHead(root);
  if (current !== expectedCommit) {
    throw new Error(
      `git HEAD changed during prepare: expected ${expectedCommit}, received ${current}`,
    );
  }
}

function readManifest(root = defaultRoot) {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
}

/**
 * The proof directory is deliberately restricted to the gitignored
 * `validation-output/` tree so a prepare run can never write into tracked
 * source or delete an unrelated directory.
 */
export function resolveOutDir(root, out) {
  const base = resolve(root, "validation-output");
  const target = isAbsolute(out) ? resolve(out) : resolve(root, out);
  const rel = relative(base, target);
  if (rel === "" || rel === "." || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`--out must be a release directory inside ${base}`);
  }

  // Lexical containment is not enough: `validation-output/alias` could be a
  // symlink to an unrelated directory. Reject any symlinked component from the
  // trusted repo root down to the output path itself, existing or not.
  let current = root;
  for (const part of relative(root, target).split(sep).filter(Boolean)) {
    current = join(current, part);
    let stats;
    try {
      stats = lstatSync(current);
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw new Error(`refusing symlinked output path component: ${current}`);
    }
  }
  return target;
}

/**
 * Reuse a fresh output directory without recursively deleting unknown user
 * content. Only a prior generated tree (proof, `.tgz`, or our own interrupted
 * temp proof) is cleared; anything else fails with the offending names intact.
 */
export function resetGeneratedOutputDir(dir) {
  let stats;
  try {
    stats = lstatSync(dir);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    mkdirSync(dir, { recursive: true });
    return;
  }

  if (stats.isSymbolicLink()) {
    throw new Error(`refusing symlinked output directory: ${dir}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`output path exists and is not a directory: ${dir}`);
  }

  const entries = readdirSync(dir);
  const generated = entries.filter(
    (name) =>
      name === proofFilename ||
      generatedTarballPattern.test(name) ||
      generatedTempProofPattern.test(name),
  );
  const unknown = entries.filter((name) => !generated.includes(name));
  if (unknown.length > 0) {
    throw new Error(
      `output directory contains unrecognized content, refusing to delete: ${unknown.join(", ")}`,
    );
  }

  for (const name of generated) {
    const entryPath = join(dir, name);
    const entryStats = lstatSync(entryPath);
    if (entryStats.isSymbolicLink() || !entryStats.isFile()) {
      throw new Error(`output directory entry is not a regular generated file: ${entryPath}`);
    }
    rmSync(entryPath, { force: true });
  }
}

function resolveProofTarballPath(dir, proof) {
  if (!proof || typeof proof.tarball !== "string" || !proof.tarball) {
    throw new Error("package-proof.json does not record a tarball");
  }
  if (basename(proof.tarball) !== proof.tarball) {
    throw new Error(`proof tarball must be a bare filename: ${proof.tarball}`);
  }
  return join(dir, proof.tarball);
}

/**
 * Write the proof only after every validation passed, then confirm the tree is
 * exactly the tarball plus the proof. If the tree check fails, remove the proof
 * again so an error can never leave behind a success artifact.
 */
export function commitPackageProof({ dir, tarballName, proof }) {
  const target = join(dir, proofFilename);
  const temporary = join(dir, `.${proofFilename}.${process.pid}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(proof, null, 2)}\n`);
  renameSync(temporary, target);

  const expectedEntries = [tarballName, proofFilename].sort();
  const actualEntries = readdirSync(dir).sort();
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
    rmSync(target, { force: true });
    throw new Error(
      `Unexpected proof tree: expected ${expectedEntries.join(", ")}, received ${actualEntries.join(", ")}`,
    );
  }
  return proof;
}

export function runPrepare({ root = defaultRoot, out = "validation-output/release" }) {
  assertCleanWorkingTree(root);
  // Snapshot HEAD BEFORE building: a commit during the build must not be
  // attested by a proof for a tarball built from the previous commit.
  const candidateCommit = readGitHead(root);
  const outDir = resolveOutDir(root, out);
  resetGeneratedOutputDir(outDir);

  run(npmCommand, ["run", "prepare"], { cwd: root });
  const packOutput = capture(
    npmCommand,
    ["pack", "--ignore-scripts", "--json", "--pack-destination", outDir],
    { cwd: root },
  );
  const tarballName = packFilenameFromJson(packOutput);
  const tarballPath = join(outDir, tarballName);

  const packedEntries = readdirSync(outDir);
  if (packedEntries.length !== 1 || packedEntries[0] !== tarballName) {
    throw new Error(
      `npm pack produced unexpected output: expected only ${tarballName}, received ${packedEntries.join(", ") || "nothing"}`,
    );
  }
  assertUsableTarball(tarballPath);

  const shaBefore = sha256File(tarballPath);
  run(process.execPath, [smokeScriptPath, "--tarball", tarballPath, "--sha256", shaBefore], {
    cwd: root,
  });
  const shaAfter = sha256File(tarballPath);
  if (shaAfter !== shaBefore) {
    throw new Error(`Tarball sha256 changed during smoke: ${shaBefore} -> ${shaAfter}`);
  }

  // All validations must pass before any success proof exists.
  assertCleanWorkingTree(root);
  assertHeadUnchanged(root, candidateCommit);

  const manifest = readManifest(root);
  const proof = buildPackageProof({
    manifest,
    candidateCommit,
    tarball: tarballName,
    sha256: shaAfter,
    smokePassed: true,
  });
  commitPackageProof({ dir: outDir, tarballName, proof });

  console.log(`Wrote ${join(outDir, proofFilename)} for ${manifest.name}@${manifest.version}`);
  return proof;
}

export function runVerify({ root = defaultRoot, dir }) {
  // HEAD equality alone would miss edited source or policy in the worktree.
  assertCleanWorkingTree(root);
  const targetDir = resolve(dir);
  const proof = JSON.parse(readFileSync(join(targetDir, proofFilename), "utf8"));
  const manifest = readManifest(root);
  const headCommit = readGitHead(root);

  let tarballStat;
  let tarballSha256;
  try {
    const tarballPath = resolveProofTarballPath(targetDir, proof);
    tarballStat = lstatSync(tarballPath);
    tarballSha256 = tarballStat.isFile() ? sha256File(tarballPath) : undefined;
  } catch {
    tarballStat = undefined;
    tarballSha256 = undefined;
  }

  const result = evaluatePackageProof({
    proof,
    manifest,
    headCommit,
    tarballSha256,
    tarballStat,
  });
  if (!result.ok) {
    throw new Error(`Package proof verification failed:\n- ${result.errors.join("\n- ")}`);
  }

  console.log(
    `Verified ${proof.packageName}@${proof.packageVersion} proof ${proof.sha256.slice(0, 12)}…`,
  );
  return proof;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    const options = parseReleasePackageArgs(process.argv.slice(2));
    if (options.command === "prepare") {
      runPrepare({ root: defaultRoot, out: options.out });
    } else {
      runVerify({ root: defaultRoot, dir: options.dir });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
