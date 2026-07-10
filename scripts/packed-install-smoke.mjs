#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keepTemp = process.env.OPENCANDLE_KEEP_PACK_SMOKE === "1";

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
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
    shell: process.platform === "win32",
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  const allowed = options.allowedExitCodes ?? [0];
  if (!allowed.includes(result.status)) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result.stdout.trim();
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

async function smokeGui(packageDir, env) {
  const port = String(19_000 + Math.floor(Math.random() * 20_000));
  const bin = join(
    packageDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "opencandle.cmd" : "opencandle",
  );
  const child = spawn(bin, ["gui"], {
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
    if (process.platform === "win32") {
      child.kill("SIGTERM");
    } else if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
    await new Promise((resolveExit) => {
      const timeout = setTimeout(() => {
        if (process.platform === "win32") {
          child.kill("SIGKILL");
        } else if (child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }
        resolveExit();
      }, 5_000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolveExit();
      });
    });
  }
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "opencandle-pack-smoke-"));
  try {
    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const packageDir = join(tmp, "consumer");
    const packDir = join(tmp, "pack");
    const homeDir = join(tmp, "home");
    const osHomeDir = join(tmp, "os-home");
    mkdirSync(packageDir);
    mkdirSync(packDir);
    mkdirSync(homeDir);
    mkdirSync(osHomeDir);
    writeFileSync(join(packageDir, "package.json"), '{"type":"module","private":true}\n');

    run("npm", ["run", "prepare"]);
    const packOutput = capture("npm", ["pack", "--pack-destination", packDir]);
    const tarballName = packOutput
      .split(/\r?\n/)
      .reverse()
      .find((line) => line.trim().endsWith(".tgz"))
      ?.trim();
    if (!tarballName) {
      throw new Error("npm pack did not report a tarball name");
    }
    const tarballPath = join(packDir, tarballName);
    if (!existsSync(tarballPath)) {
      throw new Error(`Packed tarball was not created at ${tarballPath}`);
    }

    run("npm", ["install", "--no-audit", "--no-fund", tarballPath], { cwd: packageDir });

    const importSpecifiers = [
      packageJson.name,
      ...Object.keys(packageJson.exports).map((key) => {
        return key === "." ? packageJson.name : `${packageJson.name}/${key.slice(2)}`;
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
    run("npx", ["--no-install", "opencandle", "doctor"], {
      cwd: packageDir,
      env,
      allowedExitCodes: [0, 1],
    });

    const packedPackageJson = JSON.parse(
      readFileSync(join(packageDir, "node_modules", packageJson.name, "package.json"), "utf8"),
    );
    const version = capture("npx", ["--no-install", "opencandle", "--version"], {
      cwd: packageDir,
      env,
    });
    if (version !== packedPackageJson.version) {
      throw new Error(
        `Expected packed CLI version ${packedPackageJson.version}, received ${version}`,
      );
    }

    const help = capture("npx", ["--no-install", "opencandle", "--help"], { cwd: packageDir, env });
    if (!help.includes("Usage: opencandle")) {
      throw new Error("Packed CLI help did not include usage information");
    }

    const doctorJson = capture("npx", ["--no-install", "opencandle", "doctor", "--json"], {
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
    await smokeGui(packageDir, env);
    console.log("Packed install smoke passed.");
  } finally {
    if (keepTemp) {
      console.log(`Keeping packed install smoke temp dir: ${tmp}`);
    } else {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
