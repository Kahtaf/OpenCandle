import { findEnvKeys, getProviders } from "@earendil-works/pi-ai/compat";

// Deliberately free of `src/` imports: `tests/setup/isolate-env.ts` loads this
// before every test file, and any `src/` module it pulled in would be cached
// with real dependencies before the test file's `vi.mock(...)` calls apply.

/**
 * Every environment variable Pi's model registry reads a credential from.
 *
 * Derived, never typed out: Pi accepts every provider it knows, so a
 * hand-written list silently stops covering a run the day a contributor puts a
 * new provider key in their `.env`. `findEnvKeys` reports only variables that
 * are already set, so probe it with a recording proxy that answers every lookup.
 */
export function modelCredentialEnvNames(): string[] {
  const names = new Set<string>();
  const probe = new Proxy({} as Record<string, string>, {
    get: (_target, property) => {
      if (typeof property !== "string") return undefined;
      names.add(property);
      return "probe";
    },
  });
  for (const provider of getProviders()) findEnvKeys(provider, probe);
  return [...names];
}

/**
 * OpenCandle's keyed data-provider variables. Typed out only because the
 * registry lives in `src/`; a unit test pins it to `PROVIDERS` so it cannot drift.
 */
export const DATA_PROVIDER_ENV_NAMES = [
  "ALPHA_VANTAGE_API_KEY",
  "FRED_API_KEY",
  "FINNHUB_API_KEY",
  "BRAVE_API_KEY",
  "EXA_API_KEY",
  "LSE_API_KEY",
] as const;

/** A variable name shaped like a credential, whether or not a registry knows it. */
export const CREDENTIAL_ENV_NAME =
  /(_API_KEY|_API_TOKEN|_ACCESS_TOKEN|_AUTH_TOKEN|_SECRET|_SECRET_KEY)$/;

/** Ambient flags that register live or browser cases (same set the test inventory strips). */
export const LIVE_LANE_ENV_FLAG = /^(EVAL_TIER$|OPENCANDLE_.*EVAL|OPENCANDLE_GUI_)/;
