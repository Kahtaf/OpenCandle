import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDoctorReport,
  type DoctorCheck,
  deriveDoctorStatus,
} from "../../../src/doctor/report.js";
import type { CommandRunner } from "../../../src/onboarding/provider-status.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

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

  it("reports an invalid config file as a blocking core failure", async () => {
    const home = mkdtempSync(join(tmpdir(), "opencandle-doctor-"));
    writeFileSync(join(home, "config.json"), "{nope");
    vi.stubEnv("OPENCANDLE_HOME", home);

    const report = await buildDoctorReport({
      cwd: process.cwd(),
      agentDir: "/tmp/opencandle-agent",
      now: new Date("2026-06-22T12:00:00.000Z"),
      providerStatuses: [],
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
  });
});
