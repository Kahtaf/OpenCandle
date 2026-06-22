import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
import { markProviderNeverAsk, saveOnboardingState } from "../../../src/onboarding/state.js";

const tempHomes: string[] = [];

afterEach(() => {
  for (const home of tempHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
  clearProviderStatusCache();
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
  it("derives blocked only from core failures", () => {
    expect(deriveDoctorStatus([check({ status: "fail", capability: "core" })])).toBe("blocked");
    expect(deriveDoctorStatus([check({ status: "fail", capability: "optional" })])).toBe(
      "degraded",
    );
    expect(deriveDoctorStatus([check({ status: "warn", capability: "core" })])).toBe("degraded");
    expect(deriveDoctorStatus([check({ status: "skip", capability: "optional" })])).toBe("ready");
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

  it("runs explicit session probes and keeps optional session failures non-blocking", async () => {
    useTempOpenCandleHome();
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
      providerStatuses: [],
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

  it("treats missing keyed data providers as degraded rather than blocked", async () => {
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

    expect(report.status).toBe("degraded");
    expect(
      report.sections
        .flatMap((section) => section.checks)
        .filter((check) => check.id.endsWith(".credential"))
        .map((check) => check.status),
    ).toEqual(["warn", "warn"]);
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
