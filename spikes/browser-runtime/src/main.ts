import { WebContainer, type WebContainerProcess } from "@webcontainer/api";
import runtimeBundle from "./generated/runtime-bundle.mjs?raw";
import {
  clearStoredRuntimeRecord,
  getModelSelection,
  parseStorageRecord,
  STORAGE_KEY,
  type ModelProvider,
  type StoredRuntimeRecord,
  toSafeStoredMetadata,
  updateStoredDiagnostic,
  updateStoredSelection,
} from "./runtime-contract.js";
import "./styles.css";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Missing application root");

app.innerHTML = `
  <header class="page-header">
    <p class="eyebrow">Feasibility diagnostic</p>
    <h1>Browser-hosted OpenCandle runtime</h1>
    <p class="lede">A static host boots a prebuilt OpenCandle probe inside browser-hosted Node.</p>
  </header>

  <section class="panel" aria-labelledby="runtime-heading">
    <div class="panel-heading">
      <div>
        <h2 id="runtime-heading">Runtime</h2>
        <p>Runs while this tab is open and reboots on each visit.</p>
      </div>
      <span id="runtime-status" class="badge" role="status">Not booted</span>
    </div>
    <div class="panel-body">
      <button id="boot-runtime" class="primary" type="button">Boot browser runtime</button>
      <iframe id="runtime-bridge" class="bridge-frame" title="Runtime bridge" allow="cross-origin-isolated"></iframe>
      <dl id="timings" class="timings" aria-label="Runtime phase timings"></dl>
      <pre id="health-result" class="result" aria-label="Runtime health">No health result yet.</pre>
    </div>
  </section>

  <section class="panel" aria-labelledby="credential-heading">
    <div class="panel-heading">
      <div>
        <h2 id="credential-heading">Optional model probe</h2>
        <p id="saved-indicator">No model key saved</p>
      </div>
    </div>
    <div class="panel-body form-grid">
      <label for="provider">Provider</label>
      <select id="provider">
        <option value="google">Google</option>
        <option value="openai">OpenAI</option>
        <option value="anthropic">Anthropic</option>
      </select>
      <p class="field-note">Model: <code id="model-id"></code></p>
      <label for="model-key">Model key</label>
      <input id="model-key" type="password" autocomplete="off" spellcheck="false" />
      <p class="warning">The key is stored in this browser origin and is exposed to any script executing on this origin. This is not a production credential design.</p>
      <button id="save-key" class="secondary" type="button">Save key on this device</button>
    </div>
  </section>

  <section class="panel" aria-labelledby="probe-heading">
    <div class="panel-heading">
      <div>
        <h2 id="probe-heading">Research-path probe</h2>
        <p>Runs the actual OpenCandle Polymarket provider; the optional path also runs the production router client.</p>
      </div>
    </div>
    <div class="panel-body form-grid">
      <label for="question">Diagnostic question</label>
      <textarea id="question" maxlength="500" rows="3">Bitcoin</textarea>
      <div class="actions">
        <button id="provider-probe" class="secondary" type="button" disabled>Run keyless provider probe</button>
        <button id="model-probe" class="secondary" type="button" disabled>Run model + route probe</button>
      </div>
      <pre id="probe-result" class="result" aria-label="Probe result">No probe result yet.</pre>
    </div>
  </section>

  <section class="panel caveats" aria-labelledby="limits-heading">
    <div class="panel-heading"><h2 id="limits-heading">Explicit limits</h2></div>
    <div class="panel-body">
      <p>WebContainer relies on StackBlitz-hosted infrastructure and terms.</p>
      <ul>
        <li><strong>Unsupported:</strong> SQLite and canonical Pi session history</li>
        <li><strong>Unsupported:</strong> X and Reddit desktop-cookie CLIs</li>
        <li><strong>Unsupported:</strong> background automations and closed-tab execution</li>
        <li><strong>Unsupported:</strong> multi-tab coordination</li>
      </ul>
      <button id="clear-data" class="danger" type="button">Clear saved data</button>
    </div>
  </section>
`;

const providerSelect = element<HTMLSelectElement>("provider");
const modelIdView = element<HTMLElement>("model-id");
const keyInput = element<HTMLInputElement>("model-key");
const savedIndicator = element<HTMLElement>("saved-indicator");
const questionInput = element<HTMLTextAreaElement>("question");
const runtimeStatus = element<HTMLElement>("runtime-status");
const healthResult = element<HTMLElement>("health-result");
const probeResult = element<HTMLElement>("probe-result");
const timingsView = element<HTMLElement>("timings");
const bootButton = element<HTMLButtonElement>("boot-runtime");
const providerProbeButton = element<HTMLButtonElement>("provider-probe");
const modelProbeButton = element<HTMLButtonElement>("model-probe");
const bridgeFrame = element<HTMLIFrameElement>("runtime-bridge");

let storedRecord = parseStorageRecord(localStorage.getItem(STORAGE_KEY));
let container: WebContainer | undefined;
let runtimeProcess: WebContainerProcess | undefined;
let previewUrl: string | undefined;
let previewOrigin: string | undefined;
let bootPromise: Promise<void> | undefined;
let bridgeReady:
  | {
      resolve: () => void;
      reject: (error: Error) => void;
    }
  | undefined;
const pendingBridgeRequests = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const BRIDGE_CHANNEL = "opencandle-browser-runtime-v1";

restoreSafeState();
renderModel();
window.addEventListener("message", handleBridgeMessage);

providerSelect.addEventListener("change", () => {
  const provider = providerSelect.value as ModelProvider;
  if (storedRecord) {
    storedRecord = updateStoredSelection(storedRecord, provider);
  } else {
    const selection = getModelSelection(provider);
    storedRecord = {
      version: 1,
      provider,
      modelId: selection.modelId,
      modelKey: "",
    };
  }
  persistRecord();
  renderModel();
  renderSavedIndicator();
  updateModelProbeAvailability();
});

element<HTMLButtonElement>("save-key").addEventListener("click", () => {
  const modelKey = keyInput.value.trim();
  if (!modelKey) {
    savedIndicator.textContent = "Enter a nonblank key to save";
    return;
  }
  const selection = selectedModel();
  storedRecord = {
    version: 1,
    provider: selection.provider,
    modelId: selection.modelId,
    modelKey,
    credentialProvider: selection.provider,
    ...(storedRecord?.lastQuestion && { lastQuestion: storedRecord.lastQuestion }),
    ...(storedRecord?.lastResult !== undefined && { lastResult: storedRecord.lastResult }),
  };
  persistRecord();
  keyInput.value = "";
  renderSavedIndicator();
  updateModelProbeAvailability();
});

bootButton.addEventListener("click", () => {
  void bootRuntime().catch(() => {
    // The visible runtime status carries the bounded failure.
  });
});
providerProbeButton.addEventListener("click", () => {
  void runProbe(false);
});
modelProbeButton.addEventListener("click", () => {
  void runProbe(true);
});
element<HTMLButtonElement>("clear-data").addEventListener("click", () => {
  clearStoredRuntimeRecord(localStorage);
  storedRecord = undefined;
  keyInput.value = "";
  questionInput.value = "";
  probeResult.textContent = "No probe result yet.";
  savedIndicator.textContent = "No model key saved";
  runtimeProcess?.kill();
  container?.teardown();
  runtimeProcess = undefined;
  container = undefined;
  previewUrl = undefined;
  previewOrigin = undefined;
  bridgeFrame.removeAttribute("src");
  rejectPendingBridgeRequests(new Error("Runtime was cleared"));
  bootPromise = undefined;
  runtimeStatus.textContent = "Not booted";
  runtimeStatus.className = "badge";
  healthResult.textContent = "No health result yet.";
  providerProbeButton.disabled = true;
  updateModelProbeAvailability();
});

async function bootRuntime(): Promise<void> {
  if (bootPromise) return bootPromise;
  bootPromise = doBoot().catch((error: unknown) => {
    runtimeStatus.textContent = "Failed";
    runtimeStatus.className = "badge error";
    healthResult.textContent = safeMessage(error);
    bootPromise = undefined;
    throw error;
  });
  return bootPromise;
}

async function doBoot(): Promise<void> {
  bootButton.disabled = true;
  runtimeStatus.textContent = "Booting";
  const timings: Record<string, number> = {};
  let phaseStart = performance.now();
  container = await WebContainer.boot({ coep: "require-corp" });
  timings.boot = performance.now() - phaseStart;

  phaseStart = performance.now();
  await container.mount({
    "runtime-bundle.mjs": { file: { contents: runtimeBundle } },
    "package.json": { file: { contents: '{"type":"module","private":true}' } },
  });
  timings.mount = performance.now() - phaseStart;

  const selection = selectedModel();
  const port = 10_000 + Math.floor(Math.random() * 40_000);
  const modelKey = storedRecord?.modelKey.trim() ?? "";
  const environment: Record<string, string> = {
    PORT: String(port),
    OPENCANDLE_SPIKE_HOST_ORIGIN: window.location.origin,
  };
  if (modelKey && credentialProvider(storedRecord) === selection.provider) {
    environment[selection.envVar] = modelKey;
  }

  phaseStart = performance.now();
  const serverReady = new Promise<string>((resolve) => {
    const unsubscribe = container?.on("server-ready", (readyPort, url) => {
      if (readyPort !== port) return;
      unsubscribe?.();
      resolve(url);
    });
  });
  runtimeProcess = await container.spawn("node", ["runtime-bundle.mjs"], {
    env: environment,
    output: false,
  });
  previewUrl = await withTimeout(serverReady, 90_000, "Runtime server did not become ready");
  timings.processStart = performance.now() - phaseStart;

  phaseStart = performance.now();
  await connectBridge(previewUrl);
  timings.bridgeReadiness = performance.now() - phaseStart;

  phaseStart = performance.now();
  const health = await bridgeRequest("health");
  timings.health = performance.now() - phaseStart;

  healthResult.textContent = JSON.stringify(health, null, 2);
  timingsView.innerHTML = Object.entries(timings)
    .map(([name, duration]) => `<div><dt>${name}</dt><dd>${Math.round(duration)} ms</dd></div>`)
    .join("");
  runtimeStatus.textContent = "Ready";
  runtimeStatus.className = "badge success";
  providerProbeButton.disabled = false;
  bootButton.disabled = true;
  updateModelProbeAvailability();
}

async function runProbe(runModel: boolean): Promise<void> {
  if (!previewOrigin) return;
  const question = questionInput.value.trim();
  if (!question) {
    probeResult.textContent = "Enter a diagnostic question.";
    return;
  }
  const button = runModel ? modelProbeButton : providerProbeButton;
  button.disabled = true;
  probeResult.textContent = "Running probe…";
  const started = performance.now();
  try {
    const selection = selectedModel();
    const result = await bridgeRequest("probe", {
      question,
      provider: selection.provider,
      modelId: selection.modelId,
      runModel,
    });
    const boundedResult = {
      durationMs: Math.round(performance.now() - started),
      response: result,
    };
    probeResult.textContent = JSON.stringify(boundedResult, null, 2);
    const baseRecord =
      storedRecord ??
      ({
        version: 1,
        provider: selection.provider,
        modelId: selection.modelId,
        modelKey: "",
      } satisfies StoredRuntimeRecord);
    storedRecord = updateStoredDiagnostic(baseRecord, question, boundedResult);
    persistRecord();
  } catch (error) {
    probeResult.textContent = safeMessage(error);
  } finally {
    button.disabled = false;
    updateModelProbeAvailability();
  }
}

function restoreSafeState(): void {
  if (!storedRecord) return;
  providerSelect.value = storedRecord.provider;
  const safe = toSafeStoredMetadata(storedRecord);
  if (storedRecord.modelKey.trim()) {
    const savedProvider = credentialProvider(storedRecord);
    if (savedProvider) {
      savedIndicator.textContent = `${safe.configuredLabel} · ${savedProvider}/${getModelSelection(savedProvider).modelId}`;
    }
  }
  if (safe.lastQuestion) questionInput.value = safe.lastQuestion;
  if (safe.lastResult !== undefined) {
    probeResult.textContent = JSON.stringify(safe.lastResult, null, 2);
  }
}

function persistRecord(): void {
  if (storedRecord) localStorage.setItem(STORAGE_KEY, JSON.stringify(storedRecord));
}

function selectedModel() {
  return getModelSelection(providerSelect.value as ModelProvider);
}

function renderModel(): void {
  modelIdView.textContent = selectedModel().modelId;
}

function updateModelProbeAvailability(): void {
  const selection = selectedModel();
  const hasSelectedKey =
    credentialProvider(storedRecord) === selection.provider &&
    Boolean(storedRecord?.modelKey.trim());
  modelProbeButton.disabled = runtimeStatus.textContent !== "Ready" || !hasSelectedKey;
}

function renderSavedIndicator(): void {
  if (!storedRecord?.modelKey.trim()) {
    savedIndicator.textContent = "No model key saved";
    return;
  }
  const provider = credentialProvider(storedRecord);
  if (!provider) return;
  savedIndicator.textContent = `Saved on this device · ${provider}/${getModelSelection(provider).modelId}`;
}

function credentialProvider(record: StoredRuntimeRecord | undefined): ModelProvider | undefined {
  if (!record?.modelKey.trim()) return undefined;
  return record.credentialProvider ?? record.provider;
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const secret = storedRecord?.modelKey;
  return secret ? message.replaceAll(secret, "[redacted]").slice(0, 240) : message.slice(0, 240);
}

function publicError(value: unknown): string {
  if (value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string") {
    return (value as { error: string }).error;
  }
  return "Probe failed";
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.querySelector<T>(`#${id}`);
  if (!value) throw new Error(`Missing #${id}`);
  return value;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function connectBridge(runtimeUrl: string): Promise<void> {
  previewOrigin = new URL(runtimeUrl).origin;
  const readyPromise = new Promise<void>((resolve, reject) => {
    bridgeReady = { resolve, reject };
  });
  bridgeFrame.src = new URL("/bridge", runtimeUrl).toString();
  await withTimeout(readyPromise, 20_000, "Runtime bridge did not become ready");
  bridgeReady = undefined;
}

function handleBridgeMessage(event: MessageEvent): void {
  if (!previewOrigin || event.origin !== previewOrigin) {
    markRejectedBridgeMessage();
    return;
  }
  if (event.source !== bridgeFrame.contentWindow) {
    markRejectedBridgeMessage();
    return;
  }
  const message: unknown = event.data;
  if (!message || typeof message !== "object") return;
  const record = message as Record<string, unknown>;
  if (record.channel !== BRIDGE_CHANNEL) return;
  if (record.type === "ready") {
    bridgeReady?.resolve();
    return;
  }
  if (record.type !== "response" || typeof record.requestId !== "string") return;
  const pending = pendingBridgeRequests.get(record.requestId);
  if (!pending) {
    markRejectedBridgeMessage();
    return;
  }
  clearTimeout(pending.timer);
  pendingBridgeRequests.delete(record.requestId);
  if (record.ok === true) {
    pending.resolve(record.result);
    return;
  }
  pending.reject(new Error(publicError(record.result ?? { error: record.error })));
}

function markRejectedBridgeMessage(): void {
  const count = Number.parseInt(document.documentElement.dataset.bridgeRejected ?? "0", 10);
  document.documentElement.dataset.bridgeRejected = String(count + 1);
}

function bridgeRequest(operation: "health" | "probe", payload?: unknown): Promise<unknown> {
  if (!previewOrigin || !bridgeFrame.contentWindow) {
    return Promise.reject(new Error("Runtime bridge is unavailable"));
  }
  const requestId = randomRequestId();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingBridgeRequests.delete(requestId);
      reject(new Error(`Runtime bridge ${operation} request timed out`));
    }, 60_000);
    pendingBridgeRequests.set(requestId, { resolve, reject, timer });
    bridgeFrame.contentWindow?.postMessage(
      { channel: BRIDGE_CHANNEL, operation, requestId, payload },
      previewOrigin,
    );
  });
}

function randomRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function rejectPendingBridgeRequests(error: Error): void {
  bridgeReady?.reject(error);
  bridgeReady = undefined;
  for (const pending of pendingBridgeRequests.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  pendingBridgeRequests.clear();
}
