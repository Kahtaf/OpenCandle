import { spawnSync } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getUnsupportedNodeVersionMessage } from "./check-node-version-lib.mjs";

const proofCommand = "npm run gates";
const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const supportedNodeRange = JSON.parse(readFileSync(packageJsonPath, "utf8")).engines.node;

function parseArgs(args) {
  const options = {
    dryRun: false,
    from: undefined,
    skipInstall: false,
    to: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--skip-install") {
      options.skipInstall = true;
    } else if (arg === "--from" || arg === "--to") {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} requires a directory`);
      options[arg === "--from" ? "from" : "to"] = resolve(value);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return options;
}

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: "utf8" });
}

function gitOutput(args, cwd) {
  const result = run("git", args, cwd);
  if (result.status !== 0) throw new Error("not a git checkout");
  return result.stdout.trim();
}

function resolveRoots(options) {
  const currentRoot = options.to ?? gitOutput(["rev-parse", "--show-toplevel"], process.cwd());
  if (options.from) return { currentRoot, mainRoot: options.from };

  const commonDirRaw = gitOutput(["rev-parse", "--git-common-dir"], currentRoot);
  const commonDir = isAbsolute(commonDirRaw) ? commonDirRaw : resolve(currentRoot, commonDirRaw);
  return { currentRoot, mainRoot: dirname(commonDir) };
}

function getBranch(currentRoot) {
  const result = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], currentRoot);
  return result.status === 0 ? result.stdout.trim() : "override-root";
}

function prepareEnv(mainRoot, currentRoot, dryRun) {
  const destination = join(currentRoot, ".env");
  if (existsSync(destination)) return "present";

  const source = join(mainRoot, ".env");
  if (!existsSync(source)) return "missing-source";
  if (dryRun) return "copied (planned, dry-run)";

  try {
    // COPYFILE_EXCL makes the non-overwrite guarantee atomic: a .env created
    // between the existence check above and this copy fails with EEXIST
    // instead of being overwritten.
    copyFileSync(source, destination, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error && error.code === "EEXIST") return "present";
    throw error;
  }
  chmodSync(destination, 0o600);
  return "copied";
}

function dependenciesNeedInstall(root) {
  const nodeModules = join(root, "node_modules");
  if (!existsSync(nodeModules)) return true;

  const lockfile = join(root, "package-lock.json");
  if (!existsSync(lockfile)) return false;

  const installedLockfile = join(nodeModules, ".package-lock.json");
  if (!existsSync(installedLockfile)) return true;
  return statSync(lockfile).mtimeMs > statSync(installedLockfile).mtimeMs;
}

function prepareDependencies(root, options) {
  const installNeeded = dependenciesNeedInstall(root);
  if (options.skipInstall) return "skipped (--skip-install)";
  if (options.dryRun) {
    return installNeeded ? "skipped (npm ci planned, dry-run)" : "skipped (current, dry-run)";
  }
  if (!installNeeded) return "ok";

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["ci"], { cwd: root, stdio: "inherit" });
  return result.status === 0 ? "installed" : "failed";
}

function commandIsPresent(command) {
  const extensions =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];

  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      try {
        accessSync(join(directory, `${command}${extension}`), constants.X_OK);
        return true;
      } catch {
        // Continue checking PATH entries without executing the candidate.
      }
    }
  }
  return false;
}

function blocked(reason) {
  console.log(`blocked: ${reason}; proof command: ${proofCommand}`);
  process.exitCode = 1;
}

let options;
let roots;
try {
  options = parseArgs(process.argv.slice(2));
  roots = resolveRoots(options);
} catch (error) {
  blocked(error instanceof Error ? error.message : String(error));
}

if (options && roots) {
  const nodeError = getUnsupportedNodeVersionMessage();
  let envStatus;
  try {
    envStatus = prepareEnv(roots.mainRoot, roots.currentRoot, options.dryRun);
  } catch {
    envStatus = "copy-failed";
  }
  // Never install under an unsupported runtime: native deps built with the
  // wrong Node leave a worktree that must be rebuilt after switching versions.
  const depsStatus = nodeError
    ? "skipped (unsupported node)"
    : prepareDependencies(roots.currentRoot, options);

  console.log(`branch: ${getBranch(roots.currentRoot)}`);
  console.log(
    `node: ${process.versions.node} ${nodeError ? "unsupported" : "supported"} (${supportedNodeRange})`,
  );
  console.log(`env: ${envStatus}`);
  console.log(`deps: ${depsStatus}`);
  for (const tool of ["codex", "agent-browser", "graphify"]) {
    console.log(`tool: ${tool} ${commandIsPresent(tool) ? "present" : "missing"}`);
  }

  if (nodeError) {
    blocked("unsupported Node version");
  } else if (envStatus === "copy-failed") {
    blocked("unable to copy .env");
  } else if (depsStatus === "failed") {
    blocked("npm ci failed");
  } else {
    console.log(`ready: run ${proofCommand}`);
  }
}
