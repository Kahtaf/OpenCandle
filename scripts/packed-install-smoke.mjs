#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildNpmInvocation } from "./npm-command.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keepTemp = process.env.OPENCANDLE_KEEP_PACK_SMOKE === "1";

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Parse the optional explicit-tarball arguments. With no arguments the script
 * keeps its original behavior: build, pack, and install the current checkout.
 */
export function parseSmokeArgs(args) {
  let tarball;
  let sha256;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg !== "--tarball" && arg !== "--sha256") {
      throw new Error(`unknown argument: ${arg}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${arg} requires a value`);
    }
    if (arg === "--tarball") {
      tarball = resolve(value);
    } else {
      sha256 = value.toLowerCase();
    }
    index += 1;
  }

  if ((tarball && !sha256) || (!tarball && sha256)) {
    throw new Error("--tarball and --sha256 must be provided together");
  }
  if (sha256 && !/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error("--sha256 must be a 64-character hex digest");
  }

  const parsed = {};
  if (tarball) parsed.tarball = tarball;
  if (sha256) parsed.sha256 = sha256;
  return parsed;
}

/**
 * Refuse anything we would not want to install and hash: missing files,
 * symlinks (which could redirect the hash away from the installed artifact),
 * non-regular files, and non-.tgz paths.
 */
export function assertUsableTarball(tarballPath) {
  let stats;
  try {
    stats = lstatSync(tarballPath);
  } catch {
    throw new Error(`Tarball not found: ${tarballPath}`);
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing symlink tarball: ${tarballPath}`);
  }
  if (!stats.isFile()) {
    throw new Error(`Tarball is not a regular file: ${tarballPath}`);
  }
  if (!tarballPath.toLowerCase().endsWith(".tgz")) {
    throw new Error(`Refusing non-.tgz tarball: ${tarballPath}`);
  }
  return stats;
}

/**
 * The packed artifact must describe the same public package the checkout
 * declares. Compare name, version, and the exact exports map (keys and
 * targets) so a tarball built from a different commit cannot silently pass
 * the smoke against the current root manifest.
 */
export function assertPackedManifestMatchesRoot(expected, actual) {
  if (!actual || typeof actual !== "object") {
    throw new Error("Packed package.json is missing or unreadable");
  }
  if (actual.name !== expected.name) {
    throw new Error(`Packed package name ${actual.name} does not match root ${expected.name}`);
  }
  if (actual.version !== expected.version) {
    throw new Error(
      `Packed package version ${actual.version} does not match root ${expected.version}`,
    );
  }

  const expectedExports = expected.exports ?? {};
  const actualExports = actual.exports ?? {};
  const expectedKeys = Object.keys(expectedExports).sort();
  const actualKeys = Object.keys(actualExports).sort();
  if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
    throw new Error(
      `Packed package exports mismatch: expected ${expectedKeys.join(", ")}, received ${actualKeys.join(", ")}`,
    );
  }
  for (const key of expectedKeys) {
    if (JSON.stringify(expectedExports[key]) !== JSON.stringify(actualExports[key])) {
      throw new Error(`Packed package export "${key}" does not match the root manifest`);
    }
  }
}

export function parsePackJson(output) {
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== "[") continue;
    try {
      return JSON.parse(output.slice(index));
    } catch {
      // npm lifecycle output can precede the JSON payload.
    }
  }
  throw new Error("Could not parse npm pack --json output");
}

/**
 * Extract the packed filename and validate its shape BEFORE any caller joins
 * it onto a directory. `npm pack --json` must report exactly one package whose
 * filename is a bare `.tgz` basename; anything else is untrusted output.
 */
export function packFilenameFromJson(output) {
  const packs = parsePackJson(output);
  if (!Array.isArray(packs) || packs.length !== 1) {
    const count = Array.isArray(packs) ? String(packs.length) : "non-array";
    throw new Error(`npm pack --json must report exactly one package, received ${count}`);
  }
  const filename = packs[0]?.filename;
  if (typeof filename !== "string" || !filename) {
    throw new Error("npm pack --json did not report a filename");
  }
  if (basename(filename) !== filename) {
    throw new Error(`npm pack reported an unsafe filename: ${filename}`);
  }
  if (!filename.toLowerCase().endsWith(".tgz")) {
    throw new Error(`npm pack reported a non-.tgz filename: ${filename}`);
  }
  return filename;
}

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    stdio: "inherit",
    shell: false,
  });
  const allowed = options.allowedExitCodes ?? [0];
  if (!allowed.includes(result.status)) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function capture(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: "pipe",
    shell: false,
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  const allowed = options.allowedExitCodes ?? [0];
  if (!allowed.includes(result.status)) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result.stdout.trim();
}

// npm/npx run through their JavaScript entrypoint (see npm-command.mjs) so the
// `shell: false` spawn above stays safe on Windows.
function runNpm(args, options) {
  const invocation = buildNpmInvocation("npm", args);
  return run(invocation.command, invocation.args, options);
}

function captureNpm(args, options) {
  const invocation = buildNpmInvocation("npm", args);
  return capture(invocation.command, invocation.args, options);
}

function runNpx(args, options) {
  const invocation = buildNpmInvocation("npx", args);
  return run(invocation.command, invocation.args, options);
}

function captureNpx(args, options) {
  const invocation = buildNpmInvocation("npx", args);
  return capture(invocation.command, invocation.args, options);
}

async function waitForHealth(url, timeoutMs) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? "no response"}`);
}

async function waitForGuiShell(url, timeoutMs) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      if (response.ok && body.includes('<div id="root"></div>')) return;
      lastError = new Error(`HTTP ${response.status}, body=${body.slice(0, 80)}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? "no response"}`);
}

function killProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    child.kill("SIGTERM");
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

function forceKillProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    child.kill("SIGKILL");
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/**
 * Launch target for the installed CLI. POSIX keeps the `node_modules/.bin`
 * shim so the smoke still proves the install shim works. Windows cannot spawn
 * the `.cmd` shim under `shell: false` (same hardening as npm.cmd), so resolve
 * the installed package.json `bin` JavaScript entrypoint and run it through
 * `process.execPath` instead.
 */
export function resolveInstalledCli(packageDir, manifest, platform = process.platform) {
  if (platform !== "win32") {
    return { command: join(packageDir, "node_modules", ".bin", "opencandle"), args: [] };
  }

  const bin = manifest?.bin;
  const relativeBin = typeof bin === "string" ? bin : bin?.[manifest.name];
  if (typeof relativeBin !== "string" || relativeBin.length === 0) {
    throw new Error("Packed package.json does not declare an opencandle bin entry");
  }

  const packageRoot = join(packageDir, "node_modules", manifest.name);
  const script = resolve(packageRoot, relativeBin);
  const escaped = relative(packageRoot, script);
  if (escaped.startsWith("..") || isAbsolute(escaped)) {
    throw new Error(`Packed bin entry escapes the package directory: ${relativeBin}`);
  }
  return { command: process.execPath, args: [script] };
}

async function smokeGui(packageDir, env, manifest, registerChild) {
  const port = String(19_000 + Math.floor(Math.random() * 20_000));
  const cli = resolveInstalledCli(packageDir, manifest);
  const child = spawn(cli.command, [...cli.args, "gui"], {
    cwd: packageDir,
    env: {
      ...env,
      OPENCANDLE_GUI_HOST: "127.0.0.1",
      OPENCANDLE_GUI_PORT: port,
      OPENCANDLE_AUTOMATION_HEARTBEAT_MS: "60000",
    },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  registerChild(child);
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  try {
    await waitForHealth(`http://127.0.0.1:${port}/health`, 20_000);
    await waitForGuiShell(`http://127.0.0.1:${port}/`, 20_000);
  } catch (error) {
    throw new Error(`${error.message}\nGUI output:\n${output}`);
  } finally {
    killProcessTree(child);
    await new Promise((resolveExit) => {
      const timeout = setTimeout(() => {
        forceKillProcessTree(child);
        resolveExit();
      }, 5_000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolveExit();
      });
    });
    registerChild(undefined);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { tarball: explicitTarball, sha256: expectedSha256 } = parseSmokeArgs(argv);
  const tmp = mkdtempSync(join(tmpdir(), "opencandle-pack-smoke-"));
  let guiChild;
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    forceKillProcessTree(guiChild);
    if (!keepTemp) {
      rmSync(tmp, { recursive: true, force: true });
    }
  };

  const onSignal = (signal) => {
    cleanup();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const packageDir = join(tmp, "consumer");
    const packDir = join(tmp, "pack");
    const homeDir = join(tmp, "home");
    const osHomeDir = join(tmp, "os-home");
    mkdirSync(packageDir);
    mkdirSync(packDir);
    mkdirSync(homeDir);
    mkdirSync(osHomeDir);
    writeFileSync(join(packageDir, "package.json"), '{"type":"module","private":true}\n');

    let tarballPath;
    if (explicitTarball) {
      // Explicit tarball mode is prove-only: never build, prepare, or repack.
      tarballPath = explicitTarball;
      assertUsableTarball(tarballPath);
      const actualSha256 = sha256File(tarballPath);
      if (actualSha256 !== expectedSha256) {
        throw new Error(
          `Tarball sha256 mismatch: expected ${expectedSha256}, received ${actualSha256}`,
        );
      }
      console.log(`Using explicit tarball ${tarballPath}`);
    } else {
      runNpm(["run", "prepare"]);
      const packOutput = captureNpm(["pack", "--json", "--pack-destination", packDir]);
      const tarballName = packFilenameFromJson(packOutput);
      tarballPath = join(packDir, tarballName);
      assertUsableTarball(tarballPath);
    }

    const hashBefore = sha256File(tarballPath);
    runNpm(["install", "--no-audit", "--no-fund", tarballPath], { cwd: packageDir });

    const packedPackageJson = JSON.parse(
      readFileSync(join(packageDir, "node_modules", rootManifest.name, "package.json"), "utf8"),
    );
    assertPackedManifestMatchesRoot(rootManifest, packedPackageJson);

    const importSpecifiers = [
      rootManifest.name,
      ...Object.keys(rootManifest.exports).map((key) => {
        return key === "." ? rootManifest.name : `${rootManifest.name}/${key.slice(2)}`;
      }),
    ];
    const importCheck = `
      const specifiers = ${JSON.stringify([...new Set(importSpecifiers)])};
      for (const specifier of specifiers) {
        await import(specifier);
        console.log("import ok", specifier);
      }
    `;
    run(process.execPath, ["--input-type=module", "-e", importCheck], { cwd: packageDir });

    const env = {
      ...process.env,
      HOME: osHomeDir,
      OPENCANDLE_HOME: homeDir,
      // Model keys are blanked so the fresh-consumer doctor contract below is
      // deterministic on machines with exported credentials.
      GEMINI_API_KEY: "",
      GOOGLE_API_KEY: "",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    };
    // A fresh consumer home has no model credentials, so doctor reports
    // blocked health and exits 1 by contract; the JSON status assertion
    // below is the strong gate on that state.
    runNpx(["--no-install", "opencandle", "doctor"], {
      cwd: packageDir,
      env,
      allowedExitCodes: [0, 1],
    });

    const version = captureNpx(["--no-install", "opencandle", "--version"], {
      cwd: packageDir,
      env,
    });
    if (version !== packedPackageJson.version) {
      throw new Error(
        `Expected packed CLI version ${packedPackageJson.version}, received ${version}`,
      );
    }

    const help = captureNpx(["--no-install", "opencandle", "--help"], {
      cwd: packageDir,
      env,
    });
    if (!help.includes("Usage: opencandle")) {
      throw new Error("Packed CLI help did not include usage information");
    }

    const doctorJson = captureNpx(["--no-install", "opencandle", "doctor", "--json"], {
      cwd: packageDir,
      env,
      allowedExitCodes: [0, 1],
    });
    const doctorReport = JSON.parse(doctorJson);
    if (!doctorReport.schemaVersion) {
      throw new Error("Packed CLI doctor JSON did not include schemaVersion");
    }
    if (doctorReport.status !== "blocked") {
      throw new Error(
        `Expected fresh packed CLI doctor status blocked, received ${doctorReport.status}`,
      );
    }
    await smokeGui(packageDir, env, packedPackageJson, (child) => {
      guiChild = child;
    });

    // The artifact must be byte-identical before install and after the whole
    // smoke, and must still match the caller-provided digest.
    const hashAfter = sha256File(tarballPath);
    if (hashAfter !== hashBefore) {
      throw new Error(`Tarball sha256 changed during smoke: ${hashBefore} -> ${hashAfter}`);
    }
    if (expectedSha256 && hashAfter !== expectedSha256) {
      throw new Error(
        `Tarball sha256 mismatch after smoke: expected ${expectedSha256}, received ${hashAfter}`,
      );
    }
    console.log("Packed install smoke passed.");
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    if (keepTemp) {
      console.log(`Keeping packed install smoke temp dir: ${tmp}`);
    }
    cleanup();
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
