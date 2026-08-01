import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import initSqlJs from "sql.js";
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
import { MarketStateService } from "../../../src/market-state/service.js";
import { getAllDefaults } from "../../../src/memory/tool-defaults.js";
import { createOpenCandleSessionCore } from "../../../src/pi/session-core.js";
import type { SessionCoordinator } from "../../../src/runtime/session-coordinator.js";
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
  onDurableEvents?: (events: ChatEvent[]) => void | Promise<void>;
  toolDefinitions?: ToolDefinition[];
  askUserHandler?: AskUserHandler;
}

export class BrowserPiSession {
  private constructor(
    private readonly session: AgentSession,
    private readonly sessionManager: SessionManager,
    private readonly coordinator: SessionCoordinator,
    private readonly stateDatabase: SqlJsStateDatabase,
    private readonly stateFile: string,
    private readonly ownsStateDatabase: boolean,
    private readonly writeCurrentAlias: boolean,
    private readonly unsubscribe: () => void,
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
    if (existing.messages.length === 0) {
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
    let coordinator: SessionCoordinator | undefined;
    const { session } = await createOpenCandleSessionCore({
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
      onCoordinatorCreated: (value) => {
        coordinator = value;
      },
    });
    if (!coordinator) throw new Error("OpenCandle session did not initialize its coordinator");
    let projectedEventCount = sessionEntriesToChatEvents(sessionManager.getEntries(), {
      sessionId: sessionManager.getSessionId(),
    }).length;
    const unsubscribe = session.subscribe(async (event: AgentSessionEvent) => {
      if (
        !options.onDurableEvents ||
        (event.type !== "message_end" &&
          event.type !== "turn_end" &&
          event.type !== "agent_end" &&
          event.type !== "compaction_end")
      ) {
        return;
      }
      const projected = sessionEntriesToChatEvents(sessionManager.getEntries(), {
        sessionId: sessionManager.getSessionId(),
      });
      const next = projected.slice(projectedEventCount);
      projectedEventCount = projected.length;
      if (next.length > 0) await options.onDurableEvents(next);
    });

    return new BrowserPiSession(
      session,
      sessionManager,
      coordinator,
      stateDatabase,
      stateFile,
      ownsStateDatabase,
      options.writeCurrentAlias === true,
      unsubscribe,
    );
  }

  async prompt(
    question: string,
    signal?: AbortSignal,
    images: ImageContent[] = [],
  ): Promise<BrowserPiSessionResult> {
    const abort = () => {
      void this.session.abort();
    };
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await this.session.prompt(question, { images });
      await this.coordinator.waitForActiveWorkflow();
      await this.session.waitForIdle();
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
    if (attachments.length === 0) return;
    this.sessionManager.appendCustomEntry("opencandle-user-input", {
      original,
      attachments: [...attachments],
    });
  }

  abort(): void {
    void this.session.abort();
  }

  dispose(): void {
    this.unsubscribe();
    this.session.dispose();
    if (this.ownsStateDatabase) this.stateDatabase.close();
  }
}

export async function runBrowserPiSession(
  question: string,
  providerId: FirstClassModelProviderId,
  modelId: string,
  apiKey: string,
): Promise<BrowserPiSessionResult> {
  const cwd = process.cwd();
  const session = await BrowserPiSession.create({
    cwd,
    sessionDir: join(cwd, "sessions"),
    restoredSessionFile: join(cwd, "sessions", "current.jsonl"),
    stateFile: join(cwd, "state", "current.sqlite3"),
    writeCurrentAlias: true,
    providerId,
    modelId,
    credentials: { [providerId]: apiKey },
  });
  try {
    return await session.prompt(question);
  } finally {
    session.dispose();
  }
}
