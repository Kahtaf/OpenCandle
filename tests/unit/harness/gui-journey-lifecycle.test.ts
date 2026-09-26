import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { Server as NetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Injects a failure at the single external browser boundary. Everything else
// (model fixture, aux fixture, real GUI child) stays real.
vi.mock("../../support/gui-journey/browser.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../support/gui-journey/browser.js")>();
  return {
    ...actual,
    launchJourneyBrowser: vi.fn(async () => {
      throw new Error("injected browser launch failure");
    }),
  };
});

import { allocatePort, startGuiServer } from "../../support/gui-journey/gui-process.js";
import { startGuiJourneyHarness } from "../../support/gui-journey/journey-harness.js";

/**
 * Records every in-process net.Server that reaches a listening state so the
 * test can prove the fixture HTTP servers were actually closed (not just
 * dereferenced) after a startup failure.
 */
function captureListeningServers(): {
  servers: Set<NetServer>;
  restore: () => void;
} {
  const servers = new Set<NetServer>();
  const original = NetServer.prototype.listen;
  NetServer.prototype.listen = function (this: NetServer, ...args: unknown[]) {
    const result = (original as (...a: unknown[]) => NetServer).apply(this, args);
    const record = () => {
      servers.add(this);
    };
    if (this.listening) record();
    else this.once("listening", record);
    return result;
  } as typeof NetServer.prototype.listen;
  return {
    servers,
    restore: () => {
      NetServer.prototype.listen = original;
    },
  };
}

describe("GUI journey lifecycle", () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    for (const dir of cleanupDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("rejects promptly when the GUI child exits non-zero during health startup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oc-gui-fail-"));
    cleanupDirs.push(dir);
    const bootstrapPath = join(dir, "exit-nonzero.mjs");
    writeFileSync(bootstrapPath, "process.exit(3);\n");

    const port = await allocatePort();
    const startedAt = Date.now();
    await expect(
      startGuiServer({ cwd: process.cwd(), bootstrapPath, port, env: { ...process.env } }),
    ).rejects.toThrow(/exit code 3/i);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  }, 8_000);

  it("closes fixture servers and removes the temp dir when browser startup fails", async () => {
    const capture = captureListeningServers();
    const before = readdirSync(tmpdir()).filter((name) => name.startsWith("oc-gui-journey-"));
    try {
      await expect(
        startGuiJourneyHarness({
          modelScript: () => ({ kind: "text", text: "ok" }),
        }),
      ).rejects.toThrow("injected browser launch failure");
    } finally {
      capture.restore();
    }

    const after = readdirSync(tmpdir()).filter((name) => name.startsWith("oc-gui-journey-"));
    expect(after).toEqual(before);
    expect([...capture.servers].filter((server) => server.listening)).toHaveLength(0);
  }, 30_000);
});
