#!/usr/bin/env node
import { parseArgs } from "node:util";
import {
  AuthStorage,
  DefaultPackageManager,
  InteractiveMode,
  ModelRegistry,
  SettingsManager,
  SessionManager,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  initTheme,
} from "@mariozechner/pi-coding-agent";
import { createOpenCandleSession } from "./pi/session.js";
import { loadEnv } from "./config.js";

async function handlePackageCommand(
  args: string[],
  cwd: string,
  agentDir: string,
): Promise<boolean> {
  const [command, ...rest] = args;
  if (
    !command ||
    !["install", "remove", "uninstall", "list", "update"].includes(command)
  ) {
    return false;
  }

  const settingsManager = SettingsManager.create(cwd, agentDir);
  const packageManager = new DefaultPackageManager({
    cwd,
    agentDir,
    settingsManager,
  });
  packageManager.setProgressCallback((event) => {
    if (event.type === "start" || event.type === "progress") {
      process.stdout.write(`${event.message}\n`);
    }
  });

  const source = rest.find((a) => !a.startsWith("-"));
  const local = rest.includes("-l") || rest.includes("--local");

  switch (command === "uninstall" ? "remove" : command) {
    case "install": {
      if (!source) {
        console.error("Usage: opencandle install <source> [-l]");
        process.exitCode = 1;
        return true;
      }
      await packageManager.install(source, { local });
      packageManager.addSourceToSettings(source, { local });
      console.log(`Installed ${source}`);
      return true;
    }
    case "remove": {
      if (!source) {
        console.error("Usage: opencandle remove <source> [-l]");
        process.exitCode = 1;
        return true;
      }
      await packageManager.remove(source, { local });
      const removed = packageManager.removeSourceFromSettings(source, {
        local,
      });
      if (!removed) {
        console.error(`No matching package found for ${source}`);
        process.exitCode = 1;
      } else {
        console.log(`Removed ${source}`);
      }
      return true;
    }
    case "list": {
      const globalPkgs = settingsManager.getGlobalSettings().packages ?? [];
      const projectPkgs = settingsManager.getProjectSettings().packages ?? [];
      if (globalPkgs.length === 0 && projectPkgs.length === 0) {
        console.log("No packages installed.");
        return true;
      }
      if (globalPkgs.length > 0) {
        console.log("User packages:");
        for (const pkg of globalPkgs) {
          const s = typeof pkg === "string" ? pkg : pkg.source;
          const path = packageManager.getInstalledPath(s, "user");
          console.log(`  ${s}${path ? `\n    ${path}` : ""}`);
        }
      }
      if (projectPkgs.length > 0) {
        console.log("Project packages:");
        for (const pkg of projectPkgs) {
          const s = typeof pkg === "string" ? pkg : pkg.source;
          const path = packageManager.getInstalledPath(s, "project");
          console.log(`  ${s}${path ? `\n    ${path}` : ""}`);
        }
      }
      return true;
    }
    case "update": {
      await packageManager.update(source);
      console.log(source ? `Updated ${source}` : "All packages updated.");
      return true;
    }
  }
  return false;
}

async function main(): Promise<void> {
  const { positionals } = parseArgs({ allowPositionals: true, strict: false });
  const cwd = process.cwd();
  const agentDir = getAgentDir();

  if (await handlePackageCommand(positionals, cwd, agentDir)) {
    return;
  }

  // Default: start the OpenCandle interactive agent
  loadEnv();
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const shouldSuppressFallbackMessage = modelRegistry.getAvailable().length === 0;

  initTheme(settingsManager.getTheme(), true);

  const sessionManager = SessionManager.create(agentDir);

  const runtime = await createAgentSessionRuntime(
    async (opts) => {
      const services = await createAgentSessionServices({
        cwd: opts.cwd,
        agentDir: opts.agentDir,
        authStorage,
        settingsManager,
        modelRegistry,
      });
      const result = await createOpenCandleSession({
        cwd: opts.cwd,
        settingsManager,
        authStorage,
        modelRegistry,
        sessionManager: opts.sessionManager,
      });
      return {
        ...result,
        services,
        diagnostics: services.diagnostics,
      };
    },
    { cwd, agentDir, sessionManager },
  );

  try {
    const interactiveMode = new InteractiveMode(runtime, {
      modelFallbackMessage: shouldSuppressFallbackMessage
        ? undefined
        : runtime.modelFallbackMessage,
    });
    await interactiveMode.run();
  } finally {
    await runtime.dispose();
  }
}

await main();
