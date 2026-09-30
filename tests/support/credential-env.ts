import { PROVIDERS } from "../../src/onboarding/providers.js";
import { AMBIENT_MODEL_AUTH_ENV_NAMES, modelCredentialEnvNames } from "./env.js";

/** OpenCandle's keyed data-provider variables, read from the live registry. */
export function dataProviderEnvNames(): string[] {
  return PROVIDERS.flatMap((descriptor) =>
    descriptor.kind === "api-key" ? [descriptor.envVar] : [],
  );
}

/**
 * Every environment variable that could hand a test process a credential,
 * blanked so it always starts from a genuinely cold home: Pi's model
 * credentials (keyed and ambient cloud auth) plus OpenCandle's keyed data providers.
 *
 * Blank rather than delete: `loadEnv()` only fills keys that are `undefined`,
 * so an empty string also stops a `.env` file from restoring the value.
 */
export function blankedCredentialEnv(): Record<string, string> {
  const names = new Set([
    ...modelCredentialEnvNames(),
    ...AMBIENT_MODEL_AUTH_ENV_NAMES,
    ...dataProviderEnvNames(),
  ]);
  return Object.fromEntries([...names].map((name) => [name, ""]));
}
