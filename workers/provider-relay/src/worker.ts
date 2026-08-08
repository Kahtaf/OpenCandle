import { createProviderRelay } from "./relay.js";

type ProviderRelayWorkerEnv = Env & {
  RELAY_RUNTIME_TOKEN_SECRET: string;
};

export default createProviderRelay() satisfies ExportedHandler<ProviderRelayWorkerEnv>;
