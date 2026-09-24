import type { Page } from "playwright-core";

export function toolRunEntries(toolCallId: string, symbol: string) {
  return [
    {
      type: "message",
      id: `assistant-${symbol.toLowerCase()}-tool`,
      timestamp: new Date().toISOString(),
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: toolCallId,
            name: "get_stock_quote",
            arguments: { symbol },
          },
        ],
      },
    },
    {
      type: "message",
      id: `tool-result-${symbol.toLowerCase()}`,
      timestamp: new Date().toISOString(),
      message: {
        role: "toolResult",
        toolCallId,
        toolName: "get_stock_quote",
        content: `${symbol} quote`,
        details: { symbol },
      },
    },
  ];
}

export function longTranscriptEntries(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const turn = index + 1;
    const role = turn % 2 === 0 ? "assistant" : "user";
    const id = `${role}-${turn}`;
    return {
      type: "message",
      id,
      timestamp: new Date().toISOString(),
      message: {
        role,
        content:
          role === "user"
            ? `User turn ${turn}: compare AAPL, MSFT, and NVDA with enough detail for scrolling.`
            : `Assistant turn ${turn}: here is a concise market summary with valuation, momentum, risk, and data quality notes.`,
      },
    };
  });
}

export async function installMockHttpBootstrap(
  page: Page,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await page.addInitScript((mockOverrides) => {
    const bootSessionId = mockOverrides.sessionId ?? "mock-session";
    window.WebSocket = function BrokenWebSocket() {
      throw new TypeError("WebSocket is not a constructor");
    };
    window.fetch = (input) => {
      const rawUrl = typeof input === "string" ? input : input.url;
      const url = new URL(rawUrl, window.location.origin);
      if (url.pathname === "/api/bootstrap") {
        const entries = mockOverrides.entries ?? [];
        return Promise.resolve(
          new Response(
            JSON.stringify({
              role: mockOverrides.role ?? "writer",
              supportsSessionActions: mockOverrides.supportsSessionActions ?? false,
              sessionId: bootSessionId,
              sessions: mockOverrides.sessions ?? [],
              catalog: mockOverrides.catalog ?? { tools: [], workflows: [], providers: [] },
              modelSetup: mockOverrides.modelSetup ?? {
                requirement: "ready",
                providers: [],
                availableModels: [],
              },
              askUserPrompts: mockOverrides.askUserPrompts ?? [],
              snapshot: snapshotPayload(bootSessionId, entries, mockOverrides),
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }
      const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/bootstrap$/);
      if (match) {
        const sessionId = decodeURIComponent(match[1]);
        const snapshot = mockOverrides.sessionBootstraps?.[sessionId];
        if (!snapshot) return Promise.resolve(new Response("Not found", { status: 404 }));
        const entries = snapshot.entries ?? [];
        return Promise.resolve(
          new Response(JSON.stringify(snapshotPayload(sessionId, entries, snapshot)), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("Not found", { status: 404 }));
    };

    function snapshotPayload(sessionId, entries, source) {
      return {
        sessionId,
        catalog: source.catalog ?? { tools: [], workflows: [], providers: [] },
        modelSetup: source.modelSetup ?? {
          requirement: "ready",
          providers: [],
          availableModels: [],
        },
        entries,
        events: source.events ?? entriesToEvents(entries, sessionId),
        state: source.state ?? {
          watchlist: [],
          activeAnalyses: [],
          recentResearch: [],
          dataQuality: { softGaps: [], hardSkips: [] },
        },
      };
    }

    function entriesToEvents(entries, fallbackSessionId) {
      let seq = 1;
      const events = [];
      const seenToolCalls = new Set();
      for (const entry of entries) {
        const sessionId = entry.sessionId ?? fallbackSessionId;
        if (entry.type !== "message") continue;
        const message = entry.message || {};
        if (message.role === "user" || message.role === "assistant") {
          events.push({
            type: "message.created",
            sessionId,
            messageId: entry.id,
            role: message.role,
            seq: seq++,
          });
          const content = [];
          for (const part of Array.isArray(message.content)
            ? message.content
            : [{ type: "text", text: String(message.content || "") }]) {
            if (part.type === "toolCall") {
              seenToolCalls.add(part.id);
              content.push({ type: "tool", toolCallId: part.id });
              events.push({
                type: "tool.started",
                sessionId,
                toolCallId: part.id,
                messageId: entry.id,
                name: part.name,
                input: part.arguments || {},
                seq: seq++,
              });
            } else {
              content.push(part);
            }
          }
          events.push({
            type: "message.completed",
            sessionId,
            messageId: entry.id,
            content,
            seq: seq++,
          });
        }
        if (message.role === "toolResult") {
          const toolCallId = message.toolCallId || `tool-${entry.id}`;
          if (!seenToolCalls.has(toolCallId)) {
            events.push({
              type: "tool.started",
              sessionId,
              toolCallId,
              messageId: entry.id,
              name: message.toolName || "tool",
              input: message.details?.args || {},
              seq: seq++,
            });
          }
          events.push({
            type: message.isError ? "tool.failed" : "tool.completed",
            sessionId,
            toolCallId,
            ...(message.isError
              ? {
                  error: {
                    message: String(message.content || ""),
                    details: message.details,
                  },
                }
              : {
                  output: {
                    content: [{ type: "text", text: String(message.content || "") }],
                    details: message.details,
                    isError: Boolean(message.isError),
                  },
                }),
            seq: seq++,
          });
        }
      }
      return events;
    }
  }, overrides);
}

export async function installMockSocket(
  page: Page,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await page.addInitScript((mockOverrides) => {
    const bootSessionId = mockOverrides.sessionId ?? "mock-session";
    class MockWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = MockWebSocket.OPEN;
      onopen = null;
      onmessage = null;
      onclose = null;
      onerror = null;
      sessions = [];

      constructor() {
        super();
        window.__mockWebSocketInstances = window.__mockWebSocketInstances || [];
        window.__mockWebSocketInstances.push(this);
        this.sessions = [...(mockOverrides.sessions ?? [])];
        setTimeout(() => {
          this.onopen?.(new Event("open"));
          this.emit({
            type: "boot",
            role: mockOverrides.role ?? "writer",
            supportsSessionActions: mockOverrides.supportsSessionActions ?? true,
            sessionPersisted: mockOverrides.sessionPersisted ?? false,
            sessionId: bootSessionId,
            // Mirrors the real GUI server's coordinationStateForSession: a
            // follower process never proxies market-state mutations to
            // another process's writer (only chat-run requests are
            // proxied), so it reports coordination.marketStateWritable=false unless a
            // test overrides it. supportsSessionActions stays true for a
            // follower because its chat prompts still queue behind the
            // writer -- see actionSurfaceRole() in runtime-transport.js.
            coordination: mockOverrides.coordination ?? {
              sessionId: bootSessionId,
              status: mockOverrides.role === "follower" ? "syncing" : "ready",
              marketStateWritable: mockOverrides.role !== "follower",
            },
            catalog: mockOverrides.catalog ?? { tools: [], workflows: [], providers: [] },
            modelSetup: mockOverrides.modelSetup ?? {
              requirement: "ready",
              providers: [],
              availableModels: [],
            },
          });
          this.emit({
            type: "state.snapshot",
            sessionId: bootSessionId,
            // Mirrors the real server's buildStateSnapshot(), which also
            // reports sessionPersisted: useGuiConnection's state.snapshot
            // handler re-derives currentSessionPersisted from this message
            // and would otherwise clobber the value the boot message set.
            sessionPersisted: mockOverrides.sessionPersisted ?? false,
            state: mockOverrides.dashboard ?? {
              watchlist: [],
              activeAnalyses: [],
              recentResearch: [],
              dataQuality: { softGaps: [], hardSkips: [] },
            },
            entries: mockOverrides.entries ?? [],
            events:
              mockOverrides.events ?? entriesToEvents(mockOverrides.entries ?? [], bootSessionId),
          });
          this.emit({ type: "sessions", sessions: this.sessions });
        }, 0);
      }

      send(message) {
        window.__wsMessages = window.__wsMessages || [];
        const parsed = JSON.parse(message);
        window.__wsMessages.push(parsed);
        if (parsed.type === "session.rename") {
          this.sessions = this.sessions.map((session) =>
            session.path === parsed.path ? { ...session, name: parsed.name } : session,
          );
          this.emit({ type: "sessions", sessions: this.sessions });
        }
        if (parsed.type === "session.delete") {
          this.sessions = this.sessions.filter((session) => session.path !== parsed.path);
          this.emit({ type: "sessions", sessions: this.sessions });
        }
        if (parsed.type === "model.setup.select_model") {
          this.emit({
            type: "model.setup",
            modelSetup: {
              ...(mockOverrides.modelSetup ?? {}),
              currentModel: `${parsed.provider}/${parsed.modelId}`,
            },
          });
        }
      }

      close() {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.(new CloseEvent("close"));
      }

      emit(payload) {
        const event = new MessageEvent("message", { data: JSON.stringify(payload) });
        this.dispatchEvent(event);
        this.onmessage?.(event);
      }
    }

    function entriesToEvents(entries, fallbackSessionId = bootSessionId) {
      let seq = 1;
      const events = [];
      const seenToolCalls = new Set();
      for (const entry of entries) {
        const sessionId = entry.sessionId ?? fallbackSessionId;
        if (entry.type === "custom_message") {
          events.push({
            type: "custom.message",
            sessionId,
            messageId: entry.id,
            customType: entry.customType || "custom",
            content: normalizeContent(entry.content),
            seq: seq++,
          });
          continue;
        }
        if (entry.type !== "message") continue;
        const message = entry.message || {};
        if (message.role === "user") {
          events.push({
            type: "message.created",
            sessionId,
            messageId: entry.id,
            role: "user",
            seq: seq++,
          });
          events.push({
            type: "message.completed",
            sessionId,
            messageId: entry.id,
            content: normalizeContent(message.content),
            seq: seq++,
          });
          continue;
        }
        if (message.role === "assistant") {
          events.push({
            type: "message.created",
            sessionId,
            messageId: entry.id,
            role: "assistant",
            seq: seq++,
          });
          const content = [];
          for (const part of Array.isArray(message.content)
            ? message.content
            : normalizeContent(message.content)) {
            if (part.type === "toolCall") {
              seenToolCalls.add(part.id);
              content.push({ type: "tool", toolCallId: part.id });
              events.push({
                type: "tool.started",
                sessionId,
                toolCallId: part.id,
                messageId: entry.id,
                name: part.name,
                input: part.arguments || {},
                seq: seq++,
              });
            } else {
              content.push(part);
            }
          }
          events.push({
            type: "message.completed",
            sessionId,
            messageId: entry.id,
            content,
            seq: seq++,
          });
          continue;
        }
        if (message.role === "toolResult") {
          const toolCallId = message.toolCallId || `tool-${entry.id}`;
          if (!seenToolCalls.has(toolCallId)) {
            events.push({
              type: "tool.started",
              sessionId,
              toolCallId,
              messageId: entry.id,
              name: message.toolName || "tool",
              input: message.details?.args || {},
              seq: seq++,
            });
          }
          events.push({
            type: message.isError ? "tool.failed" : "tool.completed",
            sessionId,
            toolCallId,
            ...(message.isError
              ? { error: { message: textContent(message.content), details: message.details } }
              : {
                  output: {
                    content: normalizeContent(message.content),
                    details: message.details,
                    isError: Boolean(message.isError),
                  },
                }),
            seq: seq++,
          });
        }
      }
      return events;
    }

    function normalizeContent(content) {
      if (Array.isArray(content)) return content;
      return [{ type: "text", text: String(content || "") }];
    }

    function textContent(content) {
      return normalizeContent(content)
        .map((part) => part.text || "")
        .join("");
    }

    window.WebSocket = MockWebSocket;
  }, overrides);
}

export async function installMockMarketState(
  page: Page,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await page.addInitScript((marketStateOverrides) => {
    const emptyMarketState = {
      instrumentCandidates: [],
      watchlist: [],
      portfolio: [],
      alerts: [],
      alertEvents: [],
      alertCheckRuns: [],
      reportTemplates: [],
      reportRuns: [],
      runnerLease: null,
      notifications: [],
      notificationDeliveryAttempts: [],
      quoteSnapshot: null,
    };
    const marketState = { ...emptyMarketState, ...marketStateOverrides };
    window.fetch = (input) => {
      const url = typeof input === "string" ? input : input.url;
      const parsedUrl = new URL(url, window.location.href);
      if (parsedUrl.pathname === "/api/instruments/search") {
        const query = parsedUrl.searchParams.get("q") || "";
        return Promise.resolve(
          new Response(
            JSON.stringify({
              query,
              candidates: marketState.instrumentCandidates,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }
      if (parsedUrl.pathname === "/api/market-state") {
        const {
          instrumentCandidates: _instrumentCandidates,
          quoteSnapshot,
          ...snapshot
        } = marketState;
        return Promise.resolve(
          new Response(JSON.stringify(snapshot), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (parsedUrl.pathname === "/api/market-state/quotes") {
        return Promise.resolve(
          new Response(
            JSON.stringify(
              marketState.quoteSnapshot ?? {
                watchlistQuotes: [],
                portfolioQuotes: [],
                portfolioSummary: null,
              },
            ),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }
      if (parsedUrl.pathname === "/api/chat/run") {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const send = (payload) =>
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            send({ type: "run.started", runId: "mock-run", sessionId: "mock-session", seq: 1 });
            send({ type: "run.completed", runId: "mock-run", sessionId: "mock-session", seq: 2 });
            controller.close();
          },
        });
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      }
      return Promise.resolve(new Response("Not found", { status: 404, statusText: "Not found" }));
    };
  }, overrides);
}

export async function installTwoClientCoordinatorMock(
  page: Page,
  sessionId: string,
): Promise<void> {
  await page.addInitScript((mockSessionId) => {
    window.__coordinatedRequests = [];
    window.WebSocket = function BrokenWebSocket() {
      throw new TypeError("WebSocket is not a constructor");
    };
    window.fetch = async (input, init) => {
      const rawUrl = typeof input === "string" ? input : input.url;
      const url = new URL(rawUrl, window.location.origin);
      if (url.pathname === "/api/bootstrap" || url.pathname.endsWith("/bootstrap")) {
        return jsonResponse({
          role: "writer",
          supportsSessionActions: true,
          sessionId: mockSessionId,
          sessions: [],
          catalog: { tools: [], workflows: [], providers: [] },
          modelSetup: { requirement: "ready", providers: [], availableModels: [] },
          askUserPrompts: [],
          coordination: { sessionId: mockSessionId, status: "ready" },
          snapshot: {
            sessionId: mockSessionId,
            entries: [],
            events: [],
            state: {
              watchlist: [],
              activeAnalyses: [],
              recentResearch: [],
              dataQuality: { softGaps: [], hardSkips: [] },
            },
          },
        });
      }
      if (url.pathname === `/api/sessions/${mockSessionId}/runs`) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        window.__coordinatedRequests.push({
          url: url.pathname,
          prompt: body.prompt,
          actionId: body.actionId,
        });
        if (body.prompt === "Second browser prompt") {
          return jsonResponse(
            {
              code: "session_busy",
              error: "OpenCandle is still working in this session. Try again when it finishes.",
            },
            409,
          );
        }
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            start(controller) {
              const send = (event) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              };
              send({ type: "run.started", sessionId: mockSessionId, runId: "run-1", seq: 1 });
              send({
                type: "message.completed",
                sessionId: mockSessionId,
                messageId: "assistant-1",
                role: "assistant",
                content: [{ type: "text", text: "First browser answer" }],
                seq: 2,
              });
              send({ type: "run.completed", sessionId: mockSessionId, runId: "run-1", seq: 3 });
              controller.close();
            },
          }),
          {
            status: 200,
            headers: { "content-type": "text/event-stream; charset=utf-8" },
          },
        );
      }
      return new Response("Not found", { status: 404 });
    };

    function jsonResponse(payload, status = 200) {
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    }
  }, sessionId);
}

export async function installConcurrentSessionRunMock(
  page: Page,
  options: { sessionId: string; prompt: string; holdOpen: boolean; answer: string },
): Promise<void> {
  await page.addInitScript((mockOptions) => {
    window.__concurrentSessionRequests = [];
    window.WebSocket = function BrokenWebSocket() {
      throw new TypeError("WebSocket is not a constructor");
    };
    window.fetch = async (input, init = {}) => {
      const rawUrl = typeof input === "string" ? input : input.url;
      const url = new URL(rawUrl, window.location.origin);
      if (url.pathname === "/api/bootstrap" || url.pathname.endsWith("/bootstrap")) {
        return jsonResponse(buildBootstrap(mockOptions.sessionId));
      }
      if (url.pathname === `/api/sessions/${mockOptions.sessionId}/runs`) {
        const body = JSON.parse(String(init.body ?? "{}"));
        const request = {
          sessionId: body.sessionId,
          prompt: body.prompt,
          actionId: body.actionId,
          aborted: false,
        };
        window.__concurrentSessionRequests.push(request);
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            start(controller) {
              init.signal?.addEventListener("abort", () => {
                request.aborted = true;
                controller.error(new DOMException("Aborted", "AbortError"));
              });
              const send = (event) =>
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              send({
                type: "run.started",
                sessionId: mockOptions.sessionId,
                runId: "run-1",
                seq: 1,
              });
              if (mockOptions.holdOpen) return;
              send({
                type: "message.completed",
                sessionId: mockOptions.sessionId,
                messageId: "assistant-1",
                role: "assistant",
                content: [{ type: "text", text: mockOptions.answer }],
                seq: 2,
              });
              send({
                type: "run.completed",
                sessionId: mockOptions.sessionId,
                runId: "run-1",
                seq: 3,
              });
              controller.close();
            },
          }),
          {
            status: 200,
            headers: { "content-type": "text/event-stream; charset=utf-8" },
          },
        );
      }
      if (url.pathname === "/api/market-state/quotes") {
        return jsonResponse({ watchlistQuotes: [], portfolioQuotes: [], portfolioSummary: null });
      }
      return new Response("Not found", { status: 404 });
    };

    function buildBootstrap(sessionId) {
      return {
        role: "writer",
        supportsSessionActions: true,
        sessionId,
        sessions: [{ id: sessionId, name: sessionId, path: `${sessionId}.jsonl` }],
        catalog: { tools: [], workflows: [], providers: [] },
        modelSetup: { requirement: "ready", providers: [], availableModels: [] },
        askUserPrompts: [],
        coordination: { sessionId, status: "ready" },
        snapshot: {
          sessionId,
          entries: [],
          events: [],
          state: {
            watchlist: [],
            activeAnalyses: [],
            recentResearch: [],
            dataQuality: { softGaps: [], hardSkips: [] },
          },
        },
      };
    }

    function jsonResponse(payload, status = 200) {
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    }
  }, options);
}
