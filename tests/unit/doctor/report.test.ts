import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetConfigCache } from "../../../src/config.js";
import { renderDoctorReport } from "../../../src/doctor/render.js";
import {
  buildDoctorReport,
  type DoctorCheck,
  deriveDoctorStatus,
} from "../../../src/doctor/report.js";
import {
  type ApiKeyProviderStatus,
  type CommandRunner,
  clearProviderStatusCache,
  type ExternalToolProviderStatus,
  type PublicHttpProviderStatus,
} from "../../../src/onboarding/provider-status.js";
import {
  markProviderCompleted,
  markProviderNeverAsk,
  saveOnboardingState,
} from "../../../src/onboarding/state.js";

const tempHomes: string[] = [];

afterEach(() => {
  for (const home of tempHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
  clearProviderStatusCache();
  resetConfigCache();
  vi.unstubAllEnvs();
});

function useTempOpenCandleHome(): string {
  const home = mkdtempSync(join(tmpdir(), "opencandle-doctor-"));
  tempHomes.push(home);
  vi.stubEnv("OPENCANDLE_HOME", home);
  return home;
}

function check(overrides: Partial<DoctorCheck>): DoctorCheck {
  return {
    id: "check",
    label: "Check",
    status: "pass",
    capability: "core",
    summary: "ok",
    ...overrides,
  };
}

describe("doctor report", () => {
  it("warns when London Strategic Edge reaches its monthly soft threshold", async () => {
    const home = useTempOpenCandleHome();
    vi.stubEnv("LSE_API_KEY", "lse-test-key");
    resetConfigCache();
    writeFileSync(
      join(home, "lse-byte-budget.json"),
      JSON.stringify({
        month: new Date().toISOString().slice(0, 7),
        bytesUsed: 42_949_672_960,
      }),
    );
    const lseStatus: ApiKeyProviderStatus = {
      providerId: "lse",
      kind: "api-key",
      state: "configured",
      credentialSource: "env",
      checkedAt: new Date().toISOString(),
      cacheHit: false,
    };

    const report = await buildDoctorReport({
      providerStatuses: [lseStatus],
      modelSetup: { requirement: "ready", currentModel: "google/gemini-2.5-flash" },
    });
    const budgetChecks = report.sections
      .find((section) => section.id === "providers")
      ?.checks.filter((candidate) => candidate.id === "provider.lse.byte_budget");

    expect(budgetChecks).toHaveLength(1);
    expect(budgetChecks?.[0]).toMatchObject({
      label: "London Strategic Edge",
      status: "warn",
      capability: "optional",
      summary:
        "London Strategic Edge monthly data allowance is 80% used; answers use Yahoo/Alpha Vantage until the month resets.",
      remediation: expect.any(String),
    });
    expect(renderDoctorReport(report)).toContain(`Fix: ${budgetChecks?.[0]?.remediation}`);
  });

  it("does not warn about the London Strategic Edge budget without a configured key", async () => {
    const home = useTempOpenCandleHome();
    vi.stubEnv("LSE_API_KEY", "");
    resetConfigCache();
    writeFileSync(
      join(home, "lse-byte-budget.json"),
      JSON.stringify({
        month: new Date().toISOString().slice(0, 7),
        bytesUsed: 53_687_091_200,
      }),
    );

    const report = await buildDoctorReport({
      providerStatuses: [],
      modelSetup: { requirement: "ready", currentModel: "google/gemini-2.5-flash" },
    });

    expect(
      report.sections
        .find((section) => section.id === "providers")
        ?.checks.some((candidate) => candidate.id === "provider.lse.byte_budget"),
    ).toBe(false);
  });

  it("does not warn about the London Strategic Edge budget below the soft threshold", async () => {
    const home = useTempOpenCandleHome();
    vi.stubEnv("LSE_API_KEY", "lse-test-key");
    resetConfigCache();
    writeFileSync(
      join(home, "lse-byte-budget.json"),
      JSON.stringify({
        month: new Date().toISOString().slice(0, 7),
        bytesUsed: 42_949_672_959,
      }),
    );

    const report = await buildDoctorReport({
      providerStatuses: [],
      modelSetup: { requirement: "ready", currentModel: "google/gemini-2.5-flash" },
    });

    expect(
      report.sections
        .find((section) => section.id === "providers")
        ?.checks.some((candidate) => candidate.id === "provider.lse.byte_budget"),
    ).toBe(false);
  });

  it("derives blocked only from core failures", () => {
    expect(deriveDoctorStatus([check({ status: "fail", capability: "core" })])).toBe("blocked");
    expect(deriveDoctorStatus([check({ status: "fail", capability: "optional" })])).toBe(
      "degraded",
    );
    expect(deriveDoctorStatus([check({ status: "warn", capability: "core" })])).toBe("degraded");
    expect(deriveDoctorStatus([check({ status: "unknown", capability: "optional" })])).toBe(
      "ready",
    );
    // Unverified CORE setup must never read as ready — only unchecked
    // optional capabilities do.
    expect(deriveDoctorStatus([check({ status: "unknown", capability: "core" })])).toBe("degraded");
    expect(deriveDoctorStatus([check({ status: "skip", capability: "optional" })])).toBe("ready");
  });

  it("reports whether notification webhook delivery is configured without exposing the URL", async () => {
    useTempOpenCandleHome();

    const offlineOptions = {
      cwd: process.cwd(),
      commandRunner: (async () => ({ code: 1, stdout: "", stderr: "" })) as CommandRunner,
      fetchImpl: async () => new Response("ok", { status: 200 }),
      modelSetup: { requirement: "ready" as const, currentModel: "google/gemini-2.5-flash" },
    };

    vi.stubEnv("OPENCANDLE_NOTIFICATION_WEBHOOK_URL", "");
    const unset = await buildDoctorReport(offlineOptions);
    expect(unset.metadata.notificationWebhookConfigured).toBe(false);

    vi.stubEnv("OPENCANDLE_NOTIFICATION_WEBHOOK_URL", "https://hooks.example.com/opencandle");
    const configured = await buildDoctorReport(offlineOptions);
    expect(configured.metadata.notificationWebhookConfigured).toBe(true);
    expect(JSON.stringify(configured)).not.toContain("hooks.example.com");
  });

  it("does not run browser-session probes unless sessions are requested", async () => {
    useTempOpenCandleHome();
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const commandRunner: CommandRunner = async (command, args) => {
      calls.push({ command, args });
      return { code: 0, stdout: "ok", stderr: "" };
    };

    const report = await buildDoctorReport({
      cwd: process.cwd(),
      agentDir: "/tmp/opencandle-agent",
      now: new Date("2026-06-22T12:00:00.000Z"),
      commandRunner,
      fetchImpl: async () => new Response("ok", { status: 200 }),
      modelSetup: { requirement: "ready", currentModel: "google/gemini-2.5-flash" },
    });

    expect(report.schemaVersion).toBe(1);
    expect(report.metadata.agentDir).toBe("/tmp/opencandle-agent");
    expect(
      report.sections
        .flatMap((section) => section.checks)
        .find((candidate) => candidate.id === "state.pi_agent_dir"),
    ).toMatchObject({
      summary: "/tmp/opencandle-agent",
    });
    expect(calls).toEqual([
      { command: "twitter", args: ["--version"] },
      { command: "rdt", args: ["--version"] },
    ]);
    expect(
      report.sections
        .flatMap((section) => section.checks)
        .filter((candidate) => candidate.id.endsWith(".session"))
        .map((candidate) => candidate.status),
    ).toEqual(["unknown", "unknown"]);
  });

  it("reports ready core health while naming unchecked optional sessions", async () => {
    const home = useTempOpenCandleHome();
    const installed = (providerId: "twitter" | "reddit"): ExternalToolProviderStatus => ({
      providerId,
      kind: "external-tool",
      mode: "install",
      state: "installed",
      installCmd: providerId === "twitter" ? "uv tool install twitter-cli" : "uv tool install rdt",
      checkedAt: "2026-06-22T12:00:00.000Z",
      cacheHit: false,
    });

    const report = await buildDoctorReport({
      cwd: process.cwd(),
      agentDir: home,
      providerStatuses: [installed("twitter"), installed("reddit")],
      modelSetup: { requirement: "ready", currentModel: "google/gemini-2.5-flash" },
    });

    expect(report.status).toBe("ready");
    expect(report.summary).toBe(
      "OpenCandle core health is ready with 2 optional capabilities unchecked.",
    );
  });

  it("warns when state directory paths point at files", async () => {
    const homeFile = join(tmpdir(), `opencandle-home-file-${Date.now()}`);
    const agentFile = join(tmpdir(), `opencandle-agent-file-${Date.now()}`);
    writeFileSync(homeFile, "not a directory");
    writeFileSync(agentFile, "not a directory");
    tempHomes.push(homeFile, agentFile);
    vi.stubEnv("OPENCANDLE_HOME", homeFile);

    const report = await buildDoctorReport({
      cwd: process.cwd(),
      agentDir: agentFile,
      now: new Date("2026-06-22T12:00:00.000Z"),
      providerStatuses: [],
      modelSetup: { requirement: "ready", currentModel: "google/gemini-2.5-flash" },
    });

    const checks = report.sections.flatMap((section) => section.checks);
    expect(checks.find((candidate) => candidate.id === "state.opencandle_home")).toMatchObject({
      status: "warn",
    });
    expect(checks.find((candidate) => candidate.id === "state.pi_agent_dir")).toMatchObject({
      status: "warn",
    });
  });

  it("runs explicit session probes and keeps optional session failures non-blocking", async () => {
    useTempOpenCandleHome();
    const installed = (providerId: "twitter" | "reddit"): ExternalToolProviderStatus => ({
      providerId,
      kind: "external-tool",
      mode: "install",
      state: "installed",
      installCmd: providerId === "twitter" ? "uv tool install twitter-cli" : "uv tool install rdt",
      checkedAt: "2026-06-22T12:00:00.000Z",
      cacheHit: false,
    });
    const commandRunner: CommandRunner = async (command, args) => {
      if (args.includes("--version")) return { code: 0, stdout: "ok", stderr: "" };
      if (command === "rdt") {
        return {
          code: 0,
          stdout: '{"ok":true,"schema_version":"1","data":{"authenticated":false}}',
          stderr: "",
        };
      }
      return { code: 0, stdout: '{"ok":true,"schema_version":"1","data":[]}', stderr: "" };
    };

    const report = await buildDoctorReport({
      cwd: process.cwd(),
      agentDir: "/tmp/opencandle-agent",
      now: new Date("2026-06-22T12:00:00.000Z"),
      includeSessions: true,
      commandRunner,
      fetchImpl: async () => new Response("ok", { status: 200 }),
      providerStatuses: [installed("twitter"), installed("reddit")],
      modelSetup: { requirement: "ready", currentModel: "google/gemini-2.5-flash" },
    });

    const redditSession = report.sections
      .flatMap((section) => section.checks)
      .find((candidate) => candidate.id === "provider.reddit.session");

    expect(redditSession).toMatchObject({
      status: "warn",
      capability: "optional",
    });
    expect(report.status).toBe("degraded");
  });

  it("honors skipped external-tool provider preferences", async () => {
    useTempOpenCandleHome();
    saveOnboardingState(markProviderNeverAsk({ version: 2, providers: {} }, "reddit"));
    const commandRunner = vi.fn<CommandRunner>(async () => ({
      code: 0,
      stdout: "ok",
      stderr: "",
    }));

    const report = await buildDoctorReport({
      cwd: process.cwd(),
      agentDir: "/tmp/opencandle-agent",
      now: new Date("2026-06-22T12:00:00.000Z"),
      commandRunner,
      fetchImpl: async () => new Response("ok", { status: 200 }),
      modelSetup: { requirement: "ready", currentModel: "google/gemini-2.5-flash" },
    });

    const redditCli = report.sections
      .flatMap((section) => section.checks)
      .find((candidate) => candidate.id === "provider.reddit.binary");

    expect(redditCli).toMatchObject({
      status: "skip",
      capability: "optional",
      summary: expect.stringContaining("Skipped by user preference"),
      remediation: "Run `opencandle doctor --enable reddit` to re-enable this provider.",
    });
    expect(commandRunner).not.toHaveBeenCalledWith("rdt", expect.anything(), expect.anything());
  });

  it("does not add session checks for skipped external-tool providers", async () => {
    const skipped = (providerId: "twitter" | "reddit"): ExternalToolProviderStatus => ({
      providerId,
      kind: "external-tool",
      mode: "install",
      state: "skipped",
      installCmd: providerId === "twitter" ? "uv tool install twitter-cli" : "uv tool install rdt",
      message: "Skipped by user preference",
      checkedAt: "2026-06-22T12:00:00.000Z",
      cacheHit: false,
    });

    const report = await buildDoctorReport({
      cwd: process.cwd(),
      agentDir: "/tmp/opencandle-agent",
      includeSessions: true,
      providerStatuses: [skipped("twitter"), skipped("reddit")],
      modelSetup: { requirement: "ready", currentModel: "google/gemini-2.5-flash" },
    });

    const checkIds = report.sections.flatMap((section) => section.checks.map((check) => check.id));

    expect(checkIds).toContain("provider.twitter.binary");
    expect(checkIds).toContain("provider.reddit.binary");
    expect(checkIds).not.toContain("provider.twitter.session");
    expect(checkIds).not.toContain("provider.reddit.session");
  });

  it("does not add session checks when the external CLI is missing", async () => {
    useTempOpenCandleHome();
    const missing = (providerId: "twitter" | "reddit"): ExternalToolProviderStatus => ({
      providerId,
      kind: "external-tool",
      mode: "install",
      state: "missing",
      installCmd: providerId === "twitter" ? "uv tool install twitter-cli" : "uv tool install rdt",
      checkedAt: "2026-06-22T12:00:00.000Z",
      cacheHit: false,
    });

    const report = await buildDoctorReport({
      cwd: process.cwd(),
      agentDir: "/tmp/opencandle-agent",
      includeSessions: true,
      providerStatuses: [missing("twitter"), missing("reddit")],
      modelSetup: { requirement: "ready", currentModel: "google/gemini-2.5-flash" },
    });

    const checkIds = report.sections.flatMap((section) => section.checks.map((check) => check.id));

    expect(checkIds).toContain("provider.twitter.binary");
    expect(checkIds).toContain("provider.reddit.binary");
    expect(checkIds).not.toContain("provider.twitter.session");
    expect(checkIds).not.toContain("provider.reddit.session");
    expect(report.status).toBe("ready");
    expect(
      report.sections
        .flatMap((section) => section.checks)
        .filter((check) => check.id.endsWith(".binary"))
        .map((check) => check.status),
    ).toEqual(["skip", "skip"]);
  });

  it("skips never-connected keyed providers without degrading their section", async () => {
    useTempOpenCandleHome();
    const missingKey = (providerId: "alpha_vantage" | "fred"): ApiKeyProviderStatus => ({
      providerId,
      kind: "api-key",
      state: "missing",
      credentialSource: "absent",
      checkedAt: "2026-06-22T12:00:00.000Z",
      cacheHit: false,
    });
    const yahooReachable: PublicHttpProviderStatus = {
      providerId: "yahoo",
      kind: "public-http",
      state: "reachable",
      statusCode: 200,
      checkedAt: "2026-06-22T12:00:00.000Z",
      cacheHit: false,
    };

    const report = await buildDoctorReport({
      cwd: process.cwd(),
      agentDir: "/tmp/opencandle-agent",
      providerStatuses: [missingKey("alpha_vantage"), missingKey("fred"), yahooReachable],
      modelSetup: { requirement: "ready", currentModel: "google/gemini-2.5-flash" },
    });

    expect(report.status).toBe("ready");
    expect(report.sections.find((section) => section.id === "providers")?.status).toBe("ready");
    expect(
      report.sections
        .flatMap((section) => section.checks)
        .filter((check) => check.id.endsWith(".credential"))
        .map((check) => check.status),
    ).toEqual(["skip", "skip"]);
  });

  it("warns when a previously configured provider credential is now missing", async () => {
    const home = useTempOpenCandleHome();
    saveOnboardingState(markProviderCompleted({ version: 2, providers: {} }, "alpha_vantage"));
    const missingKey: ApiKeyProviderStatus = {
      providerId: "alpha_vantage",
      kind: "api-key",
      state: "missing",
      credentialSource: "absent",
      checkedAt: "2026-06-22T12:00:00.000Z",
      cacheHit: false,
    };

    const report = await buildDoctorReport({
      cwd: process.cwd(),
      agentDir: home,
      providerStatuses: [missingKey],
      modelSetup: { requirement: "ready", currentModel: "google/gemini-2.5-flash" },
    });

    expect(report.status).toBe("degraded");
    expect(report.sections.find((section) => section.id === "providers")?.status).toBe("degraded");
    expect(report.sections.flatMap((section) => section.checks)).toContainEqual(
      expect.objectContaining({
        id: "provider.alpha_vantage.credential",
        status: "warn",
        summary: "Credential is missing",
      }),
    );
  });

  it("forces fresh provider probes for each doctor report", async () => {
    useTempOpenCandleHome();
    const commandRunner = vi.fn<CommandRunner>(async () => ({
      code: 0,
      stdout: "ok",
      stderr: "",
    }));
    const options = {
      cwd: process.cwd(),
      agentDir: "/tmp/opencandle-agent",
      commandRunner,
      fetchImpl: async () => new Response("ok", { status: 200 }),
      modelSetup: { requirement: "ready" as const, currentModel: "google/gemini-2.5-flash" },
    };

    await buildDoctorReport(options);
    await buildDoctorReport(options);

    expect(commandRunner.mock.calls.filter(([command]) => command === "twitter")).toHaveLength(2);
    expect(commandRunner.mock.calls.filter(([command]) => command === "rdt")).toHaveLength(2);
  });

  it("does not pass GUI health for unverified 200 responses", async () => {
    useTempOpenCandleHome();

    const report = await buildDoctorReport({
      cwd: process.cwd(),
      agentDir: "/tmp/opencandle-agent",
      includeGui: true,
      providerStatuses: [],
      fetchImpl: async () =>
        new Response("<html>not opencandle</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      modelSetup: { requirement: "ready", currentModel: "google/gemini-2.5-flash" },
    });

    const gui = report.sections
      .flatMap((section) => section.checks)
      .find((candidate) => candidate.id === "gui.server");

    expect(gui).toMatchObject({
      status: "warn",
      summary: "OpenCandle GUI health payload was not verified",
    });
  });

  it("reports an invalid config file as a blocking core failure", async () => {
    const home = useTempOpenCandleHome();
    writeFileSync(join(home, "config.json"), "{nope");
    const commandRunner = vi.fn<CommandRunner>();

    const report = await buildDoctorReport({
      cwd: process.cwd(),
      agentDir: "/tmp/opencandle-agent",
      now: new Date("2026-06-22T12:00:00.000Z"),
      commandRunner,
      modelSetup: { requirement: "ready" },
    });

    const config = report.sections
      .flatMap((section) => section.checks)
      .find((candidate) => candidate.id === "state.config");

    expect(config).toMatchObject({
      status: "fail",
      capability: "core",
    });
    expect(config?.remediation).toContain("Repair");
    expect(report.status).toBe("blocked");
    expect(commandRunner).not.toHaveBeenCalled();
  });
});
