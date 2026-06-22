import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuthStorage,
  createAgentSessionRuntime,
  createAgentSessionServices,
  DefaultPackageManager,
  getAgentDir,
  InteractiveMode,
  initTheme,
  ModelRegistry,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { loadEnv } from "./config.js";
import { renderDoctorReport } from "./doctor/render.js";
import { buildDoctorReport, type DoctorModelSetupState } from "./doctor/report.js";
import { getProvider, type ProviderId } from "./onboarding/providers.js";
import {
  clearProviderOnboardingEntry,
  loadOnboardingState,
  saveOnboardingState,
} from "./onboarding/state.js";
import { createOpenCandleSession } from "./pi/session.js";
import { continueOpenCandleSession } from "./pi/session-storage.js";

const require = createRequire(import.meta.url);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function handlePackageCommand(
  args: string[],
  cwd: string,
  agentDir: string,
): Promise<boolean> {
  const [command, ...rest] = args;
  if (!command || !["install", "remove", "uninstall", "list", "update"].includes(command)) {
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

async function handleGuiCommand(args: string[], cwd: string): Promise<boolean> {
  if (args[0] !== "gui") return false;

  const tsxCli = require.resolve("tsx/cli");
  const serverPath = resolve(packageRoot, "gui/server/server.ts");
  const child = spawn(process.execPath, [tsxCli, serverPath, ...args.slice(1)], {
    cwd,
    env: process.env,
    stdio: "inherit",
  });

  const exitCode = await new Promise<number>((resolveExit) => {
    child.on("close", (code, signal) => {
      if (signal) {
        resolveExit(1);
      } else {
        resolveExit(code ?? 0);
      }
    });
  });
  process.exitCode = exitCode;
  return true;
}

async function handleMonitorCommand(args: string[], cwd: string): Promise<boolean> {
  if (args[0] !== "monitor") return false;

  const tsxCli = require.resolve("tsx/cli");
  const monitorPath = resolve(packageRoot, "src/monitor.ts");
  const child = spawn(process.execPath, [tsxCli, monitorPath, ...args.slice(1)], {
    cwd,
    env: process.env,
    stdio: "inherit",
  });

  const exitCode = await new Promise<number>((resolveExit) => {
    child.on("close", (code, signal) => {
      if (signal) {
        resolveExit(1);
      } else {
        resolveExit(code ?? 0);
      }
    });
  });
  process.exitCode = exitCode;
  return true;
}

async function handleDoctorCommand(
  args: string[],
  cwd: string,
  agentDir: string,
): Promise<boolean> {
  if (args[0] !== "doctor") return false;

  const json = args.includes("--json");
  const enableFlag = args.findIndex((arg) => arg === "--enable" || arg === "--reenable");
  if (enableFlag >= 0) {
    const providerId = args[enableFlag + 1] as ProviderId | undefined;
    if (!providerId) {
      console.error("Usage: opencandle doctor --enable <provider>");
      process.exitCode = 1;
      return true;
    }
    try {
      getProvider(providerId);
    } catch {
      console.error(`Unknown provider: ${providerId}`);
      process.exitCode = 1;
      return true;
    }
    saveOnboardingState(clearProviderOnboardingEntry(loadOnboardingState(), providerId));
    if (!json) console.log(`Re-enabled ${providerId}.`);
  }

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const report = await buildDoctorReport({
    cwd,
    agentDir,
    includeSessions: args.includes("--sessions"),
    includeGui: args.includes("--full"),
    modelSetup: buildCliModelSetupState(modelRegistry, settingsManager),
  });
  console.log(json ? JSON.stringify(report, null, 2) : renderDoctorReport(report));
  return true;
}

function buildCliModelSetupState(
  modelRegistry: ModelRegistry,
  settingsManager: SettingsManager,
): DoctorModelSetupState {
  modelRegistry.refresh();
  const provider = settingsManager.getDefaultProvider();
  const modelId = settingsManager.getDefaultModel();
  const activeModel = provider && modelId ? modelRegistry.find(provider, modelId) : undefined;
  if (activeModel && modelRegistry.hasConfiguredAuth(activeModel)) {
    return {
      requirement: "ready",
      currentModel: `${activeModel.provider}/${activeModel.id}`,
    };
  }

  const availableModels = modelRegistry.getAvailable().map((model) => ({
    provider: model.provider,
    id: model.id,
    label: `${model.provider}/${model.id}`,
  }));
  return {
    requirement: availableModels.length > 0 ? "select_model" : "connect_auth",
    currentModel: activeModel ? `${activeModel.provider}/${activeModel.id}` : undefined,
    availableModels,
  };
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const cwd = process.cwd();
  const agentDir = getAgentDir();

  loadEnv();

  if (await handleGuiCommand(rawArgs, cwd)) {
    return;
  }

  if (await handleMonitorCommand(rawArgs, cwd)) {
    return;
  }

  if (await handleDoctorCommand(rawArgs, cwd, agentDir)) {
    return;
  }

  if (await handlePackageCommand(rawArgs, cwd, agentDir)) {
    return;
  }

  // Default: start the OpenCandle interactive agent
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const shouldSuppressFallbackMessage = modelRegistry.getAvailable().length === 0;

  initTheme(settingsManager.getTheme(), true);

  const sessionManager = continueOpenCandleSession(cwd);

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
        agentDir: opts.agentDir,
        settingsManager,
        authStorage,
        modelRegistry,
        sessionManager: opts.sessionManager,
        bindExtensions: false,
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
