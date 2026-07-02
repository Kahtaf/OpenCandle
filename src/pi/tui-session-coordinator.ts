import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import {
  clearPendingSessionAction,
  hasAcceptedSessionAction,
  hasPendingSessionAction,
  recordAcceptedSessionAction,
  recordPendingSessionAction,
} from "./session-action-dedupe.js";

interface TuiSessionCoordinatorOptions {
  getSession: () => AgentSession;
  getSessionManager: () => SessionManager;
  getModelUnavailableMessage: () => string | null;
  syncWriterLockScope?: () => void;
  now?: () => number;
}

export interface TuiSessionCoordinatorServer {
  endpoint: string;
  secret: string;
  close(): Promise<void>;
}

interface AcceptedAction {
  expiresAt: number;
}

const DEDUPE_RETENTION_MS = 10 * 60 * 1000;

export async function startTuiSessionCoordinatorServer(
  options: TuiSessionCoordinatorOptions,
): Promise<TuiSessionCoordinatorServer> {
  const now = options.now ?? Date.now;
  const secret = randomBytes(32).toString("base64url");
  const acceptedActions = new Map<string, AcceptedAction>();
  const activeRunSessions = new Set<string>();

  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(res, { error: message }, 500);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${address.port}`;

  return {
    endpoint,
    secret,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", endpoint);
    if (url.pathname !== "/api/local-coordinator/chat-run" || req.method !== "POST") {
      writeJson(res, { error: "Not found" }, 404);
      return;
    }

    if (
      !isLoopbackAddress(req.socket.remoteAddress) ||
      req.headers["x-opencandle-coordinator-secret"] !== secret
    ) {
      writeJson(res, { error: "Local coordinator request was not authorized." }, 403);
      return;
    }

    const body = asRecord(await readJsonBody(req));
    const prompt = String(body.prompt ?? "").trim();
    const requestedSessionId = String(body.sessionId ?? "").trim();
    const actionId = String(body.actionId ?? "").trim() || `legacy-tui-chat-${now()}`;
    const sessionManager = options.getSessionManager();
    const sessionId = sessionManager.getSessionId();
    if (!prompt) {
      writeJson(res, { error: "prompt is required" }, 400);
      return;
    }
    if (requestedSessionId && requestedSessionId !== sessionId) {
      writeJson(
        res,
        { error: "Session route and request body disagree", code: "session_changed" },
        409,
      );
      return;
    }
    try {
      options.syncWriterLockScope?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(res, { error: message, code: "syncing" }, 409);
      return;
    }

    pruneExpiredActions();
    const actionKey = `${sessionId}:${actionId}`;
    if (acceptedActions.has(actionKey) || hasAcceptedSessionAction(sessionManager, actionId)) {
      writeJson(res, { ok: true, duplicate: true });
      return;
    }
    if (hasPendingSessionAction(sessionManager, actionId)) {
      writeJson(
        res,
        { error: "OpenCandle is reconnecting to this session.", code: "syncing" },
        409,
      );
      return;
    }
    let session: AgentSession;
    try {
      session = options.getSession();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(res, { error: message, code: "session_starting" }, 409);
      return;
    }
    if (
      activeRunSessions.has(sessionId) ||
      session.isStreaming ||
      session.pendingMessageCount > 0
    ) {
      writeJson(
        res,
        {
          error: "OpenCandle is still working in this session. Try again when it finishes.",
          code: "session_busy",
        },
        409,
      );
      return;
    }

    activeRunSessions.add(sessionId);
    try {
      recordPendingSessionAction(sessionManager, actionId);
      let actionAccepted = false;
      const recordAcceptedAction = () => {
        if (actionAccepted) return;
        recordAcceptedSessionAction(sessionManager, actionId);
        options.syncWriterLockScope?.();
        acceptedActions.set(actionKey, { expiresAt: now() + DEDUPE_RETENTION_MS });
        actionAccepted = true;
      };
      let completed: boolean;
      try {
        completed = await streamPromptRun(res, prompt, sessionId, recordAcceptedAction);
      } catch (error) {
        if (!actionAccepted) clearPendingSessionAction(sessionManager, actionId);
        throw error;
      }
      if (completed) {
        recordAcceptedAction();
      } else if (!actionAccepted) {
        clearPendingSessionAction(sessionManager, actionId);
      }
    } finally {
      activeRunSessions.delete(sessionId);
    }
  }

  async function streamPromptRun(
    res: ServerResponse,
    prompt: string,
    sessionId: string,
    onPromptAdmitted: () => void,
  ): Promise<boolean> {
    options.syncWriterLockScope?.();
    const session = options.getSession();
    const sessionManager = options.getSessionManager();
    const beforeEntries = sessionManager.getEntries();
    const beforeCount = beforeEntries.length;
    let seq = 1;
    const runId = `tui-run-${now()}`;

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    writeSse(res, { type: "run.started", runId, sessionId, seq: seq++ });
    res.flushHeaders?.();

    try {
      const modelUnavailableMessage = options.getModelUnavailableMessage();
      if (!prompt.startsWith("/") && modelUnavailableMessage) {
        sessionManager.appendMessage({ role: "user", content: prompt, timestamp: now() });
        onPromptAdmitted();
        options.syncWriterLockScope?.();
        sessionManager.appendCustomMessageEntry(
          "opencandle-model-setup",
          modelUnavailableMessage,
          true,
          {
            source: "tui",
          },
        );
      } else {
        const unsubscribe = subscribeToPromptAdmission(session, prompt, onPromptAdmitted);
        try {
          await session.prompt(prompt);
          options.syncWriterLockScope?.();
          await waitForTurnSettlement(session);
        } finally {
          unsubscribe?.();
        }
      }
      const newEntries = sessionManager.getEntries().slice(beforeCount);
      for (const event of entriesToChatEvents(newEntries, sessionId, seq)) {
        writeSse(res, event);
        seq = event.seq + 1;
      }
      writeSse(res, { type: "run.completed", runId, sessionId, seq });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeSse(res, { type: "run.failed", runId, sessionId, error: { message }, seq });
      return false;
    } finally {
      res.end();
    }
  }

  function pruneExpiredActions(): void {
    const currentTime = now();
    for (const [actionKey, accepted] of acceptedActions) {
      if (accepted.expiresAt <= currentTime) acceptedActions.delete(actionKey);
    }
  }

  function subscribeToPromptAdmission(
    session: AgentSession,
    prompt: string,
    onPromptAdmitted: () => void,
  ): (() => void) | undefined {
    if (prompt.startsWith("/")) return undefined;
    const maybeSession = session as AgentSession & {
      subscribe?: (handler: (event: unknown) => void) => () => void;
    };
    if (typeof maybeSession.subscribe !== "function") return undefined;
    return maybeSession.subscribe((event) => {
      const record = asRecord(event);
      if (record.type !== "message_start") return;
      const message = asRecord(record.message);
      if (message.role !== "user") return;
      if (messageTextFromContent(message.content).trim() === prompt.trim()) onPromptAdmitted();
    });
  }
}

async function waitForTurnSettlement(session: AgentSession): Promise<void> {
  const startedAt = Date.now();
  while (session.isStreaming || session.pendingMessageCount > 0) {
    if (Date.now() - startedAt > 120_000) {
      throw new Error("Timed out waiting for session turn to settle");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function entriesToChatEvents(
  entries: unknown[],
  sessionId: string,
  startSeq: number,
): Array<Record<string, unknown> & { seq: number }> {
  let seq = startSeq;
  const events: Array<Record<string, unknown> & { seq: number }> = [];
  for (const entry of entries) {
    const record = asRecord(entry);
    const message = asRecord(record.message);
    const source = Object.keys(message).length > 0 ? message : record;
    const role =
      typeof source.role === "string"
        ? source.role
        : record.type === "custom_message"
          ? "assistant"
          : undefined;
    const content = normalizeContent(source.content);
    if (!role || content.length === 0) continue;
    events.push({
      type: "message.completed",
      sessionId,
      messageId: String(record.id ?? `tui-entry-${seq}`),
      role,
      content,
      seq: seq++,
    });
  }
  return events;
}

function normalizeContent(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content.map(asRecord).filter((item) => item.type);
  const record = asRecord(content);
  if (typeof record.text === "string") return [{ type: "text", text: record.text }];
  return [];
}

function messageTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "object" && part !== null && "text" in part && typeof part.text === "string"
        ? part.text
        : "",
    )
    .join("");
}

function writeJson(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function writeSse(res: ServerResponse, event: unknown): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
