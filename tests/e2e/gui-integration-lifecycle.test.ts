import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isProcessGroupAlive, startIsolatedGuiServer } from "../support/gui/server.js";

const runGuiIntegration = process.env.OPENCANDLE_GUI_INTEGRATION === "1";

/**
 * Lifecycle proof for the isolated GUI server: a normally stopped server must
 * leave no process-group members or temporary home behind, and a server that
 * never becomes healthy must clean up the same way before the original startup
 * error is rethrown.
 */
describe.skipIf(!runGuiIntegration)("isolated GUI server lifecycle", () => {
  it("stops the server process group and removes the temporary home", async () => {
    const server = await startIsolatedGuiServer({ cwd: process.cwd() });
    const pid = server.child.pid;
    expect(pid).toBeTruthy();
    expect(existsSync(server.homeDir)).toBe(true);

    const health = await fetch(`${server.baseUrl}/health`);
    expect(health.ok).toBe(true);

    await server.stop();

    expect(existsSync(server.homeDir)).toBe(false);
    expect(isProcessGroupAlive(pid as number)).toBe(false);
    // Nothing is listening on the port once the server is gone.
    await expect(fetch(`${server.baseUrl}/health`)).rejects.toThrow();
  }, 60_000);

  it("cleans the process group and temporary home when startup never becomes healthy", async () => {
    // A port that answers, but never healthy, keeps `waitForHealth` retrying
    // until its short timeout while the real server cannot take the port.
    const blocker = createHttpServer((_request, response) => {
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("not ready");
    });
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const address = blocker.address();
    if (!address || typeof address !== "object") throw new Error("blocker did not bind a port");

    const homeDir = mkdtempSync(join(tmpdir(), "opencandle-gui-lifecycle-"));
    let childPid: number | undefined;
    try {
      await expect(
        startIsolatedGuiServer({
          cwd: process.cwd(),
          port: address.port,
          homeDir,
          healthTimeoutMs: 1_000,
          onSpawn: (child) => {
            childPid = child.pid;
          },
        }),
      ).rejects.toThrow(/did not become healthy|EADDRINUSE|ENOENT/i);

      expect(childPid).toBeTruthy();
      expect(existsSync(homeDir)).toBe(false);
      expect(isProcessGroupAlive(childPid as number)).toBe(false);
    } finally {
      await closeServer(blocker);
      rmSync(homeDir, { recursive: true, force: true });
    }
  }, 60_000);
});

async function closeServer(server: HttpServer): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
