import type { ProviderTracker } from "./provider-tracker.js";

interface RunContext {
  providerTracker: ProviderTracker;
}

export interface RunContextToken {
  readonly id: symbol;
}

let activeContext: RunContext | null = null;
let activeToken: RunContextToken | null = null;

/** Set the active run context. Called by SessionCoordinator at workflow start. */
export function setRunContext(ctx: RunContext): RunContextToken {
  const token = { id: Symbol("run-context") };
  activeContext = ctx;
  activeToken = token;
  return token;
}

/** Clear the active run context. Called when a workflow ends or is cancelled. */
export function clearRunContext(token?: RunContextToken): void {
  if (token && activeToken !== token) return;
  activeContext = null;
  activeToken = null;
}

/** Get the current run's ProviderTracker, or undefined outside a workflow. */
export function getProviderTracker(): ProviderTracker | undefined {
  return activeContext?.providerTracker;
}
