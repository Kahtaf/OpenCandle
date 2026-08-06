import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as configModule from "../../../src/config.js";
import * as openUrlModule from "../../../src/infra/open-url.js";
import { runProviderConnect } from "../../../src/onboarding/connect.js";
import * as validationModule from "../../../src/onboarding/validation.js";

function createUi(overrides: Partial<any> = {}) {
  return {
    select: vi.fn(),
    input: vi.fn(),
    notify: vi.fn(),
    confirm: vi.fn(),
    custom: vi.fn(),
    ...overrides,
  };
}

describe("runProviderConnect", () => {
  let tempDir: string;
  const originalHome = process.env.OPENCANDLE_HOME;
  const originalEnvAV = process.env.ALPHA_VANTAGE_API_KEY;
  const originalCwd = process.cwd();

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "oc-connect-test-"));
    process.env.OPENCANDLE_HOME = tempDir;
    // Chdir to tempDir so loadEnv can't find the repo's .env and reset
    // ALPHA_VANTAGE_API_KEY from the real environment. Matches the pattern
    // the finance-setup tests used to use.
    process.chdir(tempDir);
    delete process.env.ALPHA_VANTAGE_API_KEY;
    // Reset the module-level cached Config to the fresh tempDir so keys
    // leaked from prior test cases don't cross-contaminate assertions.
    configModule.loadConfig();
    vi.spyOn(openUrlModule, "openInBrowser").mockResolvedValue(undefined);
    // Default to `valid` so the pre-existing tests (which predate Task 8
    // validation) don't hit the network. Individual tests override this.
    vi.spyOn(validationModule, "validateCredential").mockResolvedValue({
      status: "valid",
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    if (originalHome == null) delete process.env.OPENCANDLE_HOME;
    else process.env.OPENCANDLE_HOME = originalHome;
    if (originalEnvAV == null) delete process.env.ALPHA_VANTAGE_API_KEY;
    else process.env.ALPHA_VANTAGE_API_KEY = originalEnvAV;
    vi.restoreAllMocks();
  });

  it("opens browser, prompts for key, persists to file config, returns connected", async () => {
    const ui = createUi();
    ui.input.mockResolvedValueOnce("  test-av-key  ");
    const ctx = { hasUI: true, ui } as any;

    const result = await runProviderConnect(ctx, "alpha_vantage");

    expect(openUrlModule.openInBrowser).toHaveBeenCalledWith(
      "https://www.alphavantage.co/support/#api-key",
    );
    expect(ui.input).toHaveBeenCalled();
    expect(result.status).toBe("connected");

    // Key should be persisted in the file config.
    const configPath = join(tempDir, "config.json");
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.providers.alphaVantage.apiKey).toBe("test-av-key");
  });

  it("returns cancelled when user cancels at the paste prompt", async () => {
    const ui = createUi();
    ui.input.mockResolvedValueOnce(undefined); // user cancelled
    const ctx = { hasUI: true, ui } as any;

    const result = await runProviderConnect(ctx, "alpha_vantage");

    expect(result.status).toBe("cancelled");
    // Nothing should have been written.
    const configPath = join(tempDir, "config.json");
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      parsed = null;
    }
    // Either config.json doesn't exist, or it has no providers.alphaVantage.
    if (parsed && typeof parsed === "object" && "providers" in parsed) {
      expect((parsed as any).providers?.alphaVantage).toBeUndefined();
    }
  });

  it("returns cancelled when user pastes empty string", async () => {
    const ui = createUi();
    ui.input.mockResolvedValueOnce("   ");
    const ctx = { hasUI: true, ui } as any;

    const result = await runProviderConnect(ctx, "alpha_vantage");

    expect(result.status).toBe("cancelled");
  });

  it("returns blocked_by_env when the env var is already set", async () => {
    process.env.ALPHA_VANTAGE_API_KEY = "already-in-env";
    const ui = createUi();
    const ctx = { hasUI: true, ui } as any;

    const result = await runProviderConnect(ctx, "alpha_vantage");

    expect(result.status).toBe("blocked_by_env");
    // Browser should NOT be opened.
    expect(openUrlModule.openInBrowser).not.toHaveBeenCalled();
    // Input should NOT be requested.
    expect(ui.input).not.toHaveBeenCalled();
    // User should have been notified about the env-precedence situation.
    expect(ui.notify).toHaveBeenCalled();
    const notifyCall = ui.notify.mock.calls[0] as [string, string];
    expect(notifyCall[0].toLowerCase()).toContain("environment variable");
  });

  it("merges the new key with existing config.json fields", async () => {
    // Prime config.json with unrelated fields.
    const configPath = join(tempDir, "config.json");
    const existing = {
      providers: {
        fred: { apiKey: "existing-fred-key" },
      },
      debate: false,
    };
    const fs = await import("node:fs");
    fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), "utf-8");

    const ui = createUi();
    ui.input.mockResolvedValueOnce("new-av-key");
    const ctx = { hasUI: true, ui } as any;

    await runProviderConnect(ctx, "alpha_vantage");

    const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(parsed.providers.fred.apiKey).toBe("existing-fred-key");
    expect(parsed.providers.alphaVantage.apiKey).toBe("new-av-key");
    expect(parsed.debate).toBe(false);
  });

  it("refreshes the cached Config so subsequent hasCredential returns true", async () => {
    const ui = createUi();
    ui.input.mockResolvedValueOnce("fresh-key");
    const ctx = { hasUI: true, ui } as any;

    // Seed the cached Config to be empty first.
    configModule.loadConfig();

    await runProviderConnect(ctx, "alpha_vantage");

    // After runProviderConnect, getConfig should reflect the new key.
    const cfg = configModule.getConfig();
    expect(cfg.alphaVantageApiKey).toBe("fresh-key");
  });

  it("returns invalid_key and does NOT persist when validation responds with 401", async () => {
    // Task 8.3 — a 401/403 validation response (or a provider-specific
    // "invalid" body) indicates the pasted key is definitively wrong. The
    // flow must short-circuit BEFORE writing anything to config.json so the
    // user's prior (possibly working) state is preserved.
    vi.mocked(validationModule.validateCredential).mockResolvedValue({
      status: "invalid",
      httpStatus: 401,
    });

    const ui = createUi();
    ui.input.mockResolvedValueOnce("bad-key-1");
    const ctx = { hasUI: true, ui } as any;

    const result = await runProviderConnect(ctx, "alpha_vantage");

    expect(result.status).toBe("invalid_key");
    if (result.status === "invalid_key") {
      expect(result.httpStatus).toBe(401);
    }

    // No config.json written, or at least no alphaVantage entry.
    const configPath = join(tempDir, "config.json");
    if (existsSync(configPath)) {
      const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(parsed.providers?.alphaVantage).toBeUndefined();
    }

    // Cached config must not reflect the bad key either.
    const cfg = configModule.getConfig();
    expect(cfg.alphaVantageApiKey).toBeFalsy();

    // User saw an error notification.
    const notifyCalls = ui.notify.mock.calls.map((call: any[]) => [call[0], call[1]]);
    const errorNotify = notifyCalls.find((c: any[]) => c[1] === "error");
    expect(errorNotify).toBeDefined();
    expect(errorNotify?.[0].toLowerCase()).toMatch(/rejected|invalid/);
  });

  it("returns invalid_key when Alpha Vantage responds 200 with an invalid-api Information body", async () => {
    vi.mocked(validationModule.validateCredential).mockResolvedValue({
      status: "invalid",
      message:
        "Invalid API key. Please claim your free API key on https://www.alphavantage.co/support/#api-key",
    });

    const ui = createUi();
    ui.input.mockResolvedValueOnce("bad-av-key");
    const ctx = { hasUI: true, ui } as any;

    const result = await runProviderConnect(ctx, "alpha_vantage");

    expect(result.status).toBe("invalid_key");
    // The key was not persisted.
    const configPath = join(tempDir, "config.json");
    if (existsSync(configPath)) {
      const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(parsed.providers?.alphaVantage).toBeUndefined();
    }
  });

  it("does not persist the key on transient validation failure", async () => {
    vi.mocked(validationModule.validateCredential).mockResolvedValue({
      status: "transient",
      reason: "ECONNRESET",
    });

    const ui = createUi();
    ui.input.mockResolvedValueOnce("maybe-good-key");
    const ctx = { hasUI: true, ui } as any;

    const result = await runProviderConnect(ctx, "alpha_vantage");

    expect(result.status).toBe("verification_failed");

    const configPath = join(tempDir, "config.json");
    if (existsSync(configPath)) {
      const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(parsed.providers?.alphaVantage).toBeUndefined();
    }

    const notifyCalls = ui.notify.mock.calls.map((call: any[]) => [call[0], call[1]]);
    const errorNotify = notifyCalls.find((c: any[]) => c[1] === "error");
    expect(errorNotify).toBeDefined();
    expect(errorNotify?.[0]).toContain("ECONNRESET");
  });

  it("calls validateCredential with the trimmed key and the correct provider id", async () => {
    const validateSpy = vi.mocked(validationModule.validateCredential);
    validateSpy.mockResolvedValue({ status: "valid" });

    const ui = createUi();
    ui.input.mockResolvedValueOnce("   padded-key   ");
    const ctx = { hasUI: true, ui } as any;

    await runProviderConnect(ctx, "fred");

    expect(validateSpy).toHaveBeenCalledWith("fred", "padded-key");
  });

  it("does not call validateCredential at all when the env-var short-circuit fires", async () => {
    process.env.ALPHA_VANTAGE_API_KEY = "from-env";
    const validateSpy = vi.mocked(validationModule.validateCredential);

    const ui = createUi();
    const ctx = { hasUI: true, ui } as any;

    const result = await runProviderConnect(ctx, "alpha_vantage");

    expect(result.status).toBe("blocked_by_env");
    expect(validateSpy).not.toHaveBeenCalled();
  });
});
