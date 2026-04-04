import type { ProviderTracker } from "./provider-tracker.js";

interface RunContext {
  providerTracker: ProviderTracker;
}

let activeContext: RunContext | null = null;

/** Set the active run context. Called by SessionCoordinator at workflow start. */
export function setRunContext(ctx: RunContext): void {
  activeContext = ctx;
}

/** Clear the active run context. Called when a workflow ends or is cancelled. */
export function clearRunContext(): void {
  activeContext = null;
}

/** Get the current run's ProviderTracker, or undefined outside a workflow. */
export function getProviderTracker(): ProviderTracker | undefined {
  return activeContext?.providerTracker;
}
