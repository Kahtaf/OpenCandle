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
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
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
import { createLiveChatEventAdapter } from "../../../gui/shared/live-chat-event-adapter.js";
import { invokeToolFromUi } from "../../../gui/shared/invoke-tool-from-ui.js";
import { assertValidToolArguments } from "../../../gui/shared/tool-argument-validation.js";
import { toolOutcomeNeedsInput } from "../../../gui/shared/tool-output.js";
import {
  buildDispatchedPromptFromState,
  chatRunAttachmentLabel,
  type ParsedChatRunBody,
} from "../../../gui/shared/chat-run-input.js";
import {
  inferToolDomain,
  OPENCANDLE_WORKFLOWS,
  providerCatalogBase,
  serializeApiKeyProviderCatalog,
} from "../../../gui/shared/catalog-metadata.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import {
  buildPreferencesSnapshot,
  type PreferencesSnapshot,
} from "../../../src/memory/preferences-view.js";
import { MemoryStorage } from "../../../src/memory/storage.js";
import { assertUserDeletableToolDefaultPath,
  deleteDefault } from "../../../src/memory/tool-defaults.js";
import {
  clearPendingSessionAction,
  deleteSessionActionStore,
  hasAcceptedSessionAction,
  hasPendingSessionAction,
  readSessionActionStoreSnapshot,
  recordAcceptedSessionAction,
  recordPendingSessionAction,
} from "../../../src/pi/session-action-dedupe.js";
import {
  isApiKeyProvider,
  resolveHostedBrowserCapabilityReport,
  type ProviderDescriptor,
} from "../../../src/onboarding/providers.js";
import {
  createSqlJsStateDatabase,
  type SqlJsStateDatabase,
} from "../../../src/runtime/sqljs-state-database-node.js";
import {
  BrowserPiSession,
  type BrowserPiThinkingState,
} from "./browser-pi-session.js";
import type { StatefulToolOptions } from "../../../src/tools/portfolio/stateful-tool-options.js";
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
export const MAX_PI_SESSION_CACHE_SIZE = 2;

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
  operation?: Promise<Record<string, unknown>>;
  settled: boolean;
  result?: Record<string, unknown>;
  persistencePending?: boolean;
  acceptOnPersistence?: boolean;
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
  marketStateDependencies?: Pick<StatefulToolOptions, "resolveInstrument" | "getCurrentPrice">;
}

interface HostedSessionCheckpoint {
  sessionId: string;
  filename: string;
  content: string;
  actionStore?: string;
}

interface HostedStateCheckpoint {
  format: "sqlite3";
  filename: "current.sqlite3";
  contentBase64: string;
}

export interface BrowserHostedBootstrap {
  role: "writer";
  sessionId: string;
  sessionPersisted: boolean;
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
      displayName: string;
      kind: ProviderDescriptor["kind"];
      category: ProviderDescriptor["category"];
      tier: ProviderDescriptor["tier"];
      aliases: readonly string[];
      unlocks: readonly string[];
      fallbackDescription: string | null;
      instructionsHint: string;
      status: "file" | "absent" | "reachable";
      browserTransport: "direct" | "relayed" | "blocked";
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
  thinking: BrowserPiThinkingState | null;
  snapshot: {
    sessionId: string;
    entries: ReturnType<SessionManager["getEntries"]>;
    events: ReturnType<typeof sessionEntriesToChatEvents>;
    state: ReturnType<typeof projectDashboard>;
  };
  marketState: Record<string, unknown>;
  checkpoint: {
    sessions: HostedSessionCheckpoint[];
    state: HostedStateCheckpoint;
  };
}

type BrowserHostedCheckpointPersistence = Pick<
  BrowserHostedBootstrap,
  "sessionId" | "checkpoint" | "marketState"
>;

export class BrowserHostedGuiRuntime {
  private currentSessionId: string | undefined;
  private readonly activeSessionRuns = new Set<string>();
  private readonly completedChatResults = new Map<string, CachedChatResult>();
  private readonly inFlightChatResults = new Map<string, InFlightChatResult>();
  private readonly actionResults = new Map<string, CachedToolActionResult>();
  private readonly piSessions = new Map<string, BrowserPiSession>();
  private readonly piSessionCreations = new Map<string, Promise<BrowserPiSession>>();
  private readonly piSessionVersions = new Map<string, number>();
  private newSessionInFlight: Promise<BrowserHostedBootstrap> | undefined;
  private piSessionEpoch = 0;
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
    const configurationChanged =
      this.options.modelProvider !== (normalizedKey ? provider : undefined) ||
      this.options.modelId !== (normalizedKey ? modelId : undefined) ||
      this.options.modelCredentials?.[provider] !== normalizedKey;
    if (configurationChanged) this.requireNoActiveRuns();
    this.options.modelProvider = normalizedKey ? provider : undefined;
    this.options.modelId = normalizedKey ? modelId : undefined;
    this.options.modelCredentials = {
      ...this.options.modelCredentials,
      ...(normalizedKey ? { [provider]: normalizedKey } : {}),
    };
    if (configurationChanged) this.disposePiSessions();
  }

  configureRelayProviders(providers: readonly string[]): void {
    const normalized = [...new Set(providers)].sort();
    const current = [...new Set(this.options.relayProviders ?? [])].sort();
    if (normalized.join("\0") !== current.join("\0")) {
      this.requireNoActiveRuns();
      this.options.relayProviders = normalized;
      this.disposePiSessions();
    }
  }

  async configureThinking(level: ThinkingLevel): Promise<BrowserHostedBootstrap> {
    const manager = await this.resolveCurrentManager();
    const session = await this.resolveConfiguredPiSession(manager);
    this.requireNoActiveRuns();
    session.setThinkingLevel(level);
    return this.buildBootstrap(manager);
  }

  async newSession(): Promise<BrowserHostedBootstrap> {
    if (this.newSessionInFlight) return this.newSessionInFlight;
    const creation = this.createNewSession();
    this.newSessionInFlight = creation;
    try {
      return await creation;
    } finally {
      if (this.newSessionInFlight === creation) this.newSessionInFlight = undefined;
    }
  }

  private async createNewSession(): Promise<BrowserHostedBootstrap> {
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
    const guardedSessionId = requireSessionId(sessionId);
    this.requireInactiveSession(guardedSessionId);
    this.disposePiSession(guardedSessionId);
    const manager = await this.resolveManager(sessionId);
    this.requireInactiveSession(guardedSessionId);
    manager.appendSessionInfo(nextName.slice(0, 160));
    return this.buildBootstrap(manager);
  }

  async deleteSession(sessionId: string): Promise<BrowserHostedBootstrap> {
    const guardedSessionId = requireSessionId(sessionId);
    this.requireInactiveSession(guardedSessionId);
    this.disposePiSession(guardedSessionId);
    const manager = await this.resolveManager(guardedSessionId);
    this.requireInactiveSession(guardedSessionId);
    const sessionFile = manager.getSessionFile();
    if (!sessionFile) throw new Error("Saved session file is unavailable");
    deleteSessionActionStore(manager);
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
    persistCheckpoint?: (value: BrowserHostedCheckpointPersistence) => Promise<void>,
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
    const manager = await this.resolveManager(guardedSessionId);
    const completedAfterLookup = this.completedChatResults.get(actionKey);
    if (completedAfterLookup) {
      requireMatchingChatInput(completedAfterLookup.fingerprint, fingerprint);
      return { ...(await this.buildBootstrap(manager, false)), events: [] };
    }
    const inFlightAfterLookup = this.inFlightChatResults.get(actionKey);
    if (inFlightAfterLookup) {
      requireMatchingChatInput(inFlightAfterLookup.fingerprint, fingerprint);
      return inFlightAfterLookup.operation;
    }
    if (hasAcceptedSessionAction(manager, guardedActionId, fingerprint)) {
      return { ...(await this.buildBootstrap(manager, false)), events: [] };
    }
    if (hasPendingSessionAction(manager, guardedActionId, fingerprint)) {
      throw new Error(
        "A previous run with this action id may have started before the browser runtime stopped. OpenCandle will not replay paid work automatically; submit a new message only if you want to retry intentionally.",
      );
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
      manager,
      onEvent,
      signal,
      persistCheckpoint,
    );
    this.inFlightChatResults.set(actionKey, { fingerprint, operation });
    try {
      return await operation;
    } finally {
      const current = this.inFlightChatResults.get(actionKey);
      if (current?.operation === operation) this.inFlightChatResults.delete(actionKey);
      this.activeSessionRuns.delete(guardedSessionId);
      this.prunePiSessionCache(this.currentSessionId ?? guardedSessionId);
    }
  }

  private async executeChatRun(
    guardedSessionId: string,
    input: ParsedChatRunBody,
    guardedActionId: string,
    actionKey: string,
    fingerprint: string,
    manager: SessionManager,
    onEvent?: (event: Record<string, unknown>) => void | Promise<void>,
    signal?: AbortSignal,
    persistCheckpoint?: (value: BrowserHostedCheckpointPersistence) => Promise<void>,
  ): Promise<CompletedChatResult> {
    const runId = guardedActionId;
    let seq = 1;
    const streamedEvents: Array<Record<string, unknown>> = [];
    const pendingEventWrites: Promise<void>[] = [];
    const pendingCheckpointWrites: Promise<void>[] = [];
    const runAbortController = new AbortController();
    const abortFromCaller = () => runAbortController.abort(signal?.reason);
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener("abort", abortFromCaller, { once: true });
    const trackPersistenceWrite = (writes: Promise<void>[], write: Promise<void>) => {
      writes.push(write);
      void write.catch((error) => runAbortController.abort(error));
    };
    let actionAccepted = false;
    let actionStartAmbiguous = false;
    let nextLiveSeq: (() => number) | undefined;
    const emit = (event: Record<string, unknown>) => {
      const sequenced = { ...event, runId, sessionId: guardedSessionId, seq: seq++ };
      streamedEvents.push(sequenced);
      trackPersistenceWrite(
        pendingEventWrites,
        Promise.resolve()
          .then(() => onEvent?.(sequenced))
          .then(() => undefined),
      );
    };
    this.activeEventEmitters.set(guardedSessionId, emit);
    try {
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
      recordPendingSessionAction(manager, guardedActionId, fingerprint, { durable: true });
      await persistCheckpoint?.({
        sessionId: guardedSessionId,
        marketState: this.marketState(),
        checkpoint: this.checkpoint(),
      });
      emit({ type: "run.started" });
      const attachmentLabels = [
        ...input.images.map((image, index) => ({
          kind: "image",
          label: `${image.mimeType || "image"} #${index + 1}`,
        })),
        ...input.attachments.map((attachment) => ({
          kind: attachment.kind,
          label: chatRunAttachmentLabel(attachment),
        })),
      ];
      const session = await this.getOrCreatePiSession(
        guardedSessionId,
        sessionFile,
        modelProvider,
        this.options.modelId,
        this.options.modelCredentials,
      );
      const liveStartSeq = seq;
      const liveAdapter = createLiveChatEventAdapter({
        runId,
        sessionId: guardedSessionId,
        startSeq: seq,
        sequence: {
          next: () => seq++,
          peek: () => seq,
        },
        emit: (event) => {
          streamedEvents.push(event as Record<string, unknown>);
          trackPersistenceWrite(
            pendingEventWrites,
            Promise.resolve()
              .then(() => onEvent?.(event))
              .then(() => undefined),
          );
        },
        originalPrompt: input.prompt,
        dispatchedPrompt,
        originalAttachments: attachmentLabels,
      });
      nextLiveSeq = liveAdapter.nextSeq;
      const acceptAction = () => {
        if (actionAccepted) return;
        recordAcceptedSessionAction(manager, guardedActionId, fingerprint);
        actionAccepted = true;
        if (persistCheckpoint) {
          trackPersistenceWrite(
            pendingCheckpointWrites,
            Promise.resolve().then(() =>
              persistCheckpoint({
                sessionId: this.currentSessionId ?? guardedSessionId,
                marketState: this.marketState(),
                checkpoint: this.checkpoint(),
              }),
            ),
          );
        }
      };
      const unsubscribeLive = session.subscribe?.((event) => {
        liveAdapter.handle(event);
      });
      let result: Awaited<ReturnType<BrowserPiSession["prompt"]>>;
      const entryCountBeforePrompt = manager.getEntries().length;
      try {
        session.markOriginalInput?.(input.prompt, attachmentLabels);
        result = await session.prompt(dispatchedPrompt, runAbortController.signal, images);
        acceptAction();
      } catch (error) {
        let persistedUserMessage = false;
        try {
          const refreshedManager = await this.resolveManager(guardedSessionId);
          persistedUserMessage = refreshedManager
            .getEntries()
            .slice(entryCountBeforePrompt)
            .some(
              (entry) =>
                entry.type === "message" &&
                (entry as { message?: { role?: unknown } }).message?.role === "user",
            );
        } catch {
          // The durable pending marker must survive when the canonical session
          // cannot be inspected. Replaying paid work would be less safe than
          // reporting an ambiguous action after restart.
          actionStartAmbiguous = true;
        }
        if (persistedUserMessage) {
          acceptAction();
          await Promise.all(pendingCheckpointWrites);
        }
        throw error;
      } finally {
        unsubscribeLive?.();
      }
      seq = Math.max(seq, liveAdapter.nextSeq());
      if (seq === liveStartSeq && result.turnEvents) {
        for (const event of result.turnEvents) emit(event as Record<string, unknown>);
      }
      await Promise.all(pendingCheckpointWrites);
      emit({ type: "run.completed" });
      await Promise.all(pendingEventWrites);
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
      let reportedError = error;
      if (!actionAccepted && !actionStartAmbiguous) {
        clearPendingSessionAction(manager, guardedActionId);
        if (persistCheckpoint) {
          try {
            await persistCheckpoint({
              sessionId: this.currentSessionId ?? guardedSessionId,
              marketState: this.marketState(),
              checkpoint: this.checkpoint(),
            });
          } catch (checkpointError) {
            reportedError = checkpointError;
          }
        }
      }
      seq = Math.max(seq, nextLiveSeq?.() ?? seq);
      const message =
        signal?.aborted ||
        (reportedError instanceof DOMException && reportedError.name === "AbortError")
          ? "Run cancelled. The last durable session state was preserved."
          : reportedError instanceof Error
            ? reportedError.message
            : String(reportedError);
      emit({ type: "run.failed", error: { message: message.slice(0, 500) } });
      await Promise.all(pendingEventWrites);
      throw reportedError;
    } finally {
      signal?.removeEventListener("abort", abortFromCaller);
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

  /** The two silently written stores behind Settings -> Preferences. */
  listPreferences(): PreferencesSnapshot {
    return buildPreferencesSnapshot(this.stateDatabase);
  }

  async deletePreference(
    namespace: string,
    key: string,
  ): Promise<BrowserHostedBootstrap & { preferences: PreferencesSnapshot }> {
    new MemoryStorage(this.stateDatabase).deletePreference(namespace, key);
    return this.buildPreferencesMutation();
  }

  async deleteToolDefault(
    toolName: string,
    paramPath: string,
  ): Promise<BrowserHostedBootstrap & { preferences: PreferencesSnapshot }> {
    assertUserDeletableToolDefaultPath(paramPath);
    deleteDefault(toolName, paramPath, this.stateDatabase);
    return this.buildPreferencesMutation();
  }

  /**
   * A preference delete is a state mutation, so it answers with the same
   * bootstrap the other mutations return. That is what carries the changed
   * SQLite into the browser checkpoint, making the deletion survive a reload.
   */
  private async buildPreferencesMutation(): Promise<
    BrowserHostedBootstrap & { preferences: PreferencesSnapshot }
  > {
    const bootstrap = await this.buildBootstrap(await this.resolveCurrentManager());
    return { ...bootstrap, preferences: this.listPreferences() };
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
    recordTranscript = true,
  ): Promise<Record<string, unknown>> {
    const guardedSessionId = requireSessionId(sessionId);
    const guardedActionId = requireActionId(actionId);
    const key = `${guardedSessionId}:${guardedActionId}`;
    const fingerprint = fingerprintToolInvocation(toolName, args);
    const existing = this.actionResults.get(key);
    if (existing) {
      requireMatchingActionInput(existing.fingerprint, fingerprint);
      if (existing.operation) return existing.operation;
      if (existing.result && existing.persistencePending) {
        const persistenceRetry = Promise.resolve()
          .then(async () => {
            this.flushState();
            const manager = await this.resolveManager(guardedSessionId);
            if (existing.acceptOnPersistence === false) {
              clearPendingSessionAction(manager, guardedActionId);
            } else {
              recordAcceptedSessionAction(manager, guardedActionId, fingerprint);
            }
            const bootstrap = await this.buildBootstrap(manager);
            existing.result = { ...bootstrap, result: existing.result?.result };
            existing.persistencePending = false;
            existing.settled = true;
            this.pruneSettledActionResults();
            return existing.result as Record<string, unknown>;
          })
          .catch((error) => {
            existing.operation = undefined;
            throw error;
          });
        existing.operation = persistenceRetry;
        return persistenceRetry;
      }
      if (existing.result) return existing.result;
    }
    const cached: CachedToolActionResult = { fingerprint, settled: false };
    const operation = Promise.resolve().then(async () => {
      const manager = await this.resolveManager(guardedSessionId);
      if (hasAcceptedSessionAction(manager, guardedActionId, fingerprint)) {
        return {
          ...(await this.buildBootstrap(manager, false)),
          result: { status: "already_accepted" },
        };
      }
      if (hasPendingSessionAction(manager, guardedActionId, fingerprint)) {
        throw new Error("This action is still being recovered. Retry shortly.");
      }
      recordPendingSessionAction(manager, guardedActionId, fingerprint);
      try {
        const tool = getBrowserHostedToolDefinitions({
          stateDatabase: this.stateDatabase,
          relayProviders: this.options.relayProviders,
          marketStateDependencies: this.options.marketStateDependencies,
        }).find((candidate) => candidate.name === toolName);
        if (!tool) {
          throw new Error(
            `${toolName || "This action"} is unavailable in hosted OpenCandle.`,
          );
        }
        assertValidToolArguments(tool.parameters, args);
        const result = await invokeToolFromUi(manager, tool, args, "ui", { recordTranscript });
        const response = { result };
        cached.result = response;
        cached.persistencePending = true;
        cached.acceptOnPersistence = !toolOutcomeNeedsInput(result.result);
        this.flushState();
        if (cached.acceptOnPersistence) {
          recordAcceptedSessionAction(manager, guardedActionId, fingerprint);
        } else {
          clearPendingSessionAction(manager, guardedActionId);
        }
        // The host only needs a durable checkpoint to acknowledge a direct
        // tool mutation. Re-listing every Pi session here can stall a market
        // save in WebContainer; ordinary bootstrap/refresh requests retain
        // the full session list.
        const bootstrap = await this.buildBootstrap(manager, true, false);
        cached.result = { ...bootstrap, result };
        cached.persistencePending = false;
        return cached.result;
      } catch (error) {
        if (!hasAcceptedSessionAction(manager, guardedActionId, fingerprint)) {
          clearPendingSessionAction(manager, guardedActionId);
        }
        throw error;
      }
    });
    cached.operation = operation;
    this.actionResults.set(key, cached);
    void operation.then(
      () => {
        const cached = this.actionResults.get(key);
        if (cached?.operation === operation) {
          cached.settled = true;
          cached.persistencePending = false;
        }
        this.pruneSettledActionResults();
      },
      () => {
        const failed = this.actionResults.get(key);
        if (failed?.operation !== operation) return;
        if (failed.result) {
          failed.operation = undefined;
          failed.persistencePending = true;
        } else {
          this.actionResults.delete(key);
        }
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
    this.disposePiSessions();
    this.flushState();
    this.stateDatabase.close();
  }

  private async getOrCreatePiSession(
    sessionId: string,
    sessionFile: string,
    modelProvider: FirstClassModelProviderId,
    modelId: string,
    modelCredentials: BrowserModelCredentials,
  ): Promise<BrowserPiSession> {
    const existing = this.piSessions.get(sessionId);
    if (existing) {
      this.piSessions.delete(sessionId);
      this.piSessions.set(sessionId, existing);
      return existing;
    }
    const pending = this.piSessionCreations.get(sessionId);
    if (pending) return pending;
    const epoch = this.piSessionEpoch;
    const version = this.piSessionVersions.get(sessionId) ?? 0;
    const createPiSession = this.options.createPiSession ?? BrowserPiSession.create;
    const creation = createPiSession({
      cwd: this.options.cwd,
      sessionDir: this.options.sessionDir,
      restoredSessionFile: sessionFile,
      stateFile: this.options.stateFile,
      stateDatabase: this.stateDatabase,
      providerId: modelProvider,
      modelId,
      credentials: modelCredentials,
      toolDefinitions: getBrowserHostedToolDefinitions({
        stateDatabase: this.stateDatabase,
        relayProviders: this.options.relayProviders,
        marketStateDependencies: this.options.marketStateDependencies,
      }),
      askUserHandler: this.askUserBridge.askForSession(sessionId),
    }).then((session) => {
      if (
        this.piSessionEpoch !== epoch ||
        (this.piSessionVersions.get(sessionId) ?? 0) !== version
      ) {
        session.dispose();
        throw new Error("The hosted model configuration changed while the session was loading.");
      }
      this.piSessions.set(sessionId, session);
      this.prunePiSessionCache(sessionId);
      return session;
    });
    this.piSessionCreations.set(sessionId, creation);
    try {
      return await creation;
    } finally {
      if (this.piSessionCreations.get(sessionId) === creation) {
        this.piSessionCreations.delete(sessionId);
      }
    }
  }

  private async resolveConfiguredPiSession(manager: SessionManager): Promise<BrowserPiSession> {
    const sessionFile = manager.getSessionFile();
    const provider = this.options.modelProvider;
    const modelId = this.options.modelId;
    const credentials = this.options.modelCredentials;
    if (!sessionFile || !provider || !modelId || !credentials?.[provider]) {
      throw new Error("Connect an AI model before changing its thinking level.");
    }
    return this.getOrCreatePiSession(
      manager.getSessionId(),
      sessionFile,
      provider,
      modelId,
      credentials,
    );
  }

  private disposePiSession(sessionId: string): void {
    this.piSessionVersions.set(sessionId, (this.piSessionVersions.get(sessionId) ?? 0) + 1);
    this.piSessionCreations.delete(sessionId);
    this.piSessions.get(sessionId)?.dispose();
    this.piSessions.delete(sessionId);
  }

  private disposePiSessions(): void {
    this.piSessionEpoch += 1;
    this.piSessionCreations.clear();
    for (const session of this.piSessions.values()) session.dispose();
    this.piSessions.clear();
  }

  private prunePiSessionCache(preserveSessionId: string): void {
    while (this.piSessions.size > MAX_PI_SESSION_CACHE_SIZE) {
      const candidate = [...this.piSessions.keys()].find(
        (sessionId) =>
          sessionId !== preserveSessionId && !this.activeSessionRuns.has(sessionId),
      );
      if (!candidate) return;
      this.piSessions.get(candidate)?.dispose();
      this.piSessions.delete(candidate);
    }
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
    includeDisplaySessions = true,
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
      marketStateDependencies: this.options.marketStateDependencies,
    });
    const providerReport = resolveHostedBrowserCapabilityReport(this.options.relayProviders);
    // Bootstrapping the transcript must not instantiate a full Pi agent only
    // to render the thinking picker. A configured session is created lazily
    // by the first chat turn or explicit thinking change and remains cached
    // thereafter.
    const thinking = this.piSessions.get(sessionId)?.getThinkingState() ?? null;
    this.flushState();
    const checkpoint = this.checkpoint();
    const checkpointSessionIds = new Set(
      checkpoint.sessions.map((session) => session.sessionId),
    );
    const displaySessions = includeDisplaySessions
      ? (await this.listDisplaySessions()).filter((session) => checkpointSessionIds.has(session.id))
      : [];
    const bootstrap: BrowserHostedBootstrap = {
      role: "writer",
      sessionId,
      sessionPersisted: true,
      supportsSessionActions: true,
      coordination: {
        sessionId,
        ownerKind: "hosted",
        writable: true,
      },
      sessions: displaySessions.map(toDisplaySession),
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
        providers: [
          ...providerReport.available.map(serializeHostedProvider),
          ...providerReport.unavailable.map(serializeHostedBlockedProvider),
        ],
      },
      askUserPrompts: this.askUserBridge.getPrompts(),
      thinking,
      snapshot: {
        sessionId,
        entries,
        events: sessionEntriesToChatEvents(entries, { sessionId }),
        state: projectDashboard(entries, sessionId, symbols),
      },
      marketState: this.marketState(),
      checkpoint,
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
        const actionStore = readSessionActionStoreSnapshot({
          getSessionFile: () => path,
          getSessionDir: () => this.options.sessionDir,
        });
        return {
          sessionId: header.id,
          filename: basename(filename),
          content,
          ...(actionStore ? { actionStore: actionStore.content } : {}),
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
      throw new Error("Cannot modify a session while its research run is active.");
    }
  }

  private requireNoActiveRuns(): void {
    if (this.activeSessionRuns.size > 0) {
      throw new Error("Cannot change hosted runtime configuration while a research run is active.");
    }
  }
}

function serializeHostedProvider(
  provider: ProviderDescriptor,
): BrowserHostedBootstrap["catalog"]["providers"][number] {
  const credential = isApiKeyProvider(provider) ? process.env[provider.envVar]?.trim() : undefined;
  const shared = isApiKeyProvider(provider)
    ? serializeApiKeyProviderCatalog(provider, {
        source: credential ? "file" : "absent",
        credential,
      })
    : providerCatalogBase(provider);
  return {
    ...shared,
    status: isApiKeyProvider(provider) ? (credential ? "file" : "absent") : "reachable",
    browserTransport: provider.browserTransport.mode === "direct" ? "direct" : "relayed",
    hosted: true,
  };
}

// A provider with no hosted transport still gets a catalog row so the
// settings page can say it is available only in the local app, instead of
// silently omitting it.
export function serializeHostedBlockedProvider(
  provider: ProviderDescriptor,
): BrowserHostedBootstrap["catalog"]["providers"][number] {
  return {
    ...providerCatalogBase(provider),
    status: "absent",
    browserTransport: "blocked",
    hosted: true,
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
