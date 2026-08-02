import { createInterface } from "node:readline";
import { resolveHostedBrowserCapabilityReport } from "../../../src/onboarding/providers.js";
import { validateCredential } from "../../../src/onboarding/validation.js";
import { validateModelKey } from "../../../src/onboarding/validate-model-key.js";
import { BrowserHostedGuiRuntime } from "./browser-hosted-gui-runtime.js";
import {
  buildHostedMarketIndicesSnapshot,
  buildHostedMarketQuoteSnapshot,
  buildHostedUnavailableMarketQuoteSnapshot,
  getHostedInstrumentHistorySnapshot,
  getHostedInstrumentOverviewSnapshot,
  getHostedInstrumentQuoteSnapshot,
  searchHostedInstrumentCandidates,
} from "./hosted-market-data-api.js";
import {
  createHostedRelayManifestLoader,
  createHostedRuntimeTokenManager,
  createHostedProviderFetch,
} from "./provider-relay-fetch.js";
import {
  type GuiRequest,
  parseGuiRequest,
  serializeProbeError,
} from "./request-contract.js";
import {
  isFirstClassModelProvider,
  type FirstClassModelProviderId,
  modelSetupProviders,
} from "../../../src/pi/model-provider-metadata.js";

// Four 5 MiB image attachments expand to roughly 27 MiB as base64 JSON.
const MAX_BODY_BYTES = 32 * 1_024 * 1_024;
const CAPABILITIES = ["pi-agent-session", "provider-relay"] as const;
const PROCESS_FRAME_PREFIX = "@@OPENCANDLE@@";
const MODEL_KEYS = modelSetupProviders.map((provider) => process.env[provider.envVar]);
const providerRelayUrl = process.env.OPENCANDLE_PROVIDER_RELAY_URL?.trim() ?? "";
const providerRelayClientId = process.env.OPENCANDLE_PROVIDER_RELAY_CLIENT_ID?.trim() ?? "";
const providerRelayAttestationToken =
  process.env.OPENCANDLE_PROVIDER_RELAY_ATTESTATION_TOKEN?.trim() ?? "";
if (providerRelayUrl && !/^[a-f0-9]{32}$/.test(providerRelayClientId)) {
  throw new Error("OPENCANDLE_PROVIDER_RELAY_CLIENT_ID is invalid");
}
if (
  providerRelayUrl &&
  (!providerRelayAttestationToken || providerRelayAttestationToken.length > 2_048)
) {
  throw new Error("OPENCANDLE_PROVIDER_RELAY_ATTESTATION_TOKEN is invalid");
}
const nativeFetch = globalThis.fetch.bind(globalThis);
const getHostedRuntimeToken = providerRelayUrl
  ? createHostedRuntimeTokenManager({
      relayUrl: providerRelayUrl,
      clientId: providerRelayClientId,
      turnstileToken: providerRelayAttestationToken,
      fetchImpl: nativeFetch,
    })
  : async () => "";
const loadHostedRelayManifest = providerRelayUrl
  ? createHostedRelayManifestLoader({
      relayUrl: providerRelayUrl,
      clientId: providerRelayClientId,
      getRuntimeToken: getHostedRuntimeToken,
      fetchImpl: nativeFetch,
    })
  : async () => undefined;
const initialHostedRelayManifestPromise = loadHostedRelayManifest();
const runtimeEpoch = process.env.OPENCANDLE_RUNTIME_EPOCH;
if (!runtimeEpoch || !/^[a-f0-9]{32}$/.test(runtimeEpoch)) {
  throw new Error("OPENCANDLE_RUNTIME_EPOCH is invalid");
}
const hostedGuiRuntimePromise = initialHostedRelayManifestPromise.then((relayManifest) => {
  globalThis.fetch = createHostedProviderFetch({
    relayUrl: providerRelayUrl,
    clientId: providerRelayClientId,
    fetchImpl: nativeFetch,
    loadRelayManifest: loadHostedRelayManifest,
    getRuntimeToken: getHostedRuntimeToken,
  });
  const selectedProvider = isFirstClassModelProvider(process.env.OPENCANDLE_MODEL_PROVIDER)
    ? process.env.OPENCANDLE_MODEL_PROVIDER
    : undefined;
  const selectedModel = process.env.OPENCANDLE_MODEL_ID?.trim() || undefined;
  const modelCredentials = Object.fromEntries(
    modelSetupProviders.flatMap((provider) => {
      const key = process.env[provider.envVar]?.trim();
      return key ? [[provider.id, key]] : [];
    }),
  );
  return BrowserHostedGuiRuntime.create({
    cwd: process.cwd(),
    sessionDir: `${process.cwd()}/sessions`,
    stateFile: `${process.cwd()}/state/current.sqlite3`,
    currentSessionId: process.env.OPENCANDLE_CURRENT_SESSION_ID,
    modelProvider: selectedProvider,
    modelId: selectedModel,
    modelCredentials,
    relayProviders: relayManifest?.providers ?? [],
  });
});

async function runGuiRequest(request: GuiRequest): Promise<unknown> {
  const runtime = await hostedGuiRuntimePromise;
  switch (request.action) {
    case "bootstrap": {
      await refreshHostedRelayProviders(runtime);
      return runtime.bootstrap();
    }
    case "configure_model":
      runtime.configureModel(request.provider, request.modelId, request.apiKey);
      return runtime.bootstrap();
    case "configure_thinking":
      return runtime.configureThinking(request.level);
    case "validate_provider_key":
      return validateCredential(request.providerId, request.apiKey);
    case "validate_model_key":
      return validateModelKey(request.provider, request.apiKey);
    case "new_session":
      return runtime.newSession();
    case "load_session":
      return runtime.loadSession(request.sessionId);
    case "rename_session":
      return runtime.renameSession(request.sessionId, request.name);
    case "delete_session":
      return runtime.deleteSession(request.sessionId);
    case "ask_user.answer":
      return runtime.answerAskUser(request.sessionId, request.id, request.answer);
    case "ask_user.cancel":
      return runtime.cancelAskUser(request.sessionId, request.id);
    case "chat_run":
      throw new Error("Chat runs require the streaming hosted GUI operation");
    case "tool_invoke":
      return runtime.invokeTool(
        request.sessionId,
        request.actionId,
        request.toolName,
        request.args,
      );
    case "market_state":
      return runtime.marketState();
    case "diagnostics":
      return buildHostedDiagnostics();
    case "market_quotes":
      return (await hasRelayProvider("yahoo"))
        ? buildHostedMarketQuoteSnapshot(runtime.marketState())
        : buildHostedUnavailableMarketQuoteSnapshot(
            runtime.marketState(),
            "Audited provider relay is unavailable",
          );
    case "market_indices":
      return (await hasRelayProvider("yahoo"))
        ? buildHostedMarketIndicesSnapshot()
        : { generatedAt: new Date().toISOString(), indices: [] };
    case "instrument_history":
      await requireRelayProvider("yahoo", "Instrument history");
      return getHostedInstrumentHistorySnapshot(request.symbol, request.range);
    case "instrument_search":
      await requireRelayProvider("yahoo", "Instrument search");
      return searchHostedInstrumentCandidates(request.query);
    case "instrument_quote":
      await requireRelayProvider("yahoo", "Instrument quotes");
      return getHostedInstrumentQuoteSnapshot(request.symbol);
    case "instrument_endpoint":
      await requireRelayProvider("yahoo", "Instrument details");
      if (request.endpoint !== "overview") {
        throw new Error(`Unsupported hosted instrument endpoint: ${request.endpoint}`);
      }
      return getHostedInstrumentOverviewSnapshot(request.symbol);
  }
}

async function refreshHostedRelayProviders(runtime: BrowserHostedGuiRuntime): Promise<void> {
  const manifest = await loadHostedRelayManifest();
  runtime.configureRelayProviders(manifest?.providers ?? []);
}

async function hasRelayProvider(provider: string): Promise<boolean> {
  const manifest = await loadHostedRelayManifest();
  (await hostedGuiRuntimePromise).configureRelayProviders(manifest?.providers ?? []);
  return manifest?.providers.includes(provider) === true;
}

async function requireRelayProvider(provider: string, capability: string): Promise<void> {
  if (await hasRelayProvider(provider)) return;
  throw new Error(
    `${capability} requires the audited provider relay, which is unavailable or incompatible.`,
  );
}

async function buildHostedDiagnostics(): Promise<Record<string, unknown>> {
  const relayManifest = await loadHostedRelayManifest();
  (await hostedGuiRuntimePromise).configureRelayProviders(relayManifest?.providers ?? []);
  const providers = resolveHostedBrowserCapabilityReport(relayManifest?.providers);
  const relayReady = Boolean(relayManifest);
  return {
    runtime: "hosted-web",
    nodeVersion: process.version,
    status: relayReady ? "ready" : "degraded",
    summary: relayReady
      ? "The browser runtime and audited provider relay are ready. Native-only capabilities remain disabled."
      : "The browser runtime is ready. Relayed and native-only capabilities are disabled.",
    capabilities: CAPABILITIES,
    sections: [
      {
        id: "hosted-runtime",
        label: "Hosted runtime",
        status: "ready",
        checks: [
          {
            id: "browser-node",
            label: "Browser-hosted Node and Pi",
            status: "pass",
            detail: process.version,
          },
          {
            id: "background",
            label: "Background execution after closing the app",
            status: "skip",
            detail: "Unavailable in hosted mode. Use the local GUI or TUI for an always-running process.",
          },
          {
            id: "provider-relay",
            label: "Audited provider relay",
            status: relayReady ? "pass" : "skip",
            detail: relayReady
              ? `Policy v${relayManifest?.version}; ${relayManifest?.providers.length ?? 0} allowed providers.`
              : "Unavailable or incompatible. Relayed tools fail closed.",
          },
        ],
      },
      {
        id: "hosted-providers",
        label: "Browser provider paths",
        status: "degraded",
        checks: [
          ...providers.direct.map((provider) => ({
            id: `provider-${provider.id}`,
            label: provider.displayName,
            status: "pass",
            detail: provider.browserTransport.reason,
          })),
          ...providers.relayed.map((provider) => ({
            id: `provider-${provider.id}`,
            label: provider.displayName,
            status: "pass",
            detail: "Available through the audited OpenCandle provider relay.",
          })),
          ...providers.unavailable.map((provider) => ({
            id: `provider-${provider.id}`,
            label: provider.displayName,
            status: "skip",
            detail: `${provider.browserTransport.reason} Use the local GUI or TUI when needed.`,
          })),
        ],
      },
    ],
  };
}

startStdioTransport();

function writeProcessFrame(frame: unknown): void {
  process.stdout.write(`${PROCESS_FRAME_PREFIX}${JSON.stringify(frame)}\n`);
}

function startStdioTransport(): void {
  const activeStreams = new Map<string, AbortController>();
  const checkpointAcks = new Map<
    string,
    {
      requestId: string;
      timer: ReturnType<typeof setTimeout>;
      resolve: () => void;
      reject: (error: Error) => void;
    }
  >();
  let nextCheckpointId = 1;
  process.stdin.setRawMode?.(true);
  const input = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  input.on("line", (line) => {
    if (Buffer.byteLength(line) > MAX_BODY_BYTES) {
      const requestId = line.match(/"requestId"\s*:\s*"([a-f0-9]{32})"/)?.[1];
      if (requestId) {
        writeProcessFrame({
          type: "response",
          runtimeEpoch,
          requestId,
          ok: false,
          error: "Request frame is too large",
        });
      }
      return;
    }
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const requestId = typeof message.requestId === "string" ? message.requestId : "";
    if (
      message.type === "checkpoint-ack" &&
      message.runtimeEpoch === runtimeEpoch &&
      requestId
    ) {
      const checkpointId = String(message.checkpointId ?? "");
      const pending = checkpointAcks.get(checkpointId);
      if (!pending || pending.requestId !== requestId) return;
      clearTimeout(pending.timer);
      checkpointAcks.delete(checkpointId);
      if (message.ok === true) pending.resolve();
      else pending.reject(new Error(String(message.error || "Checkpoint persistence failed")));
      return;
    }
    if (message.type === "cancel" && requestId) {
      activeStreams.get(requestId)?.abort();
      activeStreams.delete(requestId);
      rejectCheckpointAcks(checkpointAcks, requestId, "Hosted runtime request was cancelled");
      return;
    }
    if (
      message.type !== "request" ||
      message.runtimeEpoch !== runtimeEpoch ||
      !/^[a-f0-9]{32}$/.test(requestId)
    ) return;
    void runStdioRequest(
      requestId,
      String(message.operation ?? ""),
      message.payload,
      activeStreams,
      async (value) => {
        const checkpointId = `checkpoint-${nextCheckpointId++}`;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            checkpointAcks.delete(checkpointId);
            reject(new Error("Durable checkpoint acknowledgement timed out"));
          }, 30_000);
          checkpointAcks.set(checkpointId, { requestId, timer, resolve, reject });
          writeProcessFrame({
            type: "checkpoint",
            runtimeEpoch,
            requestId,
            checkpointId,
            value,
          });
        });
      },
    );
  });
  writeProcessFrame({ type: "ready", runtimeEpoch });
  void hostedGuiRuntimePromise.catch((error) => {
      writeProcessFrame({
        type: "fatal",
        runtimeEpoch,
        error: serializeProbeError(error, MODEL_KEYS).error,
      });
      process.exitCode = 1;
      input.close();
    });
}

async function runStdioRequest(
  requestId: string,
  operation: string,
  payload: unknown,
  activeStreams: Map<string, AbortController>,
  persistCheckpoint: (value: unknown) => Promise<void>,
): Promise<void> {
  try {
    if (operation === "gui") {
      writeProcessFrame({
        type: "response",
        runtimeEpoch,
        requestId,
        ok: true,
        result: await runGuiRequest(parseGuiRequest(payload)),
      });
      return;
    }
    if (operation === "gui-stream") {
      const parsed = parseGuiRequest(payload);
      if (parsed.action !== "chat_run") throw new Error("Only chat runs may be streamed");
      const controller = new AbortController();
      activeStreams.set(requestId, controller);
      const runtime = await hostedGuiRuntimePromise;
      await refreshHostedRelayProviders(runtime);
      await runtime.chatRun(
        parsed.sessionId,
        parsed,
        parsed.actionId,
        (event) => writeProcessFrame({
          type: "stream-event",
          runtimeEpoch,
          requestId,
          event,
        }),
        controller.signal,
        persistCheckpoint,
      );
      activeStreams.delete(requestId);
      writeProcessFrame({ type: "stream-end", runtimeEpoch, requestId, ok: true });
      return;
    }
    throw new Error("Unsupported hosted runtime operation");
  } catch (error) {
    activeStreams.delete(requestId);
    writeProcessFrame({
      type: operation === "gui-stream" ? "stream-end" : "response",
      runtimeEpoch,
      requestId,
      ok: false,
      error: serializeProbeError(error, MODEL_KEYS).error,
    });
  }
}

function rejectCheckpointAcks(
  checkpointAcks: Map<
    string,
    {
      requestId: string;
      timer: ReturnType<typeof setTimeout>;
      reject: (error: Error) => void;
    }
  >,
  requestId: string,
  message: string,
): void {
  for (const [checkpointId, pending] of checkpointAcks) {
    if (pending.requestId !== requestId) continue;
    clearTimeout(pending.timer);
    checkpointAcks.delete(checkpointId);
    pending.reject(new Error(message));
  }
}
