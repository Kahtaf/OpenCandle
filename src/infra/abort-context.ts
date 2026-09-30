import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The abort signal of the run a tool is executing for. Pi hands each tool an
 * AbortSignal that fires when the user presses Stop, but tools and providers
 * do not thread it through every call. The tool adapter runs each tool inside
 * this context so shared infrastructure (the HTTP client, raw provider
 * fetches) can abort its in-flight requests without every tool signature
 * changing.
 */
const runAbortSignal = new AsyncLocalStorage<AbortSignal>();

export function runWithAbortSignal<T>(signal: AbortSignal | undefined, fn: () => T): T {
  if (!signal) return fn();
  return runAbortSignal.run(signal, fn);
}

/** The current run's abort signal, when code runs inside a tool execution. */
export function currentAbortSignal(): AbortSignal | undefined {
  return runAbortSignal.getStore();
}

/** `signal` combined with the current run's abort signal, if there is one. */
export function withCurrentAbortSignal(signal: AbortSignal): AbortSignal {
  const runSignal = currentAbortSignal();
  return runSignal ? AbortSignal.any([signal, runSignal]) : signal;
}
