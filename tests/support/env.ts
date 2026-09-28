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

/**
 * Ambient cloud credentials Pi's model registry accepts without a keyed
 * variable: `getEnvApiKey` counts Bedrock (AWS profile, IAM keys, bearer token,
 * container/IRSA roles) and Vertex (ADC plus project and location) as signed in
 * by checking these by name, so the `findEnvKeys` probe above cannot see them.
 */
export const AMBIENT_MODEL_AUTH_ENV_NAMES = [
  "AWS_PROFILE",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_PROJECT",
  "GCLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
] as const;

/** A variable name shaped like a credential, whether or not a registry knows it. */
export const CREDENTIAL_ENV_NAME =
  /(_API_KEY|_API_TOKEN|_ACCESS_TOKEN|_AUTH_TOKEN|_SECRET|_SECRET_KEY)$/;

/**
 * Host settings stripped before an in-process test file runs: `EVAL_TIER` and
 * every `OPENCANDLE_*` variable. That covers the flags that register live or
 * browser cases and the runtime settings that change behavior under test (a
 * stale `OPENCANDLE_ROUTER_MODE` makes `loadConfig` throw; a notification
 * webhook URL could turn a delivery test into a real POST).
 */
export const HOST_SETTING_ENV_NAME = /^(EVAL_TIER|OPENCANDLE_.+)$/;
