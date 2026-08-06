import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BrowserHostedGuiRuntime } from "../../../gui/hosted/runtime/browser-hosted-gui-runtime.js";

describe("BrowserHostedGuiRuntime session creation", () => {
  it("single-flights concurrent session creation so callers receive one durable session", async () => {
    let releaseBootstrap!: () => void;
    const bootstrapGate = new Promise<void>((resolve) => {
      releaseBootstrap = resolve;
    });
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-hosted-session-creation-"));
    const runtime = new BrowserHostedGuiRuntime(
      {
        cwd: "/workspace",
        sessionDir,
        stateFile: "/state/current.sqlite3",
        relayProviders: [],
      },
      {} as never,
    );
    (runtime as any).bootstrap = vi.fn(async () => {
      await bootstrapGate;
      return {};
    });
    (runtime as any).buildBootstrap = vi.fn(async (manager: { getSessionId: () => string }) => ({
      sessionId: manager.getSessionId(),
    }));

    const first = runtime.newSession();
    const second = runtime.newSession();

    await vi.waitFor(() => expect((runtime as any).bootstrap).toHaveBeenCalledOnce());
    releaseBootstrap();

    const [firstBootstrap, secondBootstrap] = await Promise.all([first, second]);
    expect(firstBootstrap.sessionId).toBe(secondBootstrap.sessionId);
    expect((runtime as any).buildBootstrap).toHaveBeenCalledOnce();
  });
});
