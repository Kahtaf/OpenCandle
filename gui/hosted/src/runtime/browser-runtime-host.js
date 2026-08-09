import { createBrowserDataStore } from "./browser-data-store.js";
import {
  isFirstClassModelProvider,
  modelSetupProviders,
} from "../../../../src/pi/model-provider-metadata.js";
import { firstClassModelCatalog } from "../../../../src/pi/model-catalog.generated.js";
import { resolveFirstClassModelEntry } from "../../../../src/pi/model-catalog-lookup.js";
import { listApiKeyProviders } from "../../../../src/onboarding/providers.js";
import { hostedGuiActionBlocksUpdate } from "../../../shared/hosted-gui-protocol.js";
import {
  FIRST_RUN_ONBOARDING_SEEN_KEY,
  LEGACY_FIRST_RUN_DISMISSED_KEY,
} from "../../../web/src/features/onboarding/setup-dismissal.js";
import { fetchHostedRuntimeAuthorization } from "../../runtime/provider-relay-fetch.ts";
import {
  MODEL_RELAY_HEADERS,
  MODEL_RELAY_PATH,
  PROVIDER_RELAY_HEALTH_PATH,
  PROVIDER_RELAY_PATH,
  PROVIDER_RELAY_RUNTIME_TOKEN_PATH,
} from "../../../../src/runtime/provider-relay-contract.js";

const PROCESS_FRAME_PREFIX = "@@OPENCANDLE@@";
const CREDENTIAL_KEY = "opencandle.hosted.credentials.v1";
const MODEL_SELECTION_KEY = "opencandle.hosted.model-selection.v1";
const PROVIDER_CREDENTIAL_KEY = "opencandle.hosted.provider-credentials.v1";
const CURRENT_SESSION_KEY = "opencandle.hosted.current-session.v1";
const RELAY_CLIENT_KEY = "opencandle.hosted.relay-client.v1";
const REQUEST_TIMEOUT_MS = 180_000;
const MAX_BROWSER_FETCH_BYTES = 32 * 1_024 * 1_024;
const MAX_BROWSER_FETCH_FRAME_BYTES = 384 * 1_024;
const BROWSER_FETCH_INACTIVITY_TIMEOUT_MS = 5 * 60_000;
const RUNTIME_AUTHORIZATION_REFRESH_WINDOW_MS = 5 * 60_000;
const RELAY_PATHS = new Set([
  PROVIDER_RELAY_PATH,
  MODEL_RELAY_PATH,
  PROVIDER_RELAY_HEALTH_PATH,
  PROVIDER_RELAY_RUNTIME_TOKEN_PATH,
]);

export function createBrowserRuntimeHost(options = {}) {
  return new BrowserRuntimeHost(options);
}

class BrowserRuntimeHost {
  constructor(options = {}) {
    this.WebContainerImpl = options.WebContainerImpl;
    this.configureWebContainerApiKey = options.configureWebContainerApiKey;
    const configuredWebContainerApiKey = String(
      options.webContainerApiKey ?? import.meta.env?.VITE_WEBCONTAINER_API_KEY ?? "",
    ).trim();
    this.webContainerApiKey = isLoopbackOrigin(globalThis.location?.origin)
      ? ""
      : configuredWebContainerApiKey;
    this.webContainerApiConfigured = false;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.fetchRuntimeAuthorization =
      options.fetchRuntimeAuthorization ?? fetchHostedRuntimeAuthorization;
    this.storage = options.storage ?? globalThis.localStorage;
    this.sessionStorage = options.sessionStorage ?? globalThis.sessionStorage;
    this.relayUrl = hostedRelayUrl(
      options.relayUrl ??
        import.meta.env?.VITE_PROVIDER_RELAY_URL ??
        (globalThis.location?.origin ? `${globalThis.location.origin}/v1/provider-fetch` : ""),
      globalThis.location?.origin,
    );
    this.relayClientId = getOrCreateRelayClientId(this.storage);
    this.dataStore = options.dataStore ?? createBrowserDataStore();
    this.volatileCredential = normalizeCredential(options.sessionCredential);
    if (this.volatileCredential) {
      const currentSessionCredentials = parseCredentialStore(
        this.sessionStorage.getItem(CREDENTIAL_KEY),
        "session",
      );
      const inheritedCredentials = parseCredentialBundle(this.volatileCredential, "session");
      writeCredentialStore(this.sessionStorage, {
        ...currentSessionCredentials,
        ...inheritedCredentials,
      });
    }
    this.container = null;
    this.process = null;
    this.processWriter = null;
    this.processHasRelayConfiguration = false;
    this.runtimeEpoch = "";
    this.bootPromise = null;
    // Invalidation is separate from the runtime request epoch: it also covers
    // the period before a WebContainer has been assigned to this host.
    this.lifecycleEpoch = 0;
    this.preserveRecoveryBackupUntilBoot = false;
    this.lastBootError = "";
    this.pendingRequests = new Map();
    this.browserFetchControllers = new Map();
    this.relayAuthorization = null;
    this.relayAuthorizationPromise = null;
    this.subscribers = new Set();
    this.runtimeThinking = null;
    // Read-only bootstrap replies carry a point-in-time checkpoint so the
    // first browser boot can establish an archive. Once one exists, letting a
    // delayed read reply write it back can erase a newer session created by a
    // mutation that completed first. Mutations and stream checkpoints remain
    // the only durable writers after that initial seed.
    this.hasDurableCheckpoint = false;
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  getModelSetup() {
    const credentials = this.readModelCredentials();
    const configuredProviders = new Set(Object.keys(credentials));
    const selection = this.readModelSelection(credentials);
    const configured = Boolean(selection && credentials[selection.provider]?.apiKey);
    const availableModels = firstClassModelCatalog.filter((model) =>
      configuredProviders.has(model.provider),
    );
    return {
      requirement: configured ? "ready" : availableModels.length > 0 ? "select_model" : "api_key",
      providers: modelSetupProviders.map((provider) => ({
        ...provider,
        authState: configuredProviders.has(provider.id) ? "configured" : "missing",
      })),
      availableModels,
      currentModel: configured ? `${selection.provider}/${selection.modelId}` : "",
      storageMode: selection ? credentials[selection.provider]?.storageMode ?? "persistent" : "persistent",
      supportsAttachments: true,
      hosted: true,
      ...(configured && this.runtimeThinking
        ? {
            currentThinkingLevel: this.runtimeThinking.current,
            availableThinkingLevels: this.runtimeThinking.available,
          }
        : {}),
      ...(this.lastBootError ? { error: this.lastBootError } : {}),
    };
  }

  async handleCommand(command) {
    switch (command?.type) {
      case "model.setup.save_api_key": {
        const provider = isFirstClassModelProvider(command.provider) ? command.provider : undefined;
        if (!provider) throw new Error("Unsupported model provider.");
        const apiKey = String(command.apiKey ?? "").trim();
        if (!apiKey || apiKey.length > 512) throw new Error("Enter a valid model API key.");
        const setup = modelSetupProviders.find((candidate) => candidate.id === provider);
        const requestedModel = String(command.modelId ?? setup?.defaultModel ?? "");
        const model = resolveFirstClassModelEntry(provider, requestedModel);
        if (!model) throw new Error("Unsupported provider or model.");
        const storageMode = command.storageMode === "session" ? "session" : "persistent";
        await this.ensureRelayAuthorization();
        if (this.process && !this.processHasRelayConfiguration) {
          await this.stopRuntime();
        }
        const validation = await this.request("gui", {
          action: "validate_model_key",
          provider,
          apiKey,
        });
        if (validation?.status === "invalid") {
          throw new Error(`The ${setup?.label ?? provider} key was rejected. Your existing key was not changed.`);
        }
        if (validation?.status !== "valid") {
          const reason = String(validation?.reason ?? "provider unavailable").slice(0, 160);
          throw new Error(
            `The ${setup?.label ?? provider} key could not be verified (${reason}). Your existing key was not changed.`,
          );
        }
        await this.request("gui", {
          action: "configure_model",
          provider,
          modelId: model.id,
          apiKey,
        });
        this.writeCredential({ provider, modelId: model.id, apiKey, storageMode });
        return { modelSetup: this.getModelSetup() };
      }
      case "model.setup.select_model": {
        const provider = isFirstClassModelProvider(command.provider) ? command.provider : undefined;
        const modelId = String(command.modelId ?? "");
        if (!provider || !resolveFirstClassModelEntry(provider, modelId)) {
          throw new Error("Unsupported provider or model.");
        }
        const credential = this.readModelCredentials()[provider];
        if (!credential?.apiKey) throw new Error(`Connect ${provider} before selecting this model.`);
        await this.request("gui", {
          action: "configure_model",
          provider,
          modelId,
          apiKey: credential.apiKey,
        });
        this.writeModelSelection({ provider, modelId });
        return { modelSetup: this.getModelSetup() };
      }
      case "model.setup.refresh":
        return { modelSetup: this.getModelSetup() };
      case "model.setup.set_thinking": {
        const result = await this.request("gui", {
          action: "configure_thinking",
          level: String(command.level ?? ""),
        });
        this.captureRuntimeState(result);
        return { modelSetup: this.getModelSetup() };
      }
      case "provider.save_api_key": {
        const providerId = String(command.providerId ?? "").trim();
        if (!apiKeyProvider(providerId)) {
          throw new Error("This provider does not accept an API key in hosted OpenCandle.");
        }
        const apiKey = String(command.apiKey ?? "").trim();
        if (!apiKey || apiKey.length > 8_192) throw new Error("Enter a valid provider API key.");
        const validation = await this.request("gui", {
          action: "validate_provider_key",
          providerId,
          apiKey,
        });
        if (validation?.status === "invalid") {
          throw new Error("The provider rejected this key. Your existing key was not changed.");
        }
        if (validation?.status !== "valid") {
          const reason = String(validation?.reason ?? "provider unavailable").slice(0, 160);
          throw new Error(
            `The provider key could not be verified (${reason}). Your existing key was not changed.`,
          );
        }
        const current = this.readProviderCredentials();
        this.storage.setItem(
          PROVIDER_CREDENTIAL_KEY,
          JSON.stringify({
            version: 1,
            credentials: { ...current, [providerId]: apiKey },
          }),
        );
        await this.stopRuntime();
        if (navigator.onLine) await this.ensureBooted();
        return { saved: true, providerId };
      }
      case "provider.status.check":
        return this.request("gui", { action: "diagnostics" });
      case "preferences.list":
        return this.request("gui", { action: "preferences_list" });
      case "preferences.delete": {
        // A delete replies with the mutation bootstrap that carries the durable
        // checkpoint; the caller only wants the refreshed list back.
        const result = await this.request("gui", {
          action: "preferences_delete",
          namespace: String(command.namespace ?? ""),
          key: String(command.key ?? ""),
        });
        return result?.preferences ?? { preferences: [], toolDefaults: [] };
      }
      case "tool_defaults.delete": {
        const result = await this.request("gui", {
          action: "tool_defaults_delete",
          toolName: String(command.toolName ?? ""),
          paramPath: String(command.paramPath ?? ""),
        });
        return result?.preferences ?? { preferences: [], toolDefaults: [] };
      }
      case "hosted.data.export":
        return { archive: await this.dataStore.exportAll() };
      case "hosted.data.import": {
        const archive = String(command.archive ?? "");
        if (this.dataStore.validateImportForRestore) {
          await this.dataStore.validateImportForRestore(archive);
        } else {
          this.dataStore.validateImport(archive);
        }
        await this.stopRuntime();
        const restored = await this.dataStore.importAll(archive);
        this.preserveRecoveryBackupUntilBoot = true;
        if (restored.currentSessionId) {
          this.storage.setItem(CURRENT_SESSION_KEY, restored.currentSessionId);
        } else {
          this.storage.removeItem(CURRENT_SESSION_KEY);
        }
        if (navigator.onLine) {
          try {
            await this.ensureBooted();
            await this.request("gui", { action: "bootstrap" });
          } catch (error) {
            await this.stopRuntime();
            if (await this.dataStore.restoreBackup?.()) {
              this.preserveRecoveryBackupUntilBoot = false;
              const recovery = await this.dataStore.readRuntimeSnapshot();
              if (recovery.currentSessionId) {
                this.storage.setItem(CURRENT_SESSION_KEY, recovery.currentSessionId);
              } else {
                this.storage.removeItem(CURRENT_SESSION_KEY);
              }
            }
            throw error;
          }
        }
        return { imported: true };
      }
      case "hosted.data.clear_secrets":
        this.clearSecrets();
        await this.stopRuntime();
        if (navigator.onLine) await this.ensureBooted();
        return { modelSetup: this.getModelSetup() };
      case "hosted.data.clear_all":
        await this.clearAll();
        if (navigator.onLine) await this.ensureBooted();
        return { cleared: true };
      case "hosted.runtime.prepare_update":
        await waitFor(
          () => ![...this.pendingRequests.values()].some((pending) => pending.blocksUpdate),
          REQUEST_TIMEOUT_MS,
          "Wait for active research or saved-state changes to finish before updating.",
        );
        if (navigator.onLine && this.container) {
          await this.request("gui", { action: "bootstrap" });
        }
        await this.dataStore.createBackup();
        return { ready: true };
      case "session.rename":
        return this.request("gui", {
          action: "rename_session",
          sessionId: String(command.path || command.sessionId || ""),
          name: String(command.name || ""),
        });
      case "session.delete":
        return this.request("gui", {
          action: "delete_session",
          sessionId: String(command.path || command.sessionId || ""),
        });
      case "ask_user.answer":
        return this.request("gui", {
          action: "ask_user.answer",
          sessionId: String(command.sessionId || ""),
          id: String(command.id || ""),
          answer: String(command.answer || ""),
        });
      case "ask_user.cancel":
        return this.request("gui", {
          action: "ask_user.cancel",
          sessionId: String(command.sessionId || ""),
          id: String(command.id || ""),
        });
      default:
        throw new Error(
          `This action is unavailable in hosted OpenCandle: ${String(command?.type || "unknown").slice(0, 80)}`,
        );
    }
  }

  async request(operation, payload = {}, options = {}) {
    if (!navigator.onLine) {
      if (
        operation === "gui" &&
        (payload?.action === "bootstrap" || payload?.action === "market_state")
      ) {
        const bootstrap = await this.dataStore.readOfflineBootstrap();
        if (!bootstrap) {
          throw new Error("OpenCandle is offline and no saved session is available yet.");
        }
        if (payload.action === "market_state") {
          if (!bootstrap.marketState || typeof bootstrap.marketState !== "object") {
            throw new Error("OpenCandle is offline and no saved market state is available yet.");
          }
          return structuredClone(bootstrap.marketState);
        }
        return {
          ...bootstrap,
          role: "offline",
          offline: true,
          runtimeState: "offline",
          supportsSessionActions: false,
          coordination: {
            ...(bootstrap.coordination || {}),
            writable: false,
            ownerKind: "offline",
          },
        };
      }
      throw new Error(
        "OpenCandle is offline. Saved sessions and export remain available, but research needs a network connection.",
      );
    }
    await this.ensureBooted();
    if (!this.processWriter) throw new Error("Hosted runtime process is unavailable");
    const requestId = randomRequestId();
    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const result = await new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error("Hosted runtime request timed out"));
      }, timeoutMs);
      const abort = () => {
        globalThis.clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        void this.writeProcessMessage({ type: "cancel", requestId });
        reject(new DOMException("The operation was aborted", "AbortError"));
      };
      if (options.signal?.aborted) {
        abort();
        return;
      }
      options.signal?.addEventListener("abort", abort, { once: true });
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        operation: operation === "gui" ? payload?.action : operation,
        timer,
        signal: options.signal,
        abort,
        blocksUpdate: requestBlocksUpdate(operation, payload),
        runtimeEpoch: this.runtimeEpoch,
      });
      void this.writeProcessMessage({
        type: "request",
        runtimeEpoch: this.runtimeEpoch,
        operation,
        requestId,
        payload,
      }).catch((error) => {
        const pending = this.pendingRequests.get(requestId);
        if (!pending) return;
        globalThis.clearTimeout(pending.timer);
        this.pendingRequests.delete(requestId);
        reject(error);
      });
    });
    const shouldPersistGuiResponse =
      operation === "gui" &&
      (requestBlocksUpdate(operation, payload) ||
        (!this.hasDurableCheckpoint && payload?.action === "bootstrap"));
    if (shouldPersistGuiResponse) {
      const persisted = await this.persistCheckpoint(result);
      if (requestBlocksUpdate(operation, payload) && persisted === false) {
        throw new Error("Hosted GUI mutation did not include a durable checkpoint.");
      }
    }
    if (operation === "gui" && payload?.action === "diagnostics") {
      return {
        ...result,
        networkState: navigator.onLine ? "online" : "offline",
        writerState: this.pendingRequests.size > 0 ? "busy" : "idle",
      };
    }
    return result;
  }

  async streamRequest(operation, payload = {}, options = {}) {
    if (!navigator.onLine) {
      throw new Error("OpenCandle is offline. Research needs a network connection.");
    }
    await this.ensureBooted();
    if (!this.processWriter) throw new Error("Hosted runtime process is unavailable");
    const requestId = randomRequestId();
    let streamController;
    let cancelFromConsumer = () => {};
    const stream = new ReadableStream({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        cancelFromConsumer();
      },
    });
    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const onTimeout = () => {
      options.signal?.removeEventListener("abort", abort);
      this.pendingRequests.delete(requestId);
      streamController.error(new Error("Hosted runtime stream timed out"));
      void this.writeProcessMessage({ type: "cancel", requestId });
    };
    let timer = globalThis.setTimeout(onTimeout, timeoutMs);
    const abort = (reportToConsumer = true) => {
      globalThis.clearTimeout(this.pendingRequests.get(requestId)?.timer ?? timer);
      this.pendingRequests.delete(requestId);
      void this.writeProcessMessage({ type: "cancel", requestId });
      if (reportToConsumer) {
        try {
          streamController.error(new DOMException("The operation was aborted", "AbortError"));
        } catch {
          // The consumer may already have closed the stream while cancellation propagated.
        }
      }
    };
    cancelFromConsumer = () => abort(false);
    if (options.signal?.aborted) abort();
    else {
      options.signal?.addEventListener("abort", abort, { once: true });
      const pending = {
        streamController,
        sseGate: createDurableSseGate(streamController),
        operation: `${operation}-stream`,
        timer,
        timeoutMs,
        onTimeout,
        signal: options.signal,
        abort,
        blocksUpdate: true,
        runtimeEpoch: this.runtimeEpoch,
      };
      this.pendingRequests.set(requestId, pending);
      try {
        await this.writeProcessMessage({
          type: "request",
          runtimeEpoch: this.runtimeEpoch,
          operation: `${operation}-stream`,
          requestId,
          payload,
        });
      } catch (error) {
        globalThis.clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        this.pendingRequests.delete(requestId);
        try {
          streamController.error(error);
        } catch {
          // The stream may already have been cancelled while the write failed.
        }
        throw error;
      }
    }
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  async dispose() {
    await this.stopRuntime();
  }

  async prewarm() {
    await this.ensureBooted();
  }

  async ensureBooted() {
    this.bootPromise ??= this.boot();
    try {
      await this.bootPromise;
      this.lastBootError = "";
    } catch (error) {
      this.lastBootError = scrubSecrets(
        error instanceof Error ? error.message : String(error),
        Object.values(this.readModelCredentials()).map((credential) => credential.apiKey),
      ).slice(0, 500);
      console.error(`Hosted runtime boot failed: ${this.lastBootError}`);
      await this.stopRuntime();
      throw error;
    }
  }

  async boot() {
    const lifecycleEpoch = this.lifecycleEpoch;
    let WebContainerImpl = this.WebContainerImpl;
    let configureWebContainerApiKey = this.configureWebContainerApiKey;
    if (!WebContainerImpl || (this.webContainerApiKey && !configureWebContainerApiKey)) {
      const webContainerApi = await import("@webcontainer/api");
      WebContainerImpl ??= webContainerApi.WebContainer;
      configureWebContainerApiKey ??= webContainerApi.configureAPIKey;
    }
    if (this.webContainerApiKey && !this.webContainerApiConfigured) {
      configureWebContainerApiKey(this.webContainerApiKey);
      this.webContainerApiConfigured = true;
    }
    const container = await WebContainerImpl.boot({ coep: "require-corp" });
    if (!this.isBootCurrent(lifecycleEpoch)) {
      await container.teardown?.();
      throw new Error("Hosted runtime boot was superseded");
    }
    this.container = container;
    const [runtimeManifestText, sqlWasm, sqlCommonJs, persisted] = await Promise.all([
      this.fetchAssetText(
        `/runtime/runtime-files.json?v=${encodeURIComponent(__OPENCANDLE_RUNTIME_VERSION__)}`,
      ),
      this.fetchAssetBytes(
        `/runtime/sql-wasm.wasm?v=${encodeURIComponent(__OPENCANDLE_RUNTIME_VERSION__)}`,
      ),
      this.fetchAssetText(
        `/runtime/sql-wasm.cjs?v=${encodeURIComponent(__OPENCANDLE_RUNTIME_VERSION__)}`,
      ),
      this.dataStore.readRuntimeSnapshot(),
    ]);
    this.assertBootCurrent(lifecycleEpoch);
    const runtimeManifest = parseRuntimeManifest(runtimeManifestText);
    const runtimeModules = await Promise.all(
      runtimeManifest.files.map(async (filename) => [
        filename,
        await this.fetchAssetText(
          `/runtime/${filename}?v=${encodeURIComponent(__OPENCANDLE_RUNTIME_VERSION__)}`,
        ),
      ]),
    );
    this.assertBootCurrent(lifecycleEpoch);
    const { sessions: sessionFiles, stateBytes, currentSessionId } = persisted;
    this.hasDurableCheckpoint = sessionFiles.length > 0 || Boolean(stateBytes);
    if (stateBytes && !this.preserveRecoveryBackupUntilBoot) await this.dataStore.createBackup();
    const runtimeFiles = {
      ...Object.fromEntries(
        runtimeModules.map(([filename, contents]) => [filename, { file: { contents } }]),
      ),
      "package.json": { file: { contents: '{"type":"module","private":true}' } },
      "sql-wasm.cjs": { file: { contents: sqlCommonJs } },
      "sql-wasm.wasm": { file: { contents: sqlWasm } },
    };
    if (sessionFiles.length > 0) {
      runtimeFiles.sessions = {
        directory: Object.fromEntries(
          sessionFiles.flatMap((session) => [
            [session.filename, { file: { contents: session.content } }],
            ...(session.actionStore
              ? [
                  [
                    `${session.filename}.accepted-actions.json`,
                    { file: { contents: session.actionStore } },
                  ],
                ]
              : []),
          ]),
        ),
      };
    }
    if (stateBytes) {
      runtimeFiles.state = {
        directory: {
          "current.sqlite3": { file: { contents: stateBytes } },
        },
      };
    }
    await container.mount(runtimeFiles);
    this.assertBootCurrent(lifecycleEpoch);

    await this.startProcess(
      container,
      currentSessionId || this.storage.getItem(CURRENT_SESSION_KEY) || "",
      runtimeManifest.entry,
    );
  }

  async startProcess(container, currentSessionId = "", runtimeEntry = "runtime-bundle.mjs") {
    this.runtimeEpoch = randomRequestId();
    const modelCredentials = this.readModelCredentials();
    const selection = this.readModelSelection(modelCredentials);
    const providerCredentials = this.readProviderCredentials();
    let relayAuthorization;
    if (this.relayUrl) {
      try {
        relayAuthorization = await this.ensureRelayAuthorization();
      } catch (error) {
        const reason = error instanceof Error ? error.message : "relay authorization failed";
        console.warn(`Hosted provider relay unavailable: ${reason}`);
        // The hosted shell still boots without relay-backed providers. A later
        // process restart retries authorization without persisting the token.
      }
    }
    const environment = {
      OPENCANDLE_RUNTIME_EPOCH: this.runtimeEpoch,
      ...(this.relayUrl && relayAuthorization
        ? {
            OPENCANDLE_PROVIDER_RELAY_URL: this.relayUrl,
            OPENCANDLE_PROVIDER_RELAY_CLIENT_ID: this.relayClientId,
            OPENCANDLE_PROVIDER_RELAY_TOKEN: relayAuthorization.token,
            OPENCANDLE_PROVIDER_RELAY_TOKEN_EXPIRES_AT: String(
              relayAuthorization.expiresAt,
            ),
          }
        : {}),
      ...Object.fromEntries(
        modelSetupProviders.flatMap((provider) => {
          const key = modelCredentials[provider.id]?.apiKey;
          return key ? [[provider.envVar, key]] : [];
        }),
      ),
      ...(selection
        ? {
            OPENCANDLE_MODEL_PROVIDER: selection.provider,
            OPENCANDLE_MODEL_ID: selection.modelId,
          }
        : {}),
      ...Object.fromEntries(
        Object.entries(providerCredentials).map(([providerId, apiKey]) => {
          const provider = apiKeyProvider(providerId);
          if (!provider) throw new Error(`Unsupported hosted provider: ${providerId}`);
          return [provider.envVar, apiKey];
        }),
      ),
      ...(currentSessionId
        ? {
            OPENCANDLE_CURRENT_SESSION_ID: currentSessionId,
          }
        : {}),
    };
    this.process = await container.spawn("node", [runtimeEntry], {
      env: environment,
      output: true,
    });
    this.processHasRelayConfiguration = Boolean(this.relayUrl && relayAuthorization);
    const runtimeProcess = this.process;
    const runtimeEpoch = this.runtimeEpoch;
    const runtimeReady = new Promise((resolve, reject) => {
      this.runtimeReady = { resolve, reject };
    });
    const processOutput = captureProcessOutput(runtimeProcess.output, (message) =>
      this.handleRuntimeMessage(message),
    );
    this.processWriter = runtimeProcess.input.getWriter();
    const processExit = runtimeProcess.exit?.then(async (code) => {
      const output = scrubSecrets(processOutput.snapshot(), Object.values(environment));
      throw new Error(
        `Hosted runtime exited before becoming ready (code ${code})${output ? `: ${output}` : ""}`,
      );
    }) ?? new Promise(() => {});
    try {
      await withTimeout(
        Promise.race([runtimeReady, processExit]),
        90_000,
        "Hosted runtime did not become ready",
      );
    } catch (error) {
      const output = scrubSecrets(processOutput.snapshot(), Object.values(environment));
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}${output && !message.includes(output) ? `: ${output}` : ""}`);
    }
    void processExit.catch(async (error) => {
      if (this.process !== runtimeProcess || this.runtimeEpoch !== runtimeEpoch) return;
      const message = error instanceof Error ? error.message : String(error);
      this.lastBootError = message.slice(0, 500);
      console.error(`Hosted runtime stopped after becoming ready: ${this.lastBootError}`);
      for (const [requestId, pending] of this.pendingRequests) {
        if (pending.runtimeEpoch !== runtimeEpoch) continue;
        globalThis.clearTimeout(pending.timer);
        pending.signal?.removeEventListener("abort", pending.abort);
        pending.reject?.(error);
        pending.streamController?.error(error);
        this.pendingRequests.delete(requestId);
      }
      for (const controller of this.browserFetchControllers.values()) controller.abort();
      this.browserFetchControllers.clear();
      this.processWriter?.releaseLock?.();
      this.process = null;
      this.processWriter = null;
      this.processHasRelayConfiguration = false;
      this.runtimeReady = null;
      this.runtimeEpoch = "";
      this.bootPromise = null;
      const failedContainer = this.container;
      this.container = null;
      await failedContainer?.teardown?.();
    });
  }

  async stopRuntime() {
    // A caller can yield the writer while `WebContainer.boot()` is still
    // pending. Invalidate that boot first, then wait for it to tear down
    // before releasing the coordinator lock to another tab.
    this.lifecycleEpoch += 1;
    const bootPromise = this.bootPromise;
    await this.stopProcess();
    await this.container?.teardown?.();
    this.container = null;
    this.bootPromise = null;
    if (bootPromise) await bootPromise.catch(() => {});
  }

  isBootCurrent(lifecycleEpoch) {
    return this.lifecycleEpoch === lifecycleEpoch;
  }

  assertBootCurrent(lifecycleEpoch) {
    if (!this.isBootCurrent(lifecycleEpoch)) {
      throw new Error("Hosted runtime boot was superseded");
    }
  }

  async stopProcess() {
    for (const [requestId, pending] of this.pendingRequests) {
      globalThis.clearTimeout(pending.timer);
      pending.signal?.removeEventListener("abort", pending.abort);
      pending.controller?.abort(new Error("Hosted runtime restarted"));
      if (pending.streamController) {
        pending.streamController.error(new Error("Hosted runtime restarted"));
      } else if (pending.reject) {
        pending.reject(new Error("Hosted runtime restarted"));
      }
      this.pendingRequests.delete(requestId);
    }
    for (const controller of this.browserFetchControllers.values()) controller.abort();
    this.browserFetchControllers.clear();
    this.process?.kill();
    this.processWriter?.releaseLock?.();
    this.process = null;
    this.processWriter = null;
    this.processHasRelayConfiguration = false;
    this.runtimeEpoch = "";
    this.runtimeReady?.reject(new Error("Hosted runtime boot was superseded"));
    this.runtimeReady = null;
  }

  async writeProcessMessage(message) {
    if (!this.processWriter) throw new Error("Hosted runtime process is unavailable");
    await this.processWriter.write(`${JSON.stringify(message)}\n`);
  }

  handleRuntimeMessage(message) {
    if (
      !message ||
      typeof message !== "object" ||
      message.runtimeEpoch !== this.runtimeEpoch
    ) return;
    if (message.type === "ready") {
      this.runtimeReady?.resolve();
      this.runtimeReady = null;
      return;
    }
    if (message.type === "fatal") {
      this.runtimeReady?.reject(new Error(String(message.error || "Hosted runtime failed")));
      this.runtimeReady = null;
      return;
    }
    if (message.type === "browser-fetch" && typeof message.requestId === "string") {
      void this.handleBrowserFetch(message);
      return;
    }
    if (message.type === "browser-fetch-cancel" && typeof message.requestId === "string") {
      this.browserFetchControllers.get(message.requestId)?.abort();
      return;
    }
    if (
      message.type === "checkpoint" &&
      typeof message.requestId === "string" &&
      typeof message.checkpointId === "string" &&
      this.pendingRequests.has(message.requestId)
    ) {
      void this.acknowledgeRuntimeCheckpoint(message);
      return;
    }
    if (message.type === "stream-event" && typeof message.requestId === "string") {
      const pending = this.pendingRequests.get(message.requestId);
      if (
        !pending?.streamController ||
        !message.event ||
        typeof message.event !== "object" ||
        typeof message.event.type !== "string"
      ) return;
      if (
        message.event?.type === "ask_user.prompt" ||
        message.event?.type === "ask_user.resolved"
      ) {
        for (const subscriber of this.subscribers) subscriber(message.event);
      }
      pending.sseGate.push(
        new TextEncoder().encode(`data: ${JSON.stringify(message.event)}\n\n`),
      );
      refreshStreamInactivityTimer(pending);
      return;
    }
    if (message.type === "stream-chunk" && typeof message.requestId === "string") {
      const pending = this.pendingRequests.get(message.requestId);
      if (!pending?.streamController || !isByteArray(message.value)) return;
      pending.sseGate.push(Uint8Array.from(message.value));
      refreshStreamInactivityTimer(pending);
      return;
    }
    if (message.type === "stream-end" && typeof message.requestId === "string") {
      void this.finishStreamRequest(message.requestId, message);
      return;
    }
    if (message.type !== "response" || typeof message.requestId !== "string") return;
    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) return;
    clearStreamStartupTimer(pending);
    pending.signal?.removeEventListener("abort", pending.abort);
    this.pendingRequests.delete(message.requestId);
    if (message.ok) {
      this.captureRuntimeState(message.result);
      pending.resolve(message.result);
      return;
    }
    pending.reject(
      new Error(
        String(message.result?.error || message.error || "Hosted runtime request failed").slice(
          0,
          500,
        ),
      ),
    );
  }

  async handleBrowserFetch(message) {
    const requestId = String(message.requestId || "");
    const requestEpoch = this.runtimeEpoch;
    let controller;
    let timeout;
    const respond = async (type, value = {}) => {
      if (!this.processWriter || this.runtimeEpoch !== requestEpoch) return false;
      try {
        await this.writeProcessMessage({
          type,
          runtimeEpoch: requestEpoch,
          requestId,
          ...value,
        });
        return true;
      } catch (error) {
        if (!this.processWriter || this.runtimeEpoch !== requestEpoch) return false;
        throw error;
      }
    };
    try {
      if (!/^[a-f0-9]{32}$/.test(requestId)) throw new Error("Invalid browser fetch request");
      const target = new URL(String(message.url || ""));
      const relay = new URL(this.relayUrl);
      if (target.origin !== relay.origin || !RELAY_PATHS.has(target.pathname)) {
        throw new Error("Browser fetch target is not an approved relay endpoint");
      }
      if (target.search || target.hash || target.username || target.password) {
        throw new Error("Browser fetch target is invalid");
      }
      const method = String(message.method || "GET").toUpperCase();
      if (method !== "GET" && method !== "POST") throw new Error("Browser fetch method is invalid");
      controller = new AbortController();
      this.browserFetchControllers.set(requestId, controller);
      const headers = new Headers();
      if (message.headers && typeof message.headers === "object" && !Array.isArray(message.headers)) {
        for (const [name, value] of Object.entries(message.headers)) {
          if (typeof value !== "string" || value.length > 16_384) {
            throw new Error("Browser fetch headers are invalid");
          }
          headers.set(name, value);
        }
      }
      const authorization = await this.ensureRelayAuthorization();
      if (!authorization) throw new Error("Hosted provider relay authorization is unavailable");
      if (controller.signal.aborted) throw new DOMException("The operation was aborted", "AbortError");
      headers.set(MODEL_RELAY_HEADERS.client, this.relayClientId);
      headers.set(MODEL_RELAY_HEADERS.runtimeToken, authorization.token);
      const body = message.bodyBase64
        ? decodeBase64Bytes(String(message.bodyBase64), MAX_BROWSER_FETCH_BYTES)
        : undefined;
      const resetDeadline = () => {
        globalThis.clearTimeout(timeout);
        timeout = globalThis.setTimeout(
          () => controller.abort(),
          BROWSER_FETCH_INACTIVITY_TIMEOUT_MS,
        );
      };
      resetDeadline();
      let response;
      try {
        response = await this.fetchImpl(target, {
          method,
          headers,
          ...(body?.byteLength ? { body } : {}),
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
        });
        if (!(await respond("browser-fetch-start", {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
        }))) {
          controller.abort();
          return;
        }
        resetDeadline();
        let responseBytes = 0;
        if (response.body) {
          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            responseBytes += value.byteLength;
            if (responseBytes > MAX_BROWSER_FETCH_BYTES) {
              await reader.cancel("Browser fetch response is too large");
              throw new Error("Browser fetch response is too large");
            }
            for (let offset = 0; offset < value.byteLength; offset += MAX_BROWSER_FETCH_FRAME_BYTES) {
              const frame = value.subarray(offset, offset + MAX_BROWSER_FETCH_FRAME_BYTES);
              if (!(await respond("browser-fetch-chunk", { bodyBase64: encodeBase64Bytes(frame) }))) {
                controller.abort();
                return;
              }
              resetDeadline();
            }
          }
        }
        await respond("browser-fetch-end");
      } finally {
        globalThis.clearTimeout(timeout);
      }
    } catch (error) {
      try {
        await respond("browser-fetch-error", {
          error: String(error instanceof Error ? error.message : error).slice(0, 300),
        });
      } catch {
        // The runtime transport is already unusable; teardown owns cancellation.
      }
    } finally {
      globalThis.clearTimeout(timeout);
      this.browserFetchControllers.delete(requestId);
    }
  }

  async ensureRelayAuthorization() {
    if (!this.relayUrl) return undefined;
    const now = Date.now();
    if (
      this.relayAuthorization &&
      this.relayAuthorization.expiresAt - now > RUNTIME_AUTHORIZATION_REFRESH_WINDOW_MS
    ) {
      return this.relayAuthorization;
    }
    this.relayAuthorizationPromise ??= (async () => {
      const current = this.relayAuthorization;
      const currentToken = current && current.expiresAt > Date.now() ? current.token : "";
      const authorization = await this.fetchRuntimeAuthorization({
        relayUrl: this.relayUrl,
        clientId: this.relayClientId,
        ...(currentToken ? { currentToken } : {}),
        fetchImpl: this.fetchImpl,
      });
      this.relayAuthorization = authorization;
      return authorization;
    })().finally(() => {
      this.relayAuthorizationPromise = null;
    });
    return this.relayAuthorizationPromise;
  }

  async acknowledgeRuntimeCheckpoint(message) {
    const runtimeEpoch = this.runtimeEpoch;
    const pending = this.pendingRequests.get(message.requestId);
    // A checkpoint write can outlive the request that caused it. Never send
    // that late acknowledgement into a replacement runtime: the replacement
    // may have reused a checkpoint id, but it cannot safely reconcile the
    // original action.
    if (!pending || !runtimeEpoch) return;
    try {
      const persisted = await this.persistCheckpoint(message.value);
      if (persisted === false) throw new Error("Hosted runtime checkpoint is invalid");
      if (
        this.runtimeEpoch !== runtimeEpoch ||
        this.pendingRequests.get(message.requestId) !== pending
      ) return;
      await this.writeProcessMessage({
        type: "checkpoint-ack",
        runtimeEpoch,
        requestId: message.requestId,
        checkpointId: message.checkpointId,
        ok: true,
      });
    } catch (error) {
      if (
        this.runtimeEpoch !== runtimeEpoch ||
        this.pendingRequests.get(message.requestId) !== pending
      ) return;
      await this.writeProcessMessage({
        type: "checkpoint-ack",
        runtimeEpoch,
        requestId: message.requestId,
        checkpointId: message.checkpointId,
        ok: false,
        error: String(error instanceof Error ? error.message : error).slice(0, 500),
      });
    }
  }

  async finishStreamRequest(requestId, message) {
    const pending = this.pendingRequests.get(requestId);
    if (!pending?.streamController) return;
    clearStreamStartupTimer(pending);
    pending.signal?.removeEventListener("abort", pending.abort);
    this.pendingRequests.delete(requestId);
    if (!message.ok) {
      pending.sseGate.discardCompletion();
      pending.streamController.error(
        new Error(String(message.error || "Hosted runtime stream failed").slice(0, 500)),
      );
      return;
    }
    try {
      pending.sseGate.finishInput();
      await this.request("gui", { action: "bootstrap" });
      pending.sseGate.releaseCompletion();
      pending.streamController.close();
    } catch (error) {
      pending.sseGate.discardCompletion();
      pending.streamController.error(error);
    }
  }

  readModelCredentials() {
    const persistent = parseCredentialStore(this.storage.getItem(CREDENTIAL_KEY), "persistent");
    const session = parseCredentialStore(this.sessionStorage.getItem(CREDENTIAL_KEY), "session");
    const volatile = parseCredentialBundle(this.volatileCredential, "session");
    return { ...persistent, ...session, ...volatile };
  }

  captureRuntimeState(value) {
    if (!value || typeof value !== "object") return;
    if (!Object.prototype.hasOwnProperty.call(value, "thinking")) return;
    const thinking = value.thinking;
    if (thinking == null) {
      this.runtimeThinking = null;
      return;
    }
    if (
      thinking &&
      typeof thinking === "object" &&
      typeof thinking.current === "string" &&
      Array.isArray(thinking.available)
    ) {
      this.runtimeThinking = {
        current: thinking.current,
        available: thinking.available.filter((level) => typeof level === "string"),
      };
    }
  }

  writeCredential(credential) {
    const persistent = parseCredentialStore(this.storage.getItem(CREDENTIAL_KEY), "persistent");
    const session = parseCredentialStore(this.sessionStorage.getItem(CREDENTIAL_KEY), "session");
    delete persistent[credential.provider];
    delete session[credential.provider];
    const target = credential.storageMode === "session" ? session : persistent;
    target[credential.provider] = {
      apiKey: credential.apiKey,
      storageMode: credential.storageMode,
    };
    writeCredentialStore(this.storage, persistent);
    writeCredentialStore(this.sessionStorage, session);
    this.volatileCredential = Object.keys(session).length > 0
      ? { version: 2, credentials: session }
      : null;
    this.writeModelSelection({ provider: credential.provider, modelId: credential.modelId });
  }

  readModelSelection(credentials = this.readModelCredentials()) {
    const stored = parseModelSelection(this.storage.getItem(MODEL_SELECTION_KEY));
    if (stored && credentials[stored.provider] && resolveFirstClassModelEntry(stored.provider, stored.modelId)) {
      return stored;
    }
    for (const provider of modelSetupProviders) {
      if (credentials[provider.id]) return { provider: provider.id, modelId: provider.defaultModel };
    }
    return null;
  }

  writeModelSelection(selection) {
    this.storage.setItem(MODEL_SELECTION_KEY, JSON.stringify({ version: 1, ...selection }));
  }

  async persistCheckpoint(value) {
    const persisted = await this.dataStore.persistCheckpoint(value);
    if (this.preserveRecoveryBackupUntilBoot) {
      await this.dataStore.createBackup();
      this.preserveRecoveryBackupUntilBoot = false;
    }
    if (typeof value.sessionId === "string") {
      this.storage.setItem(CURRENT_SESSION_KEY, value.sessionId);
    }
    if (persisted !== false) this.hasDurableCheckpoint = true;
    return persisted;
  }

  clearModelCredentials() {
    this.volatileCredential = null;
    this.runtimeThinking = null;
    this.storage.removeItem(CREDENTIAL_KEY);
    this.sessionStorage.removeItem(CREDENTIAL_KEY);
    this.storage.removeItem(MODEL_SELECTION_KEY);
  }

  clearSecrets() {
    this.clearModelCredentials();
    this.storage.removeItem(PROVIDER_CREDENTIAL_KEY);
  }

  readProviderCredentials() {
    return parseProviderCredentials(this.storage.getItem(PROVIDER_CREDENTIAL_KEY));
  }

  getSessionCredential() {
    const credentials = Object.fromEntries(
      Object.entries(this.readModelCredentials()).filter(([, credential]) => credential.storageMode === "session"),
    );
    return Object.keys(credentials).length > 0 ? { version: 2, credentials } : null;
  }

  async clearAll() {
    await this.stopRuntime();
    await this.dataStore.clearAll();
    this.hasDurableCheckpoint = false;
    this.clearSecrets();
    this.storage.removeItem(CURRENT_SESSION_KEY);
    this.storage.removeItem(RELAY_CLIENT_KEY);
    // Clearing everything leaves a fresh install behind, so onboarding is owed
    // its automatic first opening again.
    this.storage.removeItem(FIRST_RUN_ONBOARDING_SEEN_KEY);
    this.storage.removeItem(LEGACY_FIRST_RUN_DISMISSED_KEY);
    if (globalThis.caches) {
      await Promise.all((await caches.keys()).map((name) => caches.delete(name)));
      await repopulateServiceWorkerShell();
    }
  }

  async fetchAssetBytes(path) {
    const response = await this.fetchImpl(path, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Hosted runtime asset is unavailable: ${path}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async fetchAssetText(path) {
    const response = await this.fetchImpl(path, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Hosted runtime asset is unavailable: ${path}`);
    return response.text();
  }
}

function clearStreamStartupTimer(pending) {
  if (pending.timer == null) return;
  globalThis.clearTimeout(pending.timer);
  pending.timer = null;
}

function refreshStreamInactivityTimer(pending) {
  if (
    !pending?.streamController ||
    typeof pending.timeoutMs !== "number" ||
    typeof pending.onTimeout !== "function"
  ) return;
  globalThis.clearTimeout(pending.timer);
  pending.timer = globalThis.setTimeout(pending.onTimeout, pending.timeoutMs);
}

async function repopulateServiceWorkerShell() {
  const serviceWorker = globalThis.navigator?.serviceWorker;
  if (!serviceWorker?.getRegistration || typeof globalThis.MessageChannel !== "function") return;
  const registration = await serviceWorker.getRegistration();
  const worker = registration?.active ?? serviceWorker.controller;
  if (!worker?.postMessage) return;
  await new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = globalThis.setTimeout(() => {
      channel.port1.close();
      reject(new Error("Timed out while restoring the offline application shell."));
    }, 15_000);
    channel.port1.onmessage = (event) => {
      globalThis.clearTimeout(timer);
      channel.port1.close();
      if (event.data?.ok) resolve();
      else reject(new Error("Could not restore the offline application shell."));
    };
    try {
      worker.postMessage({ type: "REPOPULATE_SHELL" }, [channel.port2]);
    } catch (error) {
      globalThis.clearTimeout(timer);
      channel.port1.close();
      reject(error);
    }
  });
}

function hostedRelayUrl(value, hostOrigin) {
  const candidate = String(value ?? "").trim();
  const origin = String(hostOrigin ?? "").trim();
  if (!candidate || !origin) return "";
  try {
    const target = new URL(candidate, origin);
    const host = new URL(origin);
    if (target.origin === host.origin) return target.href;
    if (isLoopback(target) && isLoopback(host)) return target.href;
    return "";
  } catch {
    return "";
  }
}

function parseRuntimeManifest(serialized) {
  const value = JSON.parse(serialized);
  if (
    value?.version !== 1 ||
    typeof value.entry !== "string" ||
    !Array.isArray(value.files) ||
    !value.files.includes(value.entry) ||
    !value.files.every(
      (filename) => typeof filename === "string" && /^[A-Za-z0-9._-]+\.mjs$/.test(filename),
    )
  ) {
    throw new Error("Hosted runtime manifest is invalid");
  }
  return { entry: value.entry, files: [...new Set(value.files)] };
}

function isLoopback(url) {
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost")
  );
}

function isLoopbackOrigin(value) {
  try {
    return isLoopback(new URL(String(value ?? "")));
  } catch {
    return false;
  }
}

function getOrCreateRelayClientId(storage) {
  const existing = storage.getItem(RELAY_CLIENT_KEY) ?? "";
  if (/^[a-f0-9]{32}$/.test(existing)) return existing;
  const value = crypto.randomUUID().replaceAll("-", "");
  storage.setItem(RELAY_CLIENT_KEY, value);
  return value;
}

export function createDurableSseGate(controller) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const completionBlocks = [];

  const emitCompleteBlocks = () => {
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const framed = `${block}\n\n`;
      if (isRunCompletedBlock(block)) completionBlocks.push(framed);
      else controller.enqueue(encoder.encode(framed));
      boundary = buffer.indexOf("\n\n");
    }
  };

  return {
    push(bytes) {
      buffer += decoder.decode(bytes, { stream: true });
      emitCompleteBlocks();
    },
    finishInput() {
      buffer += decoder.decode();
      emitCompleteBlocks();
      if (buffer) {
        controller.enqueue(encoder.encode(buffer));
        buffer = "";
      }
    },
    releaseCompletion() {
      for (const block of completionBlocks.splice(0)) controller.enqueue(encoder.encode(block));
    },
    discardCompletion() {
      completionBlocks.length = 0;
      buffer = "";
    },
  };
}

function isRunCompletedBlock(block) {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data) return false;
  try {
    return JSON.parse(data)?.type === "run.completed";
  } catch {
    return false;
  }
}

function parseCredentialStore(serialized, storageMode) {
  if (!serialized) return {};
  try {
    const value = JSON.parse(serialized);
    if (value?.version === 1 && value.provider === "openai" && typeof value.apiKey === "string") {
      const apiKey = value.apiKey.trim();
      return apiKey && apiKey.length <= 512 ? { openai: { apiKey, storageMode } } : {};
    }
    return parseCredentialBundle(value, storageMode);
  } catch {
    return {};
  }
}

function parseCredentialBundle(value, storageMode) {
  if (value?.version !== 2 || !value.credentials || typeof value.credentials !== "object") return {};
  return Object.fromEntries(
    Object.entries(value.credentials).filter(
      ([provider, credential]) =>
        isFirstClassModelProvider(provider) &&
        typeof credential?.apiKey === "string" &&
        credential.apiKey.trim().length > 0 &&
        credential.apiKey.length <= 512,
    ).map(([provider, credential]) => [provider, { apiKey: credential.apiKey.trim(), storageMode }]),
  );
}

function writeCredentialStore(storage, credentials) {
  if (Object.keys(credentials).length === 0) storage.removeItem(CREDENTIAL_KEY);
  else storage.setItem(CREDENTIAL_KEY, JSON.stringify({ version: 2, credentials }));
}

function parseModelSelection(serialized) {
  if (!serialized) return null;
  try {
    const value = JSON.parse(serialized);
    return value?.version === 1 && resolveFirstClassModelEntry(value.provider, value.modelId)
      ? { provider: value.provider, modelId: value.modelId }
      : null;
  } catch {
    return null;
  }
}

function parseProviderCredentials(serialized) {
  if (!serialized) return {};
  try {
    const value = JSON.parse(serialized);
    if (value?.version !== 1 || !value.credentials || typeof value.credentials !== "object") {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value.credentials).filter(
        ([providerId, apiKey]) =>
          Boolean(apiKeyProvider(providerId)) &&
          typeof apiKey === "string" &&
          apiKey.trim().length > 0 &&
          apiKey.length <= 8_192,
      ),
    );
  } catch {
    return {};
  }
}

function apiKeyProvider(providerId) {
  return listApiKeyProviders().find((provider) => provider.id === providerId);
}

function normalizeCredential(value) {
  if (
    value?.version === 1 &&
    value.provider === "openai" &&
    typeof value.apiKey === "string" &&
    value.apiKey.trim() &&
    value.storageMode === "session"
  ) {
    return {
      version: 2,
      credentials: { openai: { apiKey: value.apiKey.trim(), storageMode: "session" } },
    };
  }
  const credentials = parseCredentialBundle(value, "session");
  return Object.keys(credentials).length > 0 ? { version: 2, credentials } : null;
}

function randomRequestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isByteArray(value) {
  return (
    Array.isArray(value) &&
    value.length <= 131_072 &&
    value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  );
}

function requestBlocksUpdate(operation, payload) {
  return operation !== "gui" || hostedGuiActionBlocksUpdate(payload?.action);
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = globalThis.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    globalThis.clearTimeout(timer);
  }
}

async function waitFor(predicate, timeoutMs, message) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function captureProcessOutput(stream, onMessage = () => {}) {
  let output = "";
  if (stream?.getReader) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    void (async () => {
      let buffered = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffered += typeof value === "string" ? value : decoder.decode(value, { stream: true });
          const lines = buffered.split("\n");
          buffered = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith(PROCESS_FRAME_PREFIX)) {
              try {
                onMessage(JSON.parse(line.slice(PROCESS_FRAME_PREFIX.length)));
              } catch {
                output = `${output}${line}\n`.slice(-8_192);
              }
            } else if (!isEchoedProcessRequest(line)) {
              output = `${output}${line}\n`.slice(-8_192);
            }
          }
        }
        buffered += decoder.decode();
        if (buffered) output = `${output}${buffered}`.slice(-8_192);
      } catch {
        // Preserve the bounded output already received for the boot error.
      }
    })();
  }
  return { snapshot: () => output.trim() };
}

function isEchoedProcessRequest(line) {
  try {
    const type = JSON.parse(line)?.type;
    return (
      ["request", "cancel", "checkpoint-ack"].includes(type) ||
      [
        "browser-fetch-start",
        "browser-fetch-chunk",
        "browser-fetch-end",
        "browser-fetch-error",
      ].includes(type)
    );
  } catch {
    return false;
  }
}

function encodeBase64Bytes(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64Bytes(value, maxBytes) {
  if (value.length > Math.ceil(maxBytes / 3) * 4 + 4) {
    throw new Error("Browser fetch request is too large");
  }
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw new Error("Browser fetch body is invalid");
  }
  if (binary.length > maxBytes) throw new Error("Browser fetch request is too large");
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function scrubSecrets(value, candidates) {
  return candidates
    .map((candidate) => String(candidate ?? "").trim())
    .filter((candidate) => candidate.length >= 8)
    .reduce((output, candidate) => output.replaceAll(candidate, "[redacted]"), String(value));
}
