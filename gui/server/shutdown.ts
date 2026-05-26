import type { Server } from "node:http";

type Cleanup = () => void | Promise<void>;

export interface GracefulShutdownOptions {
  server: Server;
  cleanup: Cleanup;
  exit: (code: number) => void;
  timeoutMs?: number;
}

export function createGracefulShutdown({
  server,
  cleanup,
  exit,
  timeoutMs = 1000,
}: GracefulShutdownOptions): () => void {
  let shuttingDown = false;
  let exited = false;

  const finish = () => {
    if (exited) return;
    exited = true;
    exit(0);
  };

  return () => {
    if (shuttingDown) return;
    shuttingDown = true;

    const timeout = setTimeout(() => {
      server.closeAllConnections?.();
      finish();
    }, timeoutMs);
    timeout.unref?.();

    void Promise.resolve()
      .then(cleanup)
      .catch(() => undefined)
      .finally(() => {
        server.close(() => {
          clearTimeout(timeout);
          finish();
        });
      });
  };
}
