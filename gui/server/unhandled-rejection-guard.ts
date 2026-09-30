/**
 * Last-resort guard for the GUI server process. Stop aborts a run's provider
 * requests, and each request still in flight then fails with the run's abort
 * reason. If one of those promises has no handler, Node's default is to exit,
 * which takes every other session's run down with the stopped one (#263).
 *
 * Only abort-shaped rejections are absorbed, and each is logged as its own
 * event so the leak stays visible and fixable at its source. Any other
 * unhandled rejection is rethrown from the listener, which Node turns into an
 * uncaught exception: the same exit as without this guard.
 */

interface RejectionEventTarget {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): unknown;
}

export interface UnhandledRejectionGuardOptions {
  target?: RejectionEventTarget;
  log?: (line: string) => void;
  /** Node flags in effect; an explicit --unhandled-rejections mode wins. */
  execArgv?: readonly string[];
}

export function isAbortRejection(reason: unknown): boolean {
  return (
    typeof reason === "object" &&
    reason !== null &&
    (reason as { name?: unknown }).name === "AbortError"
  );
}

/** Returns false when an explicit Node mode is set and the guard is not installed. */
export function installUnhandledRejectionGuard(
  options: UnhandledRejectionGuardOptions = {},
): boolean {
  const target = options.target ?? process;
  const log = options.log ?? ((line: string) => console.warn(line));
  const execArgv = options.execArgv ?? [
    ...process.execArgv,
    ...(process.env.NODE_OPTIONS ?? "").split(/\s+/),
  ];
  if (execArgv.some((arg) => arg.startsWith("--unhandled-rejections"))) return false;

  target.on("unhandledRejection", (reason: unknown) => {
    if (!isAbortRejection(reason)) throw reason;
    log(`[opencandle-gui] event=unhandled_abort_rejection ${describeAbort(reason)}`);
  });
  return true;
}

function describeAbort(reason: unknown): string {
  const error = reason as { name?: unknown; message?: unknown; stack?: unknown };
  // Frames only name source files; the message is the abort reason's own text.
  const frames =
    typeof error.stack === "string"
      ? error.stack
          .split("\n")
          .slice(1, 6)
          .map((frame) => frame.trim())
          .join(" | ")
      : "";
  return `name=${String(error.name)} message=${JSON.stringify(String(error.message ?? ""))}${
    frames ? ` stack=${JSON.stringify(frames)}` : ""
  }`;
}
