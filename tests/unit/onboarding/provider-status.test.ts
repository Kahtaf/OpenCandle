import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configModule from "../../../src/config.js";
import {
  clearProviderStatusCache,
  probeProviderStatus,
  type CommandRunner,
} from "../../../src/onboarding/provider-status.js";

const DEFAULT_EMPTY_CONFIG = {
  alphaVantageApiKey: undefined,
  fredApiKey: undefined,
  braveApiKey: undefined,
  exaApiKey: undefined,
  finnhubApiKey: undefined,
  debate: true,
  sentiment: undefined,
};

beforeEach(() => {
  clearProviderStatusCache();
  delete process.env.FRED_API_KEY;
  vi.spyOn(configModule, "getConfig").mockReturnValue(DEFAULT_EMPTY_CONFIG as any);
  vi.spyOn(configModule, "loadFileConfig").mockReturnValue({});
});

afterEach(() => {
  clearProviderStatusCache();
  delete process.env.FRED_API_KEY;
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

  it("runs the Twitter session smoke only when explicitly requested", async () => {
    const calls: Array<readonly string[]> = [];
    const runner: CommandRunner = async (_command, args) => {
      calls.push(args);
      return { code: 0, stdout: "{\"ok\":true,\"schema_version\":\"1\",\"data\":[]}", stderr: "" };
    };

    const status = await probeProviderStatus("twitter", { mode: "session", commandRunner: runner });

    expect(status).toMatchObject({
      providerId: "twitter",
      kind: "external-tool",
      mode: "session",
      state: "session_ok",
    });
    expect(calls).toEqual([["feed", "--max", "0", "--json"]]);
  });

  it("classifies Twitter missing-cookie session errors", async () => {
    const runner: CommandRunner = async () => ({
      code: 1,
      stdout: "",
      stderr: "No Twitter cookies found. Log into x.com in Chrome.",
    });

    const status = await probeProviderStatus("twitter", { mode: "session", commandRunner: runner });

    expect(status).toMatchObject({
      kind: "external-tool",
      mode: "session",
      state: "session_missing",
    });
    expect(status.message).not.toContain("auth_token");
  });

  it("bounds public HTTP reachability and caches the result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const first = await probeProviderStatus("yahoo", { fetchImpl: fetchImpl as any });
    const second = await probeProviderStatus("yahoo", { fetchImpl: fetchImpl as any });

    expect(first).toMatchObject({
      providerId: "yahoo",
      kind: "public-http",
      state: "reachable",
      statusCode: 200,
      cacheHit: false,
    });
    expect(second).toMatchObject({ cacheHit: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: "HEAD" });
    expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
