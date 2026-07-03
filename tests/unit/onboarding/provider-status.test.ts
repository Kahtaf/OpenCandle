import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../../src/config.js";
import * as configModule from "../../../src/config.js";
import {
  type CommandRunner,
  clearProviderStatusCache,
  probeProviderStatus,
} from "../../../src/onboarding/provider-status.js";
import { markProviderNeverAsk, saveOnboardingState } from "../../../src/onboarding/state.js";

const DEFAULT_EMPTY_CONFIG = {
  alphaVantageApiKey: undefined,
  fredApiKey: undefined,
  braveApiKey: undefined,
  exaApiKey: undefined,
  finnhubApiKey: undefined,
  debate: true,
  routerMode: "llm",
  toolScopeMode: "observe",
  sentiment: undefined,
} satisfies Config;

beforeEach(() => {
  clearProviderStatusCache();
  delete process.env.FRED_API_KEY;
  vi.spyOn(configModule, "getConfig").mockReturnValue(DEFAULT_EMPTY_CONFIG);
  vi.spyOn(configModule, "loadFileConfig").mockReturnValue({});
});

afterEach(() => {
  clearProviderStatusCache();
  delete process.env.FRED_API_KEY;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("provider status probes", () => {
  it("reports API-key provider source without network probes", async () => {
    process.env.FRED_API_KEY = "fred-key";

    const status = await probeProviderStatus("fred");

    expect(status).toMatchObject({
      providerId: "fred",
      kind: "api-key",
      state: "configured",
      credentialSource: "env",
      cacheHit: false,
    });
  });

  it("checks Twitter passive status with --version only", async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const runner: CommandRunner = async (command, args) => {
      calls.push({ command, args });
      return { code: 0, stdout: "twitter-cli 0.8.5\n", stderr: "" };
    };

    const status = await probeProviderStatus("twitter", { mode: "install", commandRunner: runner });

    expect(status).toMatchObject({
      providerId: "twitter",
      kind: "external-tool",
      mode: "install",
      state: "installed",
      cacheHit: false,
    });
    expect(calls).toEqual([{ command: "twitter", args: ["--version"] }]);
  });

  it("reports missing external tool without treating it like a credential", async () => {
    const runner: CommandRunner = async () => {
      const err = new Error("spawn twitter ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    };

    const status = await probeProviderStatus("twitter", { commandRunner: runner });

    expect(status).toMatchObject({
      providerId: "twitter",
      kind: "external-tool",
      mode: "install",
      state: "missing",
      installCmd: "uv tool install twitter-cli",
    });
  });

  it("finds uv-installed Twitter shims even when the parent PATH is stale", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-twitter-shim-"));
    const bin = join(dir, "twitter");
    writeFileSync(bin, "#!/bin/sh\nprintf 'twitter, version 0.8.5\\n'\n");
    chmodSync(bin, 0o755);
    vi.stubEnv("PATH", tmpdir());
    vi.stubEnv("UV_TOOL_BIN_DIR", dir);

    const status = await probeProviderStatus("twitter", { force: true });

    expect(status).toMatchObject({
      providerId: "twitter",
      kind: "external-tool",
      mode: "install",
      state: "installed",
    });

    rmSync(dir, { recursive: true, force: true });
  });

  it("runs the Twitter session smoke only when explicitly requested", async () => {
    const calls: Array<readonly string[]> = [];
    const runner: CommandRunner = async (_command, args) => {
      calls.push(args);
      return { code: 0, stdout: '{"ok":true,"schema_version":"1","data":[]}', stderr: "" };
    };

    const status = await probeProviderStatus("twitter", { mode: "session", commandRunner: runner });

    expect(status).toMatchObject({
      providerId: "twitter",
      kind: "external-tool",
      mode: "session",
      state: "session_ok",
    });
    expect(calls).toEqual([["feed", "--max", "1", "--json"]]);
  });

  it("checks Reddit passive status with --version only", async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const runner: CommandRunner = async (command, args) => {
      calls.push({ command, args });
      return { code: 0, stdout: "rdt, version 0.4.1\n", stderr: "" };
    };

    const status = await probeProviderStatus("reddit", { mode: "install", commandRunner: runner });

    expect(status).toMatchObject({
      providerId: "reddit",
      kind: "external-tool",
      mode: "install",
      state: "installed",
    });
    expect(calls).toEqual([{ command: "rdt", args: ["--version"] }]);
  });

  it("runs Reddit session status only when explicitly requested", async () => {
    const calls: Array<readonly string[]> = [];
    const runner: CommandRunner = async (_command, args) => {
      calls.push(args);
      return {
        code: 0,
        stdout: '{"ok":true,"schema_version":"1","data":{"authenticated":true}}',
        stderr: "",
      };
    };

    const status = await probeProviderStatus("reddit", { mode: "session", commandRunner: runner });

    expect(status).toMatchObject({
      providerId: "reddit",
      kind: "external-tool",
      mode: "session",
      state: "session_ok",
    });
    expect(calls).toEqual([["status", "--json"]]);
  });

  it("finds uv-installed Reddit shims for session probes even when the parent PATH is stale", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencandle-reddit-shim-"));
    const bin = join(dir, "rdt");
    writeFileSync(
      bin,
      '#!/bin/sh\nprintf \'{"ok":true,"schema_version":"1","data":{"authenticated":true}}\'\n',
    );
    chmodSync(bin, 0o755);
    vi.stubEnv("PATH", tmpdir());
    vi.stubEnv("UV_TOOL_BIN_DIR", dir);

    const status = await probeProviderStatus("reddit", { mode: "session", force: true });

    expect(status).toMatchObject({
      providerId: "reddit",
      kind: "external-tool",
      mode: "session",
      state: "session_ok",
    });

    rmSync(dir, { recursive: true, force: true });
  });

  it("classifies Reddit missing-cookie session errors", async () => {
    const runner: CommandRunner = async () => ({
      code: 0,
      stdout:
        '{"ok":false,"schema_version":"1","error":{"code":"not_authenticated","message":"No Reddit cookies found. Run rdt login."}}',
      stderr: "",
    });

    const status = await probeProviderStatus("reddit", { mode: "session", commandRunner: runner });

    expect(status).toMatchObject({
      providerId: "reddit",
      kind: "external-tool",
      mode: "session",
      state: "session_missing",
    });
    expect(status.message).toContain("No Reddit cookies found");
  });

  it("classifies Reddit authenticated=false status as session missing", async () => {
    const runner: CommandRunner = async () => ({
      code: 0,
      stdout: '{"ok":true,"schema_version":"1","data":{"authenticated":false}}',
      stderr: "",
    });

    const status = await probeProviderStatus("reddit", { mode: "session", commandRunner: runner });

    expect(status).toMatchObject({
      providerId: "reddit",
      kind: "external-tool",
      mode: "session",
      state: "session_missing",
    });
    expect(status.message).toContain("rdt login");
  });

  it("reports skipped external tools from onboarding preferences without probing", async () => {
    const home = mkdtempSync(join(tmpdir(), "opencandle-provider-status-"));
    vi.stubEnv("OPENCANDLE_HOME", home);
    saveOnboardingState(markProviderNeverAsk({ version: 2, providers: {} }, "reddit"));
    const runner = vi.fn<CommandRunner>();

    const status = await probeProviderStatus("reddit", { commandRunner: runner });

    expect(status).toMatchObject({
      providerId: "reddit",
      kind: "external-tool",
      mode: "install",
      state: "skipped",
    });
    expect(status.message).toContain("opencandle doctor --enable reddit");
    expect(runner).not.toHaveBeenCalled();

    rmSync(home, { recursive: true, force: true });
  });

  it("runs forced external tool checks even after the provider was skipped", async () => {
    const home = mkdtempSync(join(tmpdir(), "opencandle-provider-status-force-"));
    vi.stubEnv("OPENCANDLE_HOME", home);
    saveOnboardingState(markProviderNeverAsk({ version: 2, providers: {} }, "reddit"));
    const runner = vi.fn<CommandRunner>(async () => ({
      code: 0,
      stdout: "rdt, version 0.4.1\n",
      stderr: "",
    }));

    const status = await probeProviderStatus("reddit", {
      force: true,
      commandRunner: runner,
    });

    expect(status).toMatchObject({
      providerId: "reddit",
      kind: "external-tool",
      mode: "install",
      state: "installed",
    });
    expect(runner).toHaveBeenCalledWith("rdt", ["--version"], { timeoutMs: 5000 });

    rmSync(home, { recursive: true, force: true });
  });

  it("classifies Twitter missing-cookie session errors", async () => {
    const runner: CommandRunner = async () => ({
      code: 1,
      stdout: "",
      stderr:
        "Cookie: auth_token=secret123; ct0=secret456; twid=u%3D123\nNo Twitter cookies found. Log into x.com in Chrome.",
    });

    const status = await probeProviderStatus("twitter", { mode: "session", commandRunner: runner });

    expect(status).toMatchObject({
      kind: "external-tool",
      mode: "session",
      state: "session_missing",
    });
    expect(status.message).toContain("Cookie: [redacted]");
    expect(status.message).not.toContain("auth_token");
    expect(status.message).not.toContain("secret123");
    expect(status.message).not.toContain("twid");
  });

  it("bounds public HTTP reachability and caches the result", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }) as Response);

    const first = await probeProviderStatus("yahoo", { fetchImpl });
    const second = await probeProviderStatus("yahoo", { fetchImpl });

    expect(first).toMatchObject({
      providerId: "yahoo",
      kind: "public-http",
      state: "reachable",
      statusCode: 200,
      cacheHit: false,
    });
    expect(second).toMatchObject({ cacheHit: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: "GET" });
    expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
