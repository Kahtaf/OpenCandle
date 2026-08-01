import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
// The hosted bundle deliberately imports only the audited SessionManager leaf;
// the package root also pulls native/TUI surfaces that cannot run in WebContainer.
// The runtime composition build is the compatibility gate for this pinned path.
import { SessionManager } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js";
import { sessionEntriesToChatEvents } from "../../../gui/server/chat-event-adapter.js";
import { projectDashboard } from "../../../gui/server/projector.js";
import {
  createAskUserBridge,
  type GuiAskUserPrompt,
} from "../../../gui/shared/ask-user-bridge.js";
import {
  buildDispatchedPromptFromState,
  type ParsedChatRunBody,
} from "../../../gui/shared/chat-run-input.js";
import {
  inferToolDomain,
  OPENCANDLE_WORKFLOWS,
} from "../../../gui/shared/catalog-metadata.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import {
  isApiKeyProvider,
  resolveHostedBrowserCapabilityReport,
  type ProviderDescriptor,
} from "../../../src/onboarding/providers.js";
import {
  createSqlJsStateDatabase,
  type SqlJsStateDatabase,
} from "../../../src/runtime/sqljs-state-database-node.js";
import { BrowserPiSession } from "./browser-pi-session.js";
import {
  invokeHostedMarketStateTool,
  type HostedMarketStateDependencies,
} from "./hosted-market-state-actions.js";
import { getBrowserHostedToolDefinitions } from "./hosted-tool-composition.js";
import type { FirstClassModelProviderId } from "../../../src/pi/model-provider-metadata.js";
import type { BrowserModelCredentials } from "./browser-model-runtime.js";

// Pi sessions may contain base64 image blocks. This remains bounded while
// allowing multiple attachment-bearing turns to stay readable and exportable.
const MAX_SESSION_FILE_BYTES = 128 * 1_024 * 1_024;
const SESSION_COMPLETION_RESERVE_BYTES = 8 * 1_024 * 1_024;
const MAX_SESSION_FILES = 100;
const MAX_HOSTED_ARCHIVE_BYTES = 240 * 1_024 * 1_024;
const ARCHIVE_SESSION_GROWTH_MULTIPLIER = 4;
export const MAX_COMPLETED_CHAT_RESULTS = 256;

export function assertHostedBootstrapPersistable(
  bootstrap: unknown,
  maxArchiveBytes = MAX_HOSTED_ARCHIVE_BYTES,
): void {
  if (Buffer.byteLength(JSON.stringify(bootstrap)) > maxArchiveBytes) {
    throw new Error(
      "Hosted OpenCandle has reached its durable browser storage limit. Export or delete saved sessions before continuing.",
    );
  }
}

type CompletedChatResult = BrowserHostedBootstrap & {
  events: Array<Record<string, unknown>>;
};

interface CachedChatResult {
  fingerprint: string;
  sessionId: string;
}

interface InFlightChatResult {
  fingerprint: string;
  operation: Promise<CompletedChatResult>;
}

interface CachedToolActionResult {
  fingerprint: string;
  operation: Promise<Record<string, unknown>>;
  settled: boolean;
}

export interface BrowserHostedGuiRuntimeOptions {
  cwd: string;
  sessionDir: string;
  stateFile: string;
  currentSessionId?: string;
  modelProvider?: FirstClassModelProviderId;
  modelId?: string;
  modelCredentials?: BrowserModelCredentials;
  relayProviders?: readonly string[];
  createPiSession?: typeof BrowserPiSession.create;
  maxArchiveBytes?: number;
  marketStateDependencies?: HostedMarketStateDependencies;
}

interface HostedSessionCheckpoint {
  sessionId: string;
  filename: string;
  content: string;
}

interface HostedStateCheckpoint {
  format: "sqlite3";
  filename: "current.sqlite3";
  contentBase64: string;
}

export interface BrowserHostedBootstrap {
  role: "writer";
  sessionId: string;
  supportsSessionActions: true;
  coordination: {
    sessionId: string;
    ownerKind: "hosted";
    writable: true;
  };
  sessions: Array<{
    id: string;
    path: string;
    name?: string;
    created: string;
    modified: string;
    messageCount: number;
    firstMessage: string;
  }>;
  catalog: {
    tools: Array<{
      name: string;
      label: string;
      description: string;
      parameters: unknown;
      domain: string;
      enabled: true;
      defaults: Record<string, never>;
    }>;
    workflows: typeof OPENCANDLE_WORKFLOWS;
    providers: Array<{
      id: string;
      name: string;
      displayName: string;
      kind: ProviderDescriptor["kind"];
      category: ProviderDescriptor["category"];
      tier: ProviderDescriptor["tier"];
      unlocks: readonly string[];
      fallbackDescription: string | null;
      instructionsHint: string;
      status: "file" | "absent" | "reachable";
      browserTransport: "direct" | "relayed";
      hosted: true;
      configured?: boolean;
      source?: "file" | "absent";
      signupUrl?: string;
      freeTier?: boolean;
      envVar?: string;
      maskedKeyHint?: string;
    }>;
  };
  askUserPrompts: GuiAskUserPrompt[];
  snapshot: {
    sessionId: string;
    entries: ReturnType<SessionManager["getEntries"]>;
    events: ReturnType<typeof sessionEntriesToChatEvents>;
    state: ReturnType<typeof projectDashboard>;
  };
  checkpoint: {
    sessions: HostedSessionCheckpoint[];
    state: HostedStateCheckpoint;
  };
}

export class BrowserHostedGuiRuntime {
  private currentSessionId: string | undefined;
  private readonly activeSessionRuns = new Set<string>();
  private readonly completedChatResults = new Map<string, CachedChatResult>();
  private readonly inFlightChatResults = new Map<string, InFlightChatResult>();
  private readonly actionResults = new Map<string, CachedToolActionResult>();
  private readonly activeEventEmitters = new Map<
    string,
    (event: Record<string, unknown>) => void | Promise<void>
  >();
  private readonly askUserBridge = createAskUserBridge({
    broadcast: (message) => {
      const prompt = (message as { prompt?: GuiAskUserPrompt }).prompt;
      if (!prompt) return;
      void this.activeEventEmitters.get(prompt.sessionId)?.(message as Record<string, unknown>);
    },
    getSessionId: () => this.currentSessionId ?? "",
  });

  private constructor(
    private readonly options: BrowserHostedGuiRuntimeOptions,
    private readonly stateDatabase: SqlJsStateDatabase,
  ) {
    this.currentSessionId = options.currentSessionId;
  }

  static async create(options: BrowserHostedGuiRuntimeOptions): Promise<BrowserHostedGuiRuntime> {
    mkdirSync(options.sessionDir, { recursive: true });
    mkdirSync(dirname(options.stateFile), { recursive: true });
    removeLegacyCurrentAlias(options.sessionDir);
    const stateDatabase = await createSqlJsStateDatabase(
      existsSync(options.stateFile) ? readFileSync(options.stateFile) : undefined,
    );
    return new BrowserHostedGuiRuntime(options, stateDatabase);
  }

  async bootstrap(): Promise<BrowserHostedBootstrap> {
    const manager = await this.resolveCurrentManager();
    return this.buildBootstrap(manager);
  }

  configureModel(provider: FirstClassModelProviderId, modelId: string, apiKey: string): void {
    const normalizedKey = apiKey.trim();
    this.options.modelProvider = normalizedKey ? provider : undefined;
    this.options.modelId = normalizedKey ? modelId : undefined;
    this.options.modelCredentials = {
      ...this.options.modelCredentials,
      ...(normalizedKey ? { [provider]: normalizedKey } : {}),
    };
  }

  configureRelayProviders(providers: readonly string[]): void {
    this.options.relayProviders = [...new Set(providers)];
  }

  async newSession(): Promise<BrowserHostedBootstrap> {
    this.assertArchiveAdmission(await this.bootstrap(), SESSION_COMPLETION_RESERVE_BYTES);
    const existing = await SessionManager.list(this.options.cwd, this.options.sessionDir);
    if (new Set(existing.map((session) => session.id)).size >= MAX_SESSION_FILES) {
      throw new Error(`Hosted OpenCandle supports at most ${MAX_SESSION_FILES} saved sessions.`);
    }
    const manager = SessionManager.create(this.options.cwd, this.options.sessionDir);
    persistEmptySession(manager);
    this.currentSessionId = manager.getSessionId();
    return this.buildBootstrap(manager);
  }

  async loadSession(sessionId: string): Promise<BrowserHostedBootstrap> {
    const manager = await this.resolveManager(sessionId);
    this.currentSessionId = manager.getSessionId();
    return this.buildBootstrap(manager);
  }

  async renameSession(sessionId: string, name: string): Promise<BrowserHostedBootstrap> {
    const nextName = name.trim();
    if (!nextName) throw new Error("Session name must not be blank");
    const manager = await this.resolveManager(sessionId);
    manager.appendSessionInfo(nextName.slice(0, 160));
    return this.buildBootstrap(manager);
  }

  async deleteSession(sessionId: string): Promise<BrowserHostedBootstrap> {
    const guardedSessionId = requireSessionId(sessionId);
    this.requireInactiveSession(guardedSessionId);
    const manager = await this.resolveManager(guardedSessionId);
    this.requireInactiveSession(guardedSessionId);
    const sessionFile = manager.getSessionFile();
    if (!sessionFile) throw new Error("Saved session file is unavailable");
    unlinkSync(sessionFile);
    if (this.currentSessionId === guardedSessionId) this.currentSessionId = undefined;
    return this.bootstrap();
  }

  async chatRun(
    sessionId: string,
    input: ParsedChatRunBody,
    actionId: string,
    onEvent?: (event: Record<string, unknown>) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<CompletedChatResult> {
    const guardedSessionId = requireSessionId(sessionId);
    const guardedActionId = requireActionId(actionId);
    const actionKey = `${guardedSessionId}:${guardedActionId}`;
    const fingerprint = fingerprintChatInput(input);
    const completed = this.completedChatResults.get(actionKey);
    if (completed) {
      requireMatchingChatInput(completed.fingerprint, fingerprint);
      return {
        ...(await this.buildBootstrap(await this.resolveManager(completed.sessionId), false)),
        events: [],
      };
    }
    const inFlight = this.inFlightChatResults.get(actionKey);
    if (inFlight) {
      requireMatchingChatInput(inFlight.fingerprint, fingerprint);
      return inFlight.operation;
    }
    if (this.activeSessionRuns.has(guardedSessionId)) {
      throw new Error("A research run is already active for this session.");
    }
    this.activeSessionRuns.add(guardedSessionId);
    const operation = this.executeChatRun(
      guardedSessionId,
      input,
      guardedActionId,
      actionKey,
      fingerprint,
      onEvent,
      signal,
    );
    this.inFlightChatResults.set(actionKey, { fingerprint, operation });
    try {
      return await operation;
    } finally {
      const current = this.inFlightChatResults.get(actionKey);
      if (current?.operation === operation) this.inFlightChatResults.delete(actionKey);
      this.activeSessionRuns.delete(guardedSessionId);
    }
  }

  private async executeChatRun(
    guardedSessionId: string,
    input: ParsedChatRunBody,
    guardedActionId: string,
    actionKey: string,
    fingerprint: string,
    onEvent?: (event: Record<string, unknown>) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<CompletedChatResult> {
    let session: Awaited<ReturnType<typeof BrowserPiSession.create>> | undefined;
    const runId = guardedActionId;
    let seq = 1;
    const streamedEvents: Array<Record<string, unknown>> = [];
    const emit = async (event: Record<string, unknown>) => {
      const sequenced = { ...event, runId, sessionId: guardedSessionId, seq: seq++ };
      streamedEvents.push(sequenced);
      await onEvent?.(sequenced);
    };
    this.activeEventEmitters.set(guardedSessionId, emit);
    try {
      const manager = await this.resolveManager(guardedSessionId);
      const sessionFile = manager.getSessionFile();
      if (!sessionFile) throw new Error("Saved session file is unavailable");
      const modelProvider = this.options.modelProvider;
      if (!modelProvider || !this.options.modelId || !this.options.modelCredentials?.[modelProvider]) {
        throw new Error("Connect an AI model before chat can run.");
      }
      const dispatchedPrompt = buildDispatchedPromptFromState(
        input,
        new MarketStateService(this.stateDatabase),
      );
      const images = input.images.map((image) => ({ type: "image" as const, ...image }));
      const nextInputBytes = Buffer.byteLength(JSON.stringify({ dispatchedPrompt, images }));
      if (
        (existsSync(sessionFile) ? statSync(sessionFile).size : 0) +
          nextInputBytes +
          SESSION_COMPLETION_RESERVE_BYTES >
        MAX_SESSION_FILE_BYTES
      ) {
        throw new Error(
          "This session is too large for another durable turn. Start a new session and attach the saved context you need.",
        );
      }
      this.assertArchiveAdmission(
        await this.buildBootstrap(manager),
        nextInputBytes + SESSION_COMPLETION_RESERVE_BYTES,
      );
      await emit({ type: "run.started" });
      const createPiSession = this.options.createPiSession ?? BrowserPiSession.create;
      session = await createPiSession({
        cwd: this.options.cwd,
        sessionDir: this.options.sessionDir,
        restoredSessionFile: sessionFile,
        stateFile: this.options.stateFile,
        stateDatabase: this.stateDatabase,
        providerId: modelProvider,
        modelId: this.options.modelId,
        credentials: this.options.modelCredentials,
        toolDefinitions: getBrowserHostedToolDefinitions({
          stateDatabase: this.stateDatabase,
          relayProviders: this.options.relayProviders,
        }),
        askUserHandler: this.askUserBridge.askForSession(guardedSessionId),
        onDurableEvents: async (events) => {
          for (const event of events) await emit(event as Record<string, unknown>);
        },
      });
      await session.prompt(dispatchedPrompt, signal, images);
      await emit({ type: "run.completed" });
      const completedResult = {
        ...(await this.buildBootstrap(
          await this.resolveManager(guardedSessionId),
          this.currentSessionId === guardedSessionId,
        )),
        events: streamedEvents,
      };
      // Keep only the idempotency identity. A bootstrap can include many complete
      // session files and image blocks, so retaining it for every completed run
      // would multiply the browser runtime's memory use. Retries rebuild the
      // canonical current snapshot without paying for another model invocation.
      this.completedChatResults.set(actionKey, {
        fingerprint,
        sessionId: completedResult.sessionId,
      });
      if (this.completedChatResults.size > MAX_COMPLETED_CHAT_RESULTS) {
        this.completedChatResults.delete(this.completedChatResults.keys().next().value as string);
      }
      return completedResult;
    } catch (error) {
      const message =
        signal?.aborted || (error instanceof DOMException && error.name === "AbortError")
          ? "Run cancelled. The last durable session state was preserved."
          : error instanceof Error
            ? error.message
            : String(error);
      await emit({ type: "run.failed", error: { message: message.slice(0, 500) } });
      throw error;
    } finally {
      session?.dispose();
      this.activeEventEmitters.delete(guardedSessionId);
    }
  }

  async answerAskUser(
    sessionId: string,
    id: string,
    answer: string,
  ): Promise<BrowserHostedBootstrap> {
    this.requireAskUserPrompt(sessionId, id);
    if (!this.askUserBridge.answer(id, answer)) throw new Error("Unknown ask_user prompt");
    return this.buildBootstrap(await this.resolveManager(sessionId));
  }

  async cancelAskUser(sessionId: string, id: string): Promise<BrowserHostedBootstrap> {
    this.requireAskUserPrompt(sessionId, id);
    if (!this.askUserBridge.cancel(id)) throw new Error("Unknown ask_user prompt");
    return this.buildBootstrap(await this.resolveManager(sessionId));
  }

  marketState(): Record<string, unknown> {
    const service = new MarketStateService(this.stateDatabase);
    const alerts = service.listAlertRules();
    const watchlists = service.listWatchlists();
    const portfolios = service.listPortfolios();
    return {
      instruments: [
        ...new Set(alerts.map((rule) => rule.instrumentId).filter((id) => id != null)),
      ]
        .map((id) => service.getInstrument(id))
        .filter((instrument) => instrument != null),
      watchlists,
      portfolios,
      watchlist: watchlists.flatMap((watchlist) => service.listWatchlistItems(watchlist.id)),
      portfolio: portfolios.flatMap((portfolio) => service.listPortfolioLots(portfolio.id)),
      alerts,
      alertEvents: service.listAlertEvents(),
      alertCheckRuns: service.listAlertCheckRuns(),
      reportTemplates: service.listReportTemplates(),
      reportRuns: service.listReportRuns(),
      runnerLease: service.getAutomationRunnerLease(),
      notifications: service.listNotificationEvents(),
      notificationDeliveryAttempts: service.listNotificationDeliveryAttempts(),
    };
  }

  async invokeTool(
    sessionId: string,
    actionId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const key = `${requireSessionId(sessionId)}:${requireActionId(actionId)}`;
    const fingerprint = fingerprintToolInvocation(toolName, args);
    const existing = this.actionResults.get(key);
    if (existing) {
      requireMatchingActionInput(existing.fingerprint, fingerprint);
      return existing.operation;
    }
    const operation = Promise.resolve().then(async () => {
      const service = new MarketStateService(this.stateDatabase);
      const result = await invokeHostedMarketStateTool(
        service,
        toolName,
        args,
        undefined,
        this.options.marketStateDependencies,
      );
      this.flushState();
      return { result };
    });
    this.actionResults.set(key, { fingerprint, operation, settled: false });
    void operation.then(
      () => {
        const cached = this.actionResults.get(key);
        if (cached?.operation === operation) cached.settled = true;
        this.pruneSettledActionResults();
      },
      () => {
        if (this.actionResults.get(key)?.operation === operation) this.actionResults.delete(key);
      },
    );
    return operation;
  }

  private pruneSettledActionResults(): void {
    while (this.actionResults.size > 256) {
      const settled = [...this.actionResults].find(([, result]) => result.settled);
      if (!settled) return;
      this.actionResults.delete(settled[0]);
    }
  }

  dispose(): void {
    this.flushState();
    this.stateDatabase.close();
  }

  private async resolveCurrentManager(): Promise<SessionManager> {
    if (this.currentSessionId) {
      try {
        return await this.resolveManager(this.currentSessionId);
      } catch {
        this.currentSessionId = undefined;
      }
    }
    const sessions = await SessionManager.list(this.options.cwd, this.options.sessionDir);
    const latest = sessions[0];
    if (latest) {
      this.currentSessionId = latest.id;
      return SessionManager.open(latest.path, this.options.sessionDir, this.options.cwd);
    }
    const manager = SessionManager.create(this.options.cwd, this.options.sessionDir);
    persistEmptySession(manager);
    this.currentSessionId = manager.getSessionId();
    return manager;
  }

  private async resolveManager(sessionId: string): Promise<SessionManager> {
    const id = requireSessionId(sessionId);
    const sessions = await SessionManager.list(this.options.cwd, this.options.sessionDir);
    const matches = sessions.filter((session) => session.id === id);
    const match =
      matches.find((session) => basename(session.path) !== "current.jsonl") ?? matches[0];
    if (!match) throw new Error("Unknown saved session");
    return SessionManager.open(match.path, this.options.sessionDir, this.options.cwd);
  }

  private async buildBootstrap(
    manager: SessionManager,
    selectCurrent = true,
  ): Promise<BrowserHostedBootstrap> {
    if (selectCurrent) this.currentSessionId = manager.getSessionId();
    const entries = manager.getEntries();
    const sessionId = manager.getSessionId();
    const marketState = new MarketStateService(this.stateDatabase);
    const defaultWatchlist = marketState.getDefaultWatchlist();
    const symbols = marketState
      .listWatchlistItems(defaultWatchlist.id)
      .map((item) => item.symbol);
    const tools = getBrowserHostedToolDefinitions({
      stateDatabase: this.stateDatabase,
      relayProviders: this.options.relayProviders,
    });
    const providerReport = resolveHostedBrowserCapabilityReport(this.options.relayProviders);
    this.flushState();
    const bootstrap: BrowserHostedBootstrap = {
      role: "writer",
      sessionId,
      supportsSessionActions: true,
      coordination: {
        sessionId,
        ownerKind: "hosted",
        writable: true,
      },
      sessions: (await this.listDisplaySessions()).map(toDisplaySession),
      catalog: {
        tools: tools.map(({ name, label, description, parameters }) => ({
          name,
          label,
          description,
          parameters,
          domain: inferToolDomain(name),
          enabled: true as const,
          defaults: {},
        })),
        workflows: OPENCANDLE_WORKFLOWS,
        providers: providerReport.available.map(serializeHostedProvider),
      },
      askUserPrompts: this.askUserBridge.getPrompts(),
      snapshot: {
        sessionId,
        entries,
        events: sessionEntriesToChatEvents(entries, { sessionId }),
        state: projectDashboard(entries, sessionId, symbols),
      },
      checkpoint: this.checkpoint(),
    };
    assertHostedBootstrapPersistable(
      bootstrap,
      this.options.maxArchiveBytes ?? MAX_HOSTED_ARCHIVE_BYTES,
    );
    return bootstrap;
  }

  private checkpoint(): BrowserHostedBootstrap["checkpoint"] {
    const sessionFiles = readdirSync(this.options.sessionDir)
      .filter((filename) => filename.endsWith(".jsonl"))
      .map((filename) => {
        const path = resolve(this.options.sessionDir, filename);
        const content = readFileSync(path, "utf8");
        if (Buffer.byteLength(content) > MAX_SESSION_FILE_BYTES) {
          throw new Error(`Session snapshot is too large: ${filename}`);
        }
        const firstLine = content.split("\n", 1)[0];
        const header = JSON.parse(firstLine) as { type?: string; id?: string };
        if (header.type !== "session" || typeof header.id !== "string") {
          throw new Error(`Session snapshot is invalid: ${filename}`);
        }
        return {
          sessionId: header.id,
          filename: basename(filename),
          content,
        };
      });
    const sessions = selectSessionCheckpoints(sessionFiles, this.currentSessionId);
    const stateBytes = this.stateDatabase.exportBytes();
    return {
      sessions,
      state: {
        format: "sqlite3",
        filename: "current.sqlite3",
        contentBase64: Buffer.from(stateBytes).toString("base64"),
      },
    };
  }

  private assertArchiveAdmission(
    bootstrap: BrowserHostedBootstrap,
    additionalSessionBytes = 0,
  ): void {
    const maxArchiveBytes = this.options.maxArchiveBytes ?? MAX_HOSTED_ARCHIVE_BYTES;
    assertHostedBootstrapPersistable(
      bootstrap,
      maxArchiveBytes - additionalSessionBytes * ARCHIVE_SESSION_GROWTH_MULTIPLIER,
    );
  }

  private async listDisplaySessions(): Promise<SessionInfo[]> {
    const sessions = await SessionManager.list(this.options.cwd, this.options.sessionDir);
    return [
      ...new Map(
        sessions
          .filter(
            (session) =>
              Boolean(session.name?.trim()) ||
              (session.messageCount > 0 && session.firstMessage !== "(no messages)"),
          )
          .map((session) => [session.id, session]),
      ).values(),
    ];
  }

  private flushState(): void {
    writeFileSync(this.options.stateFile, this.stateDatabase.exportBytes());
  }

  private requireAskUserPrompt(sessionId: string, id: string): void {
    const prompt = this.askUserBridge.getPrompts().find((candidate) => candidate.id === id);
    if (!prompt || prompt.sessionId !== requireSessionId(sessionId)) {
      throw new Error("Unknown ask_user prompt");
    }
  }

  private requireInactiveSession(sessionId: string): void {
    if (this.activeSessionRuns.has(sessionId)) {
      throw new Error("Cannot delete a session while its research run is active.");
    }
  }
}

function serializeHostedProvider(
  provider: ProviderDescriptor,
): BrowserHostedBootstrap["catalog"]["providers"][number] {
  const credential = isApiKeyProvider(provider) ? process.env[provider.envVar]?.trim() : undefined;
  return {
    id: provider.id,
    name: provider.displayName,
    displayName: provider.displayName,
    kind: provider.kind,
    category: provider.category,
    tier: provider.tier,
    unlocks: provider.unlocks,
    fallbackDescription: provider.fallbackDescription,
    instructionsHint: provider.instructionsHint,
    status: isApiKeyProvider(provider) ? (credential ? "file" : "absent") : "reachable",
    browserTransport: provider.browserTransport.mode === "direct" ? "direct" : "relayed",
    hosted: true,
    ...(isApiKeyProvider(provider)
      ? {
          configured: Boolean(credential),
          source: credential ? ("file" as const) : ("absent" as const),
          signupUrl: provider.signupUrl,
          freeTier: provider.freeTier,
          envVar: provider.envVar,
          ...(credential ? { maskedKeyHint: `…${credential.slice(-4)}` } : {}),
        }
      : {}),
  };
}

export function selectSessionCheckpoints(
  sessions: HostedSessionCheckpoint[],
  currentSessionId = "",
): HostedSessionCheckpoint[] {
  const unique = [...new Map(sessions.map((session) => [session.sessionId, session])).values()];
  unique.sort((left, right) => {
    if (left.sessionId === currentSessionId) return -1;
    if (right.sessionId === currentSessionId) return 1;
    return left.filename.localeCompare(right.filename);
  });
  return unique.slice(0, MAX_SESSION_FILES);
}

function requireSessionId(value: string): string {
  const sessionId = value.trim();
  if (!sessionId || !/^[A-Za-z0-9_-]{1,160}$/.test(sessionId)) {
    throw new Error("Invalid sessionId");
  }
  return sessionId;
}

function requireActionId(value: string): string {
  const actionId = value.trim();
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(actionId)) throw new Error("Invalid actionId");
  return actionId;
}

function fingerprintChatInput(input: ParsedChatRunBody): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function fingerprintToolInvocation(toolName: string, args: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify({ toolName, args: canonicalizeJson(args) }))
    .digest("hex");
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeJson(entry)]),
    );
  }
  return value;
}

function requireMatchingChatInput(expected: string, candidate: string): void {
  if (expected !== candidate) {
    throw new Error("The actionId was already used with different input.");
  }
}

function requireMatchingActionInput(expected: string, candidate: string): void {
  if (expected !== candidate) {
    throw new Error("The actionId was already used with different input.");
  }
}

function toDisplaySession(session: SessionInfo): BrowserHostedBootstrap["sessions"][number] {
  return {
    id: session.id,
    path: session.id,
    ...(session.name ? { name: session.name } : {}),
    created: session.created.toISOString(),
    modified: session.modified.toISOString(),
    messageCount: session.messageCount,
    firstMessage: session.firstMessage,
  };
}

function persistEmptySession(manager: SessionManager): void {
  const sessionFile = manager.getSessionFile();
  const header = manager.getHeader();
  if (!sessionFile || !header) throw new Error("Pi did not create a session header");
  writeFileSync(sessionFile, `${JSON.stringify(header)}\n`, { flag: "wx" });
}

function removeLegacyCurrentAlias(sessionDir: string): void {
  const legacyPath = join(sessionDir, "current.jsonl");
  if (!existsSync(legacyPath)) return;
  const legacyId = readSessionHeaderId(legacyPath);
  const hasCanonicalCopy = readdirSync(sessionDir).some((filename) => {
    if (filename === "current.jsonl" || !filename.endsWith(".jsonl")) return false;
    return readSessionHeaderId(join(sessionDir, filename)) === legacyId;
  });
  if (legacyId && hasCanonicalCopy) {
    unlinkSync(legacyPath);
  }
}

function readSessionHeaderId(path: string): string | undefined {
  try {
    const firstLine = readFileSync(path, "utf8").split("\n", 1)[0];
    const header = JSON.parse(firstLine) as { type?: string; id?: string };
    return header.type === "session" && typeof header.id === "string" ? header.id : undefined;
  } catch {
    return undefined;
  }
}
