import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "../config.js";
import { getUsage, isOverSoftThreshold, LSE_MONTHLY_BYTE_CAP } from "../infra/lse-byte-budget.js";
import { getUnsupportedNodeVersionMessage } from "../infra/node-version.js";
import {
  getConfigPath,
  getOnboardingPath,
  getOpenCandleHomeDir,
  getStateDbPath,
  resolveOpenCandlePath,
} from "../infra/opencandle-paths.js";
import {
  type CommandRunner,
  type ProviderStatus,
  probeAllProviderStatuses,
  probeProviderStatus,
} from "../onboarding/provider-status.js";
import {
  getProvider,
  isExternalToolProvider,
  listAllProviders,
  type ProviderDescriptor,
  type ProviderId,
} from "../onboarding/providers.js";
import { loadOnboardingState } from "../onboarding/state.js";

export const DOCTOR_REPORT_SCHEMA_VERSION = 1;

export type DoctorCheckStatus = "pass" | "warn" | "fail" | "skip" | "unknown";
export type DoctorCapabilityImpact = "core" | "optional";
export type DoctorOverallStatus = "ready" | "degraded" | "blocked";

export interface DoctorCheck {
  readonly id: string;
  readonly label: string;
  readonly status: DoctorCheckStatus;
  readonly capability: DoctorCapabilityImpact;
  readonly summary: string;
  readonly remediation?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface DoctorSection {
  readonly id: string;
  readonly label: string;
  readonly status: DoctorOverallStatus;
  readonly checks: DoctorCheck[];
}

export interface DoctorModelSetupState {
  readonly requirement: "ready" | "select_model" | "connect_auth" | "unknown";
  readonly currentModel?: string;
  readonly availableModels?: readonly { provider: string; id: string; label?: string }[];
}

export interface DoctorGuiStatusInput {
  readonly host: string;
  readonly port: number;
  readonly role?: string;
  readonly reachable?: boolean;
  readonly healthEndpoint?: string;
}

export interface BuildDoctorReportOptions {
  readonly cwd?: string;
  readonly agentDir?: string;
  readonly now?: Date;
  readonly includeSessions?: boolean;
  readonly includeGui?: boolean;
  readonly gui?: DoctorGuiStatusInput;
  readonly modelSetup?: DoctorModelSetupState;
  readonly commandRunner?: CommandRunner;
  readonly fetchImpl?: typeof fetch;
  readonly providerStatuses?: readonly ProviderStatus[];
}

export interface DoctorReport {
  readonly schemaVersion: number;
  readonly generatedAt: string;
  readonly status: DoctorOverallStatus;
  readonly summary: string;
  readonly sections: DoctorSection[];
  readonly metadata: {
    readonly cwd: string;
    readonly agentDir?: string;
    readonly opencandleHome: string;
    readonly opencandleHomeSource: "default" | "env";
    /** Whether notification webhook delivery has a target. The URL itself is never included. */
    readonly notificationWebhookConfigured: boolean;
  };
}

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);

interface BetterSqliteDatabase {
  close(): void;
}

type BetterSqliteConstructor = new (path: string) => BetterSqliteDatabase;

export async function buildDoctorReport(
  options: BuildDoctorReportOptions = {},
): Promise<DoctorReport> {
  const now = options.now ?? new Date();
  const cwd = options.cwd ?? process.cwd();
  const home = getOpenCandleHomeDir();
  const runtimeChecks = buildRuntimeChecks(cwd);
  const stateChecks = buildStateChecks(home, options.agentDir);
  const providerChecks = stateChecks.some(
    (check) => check.id === "state.config" && check.status === "fail",
  )
    ? [providerChecksSkippedForInvalidConfig()]
    : await buildProviderChecks(options);
  const sections: DoctorSection[] = [
    section("runtime", "Runtime", runtimeChecks),
    section("state", "Local state", stateChecks),
    section("model", "Model", [buildModelCheck(options.modelSetup)]),
    section("providers", "Providers", providerChecks),
  ];

  if (options.includeGui || options.gui) {
    sections.push(section("gui", "GUI", await buildGuiChecks(options)));
  }

  const allChecks = sections.flatMap((candidate) => candidate.checks);
  const status = deriveDoctorStatus(allChecks);
  return {
    schemaVersion: DOCTOR_REPORT_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    status,
    summary: buildSummary(status, allChecks),
    sections,
    metadata: {
      cwd,
      agentDir: options.agentDir,
      opencandleHome: home,
      opencandleHomeSource: process.env.OPENCANDLE_HOME ? "env" : "default",
      notificationWebhookConfigured: Boolean(
        process.env.OPENCANDLE_NOTIFICATION_WEBHOOK_URL?.trim(),
      ),
    },
  };
}

export function deriveDoctorStatus(checks: readonly DoctorCheck[]): DoctorOverallStatus {
  if (checks.some((candidate) => candidate.capability === "core" && candidate.status === "fail")) {
    return "blocked";
  }
  if (
    checks.some(
      (candidate) =>
        candidate.status === "warn" ||
        (candidate.capability === "optional" && candidate.status === "fail") ||
        (candidate.capability === "core" && candidate.status === "unknown"),
    )
  ) {
    return "degraded";
  }
  return "ready";
}

function section(id: string, label: string, checks: DoctorCheck[]): DoctorSection {
  return {
    id,
    label,
    status: deriveDoctorStatus(checks),
    checks,
  };
}

function buildRuntimeChecks(cwd: string): DoctorCheck[] {
  const packageJson = readPackageJson();
  const nodeMessage = getUnsupportedNodeVersionMessage();
  const sqliteLoads = canLoadBetterSqlite();
  return [
    {
      id: "runtime.opencandle_version",
      label: "OpenCandle version",
      status: "pass",
      capability: "core",
      summary: packageJson.version ? `OpenCandle ${packageJson.version}` : "Version unavailable",
      metadata: { version: packageJson.version ?? null },
    },
    {
      id: "runtime.node",
      label: "Node.js",
      status: nodeMessage ? "fail" : "pass",
      capability: "core",
      summary: nodeMessage
        ? `Unsupported Node ${process.versions.node}`
        : `Node ${process.version}`,
      remediation: nodeMessage ?? undefined,
      metadata: { version: process.versions.node, supportedRange: packageJson.engines?.node },
    },
    {
      id: "runtime.better_sqlite3",
      label: "better-sqlite3",
      status: sqliteLoads ? "pass" : "fail",
      capability: "core",
      summary: sqliteLoads ? "Native SQLite binding loads" : "Native SQLite binding failed to load",
      remediation: sqliteLoads
        ? undefined
        : "Run `npm rebuild better-sqlite3` or reinstall dependencies under the active Node with `npm install`.",
    },
    {
      id: "runtime.cwd",
      label: "Working directory",
      status: "pass",
      capability: "core",
      summary: cwd,
      metadata: { cwd },
    },
  ];
}

function buildStateChecks(home: string, agentDir: string | undefined): DoctorCheck[] {
  return [
    {
      id: "state.opencandle_home",
      label: "OpenCandle home",
      status: directoryUsable(home) ? "pass" : existsSync(home) ? "warn" : "skip",
      capability: "core",
      summary: `${home} (${process.env.OPENCANDLE_HOME ? "environment override" : "default"})`,
      remediation: existsSync(home)
        ? "Ensure the OpenCandle home directory is readable and writable."
        : "OpenCandle will create this directory when state is first written.",
      metadata: { path: home, source: process.env.OPENCANDLE_HOME ? "env" : "default" },
    },
    piAgentDirCheck(agentDir),
    configCheck(),
    fileStateCheck("state.onboarding", "Onboarding state", getOnboardingPath()),
    fileStateCheck("state.sqlite", "State database", getStateDbPath()),
    fileStateCheck(
      "state.sentiment",
      "Sentiment history store",
      resolveOpenCandlePath("sentinel.db"),
    ),
  ];
}

function configCheck(): DoctorCheck {
  const path = getConfigPath();
  if (!existsSync(path)) {
    return {
      id: "state.config",
      label: "Config file",
      status: "skip",
      capability: "core",
      summary: "No config file yet",
      remediation:
        "No action required. OpenCandle will create config.json when settings are saved.",
      metadata: { path },
    };
  }

  try {
    JSON.parse(readFileSync(path, "utf-8"));
    return {
      id: "state.config",
      label: "Config file",
      status: "pass",
      capability: "core",
      summary: "config.json parses",
      metadata: { path },
    };
  } catch (error) {
    return {
      id: "state.config",
      label: "Config file",
      status: "fail",
      capability: "core",
      summary: "config.json is invalid JSON",
      remediation: `Repair or remove ${path}. ${error instanceof Error ? error.message : String(error)}`,
      metadata: { path },
    };
  }
}

function piAgentDirCheck(agentDir: string | undefined): DoctorCheck {
  if (!agentDir) {
    return {
      id: "state.pi_agent_dir",
      label: "Pi agent directory",
      status: "unknown",
      capability: "core",
      summary: "Pi agent directory was not checked",
      remediation: "Run doctor from an initialized OpenCandle CLI or GUI session.",
    };
  }
  return {
    id: "state.pi_agent_dir",
    label: "Pi agent directory",
    status: directoryUsable(agentDir) ? "pass" : existsSync(agentDir) ? "warn" : "skip",
    capability: "core",
    summary: agentDir,
    remediation: existsSync(agentDir)
      ? "Ensure the Pi agent directory is readable and writable."
      : "Pi will create this directory when model/auth state is first written.",
    metadata: { path: agentDir },
  };
}

function fileStateCheck(id: string, label: string, path: string): DoctorCheck {
  if (!existsSync(path)) {
    return {
      id,
      label,
      status: "skip",
      capability: "core",
      summary: "Not created yet",
      remediation: "No action required for a new install.",
      metadata: { path },
    };
  }
  return {
    id,
    label,
    status: canAccess(path) ? "pass" : "warn",
    capability: "core",
    summary: canAccess(path) ? "Readable and writable" : "Access may be limited",
    remediation: canAccess(path) ? undefined : `Ensure ${path} is readable and writable.`,
    metadata: { path },
  };
}

function buildModelCheck(modelSetup: DoctorModelSetupState | undefined): DoctorCheck {
  const state = modelSetup ?? { requirement: "unknown" as const };
  if (state.requirement === "ready") {
    return {
      id: "model.readiness",
      label: "Model readiness",
      status: "pass",
      capability: "core",
      summary: state.currentModel ? `Ready with ${state.currentModel}` : "Model is ready",
      metadata: { currentModel: state.currentModel ?? null },
    };
  }
  if (state.requirement === "select_model") {
    return {
      id: "model.readiness",
      label: "Model readiness",
      status: "fail",
      capability: "core",
      summary: "Model credentials exist but no active model is selected",
      remediation:
        "Run `/setup` in the CLI or choose an available model in the GUI model setup panel.",
      metadata: { requirement: state.requirement, availableModels: state.availableModels ?? [] },
    };
  }
  if (state.requirement === "connect_auth") {
    return {
      id: "model.readiness",
      label: "Model readiness",
      status: "fail",
      capability: "core",
      summary: "No usable model credentials are configured",
      remediation: "Run `/setup` in the CLI or paste a model API key in the GUI model setup panel.",
      metadata: { requirement: state.requirement },
    };
  }
  return {
    id: "model.readiness",
    label: "Model readiness",
    status: "unknown",
    capability: "core",
    summary: "Model readiness was not checked",
    remediation:
      "Run the doctor command from an initialized OpenCandle session for model setup state.",
    metadata: { requirement: "unknown" },
  };
}

async function buildProviderChecks(options: BuildDoctorReportOptions): Promise<DoctorCheck[]> {
  const providers = listAllProviders();
  const statuses =
    options.providerStatuses ??
    (await probeAllProviderStatuses({
      commandRunner: options.commandRunner,
      fetchImpl: options.fetchImpl,
      force: true,
      respectSkipped: true,
    }));
  const checks: DoctorCheck[] = statuses.map((status) => providerStatusCheck(status));

  if (getConfig().lseApiKey && isOverSoftThreshold()) {
    const percentUsed = Math.round((getUsage().bytesUsed / LSE_MONTHLY_BYTE_CAP) * 100);
    checks.push({
      id: "provider.lse.byte_budget",
      label: "London Strategic Edge",
      status: "warn",
      capability: "optional",
      summary: `London Strategic Edge monthly data allowance is ${percentUsed}% used; answers use Yahoo/Alpha Vantage until the month resets.`,
      remediation: "Wait for the monthly allowance to reset before relying on this provider again.",
    });
  }

  for (const provider of providers.filter(isExternalToolProvider)) {
    const installStatus = statuses.find(
      (status) => status.providerId === provider.id && status.kind === "external-tool",
    );
    if (installStatus?.state === "skipped") continue;
    if (installStatus?.state !== "installed") continue;

    if (options.includeSessions) {
      const status = await probeProviderStatus(provider.id, {
        mode: "session",
        force: true,
        respectSkipped: true,
        commandRunner: options.commandRunner,
      });
      checks.push(providerStatusCheck(status, "session"));
    } else {
      checks.push(sessionNotCheckedCheck(provider));
    }
  }

  return checks;
}

function providerChecksSkippedForInvalidConfig(): DoctorCheck {
  return {
    id: "providers.config_blocked",
    label: "Provider checks",
    status: "skip",
    capability: "optional",
    summary: "Skipped because config.json is invalid",
    remediation: "Repair the config file, then rerun doctor to check provider readiness.",
  };
}

function providerStatusCheck(status: ProviderStatus, modeOverride?: "session"): DoctorCheck {
  const provider = getProvider(status.providerId);
  const capability = provider.tier === "hard" ? "core" : "optional";
  const metadata = {
    providerId: status.providerId,
    category: provider.category,
    tier: provider.tier,
    kind: status.kind,
    state: status.state,
    unlocks: provider.unlocks,
  };
  if (status.kind === "api-key") {
    const configuredBefore = wasProviderConfigured(status.providerId);
    const missing = status.state === "missing";
    const neverConnected = missing && !configuredBefore;
    return {
      id: `provider.${status.providerId}.credential`,
      label: provider.displayName,
      status: status.state === "configured" ? "pass" : neverConnected ? "skip" : "warn",
      capability,
      summary:
        status.state === "configured"
          ? `Configured via ${status.credentialSource}`
          : neverConnected
            ? "Not connected — optional."
            : "Credential is missing",
      remediation:
        status.state === "configured"
          ? undefined
          : `${provider.instructionsHint}. Run /connect ${provider.id}.`,
      metadata: { ...metadata, credentialSource: status.credentialSource },
    };
  }

  if (status.kind === "public-http") {
    const ok = status.state === "reachable";
    return {
      id: `provider.${status.providerId}.reachability`,
      label: provider.displayName,
      status: ok ? "pass" : "fail",
      capability,
      summary: ok ? "Reachable" : `Not reachable (${status.state})`,
      remediation: ok
        ? undefined
        : `Check network connectivity and retry. OpenCandle uses ${provider.displayName} through a public HTTP endpoint.`,
      metadata: { ...metadata, statusCode: status.statusCode ?? null },
    };
  }

  if (modeOverride === "session" || status.mode === "session") {
    const ok = status.state === "session_ok";
    return {
      id: `provider.${status.providerId}.session`,
      label: `${provider.displayName} browser session`,
      status: ok ? "pass" : "warn",
      capability: "optional",
      summary: ok ? "Browser session is usable" : (status.message ?? `Session ${status.state}`),
      remediation: ok ? undefined : sessionRemediation(status.providerId, status.installCmd),
      metadata,
    };
  }

  const installed = status.state === "installed";
  const missingBeforeSetup =
    status.state === "missing" && !wasProviderConfigured(status.providerId);
  return {
    id: `provider.${status.providerId}.binary`,
    label: `${provider.displayName} CLI`,
    status: installed
      ? "pass"
      : status.state === "skipped"
        ? "skip"
        : status.state === "missing"
          ? missingBeforeSetup
            ? "skip"
            : "warn"
          : "unknown",
    capability: "optional",
    summary: installed
      ? "Installed"
      : missingBeforeSetup
        ? "Not connected — optional."
        : (status.message ?? `CLI ${status.state}`),
    remediation: installed
      ? undefined
      : status.state === "skipped"
        ? `Run \`opencandle doctor --enable ${status.providerId}\` to re-enable this provider.`
        : status.installCmd,
    metadata,
  };
}

function wasProviderConfigured(providerId: ProviderId): boolean {
  return loadOnboardingState().providers[providerId]?.status === "completed";
}

function sessionNotCheckedCheck(provider: ProviderDescriptor): DoctorCheck {
  return {
    id: `provider.${provider.id}.session`,
    label: `${provider.displayName} browser session`,
    status: "unknown",
    capability: "optional",
    summary: "Not checked",
    remediation: "Run `opencandle doctor --sessions` to check browser-cookie session readiness.",
    metadata: { providerId: provider.id, category: provider.category, tier: provider.tier },
  };
}

async function buildGuiChecks(options: BuildDoctorReportOptions): Promise<DoctorCheck[]> {
  if (options.gui?.reachable !== undefined || options.gui?.role) {
    const role = options.gui.role ?? "unknown";
    const reachable = options.gui.reachable ?? true;
    return [
      {
        id: "gui.server",
        label: "GUI server",
        status: reachable ? (role === "follower" ? "warn" : "pass") : "skip",
        capability: "optional",
        summary: reachable
          ? role === "writer"
            ? "GUI server is running and can run sessions"
            : `GUI server is ${role}`
          : "GUI server is not running",
        remediation:
          role === "follower"
            ? "Open the writer GUI process to perform setup mutations."
            : reachable
              ? undefined
              : "Run `opencandle gui` to start the browser workbench.",
        metadata: { ...options.gui },
      },
    ];
  }

  const host = options.gui?.host ?? process.env.OPENCANDLE_GUI_HOST ?? "127.0.0.1";
  const port = options.gui?.port ?? Number(process.env.OPENCANDLE_GUI_PORT ?? 14567);
  const endpoint = options.gui?.healthEndpoint ?? `http://${host}:${port}/health`;
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      signal: AbortSignal.timeout(1_500),
    });
    const body = await response.json().catch(() => null);
    const role = isRecord(body) && typeof body.role === "string" ? body.role : "unknown";
    const verified =
      response.ok &&
      isRecord(body) &&
      body.ok === true &&
      (role === "writer" || role === "follower");
    return [
      {
        id: "gui.server",
        label: "GUI server",
        status: verified ? (role === "follower" ? "warn" : "pass") : "warn",
        capability: "optional",
        summary: verified
          ? role === "writer"
            ? "GUI server is running and can run sessions"
            : `GUI server is ${role}`
          : response.ok
            ? "OpenCandle GUI health payload was not verified"
            : `GUI health returned HTTP ${response.status}`,
        remediation:
          verified && role === "follower"
            ? "Open the writer GUI process to perform setup mutations."
            : undefined,
        metadata: { host, port, role, endpoint, statusCode: response.status },
      },
    ];
  } catch {
    return [
      {
        id: "gui.server",
        label: "GUI server",
        status: "skip",
        capability: "optional",
        summary: "GUI server is not running",
        remediation: "Run `opencandle gui` to start the browser workbench.",
        metadata: { host, port, endpoint },
      },
    ];
  }
}

function sessionRemediation(providerId: ProviderId, installCmd: string | undefined): string {
  if (providerId === "reddit") return "Run `rdt login` and retry `opencandle doctor --sessions`.";
  if (providerId === "twitter") {
    return "Stay logged into x.com in a supported browser and retry `opencandle doctor --sessions`.";
  }
  return installCmd ?? "Install and authenticate the external tool.";
}

function buildSummary(status: DoctorOverallStatus, checks: readonly DoctorCheck[]): string {
  if (status === "ready") {
    const unchecked = checks.filter((candidate) => candidate.status === "unknown");
    if (unchecked.length === 0) return "OpenCandle core health is ready.";
    if (unchecked.every((candidate) => candidate.capability === "optional")) {
      return `OpenCandle core health is ready with ${unchecked.length} optional ${unchecked.length === 1 ? "capability" : "capabilities"} unchecked.`;
    }
    return `OpenCandle is usable with ${unchecked.length} unchecked ${unchecked.length === 1 ? "capability" : "capabilities"}.`;
  }
  const firstBlocking = checks.find(
    (candidate) => candidate.capability === "core" && candidate.status === "fail",
  );
  if (firstBlocking) return `OpenCandle is blocked: ${firstBlocking.summary}.`;
  const issueCount = checks.filter((candidate) =>
    ["warn", "fail", "unknown"].includes(candidate.status),
  ).length;
  return `OpenCandle is usable with ${issueCount} degraded or unchecked ${issueCount === 1 ? "capability" : "capabilities"}.`;
}

function readPackageJson(): { version?: string; engines?: { node?: string } } {
  try {
    return JSON.parse(readFileSync(resolve(PACKAGE_ROOT, "package.json"), "utf-8")) as {
      version?: string;
      engines?: { node?: string };
    };
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function canLoadBetterSqlite(): boolean {
  try {
    const Database = require("better-sqlite3") as BetterSqliteConstructor;
    const db = new Database(":memory:");
    db.close();
    return true;
  } catch {
    return false;
  }
}

function directoryUsable(path: string): boolean {
  try {
    return (
      statSync(path).isDirectory() &&
      canAccess(path, constants.R_OK | constants.W_OK | constants.X_OK)
    );
  } catch {
    return false;
  }
}

function canAccess(path: string, mode = constants.R_OK | constants.W_OK): boolean {
  try {
    accessSync(path, mode);
    return true;
  } catch {
    return false;
  }
}
