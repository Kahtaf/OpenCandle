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
