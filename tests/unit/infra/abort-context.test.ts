import { describe, expect, it } from "vitest";
import {
  currentAbortSignal,
  runWithAbortSignal,
  withCurrentAbortSignal,
} from "../../../src/infra/abort-context.js";

// Raw provider fetches (Yahoo, Exa, SEC) combine their own timeout with the
// stopped run's signal, so Stop aborts them without waiting for the timeout.
describe("run abort context", () => {
  it("aborts a provider's timeout signal when the run it belongs to is stopped", () => {
    const run = new AbortController();
    const timeout = new AbortController();
    const combined = runWithAbortSignal(run.signal, () => withCurrentAbortSignal(timeout.signal));
    expect(combined.aborted).toBe(false);
    run.abort();
    expect(combined.aborted).toBe(true);
  });

  it("leaves signals untouched outside a tool run", () => {
    const timeout = new AbortController();
    expect(currentAbortSignal()).toBeUndefined();
    expect(withCurrentAbortSignal(timeout.signal)).toBe(timeout.signal);
    expect(runWithAbortSignal(undefined, () => currentAbortSignal())).toBeUndefined();
  });
});
