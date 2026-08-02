import { createProviderRelay } from "./relay.js";

type ProviderRelayWorkerEnv = Env & {
  RELAY_RUNTIME_TOKEN_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
};

export default createProviderRelay() satisfies ExportedHandler<ProviderRelayWorkerEnv>;
