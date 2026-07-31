import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
// The hosted bundle deliberately imports only the audited SessionManager leaf;
// the package root also pulls native/TUI surfaces that cannot run in WebContainer.
// The runtime composition build is the compatibility gate for this pinned path.
import { SessionManager } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js";
import { sessionEntriesToChatEvents } from "../../../gui/server/chat-event-adapter.js";
import { projectDashboard } from "../../../gui/server/projector.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import { getHostedBrowserCapabilityReport } from "../../../src/onboarding/providers.js";
import { getHostedOpenCandleToolDefinitions } from "../../../src/pi/hosted-tool-adapter.js";
import {
  createSqlJsStateDatabase,
  type SqlJsStateDatabase,
} from "../../../src/runtime/sqljs-state-database-node.js";
import { BrowserPiSession } from "./browser-pi-session.js";
import { invokeHostedMarketStateTool } from "./hosted-market-state-actions.js";

const MAX_SESSION_FILE_BYTES = 1_048_576;
const MAX_SESSION_FILES = 100;

export interface BrowserHostedGuiRuntimeOptions {
  cwd: string;
  sessionDir: string;
  stateFile: string;
  currentSessionId?: string;
  modelId?: string;
  apiKey?: string;
  createPiSession?: typeof BrowserPiSession.create;
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
    tools: Array<{ name: string; label: string; description: string }>;
    workflows: [];
    providers: Array<{
      id: "polymarket";
      name: "Polymarket";
      status: "ready";
      browserTransport: "direct";
    }>;
  };
  askUserPrompts: [];
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
  private readonly completedChatResults = new Map<
    string,
    BrowserHostedBootstrap & { events: Array<Record<string, unknown>> }
  >();
  private readonly actionResults = new Map<string, Promise<Record<string, unknown>>>();

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

  configureModel(modelId: string, apiKey: string): void {
    const normalizedKey = apiKey.trim();
    this.options.modelId = normalizedKey ? modelId : undefined;
    this.options.apiKey = normalizedKey || undefined;
  }

  async newSession(): Promise<BrowserHostedBootstrap> {
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
    const manager = await this.resolveManager(sessionId);
    const sessionFile = manager.getSessionFile();
    if (!sessionFile) throw new Error("Saved session file is unavailable");
    unlinkSync(sessionFile);
    if (this.currentSessionId === sessionId) this.currentSessionId = undefined;
    return this.bootstrap();
  }

  async chatRun(
    sessionId: string,
    prompt: string,
    actionId: string,
    onEvent?: (event: Record<string, unknown>) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<
    BrowserHostedBootstrap & {
      events: Array<Record<string, unknown>>;
    }
  > {
    const guardedSessionId = requireSessionId(sessionId);
    const guardedActionId = requireActionId(actionId);
    const actionKey = `${guardedSessionId}:${guardedActionId}`;
    const completed = this.completedChatResults.get(actionKey);
    if (completed) return completed;
    if (this.activeSessionRuns.has(guardedSessionId)) {
      throw new Error("A research run is already active for this session.");
    }
    this.activeSessionRuns.add(guardedSessionId);
    let session: Awaited<ReturnType<typeof BrowserPiSession.create>> | undefined;
    const runId = guardedActionId;
    let seq = 1;
    const streamedEvents: Array<Record<string, unknown>> = [];
    const emit = async (event: Record<string, unknown>) => {
      const sequenced = { ...event, runId, sessionId: guardedSessionId, seq: seq++ };
      streamedEvents.push(sequenced);
      await onEvent?.(sequenced);
    };
    try {
      const manager = await this.resolveManager(guardedSessionId);
      const sessionFile = manager.getSessionFile();
      if (!sessionFile) throw new Error("Saved session file is unavailable");
      if (!this.options.apiKey || !this.options.modelId) {
        throw new Error("Connect an OpenAI model before chat can run.");
      }
      await emit({ type: "run.started" });
      const createPiSession = this.options.createPiSession ?? BrowserPiSession.create;
      session = await createPiSession({
        cwd: this.options.cwd,
        sessionDir: this.options.sessionDir,
        restoredSessionFile: sessionFile,
        stateFile: this.options.stateFile,
        stateDatabase: this.stateDatabase,
        modelId: this.options.modelId,
        apiKey: this.options.apiKey,
        onDurableEvents: async (events) => {
          for (const event of events) await emit(event as Record<string, unknown>);
        },
      });
      const result = await session.prompt(prompt, signal);
      this.currentSessionId = result.sessionId;
      await emit({ type: "run.completed" });
      const completedResult = {
        ...(await this.buildBootstrap(await this.resolveManager(guardedSessionId))),
        events: streamedEvents,
      };
      this.completedChatResults.set(actionKey, completedResult);
      if (this.completedChatResults.size > 256) {
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
      this.activeSessionRuns.delete(guardedSessionId);
    }
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
    const existing = this.actionResults.get(key);
    if (existing) return existing;
    const operation = Promise.resolve().then(() => {
      const service = new MarketStateService(this.stateDatabase);
      const result = invokeHostedMarketStateTool(service, toolName, args);
      this.flushState();
      return { result };
    });
    this.actionResults.set(key, operation);
    if (this.actionResults.size > 256) {
      this.actionResults.delete(this.actionResults.keys().next().value as string);
    }
    operation.catch(() => this.actionResults.delete(key));
    return operation;
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

  private async buildBootstrap(manager: SessionManager): Promise<BrowserHostedBootstrap> {
    this.currentSessionId = manager.getSessionId();
    const entries = manager.getEntries();
    const sessionId = manager.getSessionId();
    const marketState = new MarketStateService(this.stateDatabase);
    const defaultWatchlist = marketState.getDefaultWatchlist();
    const symbols = marketState
      .listWatchlistItems(defaultWatchlist.id)
      .map((item) => item.symbol);
    const tools = getHostedOpenCandleToolDefinitions();
    const providers = getHostedBrowserCapabilityReport().direct;
    this.flushState();
    return {
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
        tools: tools.map(({ name, label, description }) => ({ name, label, description })),
        workflows: [],
        providers: providers.map((provider) => ({
          id: provider.id,
          name: provider.displayName,
          status: "ready",
          browserTransport: "direct",
        })),
      },
      askUserPrompts: [],
      snapshot: {
        sessionId,
        entries,
        events: sessionEntriesToChatEvents(entries, { sessionId }),
        state: projectDashboard(entries, sessionId, symbols),
      },
      checkpoint: this.checkpoint(),
    };
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
