/**
 * Durable persistence for a cancelled run whose Pi SessionManager has not yet
 * flushed anything to disk.
 *
 * Pi's SessionManager defers every entry until the first assistant message
 * (`_persist` in pi-coding-agent). A Stop that lands before the model ever
 * replies therefore leaves an in-memory-only session: the cancellation marker
 * and the user's prompt vanish on reload. This helper writes the manager's
 * canonical header + entries to the manager's own not-yet-created session file
 * exclusively, then reloads that same file through the public
 * `setSessionFile` API so `flushed` becomes true and later appends land on
 * disk instead of hitting `wx` with `EEXIST`.
 *
 * Scope is deliberately narrow: only persist-enabled sessions whose file is
 * still absent. An already-persisted session stays owned by Pi. Errors are
 * propagated to the caller (the GUI run's existing catch/finally owns cleanup);
 * this helper never fabricates an assistant message and never overwrites an
 * existing file.
 */
import { closeSync, existsSync, openSync, rmSync, writeFileSync } from "node:fs";
import type { SessionManager } from "@earendil-works/pi-coding-agent";

export function persistUnflushedSession(manager: SessionManager): boolean {
  if (!manager.isPersisted()) return false;
  const sessionFile = manager.getSessionFile();
  if (!sessionFile || existsSync(sessionFile)) return false;
  const header = manager.getHeader();
  if (!header) {
    throw new Error("Cannot persist a session without a header");
  }
  const lines = [header, ...manager.getEntries()].map((entry) => JSON.stringify(entry));
  const fd = openSync(sessionFile, "wx", 0o600);
  try {
    for (const line of lines) writeFileSync(fd, `${line}\n`);
  } catch (error) {
    try {
      closeSync(fd);
    } catch {
      // Best-effort close before removing the partial file we created.
    }
    try {
      rmSync(sessionFile, { force: true });
    } catch {
      // Leave the partial file if it cannot be removed; throw the original.
    }
    throw error;
  }
  closeSync(fd);
  manager.setSessionFile(sessionFile);
  return true;
}
