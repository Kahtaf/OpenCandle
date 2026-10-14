import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import initSqlJs from "sql.js";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type AgentSessionEvent,
  type SessionEntry,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { sessionEntriesToChatEvents } from "../../../gui/server/chat-event-adapter.js";
import { persistUnflushedSession } from "../../../gui/server/durable-session-persist.js";
import { buildRunStoppedMarker, RUN_STOPPED_CUSTOM_TYPE } from "../../../gui/server/run-stop-marker.js";
import type { ChatEvent } from "../../../gui/shared/chat-events.js";
import { shouldPersistOriginalInputMarker } from "../../../gui/shared/chat-run-input.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import { getAllDefaults } from "../../../src/memory/tool-defaults.js";
import { createOpenCandleSessionCore } from "../../../src/pi/session-core.js";
import {
  createSqlJsStateDatabaseWithModule,
  type SqlJsStateDatabase,
} from "../../../src/runtime/sqljs-state-database.js";
import {
  createBrowserModelRuntime,
  type BrowserModelCredentials,
} from "./browser-model-runtime.js";
import { createPiAiRouterClient } from "../../../src/routing/router-llm-client.js";
import type { FirstClassModelProviderId } from "../../../src/pi/model-provider-metadata.js";
import type { AskUserHandler } from "../../../src/types/index.js";

const MAX_RETURNED_ENTRIES = 48;
export const HOSTED_RUN_PENDING = "opencandle-hosted-run-pending";
const HOSTED_RUN_FINISHED = "opencandle-hosted-run-finished";

/** Called only when a new runtime restores sessions, never for a live writer. */
export function recoverInterruptedHostedRun(manager: SessionManager): void {
  const entries = manager.getEntries();
  const pending = entries.findLast((entry) => entry.type === "custom" && entry.customType === HOSTED_RUN_PENDING);
  if (!pending || pending.type !== "custom") return;
  const data = pending.data as { actionId?: string; prompt?: string; attachments?: unknown };
  if (typeof data?.actionId !== "string" || typeof data.prompt !== "string") return;
  const runEntries = entries.slice(entries.indexOf(pending) + 1);
  if (runEntries.some((entry) => entry.type === "custom" && entry.customType === HOSTED_RUN_FINISHED && (entry.data as { actionId?: string })?.actionId === data.actionId)) return;
  const hasUserMessage = runEntries.some((entry) => entry.type === "message" && entry.message.role === "user");
  if (!hasUserMessage) {
    manager.appendCustomEntry("opencandle-user-input", { original: data.prompt, attachments: data.attachments ?? [] });
    manager.appendMessage({ role: "user", content: data.prompt, timestamp: Date.now() });
  }
  const requiresReattachment = Array.isArray(data.attachments) && data.attachments.length > 0;
  manager.appendCustomMessageEntry(
    "opencandle-run-cancelled",
    requiresReattachment
      ? "This run was interrupted when the browser runtime closed. Reattach your files or saved context, then send the prompt again."
      : "This run was interrupted when the browser runtime closed. Retry to start it again.",
    true,
    { reason: "interrupted", prompt: data.prompt, requiresReattachment },
  );
  manager.appendCustomEntry(HOSTED_RUN_FINISHED, { actionId: data.actionId });
  persistUnflushedSession(manager);
}


interface PiMessageOutcome {
  readonly role: string;
  readonly stopReason?: string;
  readonly errorMessage?: string;
}

export function assertTerminalAssistantSucceeded(messages: readonly PiMessageOutcome[]): void {
  const assistant = messages.findLast((message) => message.role === "assistant");
  if (assistant?.stopReason === "aborted") {
    throw new DOMException(assistant.errorMessage ?? "The operation was aborted", "AbortError");
  }
  if (assistant?.stopReason === "error") {
    throw new Error(assistant.errorMessage ?? "The model provider returned an error");
  }
}

export interface BrowserPiSessionResult {
  runtime: "pi-agent-session";
  sessionId: string;
  model: string;
  toolNames: string[];
  entries: SessionEntry[];
  events: ChatEvent[];
  turnEvents: ChatEvent[];
  snapshot: {
    format: "pi-jsonl";
    filename: string;
    content: string;
  };
  stateSnapshot: {
    format: "sqlite3";
    filename: "current.sqlite3";
    contentBase64: string;
  };
  stateSummary: {
    defaultWatchlistId: number;
    watchlistCount: number;
  };
}

export interface BrowserPiSessionOptions {
  cwd?: string;
  sessionDir?: string;
  restoredSessionFile?: string;
  stateFile?: string;
  stateDatabase?: SqlJsStateDatabase;
  writeCurrentAlias?: boolean;
  providerId: FirstClassModelProviderId;
  modelId: string;
  credentials: BrowserModelCredentials;
  toolDefinitions?: ToolDefinition[];
  askUserHandler?: AskUserHandler;
}

export interface BrowserPiThinkingState {
  current: ThinkingLevel;
  available: ThinkingLevel[];
}

export class BrowserPiSession {
  private constructor(
    private readonly session: AgentSession,
    private readonly sessionManager: SessionManager,
    private readonly waitForSettled: () => Promise<void>,
    private readonly stateDatabase: SqlJsStateDatabase,
    private readonly stateFile: string,
    private readonly ownsStateDatabase: boolean,
    private readonly writeCurrentAlias: boolean,
  ) {}

  static async create(options: BrowserPiSessionOptions): Promise<BrowserPiSession> {
    const cwd = options.cwd ?? process.cwd();
    const sessionDir = options.sessionDir ?? join(cwd, "sessions");
    mkdirSync(sessionDir, { recursive: true });

    const modelRuntime = await createBrowserModelRuntime(options.credentials);
    const model = modelRuntime.getModel(options.providerId, options.modelId) as
      | Model<string>
      | undefined;
    if (!model || !modelRuntime.hasConfiguredAuth(model.provider)) {
      throw new Error(`Model is not configured: ${options.providerId}/${options.modelId}`);
    }

    const restoredFile = options.restoredSessionFile;
    const sessionManager =
      restoredFile && existsSync(restoredFile)
        ? SessionManager.open(restoredFile, sessionDir, cwd)
        : SessionManager.create(cwd, sessionDir);
    const existing = sessionManager.buildSessionContext();
    if (
      existing.model?.provider !== model.provider ||
      existing.model?.modelId !== model.id
    ) {
      sessionManager.appendModelChange(model.provider, model.id);
    }
    if (existing.thinkingLevel == null) {
      sessionManager.appendThinkingLevelChange("off");
    }

    const stateFile = options.stateFile ?? join(cwd, "state", "current.sqlite3");
    mkdirSync(dirname(stateFile), { recursive: true });
    const ownsStateDatabase = !options.stateDatabase;
    const stateDatabase =
      options.stateDatabase ??
      createSqlJsStateDatabaseWithModule(
        await initSqlJs({
          locateFile: () => join(cwd, "sql-wasm.wasm"),
        }),
        existsSync(stateFile) ? readFileSync(stateFile) : undefined,
      );

    const settingsManager = SettingsManager.inMemory({
      defaultProvider: model.provider,
      defaultModel: model.id,
      defaultThinkingLevel: existing.thinkingLevel ?? "off",
      compaction: { enabled: true },
    });
    const sessionHandle = await createOpenCandleSessionCore({
      cwd,
      agentDir: join(cwd, ".pi-agent"),
      modelRuntime,
      model,
      thinkingLevel: existing.thinkingLevel ?? "off",
      settingsManager,
      sessionManager,
      askUserHandler: options.askUserHandler,
      stateDatabaseFactory: () => stateDatabase,
      toolDefinitions: options.toolDefinitions,
      routerLlmClient: createPiAiRouterClient(
        model,
        modelRuntime.completeSimple.bind(modelRuntime),
      ),
      toolDefaultsFactory: (database) => getAllDefaults(database),
    });
    const { session, coordinator } = sessionHandle;
    if (!coordinator) throw new Error("OpenCandle session did not initialize its coordinator");
    return new BrowserPiSession(
      session,
      sessionManager,
      sessionHandle.waitForSettled,
      stateDatabase,
      stateFile,
      ownsStateDatabase,
      options.writeCurrentAlias === true,
    );
  }

  async prompt(
    question: string,
    signal?: AbortSignal,
    images: ImageContent[] = [],
  ): Promise<BrowserPiSessionResult> {
    const beforeEntryCount = this.sessionManager.getEntries().length;
    const abort = () => {
      void this.session.abort();
    };
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await this.session.prompt(question, { images });
      await this.waitForSettled();
      assertTerminalAssistantSucceeded(this.session.state.messages);
      const sessionFile = this.sessionManager.getSessionFile();
      if (!sessionFile || !existsSync(sessionFile)) {
        throw new Error("Pi session did not produce a durable JSONL file");
      }
      const content = readFileSync(sessionFile, "utf8");
      if (this.writeCurrentAlias) {
        const checkpointFile = join(dirname(sessionFile), "current.jsonl");
        if (checkpointFile !== sessionFile) writeFileSync(checkpointFile, content, "utf8");
      }
      const marketState = new MarketStateService(this.stateDatabase);
      const defaultWatchlist = marketState.getDefaultWatchlist();
      const watchlistCount = marketState.listWatchlists().length;
      const stateBytes = this.stateDatabase.exportBytes();
      const entries = this.sessionManager.getEntries();
      return {
        runtime: "pi-agent-session",
        sessionId: this.sessionManager.getSessionId(),
        model: this.session.model
          ? `${this.session.model.provider}/${this.session.model.id}`
          : "unconfigured",
        toolNames: this.session.getActiveToolNames(),
        entries: entries.slice(-MAX_RETURNED_ENTRIES),
        events: sessionEntriesToChatEvents(entries, {
          sessionId: this.sessionManager.getSessionId(),
        }),
        turnEvents: sessionEntriesToChatEvents(entries.slice(beforeEntryCount), {
          sessionId: this.sessionManager.getSessionId(),
        }),
        snapshot: {
          format: "pi-jsonl",
          filename: "current.jsonl",
          content,
        },
        stateSnapshot: {
          format: "sqlite3",
          filename: "current.sqlite3",
          contentBase64: Buffer.from(stateBytes).toString("base64"),
        },
        stateSummary: {
          defaultWatchlistId: defaultWatchlist.id,
          watchlistCount,
        },
      };
    } finally {
      writeFileSync(this.stateFile, this.stateDatabase.exportBytes());
      signal?.removeEventListener("abort", abort);
    }
  }

  markOriginalInput(
    original: string,
    attachments: readonly { kind: string; label: string }[],
  ): void {
    if (!shouldPersistOriginalInputMarker(original, attachments)) return;
    this.sessionManager.appendCustomEntry("opencandle-user-input", {
      original,
      attachments: [...attachments],
    });
  }

  markRunStarted(actionId: string, prompt: string, attachments: readonly { kind: string; label: string }[]): void {
    this.sessionManager.appendCustomEntry(HOSTED_RUN_PENDING, { actionId, prompt, attachments: [...attachments] });
    persistUnflushedSession(this.sessionManager);
  }

  markRunFinished(actionId: string): void {
    this.sessionManager.appendCustomEntry(HOSTED_RUN_FINISHED, { actionId });
    persistUnflushedSession(this.sessionManager);
  }

  markStoppedRun(actionId: string, prompt: string): void {
    const entries = this.sessionManager.getEntries();
    const pendingIndex = entries.findLastIndex(
      (entry) => entry.type === "custom" && entry.customType === HOSTED_RUN_PENDING &&
        (entry.data as { actionId?: string })?.actionId === actionId,
    );
    const runEntries = pendingIndex < 0 ? [] : entries.slice(pendingIndex + 1);
    if (pendingIndex >= 0 && !runEntries.some((entry) => entry.type === "message" && entry.message.role === "user")) {
      const pending = entries[pendingIndex];
      const attachments = pending.type === "custom" ? (pending.data as { attachments?: unknown })?.attachments : [];
      const requiresReattachment = Array.isArray(attachments) && attachments.length > 0;
      this.sessionManager.appendCustomEntry("opencandle-user-input", { original: prompt, attachments: attachments ?? [] });
      this.sessionManager.appendMessage({ role: "user", content: prompt, timestamp: Date.now() });
      this.sessionManager.appendCustomMessageEntry(
        "opencandle-run-cancelled",
        requiresReattachment
          ? "Run stopped before it started. Reattach your files or saved context, then send the prompt again."
          : "Run stopped before it started. Retry to start it again.",
        true,
        { reason: "cancelled", prompt, requiresReattachment },
      );
    }
    this.sessionManager.appendCustomEntry(
      RUN_STOPPED_CUSTOM_TYPE,
      buildRunStoppedMarker(runEntries, {
        actionId,
        prompt,
      }),
    );
    persistUnflushedSession(this.sessionManager);
  }

  abort(): void {
    void this.session.abort();
  }

  subscribe(handler: (event: AgentSessionEvent) => void): () => void {
    return this.session.subscribe(handler);
  }

  getThinkingState(): BrowserPiThinkingState {
    return {
      current: this.session.thinkingLevel,
      available: this.session.getAvailableThinkingLevels(),
    };
  }

  setThinkingLevel(level: ThinkingLevel): BrowserPiThinkingState {
    if (!this.session.getAvailableThinkingLevels().includes(level)) {
      throw new Error(`Unsupported thinking level: ${level}`);
    }
    this.session.setThinkingLevel(level);
    return this.getThinkingState();
  }

  dispose(): void {
    this.session.dispose();
    if (this.ownsStateDatabase) this.stateDatabase.close();
  }
}
