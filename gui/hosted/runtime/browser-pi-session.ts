import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import initSqlJs from "sql.js";
import { Agent } from "../../../node_modules/@earendil-works/pi-agent-core/dist/agent.js";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { convertToLlm } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/messages.js";
import { SessionManager } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js";
import { sessionEntriesToChatEvents } from "../../../gui/server/chat-event-adapter.js";
import type { ChatEvent } from "../../../gui/shared/chat-events.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import {
  createSqlJsStateDatabaseWithModule,
  type SqlJsStateDatabase,
} from "../../../src/runtime/sqljs-state-database.js";
import { BrowserOpenCandleExtensionHost } from "./browser-extension-host.js";
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
    private readonly model: Model<string>,
    private readonly sessionManager: SessionManager,
    private readonly host: BrowserOpenCandleExtensionHost,
    private readonly agent: Agent,
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

    const host = new BrowserOpenCandleExtensionHost(
      sessionManager,
      model,
      createPiAiRouterClient(model, modelRuntime.completeSimple.bind(modelRuntime)),
      stateDatabase,
      options.toolDefinitions,
      options.askUserHandler,
    );
    const agent = new Agent({
      initialState: {
        systemPrompt: "",
        model,
        thinkingLevel: existing.thinkingLevel ?? "off",
        tools: host.getAgentTools(),
        messages: existing.messages,
      },
      convertToLlm,
      streamFn: (nextModel, context, streamOptions) =>
        modelRuntime.streamSimple(nextModel, context, streamOptions),
      sessionId: sessionManager.getSessionId(),
    });
    host.bindAgent(agent);
    let projectedEventCount = sessionEntriesToChatEvents(sessionManager.getEntries(), {
      sessionId: sessionManager.getSessionId(),
    }).length;
    const unsubscribe = agent.subscribe(async (event) => {
      await host.handleAgentEvent(event);
      if (
        !options.onDurableEvents ||
        (event.type !== "message_end" && event.type !== "turn_end" && event.type !== "agent_end")
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
    await host.start();

    return new BrowserPiSession(
      model,
      sessionManager,
      host,
      agent,
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
    const abort = () => this.agent.abort();
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const input = await this.host.processInput(question);
      if (input.action === "handled") {
        throw new Error("Hosted Pi input was handled without producing a model turn");
      }
      this.agent.state.systemPrompt = await this.host.prepareSystemPrompt("");
      await this.agent.prompt(input.text, images);
      await this.host.waitForWorkflowIdle();
      await this.agent.waitForIdle();
      assertTerminalAssistantSucceeded(this.agent.state.messages);
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
      writeFileSync(this.stateFile, stateBytes);
      return {
        runtime: "pi-agent-session",
        sessionId: this.sessionManager.getSessionId(),
        model: `${this.model.provider}/${this.model.id}`,
        toolNames: this.host.getAgentTools().map((tool) => tool.name),
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
      signal?.removeEventListener("abort", abort);
    }
  }

  abort(): void {
    this.agent.abort();
  }

  dispose(): void {
    this.unsubscribe();
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
